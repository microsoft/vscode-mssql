/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio untitled hot-exit backstop.
 *
 * VS Code owns CustomTextEditorProvider text backups, but restored untitled
 * Query Studio documents can arrive as blank plaintext documents. This store
 * keeps an invisible local copy of untitled Query Studio text so resolve can
 * rehydrate the real TextDocument before Monaco attaches.
 */

import * as vscode from "vscode";
import { textHash } from "./textSync";

export const QUERY_STUDIO_HOT_EXIT_BACKUP_FOLDER = "query-studio-hot-exit";

interface QueryStudioHotExitBackupPayload {
    version: 1;
    uri: string;
    languageId: string;
    text: string;
    textHash: string;
    updatedUtc: string;
}

export interface QueryStudioHotExitRestoreResult {
    outcome: "notUntitled" | "alreadyHasText" | "notFound" | "empty" | "restored" | "failed";
    document: vscode.TextDocument;
    chars?: number;
}

export function queryStudioHotExitBackupRoot(globalStorageUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(globalStorageUri, QUERY_STUDIO_HOT_EXIT_BACKUP_FOLDER);
}

export function queryStudioHotExitBackupUri(root: vscode.Uri, documentUri: vscode.Uri): vscode.Uri {
    const key = Buffer.from(documentUri.toString()).toString("base64url");
    return vscode.Uri.joinPath(root, `${key}.json`);
}

export async function persistQueryStudioHotExitBackup(
    root: vscode.Uri | undefined,
    document: vscode.TextDocument,
): Promise<void> {
    if (!root || document.uri.scheme !== "untitled") {
        return;
    }
    const text = document.getText();
    if (text.length === 0) {
        await deleteQueryStudioHotExitBackup(root, document.uri);
        return;
    }
    await vscode.workspace.fs.createDirectory(root);
    const payload: QueryStudioHotExitBackupPayload = {
        version: 1,
        uri: document.uri.toString(),
        languageId: document.languageId,
        text,
        textHash: textHash(text),
        updatedUtc: new Date().toISOString(),
    };
    await vscode.workspace.fs.writeFile(
        queryStudioHotExitBackupUri(root, document.uri),
        Buffer.from(JSON.stringify(payload), "utf8"),
    );
}

export async function restoreQueryStudioHotExitBackup(
    root: vscode.Uri,
    document: vscode.TextDocument,
): Promise<QueryStudioHotExitRestoreResult> {
    if (document.uri.scheme !== "untitled") {
        return { outcome: "notUntitled", document };
    }
    if (document.getText().length > 0) {
        return { outcome: "alreadyHasText", document, chars: document.getText().length };
    }
    const payload = await readBackupPayload(root, document.uri);
    if (!payload) {
        return { outcome: "notFound", document };
    }
    if (payload.text.length === 0) {
        return { outcome: "empty", document };
    }
    try {
        let target = document;
        if (target.languageId !== "sql") {
            target = await vscode.languages.setTextDocumentLanguage(target, "sql");
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            target.uri,
            new vscode.Range(target.positionAt(0), target.positionAt(target.getText().length)),
            payload.text,
        );
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            return { outcome: "failed", document: target };
        }
        return { outcome: "restored", document: target, chars: payload.text.length };
    } catch {
        return { outcome: "failed", document };
    }
}

export async function deleteQueryStudioHotExitBackup(
    root: vscode.Uri | undefined,
    documentUri: vscode.Uri,
): Promise<void> {
    if (!root || documentUri.scheme !== "untitled") {
        return;
    }
    try {
        await vscode.workspace.fs.delete(queryStudioHotExitBackupUri(root, documentUri), {
            useTrash: false,
        });
    } catch {
        // Best-effort cleanup only.
    }
}

async function readBackupPayload(
    root: vscode.Uri,
    documentUri: vscode.Uri,
): Promise<QueryStudioHotExitBackupPayload | undefined> {
    try {
        const raw = Buffer.from(
            await vscode.workspace.fs.readFile(queryStudioHotExitBackupUri(root, documentUri)),
        ).toString("utf8");
        const parsed = JSON.parse(raw) as Partial<QueryStudioHotExitBackupPayload>;
        if (
            parsed.version !== 1 ||
            parsed.uri !== documentUri.toString() ||
            typeof parsed.text !== "string"
        ) {
            return undefined;
        }
        return {
            version: 1,
            uri: parsed.uri,
            languageId: typeof parsed.languageId === "string" ? parsed.languageId : "sql",
            text: parsed.text,
            textHash: typeof parsed.textHash === "string" ? parsed.textHash : textHash(parsed.text),
            updatedUtc: typeof parsed.updatedUtc === "string" ? parsed.updatedUtc : "",
        };
    } catch {
        return undefined;
    }
}
