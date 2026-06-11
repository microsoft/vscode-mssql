/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import SqlToolsServerClient from "./serviceclient";
import { readRefactorLogPath } from "../publishProject/projectUtils";
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
        // When STS resolved the element type (table, column, etc.) we also write a
        // .refactorlog entry so DacFx deploy knows about the rename.
        // The edit is added to the SAME WorkspaceEdit so Apply/Discard controls both.
        if (
            response.elementType &&
            response.elementName &&
            response.parentElementName &&
            response.parentElementType
        ) {
            // Find the .sqlproj that owns the renamed file.
            // Pick the most-specific (deepest) match to handle nested project structures.
            const sqlprojFiles = await vscode.workspace.findFiles("**/*.sqlproj");
            const normalizedDocPath = path.normalize(document.uri.fsPath);
            const sqlprojUri = sqlprojFiles
                .filter((projUri) => {
                    const projDir = path.normalize(path.dirname(projUri.fsPath));
                    const rel = path.relative(projDir, normalizedDocPath);
                    return (
                        !(rel === ".." || rel.startsWith(".." + path.sep)) && !path.isAbsolute(rel)
                    );
                })
                .sort((a, b) => b.fsPath.length - a.fsPath.length)[0];

            if (sqlprojUri) {
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

                // Generate GUID and UTC timestamp inline.
                const guid = crypto.randomUUID();
                const now = new Date();
                const pad = (n: number) => String(n).padStart(2, "0");
                const timestamp =
                    `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${now.getUTCFullYear()} ` +
                    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

                // Escape XML special characters in values before embedding in XML attributes.
                const xmlEscape = (v: string) =>
                    v
                        .replace(/&/g, "&amp;")
                        .replace(/"/g, "&quot;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");

                const operationXml = [
                    `  <Operation Name="Rename Refactor" Key="${guid}" ChangeDateTime="${timestamp}">`,
                    `    <Property Name="ElementName" Value="${xmlEscape(response.elementName)}" />`,
                    `    <Property Name="ElementType" Value="${xmlEscape(response.elementType)}" />`,
                    `    <Property Name="ParentElementName" Value="${xmlEscape(response.parentElementName)}" />`,
                    `    <Property Name="ParentElementType" Value="${xmlEscape(response.parentElementType)}" />`,
                    `    <Property Name="NewName" Value="${xmlEscape(newName)}" />`,
                    `  </Operation>`,
                ].join("\n");

                if (existingRefactorLogRelPath) {
                    // File is registered in .sqlproj — append to it if it exists,
                    // or create it fresh if it was deleted after registration.
                    let refactorlogExists = false;
                    try {
                        await vscode.workspace.fs.stat(refactorlogUri);
                        refactorlogExists = true;
                    } catch {
                        // file missing — will create below
                    }

                    let existingContent: string;
                    if (refactorlogExists) {
                        const existingDoc = await vscode.workspace.openTextDocument(refactorlogUri);
                        existingContent = existingDoc.getText();
                    } else {
                        // File was deleted after being registered — start fresh.
                        existingContent = [
                            '<?xml version="1.0" encoding="utf-8"?>',
                            '<Operations Version="1.0" xmlns="http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02">',
                            "</Operations>",
                        ].join("\n");
                    }

                    const closingTag = "</Operations>";
                    const insertIdx = existingContent.lastIndexOf(closingTag);
                    const updatedContent =
                        insertIdx >= 0
                            ? existingContent.slice(0, insertIdx) +
                              operationXml +
                              "\n" +
                              existingContent.slice(insertIdx)
                            : existingContent + "\n" + operationXml;

                    if (refactorlogExists) {
                        const existingDoc = await vscode.workspace.openTextDocument(refactorlogUri);
                        const fullRange = new vscode.Range(
                            existingDoc.lineAt(0).range.start,
                            existingDoc.lineAt(existingDoc.lineCount - 1).range.end,
                        );
                        workspaceEdit.replace(refactorlogUri, fullRange, updatedContent);
                    } else {
                        workspaceEdit.createFile(refactorlogUri, {
                            overwrite: false,
                            contents: Buffer.from(updatedContent, "utf8"),
                        });
                    }
                } else {
                    // No refactorlog in .sqlproj yet — create the file and register it.

                    // 1. Create the new .refactorlog file.
                    const newRefactorlogContent = [
                        '<?xml version="1.0" encoding="utf-8"?>',
                        '<Operations Version="1.0" xmlns="http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02">',
                        operationXml,
                        "</Operations>",
                    ].join("\n");
                    workspaceEdit.createFile(refactorlogUri, {
                        overwrite: false,
                        contents: Buffer.from(newRefactorlogContent, "utf8"),
                    });

                    // 2. Add <RefactorLog Include="..." /> to the .sqlproj in the same WorkspaceEdit.
                    // Insert a new ItemGroup before the closing </Project> tag.
                    const itemGroupEntry = `\n  <ItemGroup>\n    <RefactorLog Include="${refactorlogRelPath}" />\n  </ItemGroup>`;
                    const projectCloseTag = "</Project>";
                    const projectCloseIdx = sqlprojContent.lastIndexOf(projectCloseTag);
                    const newSqlprojContent =
                        projectCloseIdx >= 0
                            ? sqlprojContent.slice(0, projectCloseIdx) +
                              itemGroupEntry +
                              "\n" +
                              sqlprojContent.slice(projectCloseIdx)
                            : sqlprojContent + itemGroupEntry;
                    const sqlprojFullRange = new vscode.Range(
                        sqlprojDoc.lineAt(0).range.start,
                        sqlprojDoc.lineAt(sqlprojDoc.lineCount - 1).range.end,
                    );
                    workspaceEdit.replace(sqlprojUri, sqlprojFullRange, newSqlprojContent);
                }
            }
        }

        return workspaceEdit;
    }
}
