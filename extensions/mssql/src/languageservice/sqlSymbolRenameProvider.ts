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
import { SqlSymbolRename as loc, msgYes } from "../constants/locConstants";
import {
    escapeXmlAttribute,
    isInSqlProject,
    RefactorLogTarget,
    resolveRefactorLogTarget,
} from "./refactorLog";
import { SqlProjectFileCache } from "./sqlProjectFileCache";

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
     * Regex to match SQL identifiers: bracket-quoted (e.g. [TableName]) or regular word (e.g. TableName).
     * Shared between prepareRename and provideRenameEdits to ensure consistent identifier detection.
     */
    private static readonly _renameWordRegex = /\[+[^\]]*\]+|\w+/;

    constructor(private readonly _sqlProjectFiles: SqlProjectFileCache) {}

    /**
     * Called before the inline rename box appears. Rejects early for files that are
     * not part of a SQL project, so the rename box never shows for those files.
     */
    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        return isInSqlProject(document.uri.fsPath, this._sqlProjectFiles).then((inProject) => {
            if (!inProject) {
                return Promise.reject(new Error(loc.renameOnlyInProjectFiles));
            }
            const wordRange = document.getWordRangeAtPosition(
                position,
                SqlSymbolRenameProvider._renameWordRegex,
            );
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
        const refactorTarget = await resolveRefactorLogTarget(document, this._sqlProjectFiles);
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
            throw new Error(loc.renameOnlyInProjectFiles);
        }

        // Hard rejection — surface the error message and abort.
        if (response.message && !response.isWarning) {
            throw new Error(response.message);
        }

        // Name collision warning — ask the user before proceeding.
        if (response.message && response.isWarning) {
            const choice = await vscode.window.showWarningMessage(
                response.message,
                { modal: true },
                msgYes,
            );
            if (choice !== msgYes) {
                return new vscode.WorkspaceEdit(); // user declined — apply nothing silently
            }
        }

        const workspaceEdit = new vscode.WorkspaceEdit();

        if (!response.changes || Object.keys(response.changes).length === 0) {
            // No cross-file references — rename just the token at cursor in this file.
            const wordRange = document.getWordRangeAtPosition(
                position,
                SqlSymbolRenameProvider._renameWordRegex,
            );
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
                this.applyRefactorLogEdit(
                    workspaceEdit,
                    refactorTarget,
                    response.refactorLogContent,
                );
            }
            return workspaceEdit;
        }

        const changes = response.changes as Record<string, SqlSymbolRenameTextEdit[]>;
        for (const [uriStr, textEdits] of Object.entries(changes)) {
            if (textEdits.length === 0) continue; // skip no-op entries to avoid phantom files in preview
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

        // ── Refactorlog handling ────────────────────────────────────────────────────
        // STS returns the full .refactorlog content (existing operations + the new rename) when
        // the renamed symbol needs one. We write it via the SAME WorkspaceEdit so Apply/Discard
        // controls the code edits and the refactorlog together.
        if (response.refactorLogContent) {
            this.applyRefactorLogEdit(workspaceEdit, refactorTarget, response.refactorLogContent);
        }

        return workspaceEdit;
    }

    /**
     * Adds the refactorlog write (and, when needed, its `.sqlproj` registration) to `workspaceEdit`.
     * The content is produced by STS; this method only decides between create vs. overwrite and
     * registers the file in the project when it is not already declared.
     */
    private applyRefactorLogEdit(
        workspaceEdit: vscode.WorkspaceEdit,
        target: RefactorLogTarget,
        refactorLogContent: string,
    ): void {
        if (target.existingContent !== null) {
            // File already exists — overwrite its whole content with the STS-generated document.
            const fullRange = new vscode.Range(
                target.refactorlogDoc!.lineAt(0).range.start,
                target.refactorlogDoc!.lineAt(target.refactorlogDoc!.lineCount - 1).range.end,
            );
            workspaceEdit.replace(target.refactorlogUri, fullRange, refactorLogContent);
        } else {
            // File does not exist yet — create it.
            workspaceEdit.createFile(target.refactorlogUri, {
                overwrite: false,
                contents: Buffer.from(refactorLogContent, "utf8"),
            });
        }

        if (!target.isRegistered) {
            // Register <RefactorLog Include="..." /> in the .sqlproj in the same WorkspaceEdit.
            // Escape the path so project names/paths containing & < > " stay valid XML.
            const includeValue = escapeXmlAttribute(target.refactorlogRelPath);
            const itemGroupEntry = `\n  <ItemGroup>\n    <RefactorLog Include="${includeValue}" />\n  </ItemGroup>`;
            // Use regex to find </Project> tag, accounting for optional whitespace before >
            const projectCloseMatch = /<\/Project\s*>/i.exec(target.sqlprojContent);
            const projectCloseIdx = projectCloseMatch?.index ?? -1;
            const newSqlprojContent =
                projectCloseIdx >= 0
                    ? target.sqlprojContent.slice(0, projectCloseIdx) +
                      itemGroupEntry +
                      "\n" +
                      target.sqlprojContent.slice(projectCloseIdx)
                    : target.sqlprojContent + itemGroupEntry;
            const sqlprojFullRange = new vscode.Range(
                target.sqlprojDoc.lineAt(0).range.start,
                target.sqlprojDoc.lineAt(target.sqlprojDoc.lineCount - 1).range.end,
            );
            workspaceEdit.replace(target.sqlprojUri, sqlprojFullRange, newSqlprojContent);
        }
    }
}
