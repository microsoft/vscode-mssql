/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import {
    MigrationScriptPreviewState,
    MigrationScriptPreviewReducers,
} from "../sharedInterfaces/migrationScriptPreview";

/**
 * Result returned when the migration script preview is closed
 */
export interface MigrationScriptPreviewResult {
    /**
     * Whether the user confirmed execution of the script
     */
    confirmed: boolean;
}

/**
 * Controller for the migration script preview webview
 */
export class MigrationScriptPreviewController extends ReactWebviewPanelController<
    MigrationScriptPreviewState,
    MigrationScriptPreviewReducers,
    MigrationScriptPreviewResult
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        script: string,
        tableName: string,
        operationType: string,
        hasDataLoss: boolean = false,
    ) {
        super(
            context,
            vscodeWrapper,
            "migrationScriptPreview",
            "migrationScriptPreview",
            {
                script,
                tableName,
                operationType,
                hasDataLoss,
            },
            {
                title: `Migration Script Preview - ${tableName}`,
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "editTable_dark.svg"),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "editTable_light.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this.registerRpcHandlers();
    }

    private registerRpcHandlers(): void {
        // Handle execute script action
        this.registerReducer("executeScript", async (state) => {
            // Resolve the dialog result with confirmed = true
            this.dialogResult.resolve({ confirmed: true });
            // Close the panel
            this.panel.dispose();
            return state;
        });

        // Handle cancel action
        this.registerReducer("cancel", async (state) => {
            // Resolve the dialog result with confirmed = false
            this.dialogResult.resolve({ confirmed: false });
            // Close the panel
            this.panel.dispose();
            return state;
        });
    }
}
