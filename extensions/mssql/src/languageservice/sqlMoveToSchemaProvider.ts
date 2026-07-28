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

        await this.applyMove(document, position, selected.label);
    }

    /**
     * Sends the move request to STS, builds the WorkspaceEdit (code edits + refactorlog),
     * and shows VS Code's refactor preview (Apply / Discard).
     */
    private async applyMove(
        document: vscode.TextDocument,
        position: vscode.Position,
        targetSchema: string,
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
                await this.moveFileToNewSchemaFolder(document, refactorTarget, targetSchema);
                // Refresh the project tree so the moved file appears under its new schema folder
                // without requiring the user to manually reload the project.
                await vscode.commands.executeCommand("dataworkspace.refresh");
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
     * After the SQL text edits are confirmed, moves the physical `.sql` file to the folder that
     * matches the new schema. For example:
     *   `dbo/tables/table1.sql`  →  `sss/tables/table1.sql`
     *
     * Only acts when the file lives directly under a schema-named top-level folder (i.e. the first
     * path segment matches the old schema name). Files outside this convention are skipped silently
     * so the SQL text edits are still preserved.
     *
     * Uses `vscode.Uri.joinPath` for all URI construction and forward-slash paths for `.sqlproj`
     * entries to ensure cross-platform compatibility.
     */
    private async moveFileToNewSchemaFolder(
        document: vscode.TextDocument,
        refactorTarget: RefactorLogTarget,
        targetSchema: string,
    ): Promise<void> {
        // Use vscode.Uri.path (always forward-slash on every platform) to derive the
        // project-relative path. This avoids any OS path-separator handling — no need for
        // path.relative, path.sep, or manual slash normalization.
        const projDirUriPath = refactorTarget.sqlprojUri.path.substring(
            0,
            refactorTarget.sqlprojUri.path.lastIndexOf("/"),
        );
        if (!document.uri.path.startsWith(projDirUriPath + "/")) {
            // File is not inside the project directory — skip.
            return;
        }
        const relPath = document.uri.path.substring(projDirUriPath.length + 1);

        const segments = relPath.split("/").filter(Boolean);
        if (segments.length < 2) {
            // File is at the project root (no schema folder prefix) — skip file move.
            return;
        }

        const currentSchema = segments[0];
        if (currentSchema.toLowerCase() === targetSchema.toLowerCase()) {
            // File is already under the target schema folder — nothing to move.
            return;
        }

        // Retain any intermediate object-type folder (e.g. "tables") and the file name unchanged.
        const innerSegments = segments.slice(1, -1); // e.g. ["tables"]
        const fileName = segments[segments.length - 1]; // e.g. "table1.sql"

        // Build the new relative path using forward slashes (cross-platform safe for .sqlproj).
        const newRelPath = [targetSchema, ...innerSegments, fileName].join("/");

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
            await vscode.workspace.fs.rename(document.uri, newAbsUri, { overwrite: false });
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.moveFileFailed(err instanceof Error ? err.message : String(err)),
            );
            return;
        }

        // Register the new schema folder hierarchy in the .sqlproj (no-op if already present).
        const projPath = refactorTarget.sqlprojUri.fsPath;
        await this._sqlProjectsService.addFolder(projPath, targetSchema);
        if (innerSegments.length > 0) {
            await this._sqlProjectsService.addFolder(
                projPath,
                [targetSchema, ...innerSegments].join("/"),
            );
        }

        // Update the <Build Include> path in the .sqlproj to reflect the new file location.
        await this._sqlProjectsService.moveSqlObjectScript(projPath, relPath, newRelPath);
    }
}
