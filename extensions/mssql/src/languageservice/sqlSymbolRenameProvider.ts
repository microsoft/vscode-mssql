/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import SqlToolsServerClient from "./serviceclient";
import {
    SqlSymbolRenameParams,
    SqlSymbolRenameRequest,
    SqlSymbolRenameTextEdit,
} from "../models/contracts/languageService";
import { SqlSymbolRename as loc } from "../constants/locConstants";

/**
 * VS Code RenameProvider for SQL project files.
 *
 * Registered for the "sql" language so that F2 / right-click "Rename Symbol"
 * use our `sql/rename` STS endpoint instead of VS Code's built-in LSP
 * rename. This gives:
 *   - The native **inline** rename textbox at the cursor position
 *   - VS Code's built-in **preview panel** (Apply / Discard) showing all files
 *     that will be changed across the project
 */
export class SqlSymbolRenameProvider implements vscode.RenameProvider {
    /**
     * Returns true if `filePath` lives under the directory of any `.sqlproj` file
     * currently in the workspace. Uses VS Code's cached file index — no directory walks.
     */
    private static async isInSqlProject(filePath: string): Promise<boolean> {
        const sqlprojFiles = await vscode.workspace.findFiles("**/*.sqlproj");
        const normalizedFile = path.normalize(filePath);
        return sqlprojFiles.some((projUri) => {
            const projDir = path.normalize(path.dirname(projUri.fsPath));
            const rel = path.relative(projDir, normalizedFile);
            // File is inside projDir when the relative path doesn't escape upward
            return !rel.startsWith("..") && !path.isAbsolute(rel);
        });
    }

    /**
     * Called before the inline rename box appears. Rejects early for files that are
     * not part of a SQL project, so the rename box never shows for those files.
     */
    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        return SqlSymbolRenameProvider.isInSqlProject(document.uri.fsPath).then((inProject) => {
            if (!inProject) {
                return Promise.reject(new Error(loc.renameOnlyInProjectFiles));
            }
            const wordRange = document.getWordRangeAtPosition(position, /\[+[^\]]*\]+|\w+/);
            if (!wordRange) {
                return Promise.reject(new Error(loc.renameNotSupportedAtPosition));
            }
            const rawWord = document.getText(wordRange);
            // Strip exactly one outer bracket pair (e.g. [name] → name, [[name]] → [name])
            const placeholder =
                rawWord.startsWith("[") && rawWord.endsWith("]") ? rawWord.slice(1, -1) : rawWord;
            return { range: wordRange, placeholder };
        });
    }

    /**
     * Called after the user confirms the new name in the inline box.
     * We send the rename request to STS and return the WorkspaceEdit.
     * VS Code will then show the preview panel before applying the changes.
     */
    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        _token: vscode.CancellationToken,
    ): Promise<vscode.WorkspaceEdit | null | undefined> {
        const params: SqlSymbolRenameParams = {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
            newName,
        };

        let response;
        try {
            response = await SqlToolsServerClient.instance.sendRequest(
                SqlSymbolRenameRequest.type,
                params,
            );
        } catch (err) {
            throw new Error(
                loc.renameRequestFailed(err instanceof Error ? err.message : String(err)),
            );
        }

        if (!response) {
            throw new Error(loc.renameOnlyInProjectFiles);
        }

        const workspaceEdit = new vscode.WorkspaceEdit();

        if (!response.changes || Object.keys(response.changes).length === 0) {
            // No cross-file references — rename just the token at cursor in this file.
            const wordRange = document.getWordRangeAtPosition(position, /\[+[^\]]*\]+|\w+/);
            if (!wordRange) {
                throw new Error(loc.noRenameableSymbolAtCursor);
            }
            const originalText = document.getText(wordRange);
            const finalName =
                originalText.startsWith("[") && originalText.endsWith("]")
                    ? `[${newName}]`
                    : newName;
            workspaceEdit.replace(document.uri, wordRange, finalName);
            return workspaceEdit;
        }

        const changes = response.changes as Record<string, SqlSymbolRenameTextEdit[]>;
        for (const [uriStr, textEdits] of Object.entries(changes)) {
            const fileUri = vscode.Uri.parse(uriStr);
            const vsEdits = textEdits.map(
                (e) =>
                    new vscode.TextEdit(
                        new vscode.Range(
                            e.range.start.line,
                            e.range.start.character,
                            e.range.end.line,
                            e.range.end.character,
                        ),
                        e.newText,
                    ),
            );
            workspaceEdit.set(fileUri, vsEdits);
        }

        return workspaceEdit;
    }
}
