/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServerClient from "./serviceclient";
import {
    SqlSymbolRenameParams,
    SqlSymbolRenameRequest,
    SqlSymbolRenameTextEdit,
} from "../models/contracts/languageService";
import { SqlSymbolRename as loc } from "../constants/locConstants";
import {
    applyRefactorLogEdit,
    buildRefactorWorkspaceEdit,
    getSqlIdentifierRange,
    isInSqlProject,
    resolveRefactorLogTarget,
} from "./refactorLog";

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
     * Called before the inline rename box appears. Rejects early for files that are
     * not part of a SQL project, so the rename box never shows for those files.
     */
    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        return isInSqlProject(document.uri.fsPath).then((inProject) => {
            if (!inProject) {
                return Promise.reject(new Error(loc.renameOnlyInProjectFiles));
            }
            const wordRange = getSqlIdentifierRange(document, position);
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
        token: vscode.CancellationToken,
    ): Promise<vscode.WorkspaceEdit | null | undefined> {
        if (token.isCancellationRequested) {
            return undefined;
        }

        // Resolve the project's refactorlog target up front so we can hand its current content to
        // STS. STS appends the new operation and returns the full document for us to write.
        // This also enforces SQL project membership: a file outside any .sqlproj resolves to
        // undefined (even if prepareRename wasn't called).
        const refactorTarget = await resolveRefactorLogTarget(document);
        if (!refactorTarget) {
            throw new Error(loc.renameOnlyInProjectFiles);
        }

        const params: SqlSymbolRenameParams = {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
            newName,
            existingRefactorLogContent: refactorTarget.existingContent,
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

        if (token.isCancellationRequested) {
            return undefined;
        }

        if (!response) {
            throw new Error(loc.renameNotSupportedForSymbol);
        }

        const workspaceEdit = new vscode.WorkspaceEdit();

        if (!response.changes || Object.keys(response.changes).length === 0) {
            // No cross-file references — rename just the token at cursor in this file.
            const wordRange = getSqlIdentifierRange(document, position);
            if (!wordRange) {
                throw new Error(loc.noRenameableSymbolAtCursor);
            }
            const originalText = document.getText(wordRange);
            const finalName =
                originalText.startsWith("[") && originalText.endsWith("]")
                    ? `[${newName}]`
                    : newName;
            workspaceEdit.replace(document.uri, wordRange, finalName);
            // Still write the refactorlog (if STS produced one) so the single-file rename and the
            // refactorlog update stay atomic under Apply/Discard.
            if (response.refactorLogContent) {
                applyRefactorLogEdit(workspaceEdit, refactorTarget, response.refactorLogContent);
            }
            return workspaceEdit;
        }

        const changes = response.changes as Record<string, SqlSymbolRenameTextEdit[]>;
        return buildRefactorWorkspaceEdit(changes, refactorTarget, response.refactorLogContent);
    }
}
