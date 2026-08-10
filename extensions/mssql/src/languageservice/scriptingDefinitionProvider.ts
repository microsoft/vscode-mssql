/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { IServerInfo, IScriptingObject } from "vscode-mssql";
import {
    ScriptOperation,
    type IScriptingParams,
} from "../models/contracts/scripting/scriptingRequest";

/** A catalog object kind that can be scripted as a definition document. */
export type ScriptingDefinitionObjectKind =
    | "table"
    | "view"
    | "scalarFunction"
    | "tableValuedFunction"
    | "storedProcedure";

/**
 * Stable catalog identity used by the definition bridge. Names are unquoted
 * catalog values; use {@link catalogObjectFromMultipart} for parsed T-SQL names.
 */
export interface ScriptingDefinitionObject {
    readonly server?: string;
    readonly database?: string;
    readonly schema?: string;
    readonly name: string;
    readonly kind: ScriptingDefinitionObjectKind;
    readonly parentName?: string;
    readonly parentTypeName?: string;
}

/** Narrow dependency surface implemented by the existing ScriptingService. */
export interface ScriptingDefinitionScriptingApi {
    createScriptingRequestParams(
        serverInfo: IServerInfo,
        scriptingObject: IScriptingObject,
        ownerUri: string,
        operation: ScriptOperation,
    ): IScriptingParams;
    script(scriptingParams: IScriptingParams): Promise<string | undefined>;
}

/** Narrow connection lookup surface implemented by ConnectionManager. */
export interface ScriptingDefinitionConnectionResolver {
    getConnectionInfo(ownerUri: string):
        | {
              connectionId?: string;
              serverInfo?: IServerInfo;
              credentials?: {
                  database?: unknown;
                  options?: { database?: unknown };
              };
          }
        | undefined;
}

interface ResolvedObject extends ScriptingDefinitionObject {
    readonly connectionId: string;
    readonly database: string;
    readonly schema: string;
    readonly revision: string;
    readonly ownerUri: string;
}

interface ScriptCacheEntry {
    readonly key: string;
    readonly baseKey: string;
    readonly object: ResolvedObject;
    readonly uri: vscode.Uri;
    content?: string;
    pending?: Promise<string | undefined>;
}

/**
 * Read-only content provider and definition resolver for database objects.
 *
 * The bridge has no registrations of its own. Its owner should register it as a
 * text document content provider, then delegate external database objects from
 * a DefinitionProvider to {@link resolveDefinition}. A cache entry is scoped to
 * connection, database, object identity, and catalog revision, so a metadata
 * refresh can never return an old definition as the current one.
 */
export class ScriptingDefinitionProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    public static readonly scheme = "mssql-definition";

    private readonly _entries = new Map<string, ScriptCacheEntry>();
    private readonly _entriesByUri = new Map<string, ScriptCacheEntry>();
    private readonly _latestRevisionByObject = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    public readonly onDidChange = this._onDidChange.event;

    public constructor(
        private readonly _connections: ScriptingDefinitionConnectionResolver,
        private readonly _scripting: ScriptingDefinitionScriptingApi,
    ) {}

    /**
     * Resolves a catalog object to a virtual, read-only SQL document location.
     * Requests made with the same cache key share one Script As Create operation.
     * Cancellation only abandons the caller; it deliberately does not cancel a
     * shared scripting request which may still be needed by another editor.
     */
    public async resolveDefinition(
        ownerUri: vscode.Uri | string,
        object: ScriptingDefinitionObject,
        catalogRevision: string | number,
        token?: vscode.CancellationToken,
    ): Promise<vscode.Location | undefined> {
        if (token?.isCancellationRequested) {
            return undefined;
        }

        const ownerUriString = typeof ownerUri === "string" ? ownerUri : ownerUri.toString();
        const connection = this._connections.getConnectionInfo(ownerUriString);
        if (!connection?.connectionId || !connection.serverInfo) {
            return undefined;
        }

        const resolved = this.resolveObject(
            ownerUriString,
            connection.connectionId,
            connection.credentials,
            object,
            String(catalogRevision),
        );
        if (!resolved || !toScriptingObjectType(resolved.kind)) {
            return undefined;
        }

        const baseKey = this.baseKey(resolved);
        this._latestRevisionByObject.set(baseKey, resolved.revision);
        const entry = this.getOrCreateEntry(resolved, baseKey);
        const script = await this.awaitForCaller(this.load(entry, connection.serverInfo), token);

        if (
            !script ||
            token?.isCancellationRequested ||
            this._latestRevisionByObject.get(baseKey) !== resolved.revision
        ) {
            return undefined;
        }

        return new vscode.Location(entry.uri, findDefinitionRange(script, resolved));
    }

    /**
     * Returns cached content for a virtual definition document. The first call
     * may perform a Script As Create request if resolveDefinition registered the
     * URI but no caller has loaded its content yet.
     */
    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const entry = this._entriesByUri.get(uri.toString());
        if (!entry) {
            return "";
        }

        const connection = this._connections.getConnectionInfo(entry.object.ownerUri);
        if (!connection?.serverInfo) {
            return "";
        }

        try {
            return (await this.load(entry, connection.serverInfo)) ?? "";
        } catch {
            // TextDocumentContentProvider cannot surface a meaningful request
            // error. Definition resolution already returns undefined on errors.
            return "";
        }
    }

    /** Removes all cached scripts, or only scripts belonging to one connection. */
    public invalidate(connectionId?: string): void {
        for (const [key, entry] of this._entries) {
            if (connectionId && entry.object.connectionId !== connectionId) {
                continue;
            }
            this._entries.delete(key);
            this._entriesByUri.delete(entry.uri.toString());
            this._latestRevisionByObject.delete(entry.baseKey);
            this._onDidChange.fire(entry.uri);
        }
    }

    public dispose(): void {
        this._entries.clear();
        this._entriesByUri.clear();
        this._latestRevisionByObject.clear();
        this._onDidChange.dispose();
    }

    private resolveObject(
        ownerUri: string,
        connectionId: string,
        credentials: { database?: unknown; options?: { database?: unknown } } | undefined,
        object: ScriptingDefinitionObject,
        revision: string,
    ): ResolvedObject | undefined {
        const name = normalizeCatalogPart(object.name);
        const schema = normalizeCatalogPart(object.schema) || "dbo";
        const database =
            normalizeCatalogPart(object.database) || databaseFromCredentials(credentials) || "";
        if (!name) {
            return undefined;
        }

        return {
            ...object,
            name,
            schema,
            database,
            connectionId,
            revision,
            ownerUri,
        };
    }

    private getOrCreateEntry(resolved: ResolvedObject, baseKey: string): ScriptCacheEntry {
        const key = `${baseKey}|${resolved.revision}`;
        const existing = this._entries.get(key);
        if (existing) {
            return existing;
        }

        const entry: ScriptCacheEntry = {
            key,
            baseKey,
            object: resolved,
            uri: this.uriFor(resolved),
        };
        this._entries.set(key, entry);
        this._entriesByUri.set(entry.uri.toString(), entry);
        return entry;
    }

    private load(entry: ScriptCacheEntry, serverInfo: IServerInfo): Promise<string | undefined> {
        if (entry.content !== undefined) {
            return Promise.resolve(entry.content);
        }
        if (entry.pending) {
            return entry.pending;
        }

        const scriptingType = toScriptingObjectType(entry.object.kind);
        if (!scriptingType) {
            return Promise.resolve(undefined);
        }

        const scriptingObject: IScriptingObject = {
            type: scriptingType,
            schema: entry.object.schema,
            name: entry.object.name,
            ...(entry.object.parentName ? { parentName: entry.object.parentName } : {}),
            ...(entry.object.parentTypeName ? { parentTypeName: entry.object.parentTypeName } : {}),
        };
        const params = this._scripting.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            entry.object.ownerUri,
            ScriptOperation.Create,
        );

        entry.pending = this._scripting
            .script(params)
            .then((script) => {
                if (!script) {
                    return undefined;
                }
                // A newer catalog revision was requested while this round trip
                // was in flight. Do not publish its old text into a virtual
                // document after the newer definition has become authoritative.
                if (
                    this._entries.get(entry.key) !== entry ||
                    this._latestRevisionByObject.get(entry.baseKey) !== entry.object.revision
                ) {
                    return undefined;
                }
                entry.content = script;
                this._onDidChange.fire(entry.uri);
                return script;
            })
            .catch((error: unknown) => {
                if (this._entries.get(entry.key) === entry) {
                    this._entries.delete(entry.key);
                    this._entriesByUri.delete(entry.uri.toString());
                }
                throw error;
            })
            .finally(() => {
                entry.pending = undefined;
            });
        return entry.pending;
    }

    private uriFor(object: ResolvedObject): vscode.Uri {
        const segments = [
            object.database,
            object.schema,
            object.kind,
            object.name,
            object.parentTypeName ?? "",
            object.parentName ?? "",
        ].map(encodeURIComponent);
        return vscode.Uri.from({
            scheme: ScriptingDefinitionProvider.scheme,
            authority: encodeURIComponent(object.connectionId),
            path: `/${segments.join("/")}`,
            query: `revision=${encodeURIComponent(object.revision)}`,
        });
    }

    private baseKey(object: ResolvedObject): string {
        return JSON.stringify([
            object.connectionId,
            object.server ?? "",
            object.database,
            object.schema,
            object.kind,
            object.name,
            object.parentTypeName ?? "",
            object.parentName ?? "",
        ]);
    }

    private async awaitForCaller(
        promise: Promise<string | undefined>,
        token?: vscode.CancellationToken,
    ): Promise<string | undefined> {
        if (!token) {
            try {
                return await promise;
            } catch {
                return undefined;
            }
        }
        if (token.isCancellationRequested) {
            return undefined;
        }

        return await new Promise<string | undefined>((resolve) => {
            let complete = false;
            const finish = (value: string | undefined): void => {
                if (complete) {
                    return;
                }
                complete = true;
                cancellation.dispose();
                resolve(value);
            };
            const cancellation = token.onCancellationRequested(() => finish(undefined));
            void promise.then(
                (value) => finish(value),
                () => finish(undefined),
            );
        });
    }
}

/** Maps the beta catalog's object kinds to the ScriptingService SMO type names. */
export function toScriptingObjectType(kind: ScriptingDefinitionObjectKind): string | undefined {
    switch (kind) {
        case "table":
            return "Table";
        case "view":
            return "View";
        case "storedProcedure":
            return "StoredProcedure";
        case "scalarFunction":
        case "tableValuedFunction":
            return "UserDefinedFunction";
        default:
            return undefined;
    }
}

/**
 * Converts a parsed multipart name to a catalog identity. One-part names use
 * dbo, while three- and four-part names retain their database/server qualifiers.
 */
export function catalogObjectFromMultipart(
    parts: readonly string[],
    kind: ScriptingDefinitionObjectKind,
): ScriptingDefinitionObject | undefined {
    const identifiers = parts.map(normalizeCatalogPart);
    if (identifiers.some((part) => !part) || identifiers.length === 0 || identifiers.length > 4) {
        return undefined;
    }

    switch (identifiers.length) {
        case 1:
            return { schema: "dbo", name: identifiers[0], kind };
        case 2:
            return { schema: identifiers[0], name: identifiers[1], kind };
        case 3:
            return {
                database: identifiers[0],
                schema: identifiers[1],
                name: identifiers[2],
                kind,
            };
        case 4:
            return {
                server: identifiers[0],
                database: identifiers[1],
                schema: identifiers[2],
                name: identifiers[3],
                kind,
            };
        default:
            return undefined;
    }
}

function normalizeCatalogPart(value: string | undefined): string {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length < 2) {
        return trimmed;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.slice(1, -1).replaceAll("]]", "]");
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replaceAll('""', '"');
    }
    return trimmed;
}

function databaseFromCredentials(
    credentials: { database?: unknown; options?: { database?: unknown } } | undefined,
): string {
    const database = credentials?.database ?? credentials?.options?.database;
    return typeof database === "string" ? normalizeCatalogPart(database) : "";
}

function findDefinitionRange(script: string, object: ResolvedObject): vscode.Range {
    const objectType = createTypePattern(object.kind);
    const schema = identifierPattern(object.schema);
    const name = identifierPattern(object.name);
    const declaration = new RegExp(
        `\\bCREATE\\s+(?:OR\\s+ALTER\\s+)?${objectType}\\s+(?:${schema}\\s*\\.\\s*)?(${name})`,
        "iu",
    ).exec(script);
    const match = declaration ?? new RegExp(name, "iu").exec(script);
    if (!match) {
        return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    }

    const selected = declaration ? declaration[1] : match[0];
    const startOffset = match.index + match[0].lastIndexOf(selected);
    return new vscode.Range(
        positionAt(script, startOffset),
        positionAt(script, startOffset + selected.length),
    );
}

function createTypePattern(kind: ScriptingDefinitionObjectKind): string {
    switch (kind) {
        case "table":
            return "TABLE";
        case "view":
            return "VIEW";
        case "storedProcedure":
            return "(?:PROCEDURE|PROC)";
        case "scalarFunction":
        case "tableValuedFunction":
            return "FUNCTION";
    }
}

function identifierPattern(identifier: string): string {
    const escaped = escapeRegExp(identifier);
    const bracketed = `\\[${escapeRegExp(identifier.replaceAll("]", "]]"))}\\]`;
    const quoted = `"${escapeRegExp(identifier.replaceAll('"', '""'))}"`;
    return `(?:${bracketed}|${quoted}|${escaped})`;
}

function escapeRegExp(value: string): string {
    const metaCharacters = new Set([
        "\\",
        "^",
        "$",
        ".",
        "*",
        "+",
        "?",
        "(",
        ")",
        "[",
        "]",
        "{",
        "}",
        "|",
    ]);
    return [...value]
        .map((character) => (metaCharacters.has(character) ? `\\${character}` : character))
        .join("");
}

function positionAt(text: string, offset: number): vscode.Position {
    const prefix = text.slice(0, offset);
    const line = prefix.split(/\r\n|\r|\n/gu).length - 1;
    const lastLineBreak = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r"));
    return new vscode.Position(line, prefix.length - lastLineBreak - 1);
}
