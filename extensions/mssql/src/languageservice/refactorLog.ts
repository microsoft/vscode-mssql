/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { readRefactorLogPath } from "../publishProject/projectUtils";
import { SqlSymbolRenameTextEdit } from "../models/contracts/languageService";

/** Returns true if `c` is a SQL word character (A-Z, a-z, 0-9, or underscore). */
function isSqlWordChar(c: string): boolean {
    const code = c.charCodeAt(0);
    return (
        (code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122) || // a-z
        (code >= 48 && code <= 57) || // 0-9
        code === 95 // _
    );
}

/**
 * Core scan logic for a single position — does not retry. Returns `undefined` when `pos` is not
 * on an identifier character.
 */
function tryScanSqlIdentifierAt(
    text: string,
    pos: number,
): { value: string; start: number; end: number } | undefined {
    // Scan left from pos to find '[', stopping early if we encounter a ']' before it
    // (which means pos is positioned after a closing bracket, not inside one).
    let bracketStart = -1;
    for (let i = pos; i >= 0; i--) {
        if (text[i] === "[") {
            bracketStart = i;
            break;
        }
        if (text[i] === "]" && i < pos) {
            break; // past the end of a bracket-quoted identifier
        }
    }

    if (bracketStart >= 0) {
        // Find the matching ']' scanning right from '['
        for (let i = bracketStart + 1; i < text.length; i++) {
            if (text[i] === "]") {
                return { value: text.slice(bracketStart + 1, i), start: bracketStart, end: i };
            }
        }
        return undefined; // unclosed bracket
    }

    // Bare word — pos must be on a word character
    if (pos >= text.length || !isSqlWordChar(text[pos])) {
        return undefined;
    }
    let start = pos;
    while (start > 0 && isSqlWordChar(text[start - 1])) {
        start--;
    }
    let end = pos;
    while (end < text.length - 1 && isSqlWordChar(text[end + 1])) {
        end++;
    }
    return { value: text.slice(start, end + 1), start, end };
}

/**
 * Scans a SQL identifier — bracket-quoted (`[name]`) or bare word (`name`) — from `text` at `pos`.
 * `pos` may be anywhere on the identifier: inside `[...]`, on `[`, on `]`, or on a word character.
 * Also handles `pos` being one position past the end of an identifier, which is the common VS Code
 * case when the cursor is positioned *between* characters (e.g. at the end of a word).
 * Returns `{ value, start, end }` (end is the index of the last character, inclusive),
 * or `undefined` when `pos` is not on (or immediately after) an identifier.
 */
function scanSqlIdentifier(
    text: string,
    pos: number,
): { value: string; start: number; end: number } | undefined {
    const result = tryScanSqlIdentifierAt(text, pos);
    if (result !== undefined) {
        return result;
    }
    // Fallback: cursor may be just past the end of an identifier (VS Code positions the cursor
    // *between* characters, so clicking after "foo" gives character = pos + 1).
    if (pos > 0) {
        return tryScanSqlIdentifierAt(text, pos - 1);
    }
    return undefined;
}

/**
 * Extracts the schema name immediately before a `.` at the end of `linePrefix`,
 * handling both bracket-quoted (`[dbo]`) and bare (`dbo`) identifiers, with optional
 * whitespace around the dot. Returns undefined when no schema qualifier is found.
 */
export function extractSchemaFromLinePrefix(linePrefix: string): string | undefined {
    let i = linePrefix.length - 1;

    // Skip trailing whitespace
    while (i >= 0 && (linePrefix[i] === " " || linePrefix[i] === "\t")) {
        i--;
    }
    // Must end with '.'
    if (i < 0 || linePrefix[i] !== ".") {
        return undefined;
    }
    i--;
    // Skip whitespace before '.'
    while (i >= 0 && (linePrefix[i] === " " || linePrefix[i] === "\t")) {
        i--;
    }
    if (i < 0) {
        return undefined;
    }

    return scanSqlIdentifier(linePrefix, i)?.value;
}

/**
 * Finds the range of the SQL identifier (bracket-quoted or bare word) at `position` in `document`.
 * Returns undefined when the cursor is not on an identifier.
 */
export function getSqlIdentifierRange(
    document: vscode.TextDocument,
    position: vscode.Position,
): vscode.Range | undefined {
    const line = document.lineAt(position.line).text;
    const result = scanSqlIdentifier(line, position.character);
    if (!result) {
        return undefined;
    }
    return new vscode.Range(position.line, result.start, position.line, result.end + 1);
}

/**
 * Returns true if `filePath` lives under the directory of any `.sqlproj` file currently in the
 * workspace. Uses VS Code's cached file index — no directory walks.
 */
export async function isInSqlProject(filePath: string): Promise<boolean> {
    const sqlprojFiles = await vscode.workspace.findFiles("**/*.sqlproj");
    const normalizedFile = path.normalize(filePath);
    return sqlprojFiles.some((projUri) => {
        const projDir = path.normalize(path.dirname(projUri.fsPath));
        const rel = path.relative(projDir, normalizedFile);
        return !(rel === ".." || rel.startsWith(".." + path.sep)) && !path.isAbsolute(rel);
    });
}

/** Escapes a string for safe use inside an XML attribute value (e.g. an Include path). */
export function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Resolved refactorlog destination for a refactoring operation: the owning `.sqlproj`, the
 * refactorlog file, and the refactorlog's current content (null when the file does not exist yet).
 */
export interface RefactorLogTarget {
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
 * Locates the `.sqlproj` that owns `document`, resolves its refactorlog path, and reads the
 * refactorlog's current content (null when the file does not exist yet). Returns undefined when
 * the document is not inside any project.
 */
export async function resolveRefactorLogTarget(
    document: vscode.TextDocument,
): Promise<RefactorLogTarget | undefined> {
    // Find the .sqlproj that owns the file.
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
    } catch (err) {
        // Only treat a genuine "not found" as "no file yet". Rethrow other errors
        // (permission, transient provider failures) so we don't mistakenly recreate the file.
        if (!(err instanceof vscode.FileSystemError && err.code === "FileNotFound")) {
            throw err;
        }
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

/** Returns a range spanning the entire content of `doc`. */
function fullDocumentRange(doc: vscode.TextDocument): vscode.Range {
    return new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end);
}

/**
 * Adds the refactorlog write (and, when needed, its `.sqlproj` registration) to `workspaceEdit`.
 * The content is produced by STS; this method only decides between create vs. overwrite and
 * registers the file in the project when it is not already declared.
 */
export function applyRefactorLogEdit(
    workspaceEdit: vscode.WorkspaceEdit,
    target: RefactorLogTarget,
    refactorLogContent: string,
): void {
    if (target.existingContent !== null && target.existingContent !== undefined) {
        // File already exists — overwrite its whole content with the STS-generated document.
        workspaceEdit.replace(
            target.refactorlogUri,
            fullDocumentRange(target.refactorlogDoc!),
            refactorLogContent,
        );
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
        // Use a regex to find </Project> so it handles optional whitespace (e.g. </Project >) and
        // case variations, avoiding the brittle case-sensitive lastIndexOf approach.
        const projectCloseMatch = /<\/Project\s*>/i.exec(target.sqlprojContent);
        const projectCloseIdx = projectCloseMatch?.index ?? -1;
        const newSqlprojContent =
            projectCloseIdx >= 0
                ? target.sqlprojContent.slice(0, projectCloseIdx) +
                  itemGroupEntry +
                  "\n" +
                  target.sqlprojContent.slice(projectCloseIdx)
                : target.sqlprojContent + itemGroupEntry;
        workspaceEdit.replace(
            target.sqlprojUri,
            fullDocumentRange(target.sqlprojDoc),
            newSqlprojContent,
        );
    }
}

/**
 * Adds a no-op sentinel edit on the `.sqlproj` (replaces its content with itself) marked
 * `needsConfirmation: true`. This triggers VS Code's refactor preview panel.
 * Only call when `target.isRegistered` is true — i.e. the sqlproj has no real pending edits.
 */
export function addSqlProjAsPreviewTrigger(
    workspaceEdit: vscode.WorkspaceEdit,
    target: RefactorLogTarget,
    label: string,
): void {
    workspaceEdit.replace(
        target.sqlprojUri,
        fullDocumentRange(target.sqlprojDoc),
        target.sqlprojContent,
        {
            needsConfirmation: true,
            label,
        },
    );
}

/**
 * VS Code only opens the refactor preview panel when at least one edit in the WorkspaceEdit has
 * `needsConfirmation: true`. When `!target.isRegistered`, the sqlproj already has a real edit
 * (registering the refactorlog), so we can't use it as the sentinel without making it unchecked.
 * Instead, we create a temporary empty `.sql` file, open it so VS Code tracks its version, add a
 * no-op replace with `needsConfirmation: true`, and return its URI so the caller can delete it
 * after `applyEdit` resolves.
 */
export async function addTempFileAsPreviewTrigger(
    workspaceEdit: vscode.WorkspaceEdit,
    target: RefactorLogTarget,
    label: string,
): Promise<vscode.Uri> {
    const tempUri = vscode.Uri.file(
        path.join(
            path.dirname(target.sqlprojUri.fsPath),
            `.mssql-refactor-preview-${Date.now()}.sql`,
        ),
    );
    await vscode.workspace.fs.writeFile(tempUri, new Uint8Array());
    const tempDoc = await vscode.workspace.openTextDocument(tempUri);
    workspaceEdit.replace(tempUri, fullDocumentRange(tempDoc), "", {
        needsConfirmation: true,
        label,
    });
    return tempUri;
}

/**
 * Builds a `WorkspaceEdit` from the text-edit changes returned by STS (move-to-schema) and
 * optionally appends the refactorlog write. Used by `SqlMoveToSchemaProvider`.
 */
export function buildRefactorWorkspaceEdit(
    changes: Record<string, SqlSymbolRenameTextEdit[]>,
    refactorTarget: RefactorLogTarget,
    refactorLogContent?: string | null,
): vscode.WorkspaceEdit {
    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const [uriStr, textEdits] of Object.entries(changes)) {
        if (textEdits.length === 0) {
            continue;
        }
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

    if (refactorLogContent) {
        applyRefactorLogEdit(workspaceEdit, refactorTarget, refactorLogContent);
    }

    return workspaceEdit;
}
