/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { SqlMoveToSchema as loc } from "../constants/locConstants";
import { cmdMoveToSchema } from "../constants/constants";
import SqlToolsServerClient from "./serviceclient";
import VscodeWrapper from "../controllers/vscodeWrapper";
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
    resolveRefactorLogTarget,
} from "./refactorLog";

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

    constructor(private readonly vscodeWrapper: VscodeWrapper) {}

    /**
     * Registers the provider and its backing command. Returns disposables for the caller to track.
     */
    public static register(vscodeWrapper: VscodeWrapper): vscode.Disposable[] {
        const provider = new SqlMoveToSchemaProvider(vscodeWrapper);
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
            void this.vscodeWrapper.showInformationMessage(loc.moveToSchemaOnlyInProjectFiles);
            return;
        }

        const wordRange = getSqlIdentifierRange(document, position);
        if (!wordRange) {
            void this.vscodeWrapper.showInformationMessage(loc.noMovableSymbolAtCursor);
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
            void this.vscodeWrapper.showErrorMessage(
                loc.moveToSchemaRequestFailed(err instanceof Error ? err.message : String(err)),
            );
            return;
        }

        if (schemas.length === 0) {
            void this.vscodeWrapper.showInformationMessage(loc.noSchemasFound);
            return;
        }

        // Show QuickPick with schema dropdown
        const items = schemas.map((s) => ({ label: s }));
        const selected = await this.vscodeWrapper.showQuickPick(items, {
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
        const refactorTarget = await resolveRefactorLogTarget(document);
        if (!refactorTarget) {
            void this.vscodeWrapper.showErrorMessage(loc.moveToSchemaOnlyInProjectFiles);
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
            void this.vscodeWrapper.showErrorMessage(
                loc.moveToSchemaRequestFailed(err instanceof Error ? err.message : String(err)),
            );
            return;
        }

        if (!response || !response.changes || Object.keys(response.changes).length === 0) {
            void this.vscodeWrapper.showInformationMessage(loc.noMovableSymbolAtCursor);
            return;
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
                void this.vscodeWrapper.showErrorMessage(loc.applyEditFailed);
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
}
