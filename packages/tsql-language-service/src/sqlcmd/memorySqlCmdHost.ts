/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlCmdArgument,
    SqlCmdConnectionInfo,
    SqlCmdConnectionResolver,
    SqlCmdHost,
    SqlCmdIncludeEntry,
    SqlCmdIncludeStore,
    SqlCmdPolicy,
} from "./contracts.js";
import { defaultSqlCmdPolicy } from "./contracts.js";

/**
 * A host that resolves nothing.
 *
 * It is the honest offline default: every `:r` is unresolved and every `:connect` keeps its own
 * region without an identity. Nothing is invented and nothing is read from the machine.
 */
export const nullSqlCmdHost: SqlCmdHost = Object.freeze({});

/**
 * An in-memory include store for tests and for hosts that already hold the file text.
 *
 * References are resolved as URIs relative to the including document, using only string work, so
 * the store can be used in a browser worker with no file system at all.
 */
export class MemorySqlCmdIncludeStore implements SqlCmdIncludeStore {
    private readonly _entries = new Map<string, SqlCmdIncludeEntry>();

    public constructor(entries?: Iterable<readonly [string, string]>) {
        for (const [uri, text] of entries ?? []) this.set(uri, { state: "loaded", text });
    }

    public set(uri: string, entry: SqlCmdIncludeEntry): void {
        this._entries.set(uri, entry);
    }

    public delete(uri: string): void {
        this._entries.delete(uri);
    }

    public resolve(reference: string, fromUri: string): string | undefined {
        const normalized = reference
            .replaceAll("\\", "/")
            .trim()
            .replace(/^["']|["']$/gu, "");
        if (normalized.length === 0) return undefined;
        if (/^[a-z][a-z0-9+.-]*:/iu.test(normalized)) return normalized;
        const base = fromUri.slice(0, fromUri.lastIndexOf("/") + 1);
        if (base.length === 0) return undefined;
        const segments: string[] = [];
        for (const segment of `${base}${normalized}`.split("/")) {
            if (segment === ".") continue;
            if (segment === ".." && segments.length > 0 && !segments.at(-1)!.endsWith(":")) {
                segments.pop();
                continue;
            }
            segments.push(segment);
        }
        return segments.join("/");
    }

    public get(uri: string): SqlCmdIncludeEntry | undefined {
        return this._entries.get(uri);
    }
}

/** A connection lookup backed by a fixed table, used by tests and offline tools. */
export class MemorySqlCmdConnectionResolver implements SqlCmdConnectionResolver {
    public constructor(private readonly _servers: ReadonlyMap<string, SqlCmdConnectionInfo>) {}

    public resolve(
        server: string,
        options: readonly SqlCmdArgument[],
    ): SqlCmdConnectionInfo | undefined {
        // A credential switch arrives with its value already blanked, so nothing here can read one.
        void options;
        return this._servers.get(server.toLowerCase());
    }
}

/** Builds a policy from partial host settings, keeping the documented defaults for the rest. */
export function resolveSqlCmdPolicy(policy?: Partial<SqlCmdPolicy>): SqlCmdPolicy {
    return Object.freeze({
        maximumIncludeDepth: positive(
            policy?.maximumIncludeDepth,
            defaultSqlCmdPolicy.maximumIncludeDepth,
        ),
        maximumIncludeCount: positive(
            policy?.maximumIncludeCount,
            defaultSqlCmdPolicy.maximumIncludeCount,
        ),
        maximumIncludeCharacters: positive(
            policy?.maximumIncludeCharacters,
            defaultSqlCmdPolicy.maximumIncludeCharacters,
        ),
        allowShellCommands: policy?.allowShellCommands === true,
    });
}

function positive(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
