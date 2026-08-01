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
 * Maps DacFx element type names (`<Type Name="SqlTable" .../>` in DacFx's SchemaModel/SqlModel.xml,
 * lowercased) to their conventional SSDT folder names.
 * Surfaced by STS via `SchemaLevelRefactorType()` in TSqlModelMetadataProvider.cs.
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

/** Outcome of attempting to relocate the definition file to its new schema folder. */
const enum FileMoveResult {
    /** The file was renamed to the new schema folder. */
    Moved = "moved",
    /** No move was attempted; the file stays where it is (not an error). */
    Skipped = "skipped",
    /** The rename was attempted but failed; an error has already been shown to the user. */
    Failed = "failed",
}

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
                const moveResult = await this.moveFileToNewSchemaFolder(
                    document,
                    refactorTarget,
                    targetSchema,
                    schemas,
                    response.definitionFileUri,
                    response.elementType,
                );
                // Refresh the project tree to reflect the SQL text edits, .sqlproj changes,
                // and (when the file moved) the new file location. Skip only when the rename
                // failed — the user already saw the error message in that case.
                if (moveResult !== FileMoveResult.Failed) {
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
     * Moves the `.sql` file that defines the object into the folder for its new schema, and
     * updates the `.sqlproj` to match. For example: `dbo/Tables/table1.sql` → `sss/Tables/table1.sql`.
     *
     * The source file comes from `definitionFileUri` (so the correct file is moved even when the
     * cursor was on a reference inside another file, such as a table name in a trigger body),
     * falling back to `triggerDocument` when STS does not supply it. The destination subfolder
     * comes from `elementType` via {@link stsElementTypeToFolderMap}, falling back to the source
     * file's existing subfolders when the type is unrecognised.
     *
     * @returns
     * - {@link FileMoveResult.Moved} — the file was renamed.
     * - {@link FileMoveResult.Skipped} — no move was needed or the file is not laid out by schema; the SQL text edits still stand.
     * - {@link FileMoveResult.Failed} — the rename failed and an error was shown to the user.
     */
    private async moveFileToNewSchemaFolder(
        triggerDocument: vscode.TextDocument,
        refactorTarget: RefactorLogTarget,
        targetSchema: string,
        schemas: string[],
        definitionFileUri: string | null | undefined,
        elementType: string | null | undefined,
    ): Promise<FileMoveResult> {
        // Use vscode.Uri.path (always forward-slash on every platform) to derive the
        // project-relative path. This avoids any OS path-separator handling — no need for
        // path.relative, path.sep, or manual slash normalization.
        const projDirUriPath = refactorTarget.sqlprojUri.path.substring(
            0,
            refactorTarget.sqlprojUri.path.lastIndexOf("/"),
        );

        // Source file and target folder come from the STS response; both fall back when absent.
        // See SqlMoveToSchemaResponse in models/contracts/languageService.ts for a payload example.
        const sourceUri = definitionFileUri
            ? vscode.Uri.parse(definitionFileUri)
            : triggerDocument.uri;
        const detectedFolder = elementType
            ? stsElementTypeToFolderMap[elementType.toLowerCase()]
            : undefined;

        if (!sourceUri.path.startsWith(projDirUriPath + "/")) {
            // Source file is not inside the project directory — skip.
            return FileMoveResult.Skipped;
        }
        const relPath = sourceUri.path.substring(projDirUriPath.length + 1);

        // "dbo/Tables/table1.sql" -> ["dbo", "Tables", "table1.sql"]
        const segments = relPath.split("/").filter(Boolean);
        const fileName = segments[segments.length - 1];
        const hasSchemaPrefix = segments.length >= 2;
        const currentSchemaLower = hasSchemaPrefix ? segments[0].toLowerCase() : undefined;

        // Prefer the folder implied by the object's type (SqlTable -> "Tables"); otherwise keep
        // the file's existing intermediate folders.
        const innerSegments = detectedFolder
            ? [detectedFolder]
            : hasSchemaPrefix
              ? segments.slice(1, -1)
              : [];

        if (!hasSchemaPrefix && !detectedFolder) {
            // File is at the project root and object type is unknown — skip file move.
            return FileMoveResult.Skipped;
        }

        if (hasSchemaPrefix && !schemas.some((s) => s.toLowerCase() === currentSchemaLower)) {
            // Top-level folder is not a known project schema — skip to avoid moving
            // non-schema-organised files (e.g. misc/tables/x.sql) unexpectedly.
            return FileMoveResult.Skipped;
        }

        // Build the new relative path and skip if file is already at the destination.
        const newRelPath = [targetSchema, ...innerSegments, fileName].join("/");
        if (relPath === newRelPath) {
            return FileMoveResult.Skipped;
        }

        // Derive the project root URI from the sqlproj URI so all file operations stay URI-based.
        const projectRootUri = vscode.Uri.joinPath(refactorTarget.sqlprojUri, "..");
        const newAbsUri = vscode.Uri.joinPath(
            projectRootUri,
            targetSchema,
            ...innerSegments,
            fileName,
        );

        // Move the file via WorkspaceEdit.renameFile so VS Code updates any open editors and
        // transfers dirty-buffer state to the new URI. Using vscode.workspace.fs.rename directly
        // (filesystem-level) would desync open TextDocument URIs — the dirty buffer at the old
        // URI could be saved back, recreating the old-path file. WorkspaceEdit.renameFile also
        // creates the target directory automatically, so no separate createDirectory is needed.
        const renameEdit = new vscode.WorkspaceEdit();
        renameEdit.renameFile(sourceUri, newAbsUri, { overwrite: false });
        let renameApplied: boolean;
        try {
            renameApplied = await vscode.workspace.applyEdit(renameEdit);
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.moveFileFailed(err instanceof Error ? err.message : String(err)),
            );
            return FileMoveResult.Failed;
        }
        if (!renameApplied) {
            void vscode.window.showErrorMessage(loc.moveFileFailed(""));
            return FileMoveResult.Failed;
        }

        // Register the new schema folder hierarchy in the .sqlproj. SDK-style projects glob their
        // scripts from disk (`**/*.sql`), so the file move alone is enough for them and only the
        // folder entries need adding. Legacy projects with explicit <Build Include> entries also
        // need the script path rewritten — done by excluding the old path and adding the new one
        // (avoids the disk-move side-effect of moveSqlObjectScript, which would conflict with the
        // renameFile already performed above).
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

            const failure = results.find((r) => !r?.success);
            if (failure) {
                void vscode.window.showErrorMessage(
                    loc.sqlprojUpdateFailed(failure.errorMessage || ""),
                );
            }

            // Best-effort: re-register the script path for legacy projects that use explicit
            // <Build Include> entries. SDK-style (glob-based) projects have no entry to update,
            // so this is a no-op for them — any failure is silently ignored.
            await this._sqlProjectsService
                .excludeSqlObjectScript(projPath, relPath)
                .then(
                    () => this._sqlProjectsService.addSqlObjectScript(projPath, newRelPath),
                    () => undefined,
                )
                .then(undefined, () => undefined);
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.sqlprojUpdateFailed(err instanceof Error ? err.message : String(err)),
            );
        }

        return FileMoveResult.Moved;
    }
}
