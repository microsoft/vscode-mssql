/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { SqlMoveToSchema as loc, msgYes } from "../constants/locConstants";
import { cmdMoveToSchema } from "../constants/constants";
import SqlToolsServerClient from "./serviceclient";
import {
    ListProjectSchemasRequest,
    SqlMoveToSchemaParams,
    SqlMoveToSchemaRequest,
    SqlSymbolRenameTextEdit,
} from "../models/contracts/languageService";
import {
    addSqlProjAsPreviewTrigger,
    addTempFileAsPreviewTrigger,
    applyRefactorLogEdit,
    buildRefactorWorkspaceEdit,
    extractSchemaFromLinePrefix,
    getSqlIdentifierRange,
    isInSqlProject,
    RefactorLogTarget,
    resolveRefactorLogTarget,
} from "./refactorLog";
import { SqlProjectsService } from "../services/sqlProjectsService";

/**
 * Maps STS `ElementType` values (from the `.refactorlog` XML) to their conventional
 * SQL project folder names, following SSDT folder structure conventions.
 */
const stsElementTypeToFolderMap: Readonly<Record<string, string>> = {
    sqltable: "Tables",
    sqlview: "Views",
    sqlinlinefunction: "Functions",
    sqlscalarfunction: "Functions",
    sqltablevaluefunction: "Functions",
    sqldmltrigger: "Triggers",
    sqltrigger: "Triggers",
    sqlsequence: "Sequences",
};

/**
 * Surfaces a "Move to Schema..." action under the editor's **Refactor...** menu for SQL files in a
 * SQL project.
 *
 * Picking the action shows a QuickPick dropdown at the top-center of the window where the user can
 * select the target schema. After selecting, VS Code shows the refactor preview panel (Apply /
 * Discard) with all the changes before applying them.
 */
export class SqlMoveToSchemaProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

    private readonly _sqlProjectsService: SqlProjectsService;

    constructor(sqlProjectsService?: SqlProjectsService) {
        this._sqlProjectsService =
            sqlProjectsService ?? new SqlProjectsService(SqlToolsServerClient.instance);
    }

    /**
     * Registers the provider and its backing command. Returns disposables for the caller to track.
     */
    public static register(): vscode.Disposable[] {
        const provider = new SqlMoveToSchemaProvider();
        return [
            vscode.languages.registerCodeActionsProvider({ language: "sql" }, provider, {
                providedCodeActionKinds: SqlMoveToSchemaProvider.providedCodeActionKinds,
            }),
            vscode.commands.registerCommand(
                cmdMoveToSchema,
                (document: vscode.TextDocument, position: vscode.Position) =>
                    provider.runMoveToSchema(document, position),
            ),
        ];
    }

    /**
     * Offers the "Move to Schema..." refactor action when the cursor is on a word inside a SQL
     * project file. The action invokes the `mssql.moveToSchema` command, which shows QuickPick.
     */
    public async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
    ): Promise<vscode.CodeAction[]> {
        if (!(await isInSqlProject(document.uri.fsPath))) {
            return [];
        }
        const position = range.start;
        if (!getSqlIdentifierRange(document, position)) {
            return [];
        }

        const action = new vscode.CodeAction(loc.moveToSchemaTitle, vscode.CodeActionKind.Refactor);
        action.command = {
            command: cmdMoveToSchema,
            title: loc.moveToSchemaTitle,
            arguments: [document, position],
        };
        return [action];
    }

    /**
     * Runs the full Move to Schema flow: gather the project's schemas, show QuickPick dropdown,
     * then ask STS for the edits and show the preview panel.
     */
    public async runMoveToSchema(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<void> {
        if (!(await isInSqlProject(document.uri.fsPath))) {
            void vscode.window.showInformationMessage(loc.moveToSchemaOnlyInProjectFiles);
            return;
        }

        const wordRange = getSqlIdentifierRange(document, position);
        if (!wordRange) {
            void vscode.window.showInformationMessage(loc.noMovableSymbolAtCursor);
            return;
        }

        const linePrefix = document.getText(
            new vscode.Range(
                wordRange.start.line,
                0,
                wordRange.start.line,
                wordRange.start.character,
            ),
        );
        const currentSchema = extractSchemaFromLinePrefix(linePrefix);

        let schemas: string[];
        try {
            const response = await SqlToolsServerClient.instance.sendRequest(
                ListProjectSchemasRequest.type,
                { textDocument: { uri: document.uri.toString() } },
            );
            schemas = response?.schemas ?? [];
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.moveToSchemaRequestFailed(err instanceof Error ? err.message : String(err)),
            );
            return;
        }

        if (schemas.length === 0) {
            void vscode.window.showInformationMessage(loc.noSchemasFound);
            return;
        }

        // Show QuickPick with schema dropdown
        const items = schemas.map((s) => ({ label: s }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: loc.selectTargetSchemaPlaceholder(currentSchema),
            canPickMany: false,
        });

        if (!selected) {
            return; // user cancelled
        }

        await this.applyMove(document, position, selected.label, schemas);
    }

    /**
     * Sends the move request to STS, builds the WorkspaceEdit (code edits + refactorlog),
     * and shows VS Code's refactor preview (Apply / Discard).
     */
    private async applyMove(
        document: vscode.TextDocument,
        position: vscode.Position,
        targetSchema: string,
        schemas: string[],
    ): Promise<void> {
        let refactorTarget;
        try {
            refactorTarget = await resolveRefactorLogTarget(document);
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.resolveRefactorLogFailed(err instanceof Error ? err.message : String(err)),
            );
            return;
        }
        if (!refactorTarget) {
            void vscode.window.showErrorMessage(loc.moveToSchemaOnlyInProjectFiles);
            return;
        }

        const params: SqlMoveToSchemaParams = {
            textDocument: { uri: document.uri.toString() },
            position: { line: position.line, character: position.character },
            targetSchema,
            existingRefactorLogContent: refactorTarget.existingContent,
        };

        let response;
        try {
            response = await SqlToolsServerClient.instance.sendRequest(
                SqlMoveToSchemaRequest.type,
                params,
            );
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.moveToSchemaRequestFailed(err instanceof Error ? err.message : String(err)),
            );
            return;
        }

        if (!response || !response.changes || Object.keys(response.changes).length === 0) {
            void vscode.window.showInformationMessage(loc.noMovableSymbolAtCursor);
            return;
        }

        // Warn if an object with the same name already exists in the target schema.
        if (response.message && response.isWarning) {
            const choice = await vscode.window.showWarningMessage(
                response.message,
                { modal: true },
                msgYes,
            );
            if (choice !== msgYes) {
                return; // user declined — do nothing silently
            }
        }

        const changes = response.changes as Record<string, SqlSymbolRenameTextEdit[]>;
        const label = loc.previewLabel(targetSchema);

        const workspaceEdit = buildRefactorWorkspaceEdit(changes, refactorTarget);
        if (response.refactorLogContent) {
            applyRefactorLogEdit(workspaceEdit, refactorTarget, response.refactorLogContent);
        }

        // VS Code only opens the refactor preview when at least one edit has needsConfirmation:true.
        // When isRegistered=true: sqlproj has no real edits — use it as a no-op sentinel.
        // When isRegistered=false: sqlproj has a real registration edit — use a temp file instead.
        let tempUri: vscode.Uri | undefined;
        if (refactorTarget.isRegistered) {
            addSqlProjAsPreviewTrigger(workspaceEdit, refactorTarget, label);
        } else {
            tempUri = await addTempFileAsPreviewTrigger(workspaceEdit, refactorTarget, label);
        }

        try {
            const applied = await vscode.workspace.applyEdit(workspaceEdit, {
                isRefactoring: true,
            });
            if (!applied) {
                void vscode.window.showErrorMessage(loc.applyEditFailed);
            } else {
                const moved = await this.moveFileToNewSchemaFolder(
                    document,
                    refactorTarget,
                    targetSchema,
                    schemas,
                    response.definitionFileUri,
                    response.elementType,
                );
                // Refresh the project tree to reflect the SQL text edits, .sqlproj changes,
                // and (when the file moved) the new file location. Skip only when the physical
                // rename itself failed — the user already saw the error message in that case.
                if (moved !== false) {
                    await vscode.commands.executeCommand("dataworkspace.refresh");
                }
            }
        } finally {
            if (tempUri) {
                // Always clean up the temp file after the preview closes (Apply or Discard).
                await vscode.workspace.fs.delete(tempUri, { useTrash: false }).then(
                    () => undefined,
                    () => undefined,
                );
            }
        }
    }

    /**
     * After the SQL text edits are confirmed, relocates the physical `.sql` file that defines
     * the moved object to the folder matching the new schema. For example:
     *   `dbo/Tables/table1.sql`  →  `sss/Tables/table1.sql`
     *
     * Uses `definitionFileUri` from the STS response to locate the correct source file — this
     * handles the case where the cursor was on a reference in another file (e.g. a table name
     * inside a trigger body). Falls back to the open document when the URI is absent.
     *
     * The target subfolder is derived from `elementType` (e.g. `SqlTable` → `Tables`) using
     * `stsElementTypeToFolderMap`. When the type is unknown the existing path segments are
     * preserved as a fallback.
     *
     * Skips silently (preserving SQL text edits) when:
     *  - the source file is not under a known project schema folder
     *  - the file is already at the destination
     *
     * Returns `false` only when the physical rename fails (caller skips tree refresh).
     */
    private async moveFileToNewSchemaFolder(
        triggerDocument: vscode.TextDocument,
        refactorTarget: RefactorLogTarget,
        targetSchema: string,
        schemas: string[],
        definitionFileUri: string | null | undefined,
        elementType: string | null | undefined,
    ): Promise<boolean | void> {
        // Use vscode.Uri.path (always forward-slash on every platform) to derive the
        // project-relative path. This avoids any OS path-separator handling — no need for
        // path.relative, path.sep, or manual slash normalization.
        const projDirUriPath = refactorTarget.sqlprojUri.path.substring(
            0,
            refactorTarget.sqlprojUri.path.lastIndexOf("/"),
        );

        // Resolve the source file and target subfolder directly from the STS response fields.
        // definitionFileUri is the file that declares the moved object; elementType maps to the
        // SSDT-conventional folder name. Both fall back gracefully when absent.
        const sourceUri = definitionFileUri
            ? vscode.Uri.parse(definitionFileUri)
            : triggerDocument.uri;
        const detectedFolder = elementType
            ? stsElementTypeToFolderMap[elementType.toLowerCase()]
            : undefined;

        if (!sourceUri.path.startsWith(projDirUriPath + "/")) {
            // Source file is not inside the project directory — skip.
            return;
        }
        const relPath = sourceUri.path.substring(projDirUriPath.length + 1);

        const segments = relPath.split("/").filter(Boolean);
        const fileName = segments[segments.length - 1];
        const hasSchemaPrefix = segments.length >= 2;
        const currentSchema = hasSchemaPrefix ? segments[0] : undefined;

        const innerSegments = detectedFolder
            ? [detectedFolder]
            : hasSchemaPrefix
              ? segments.slice(1, -1)
              : [];

        if (!hasSchemaPrefix && !detectedFolder) {
            // File is at the project root and object type is unknown — skip file move.
            return;
        }

        if (
            hasSchemaPrefix &&
            !schemas.some((s) => s.toLowerCase() === currentSchema!.toLowerCase())
        ) {
            // Top-level folder is not a known project schema — skip to avoid moving
            // non-schema-organised files (e.g. misc/tables/x.sql) unexpectedly.
            return;
        }

        // Build the new relative path and skip if file is already at the destination.
        const newRelPath = [targetSchema, ...innerSegments, fileName].join("/");
        if (relPath === newRelPath) {
            return;
        }

        // Derive the project root URI from the sqlproj URI so all file operations stay URI-based.
        const projectRootUri = vscode.Uri.joinPath(refactorTarget.sqlprojUri, "..");
        const newAbsUri = vscode.Uri.joinPath(
            projectRootUri,
            targetSchema,
            ...innerSegments,
            fileName,
        );
        const targetDirUri = vscode.Uri.joinPath(projectRootUri, targetSchema, ...innerSegments);

        // Ensure the target directory exists on disk. createDirectory is idempotent.
        try {
            await vscode.workspace.fs.createDirectory(targetDirUri);
        } catch {
            // Ignore "already exists" — the directory may have been created already.
        }

        // Move the physical file.
        try {
            await vscode.workspace.fs.rename(sourceUri, newAbsUri, { overwrite: false });
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.moveFileFailed(err instanceof Error ? err.message : String(err)),
            );
            return false; // signal that the rename failed so the caller skips the tree refresh
        }

        // Register the new schema folder hierarchy in the .sqlproj (no-op if already present) and
        // update the <Build Include> path to reflect the new file location. The file has already
        // been moved on disk at this point, so a failure here leaves the project out of sync —
        // surface it to the user rather than failing silently.
        const projPath = refactorTarget.sqlprojUri.fsPath;
        try {
            const results = [await this._sqlProjectsService.addFolder(projPath, targetSchema)];
            if (innerSegments.length > 0) {
                results.push(
                    await this._sqlProjectsService.addFolder(
                        projPath,
                        [targetSchema, ...innerSegments].join("/"),
                    ),
                );
            }
            results.push(
                await this._sqlProjectsService.moveSqlObjectScript(projPath, relPath, newRelPath),
            );

            const failure = results.find((r) => !r?.success);
            if (failure) {
                void vscode.window.showErrorMessage(
                    loc.sqlprojUpdateFailed(failure.errorMessage || ""),
                );
            }
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.sqlprojUpdateFailed(err instanceof Error ? err.message : String(err)),
            );
        }
    }
}
