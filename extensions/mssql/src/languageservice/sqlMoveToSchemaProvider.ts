/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
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
import { getLogger } from "../models/logger";

const logger = getLogger("SqlMoveToSchemaProvider");

/**
 * Maps DacFx element type names (`<Type Name="SqlTable" .../>` in DacFx's SchemaModel/SqlModel.xml,
 * lowercased) to their conventional SSDT folder names.
 * Surfaced by STS via `SchemaLevelRefactorType()` in TSqlModelMetadataProvider.cs.
 */
const stsElementTypeToFolderMap: Readonly<Record<string, string>> = {
    sqltable: "Tables",
    sqlview: "Views",
    sqlprocedure: "StoredProcedures",
    sqlinlinefunction: "Functions",
    sqlscalarfunction: "Functions",
    sqltablevaluefunction: "Functions",
    sqldmltrigger: "Triggers",
    sqltrigger: "Triggers",
    sqlsequence: "Sequences",
};

/** Outcome of attempting to relocate the definition file to its new schema folder. */
const enum FileMoveResult {
    Moved = "moved",
    /** No move was attempted; the file stays where it is (not an error). */
    Skipped = "skipped",
    /** The move failed; an error has already been shown to the user. */
    Failed = "failed",
}

/** Resolved source/destination for relocating a definition file into its new schema folder. */
interface SchemaFolderMovePlan {
    sourceUri: vscode.Uri;
    /** Current project-relative path, e.g. `dbo/Tables/table1.sql`. */
    relPath: string;
    /** Destination project-relative path, e.g. `sss/Tables/table1.sql`. */
    newRelPath: string;
    newAbsUri: vscode.Uri;
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
                // `applyEdit` returns false when the user clicks Discard in the refactor preview,
                // which is a deliberate action — not an error worth surfacing to the user.
                logger.debug("Move to Schema edits were not applied (discarded or rejected).");
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
                // and (when the file moved) the new file location. Skip only when the move
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
     */
    private async moveFileToNewSchemaFolder(
        triggerDocument: vscode.TextDocument,
        refactorTarget: RefactorLogTarget,
        targetSchema: string,
        schemas: string[],
        definitionFileUri: string | null | undefined,
        elementType: string | null | undefined,
    ): Promise<FileMoveResult> {
        const plan = this.planSchemaFolderMove(
            triggerDocument,
            refactorTarget,
            targetSchema,
            schemas,
            definitionFileUri,
            elementType,
        );
        if (!plan) {
            return FileMoveResult.Skipped;
        }

        if (!(await this.moveDefinitionFile(plan.sourceUri, plan.newAbsUri))) {
            return FileMoveResult.Failed;
        }

        // VS Code has already moved the file on disk; ask STS to update only the .sqlproj
        // metadata (remove old <Build Include>, add new one) without touching the filesystem.
        try {
            const result = await this._sqlProjectsService.moveSqlObjectScript(
                refactorTarget.sqlprojUri.fsPath,
                plan.relPath,
                plan.newRelPath,
                true, // metadataOnly
            );
            if (!result?.success) {
                void vscode.window.showErrorMessage(
                    loc.sqlprojUpdateFailed(result?.errorMessage || ""),
                );
            }
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.sqlprojUpdateFailed(err instanceof Error ? err.message : String(err)),
            );
        }

        return FileMoveResult.Moved;
    }

    /**
     * Works out where the definition file should end up, without touching disk or the `.sqlproj`.
     *
     * @returns the move plan, or `undefined` when no move should be attempted (file outside the
     * project, not laid out by schema, or already at the destination).
     */
    private planSchemaFolderMove(
        triggerDocument: vscode.TextDocument,
        refactorTarget: RefactorLogTarget,
        targetSchema: string,
        schemas: string[],
        definitionFileUri: string | null | undefined,
        elementType: string | null | undefined,
    ): SchemaFolderMovePlan | undefined {
        // Source file and target folder come from the STS response; both fall back when absent.
        // See SqlMoveToSchemaResponse in models/contracts/languageService.ts for a payload example.
        const sourceUri = definitionFileUri
            ? vscode.Uri.parse(definitionFileUri)
            : triggerDocument.uri;
        const detectedFolder = elementType
            ? stsElementTypeToFolderMap[elementType.toLowerCase()]
            : undefined;

        // vscode.Uri.path is always forward-slash on every platform, so path.posix APIs work
        // correctly here without any OS path-separator handling.
        const projDirUriPath = path.posix.dirname(refactorTarget.sqlprojUri.path);
        const relPath = path.posix.relative(projDirUriPath, sourceUri.path);
        if (relPath.startsWith("..")) {
            // Source file is not inside the project directory — skip.
            return undefined;
        }

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
            return undefined;
        }

        if (hasSchemaPrefix && !schemas.some((s) => s.toLowerCase() === currentSchemaLower)) {
            // Top-level folder is not a known project schema — skip to avoid moving
            // non-schema-organised files (e.g. misc/tables/x.sql) unexpectedly.
            return undefined;
        }

        // Build the new relative path and skip if the file is already at the destination.
        const newRelPath = [targetSchema, ...innerSegments, fileName].join("/");
        if (relPath === newRelPath) {
            return undefined;
        }

        const projectRootUri = vscode.Uri.joinPath(refactorTarget.sqlprojUri, "..");
        const newAbsUri = vscode.Uri.joinPath(
            projectRootUri,
            targetSchema,
            ...innerSegments,
            fileName,
        );

        return { sourceUri, relPath, newRelPath, newAbsUri };
    }

    /**
     * Moves the definition file to its new location, creating any missing folders along the way.
     * Shows an error and returns `false` if the move does not go through.
     */
    private async moveDefinitionFile(
        sourceUri: vscode.Uri,
        newAbsUri: vscode.Uri,
    ): Promise<boolean> {
        const moveEdit = new vscode.WorkspaceEdit();
        moveEdit.renameFile(sourceUri, newAbsUri, { overwrite: false });
        let moveApplied: boolean;
        try {
            moveApplied = await vscode.workspace.applyEdit(moveEdit);
        } catch (err) {
            void vscode.window.showErrorMessage(
                loc.moveFileFailed(err instanceof Error ? err.message : String(err)),
            );
            return false;
        }
        if (!moveApplied) {
            void vscode.window.showErrorMessage(loc.moveFileFailed(""));
            return false;
        }
        return true;
    }
}
