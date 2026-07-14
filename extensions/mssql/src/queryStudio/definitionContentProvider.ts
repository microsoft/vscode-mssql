/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `mssql-def:` virtual documents (language-service design 05 §13.5, B12):
 * read-only TextDocumentContentProvider holding generated definition scripts
 * for Query Studio go-to-definition. Registered ONCE at activation of the QS
 * surface; content is cached by object key + metadata generation (the cache
 * key rides in the URI query, so a new generation mints a new URI and stale
 * entries age out of the small LRU).
 *
 * Delivery (§13.5 + plan settings): scripted/cross-file targets open BESIDE
 * as read-only preview; `mssql.sqlLanguage.definition.mode` picks between a
 * transient preview tab ("peek", default) and a pinned tab ("open").
 */

import * as vscode from "vscode";

export const DEFINITION_SCHEME = "mssql-def";
export const DEFINITION_MODE_SETTING = "mssql.sqlLanguage.definition.mode";

/** Scripted-definition payload the language engine returns (JSON-safe). */
export interface ScriptedDefinitionContent {
    readonly title: string;
    readonly text: string;
    readonly anchor?: { readonly line: number; readonly character: number };
    readonly cacheKey: string;
}

const MAX_CACHED_SCRIPTS = 32;

export class DefinitionContentProvider implements vscode.TextDocumentContentProvider {
    /** Insertion-ordered → the first key is the least recently stored. */
    private readonly contentByUri = new Map<string, string>();
    private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.changeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        return (
            this.contentByUri.get(uri.toString()) ??
            "-- This generated definition has expired. Run Go to Definition again."
        );
    }

    /** Store a script and return its stable URI (cacheKey-addressed). */
    store(content: ScriptedDefinitionContent): vscode.Uri {
        const uri = vscode.Uri.from({
            scheme: DEFINITION_SCHEME,
            path: `/${content.title}.sql`,
            query: encodeURIComponent(content.cacheKey),
        });
        const key = uri.toString();
        const existing = this.contentByUri.get(key);
        this.contentByUri.delete(key); // re-insert refreshes LRU order
        this.contentByUri.set(key, content.text);
        if (existing !== undefined && existing !== content.text) {
            this.changeEmitter.fire(uri);
        }
        while (this.contentByUri.size > MAX_CACHED_SCRIPTS) {
            const oldest = this.contentByUri.keys().next().value as string;
            this.contentByUri.delete(oldest);
        }
        return uri;
    }

    get size(): number {
        return this.contentByUri.size;
    }
}

let sharedProvider: DefinitionContentProvider | undefined;

/** Register the provider once at QS-surface activation (idempotent). */
export function registerDefinitionContentProvider(
    context: vscode.ExtensionContext,
): DefinitionContentProvider {
    if (sharedProvider === undefined) {
        sharedProvider = new DefinitionContentProvider();
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider(DEFINITION_SCHEME, sharedProvider),
            { dispose: () => (sharedProvider = undefined) },
        );
    }
    return sharedProvider;
}

/** The registered provider, if the QS surface has activated. */
export function definitionContentProvider(): DefinitionContentProvider | undefined {
    return sharedProvider;
}

/**
 * Open a scripted definition BESIDE the Query Studio panel as a read-only
 * document, positioned at the anchor. Mode "peek" (default) opens a
 * transient preview tab; "open" pins a real tab. Returns the document URI
 * so the caller can attach the SOURCE editor's connection context to it.
 */
export async function openScriptedDefinition(
    provider: DefinitionContentProvider,
    content: ScriptedDefinitionContent,
): Promise<vscode.Uri> {
    const uri = provider.store(content);
    const document = await vscode.workspace.openTextDocument(uri);
    const anchor = content.anchor ?? { line: 0, character: 0 };
    const position = new vscode.Position(anchor.line, anchor.character);
    const mode = vscode.workspace.getConfiguration().get<string>(DEFINITION_MODE_SETTING, "peek");
    await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: mode !== "open",
        preserveFocus: false,
        selection: new vscode.Range(position, position),
    });
    return document.uri;
}
