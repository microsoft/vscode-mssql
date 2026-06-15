/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import SqlToolsServerClient from "./serviceclient";
import { readRefactorLogPath } from "../publishProject/projectUtils";
import {
    SqlSymbolRenameParams,
    SqlSymbolRenameRequest,
    SqlSymbolRenameTextEdit,
} from "../models/contracts/languageService";
import { SqlSymbolRename as loc } from "../constants/locConstants";

/**
 * Resolved refactorlog destination for a rename: the owning `.sqlproj`, the refactorlog file, and
 * the refactorlog's current content (null when the file does not exist yet).
 */
interface RefactorLogTarget {
    sqlprojUri: vscode.Uri;
    sqlprojDoc: vscode.TextDocument;
    sqlprojContent: string;
    /** True when the .sqlproj already declares a <RefactorLog Include="..." /> entry. */
    isRegistered: boolean;
    refactorlogUri: vscode.Uri;
    refactorlogRelPath: string;
    /** Open document for the refactorlog file when it exists; undefined otherwise. */
    refactorlogDoc: vscode.TextDocument | undefined;
    /** Current refactorlog content, or null when the file does not exist yet. */
    existingContent: string | null;
}

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
            // File is inside projDir when the relative path doesn't escape upward.
            // Use an exact check so files named e.g. "..foo.sql" aren't falsely rejected.
            return !(rel === ".." || rel.startsWith(".." + path.sep)) && !path.isAbsolute(rel);
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
        // Enforce SQL project membership even if prepareRename wasn't called
        if (!(await SqlSymbolRenameProvider.isInSqlProject(document.uri.fsPath))) {
            throw new Error(loc.renameOnlyInProjectFiles);
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        // Resolve the project's refactorlog target up front so we can hand its current content to
        // STS. STS appends the new operation and returns the full document for us to write.
        const refactorTarget = await SqlSymbolRenameProvider.resolveRefactorLogTarget(document);

        const params: SqlSymbolRenameParams = {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
            newName,
            existingRefactorLogContent: refactorTarget?.existingContent ?? null,
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
        if (response.refactorLogContent && refactorTarget) {
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
            const itemGroupEntry = `\n  <ItemGroup>\n    <RefactorLog Include="${target.refactorlogRelPath}" />\n  </ItemGroup>`;
            const projectCloseTag = "</Project>";
            const projectCloseIdx = target.sqlprojContent.lastIndexOf(projectCloseTag);
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

    /**
     * Locates the `.sqlproj` that owns `document`, resolves its refactorlog path, and reads the
     * refactorlog's current content (null when the file does not exist yet). Returns undefined when
     * the document is not inside any project.
     */
    private static async resolveRefactorLogTarget(
        document: vscode.TextDocument,
    ): Promise<RefactorLogTarget | undefined> {
        // Find the .sqlproj that owns the renamed file.
        // Pick the most-specific (deepest) match to handle nested project structures.
        const sqlprojFiles = await vscode.workspace.findFiles("**/*.sqlproj");
        const normalizedDocPath = path.normalize(document.uri.fsPath);
        const sqlprojUri = sqlprojFiles
            .filter((projUri) => {
                const projDir = path.normalize(path.dirname(projUri.fsPath));
                const rel = path.relative(projDir, normalizedDocPath);
                return !(rel === ".." || rel.startsWith(".." + path.sep)) && !path.isAbsolute(rel);
            })
            .sort((a, b) => b.fsPath.length - a.fsPath.length)[0];

        if (!sqlprojUri) {
            return undefined;
        }

        const projDir = path.dirname(sqlprojUri.fsPath);
        const projName = path.basename(sqlprojUri.fsPath, ".sqlproj");

        // Read the .sqlproj XML to find an existing <RefactorLog Include="..." /> entry.
        const sqlprojDoc = await vscode.workspace.openTextDocument(sqlprojUri);
        const sqlprojContent = sqlprojDoc.getText();
        const existingRefactorLogRelPath = readRefactorLogPath(sqlprojContent);

        // Resolve the refactorlog path:
        // - If already declared in .sqlproj → resolve relative to project dir.
        // - Otherwise → default to <ProjectName>.refactorlog next to .sqlproj.
        const refactorlogRelPath = existingRefactorLogRelPath ?? projName + ".refactorlog";
        const refactorlogAbsPath = path.resolve(projDir, refactorlogRelPath);
        const refactorlogUri = vscode.Uri.file(refactorlogAbsPath);

        // Read the current refactorlog content so STS can append to it. Null means "no file yet".
        let existingContent: string | null = null;
        let refactorlogDoc: vscode.TextDocument | undefined;
        try {
            await vscode.workspace.fs.stat(refactorlogUri);
            refactorlogDoc = await vscode.workspace.openTextDocument(refactorlogUri);
            existingContent = refactorlogDoc.getText();
        } catch {
            // File does not exist yet — leave existingContent null.
        }

        return {
            sqlprojUri,
            sqlprojDoc,
            sqlprojContent,
            isRegistered: existingRefactorLogRelPath !== undefined,
            refactorlogUri,
            refactorlogRelPath,
            refactorlogDoc,
            existingContent,
        };
    }
}
