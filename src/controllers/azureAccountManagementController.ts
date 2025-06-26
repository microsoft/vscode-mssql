/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import {
    AzureAccountManagementReducers,
    AzureAccountManagementState,
} from "../sharedInterfaces/azureAccountManagement";
import VscodeWrapper from "./vscodeWrapper";

/**
 * Controller for the Azure Account Management dialog
 */
export class AzureAccountManagementController extends ReactWebviewPanelController<
    AzureAccountManagementState,
    AzureAccountManagementReducers
> {
    private static readonly _title = "Azure Account Management";

    /**
     * Creates a new instance of the AzureAccountManagementController
     */
    constructor(extensionContext: vscode.ExtensionContext, vscodeWrapper: VscodeWrapper) {
        super(
            extensionContext,
            vscodeWrapper,
            "azureAccountManagement",
            "azureAccountManagement",
            {
                accounts: [],
                message: "Welcome to Azure Account Management",
            },
            {
                title: AzureAccountManagementController._title,
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: true,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        extensionContext.extensionUri,
                        "media",
                        "database_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        extensionContext.extensionUri,
                        "media",
                        "database_light.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        // Register reducers
        this.registerReducer("closeDialog", () => this.closeDialog());
    }

    /**
     * Closes the dialog
     */
    private async closeDialog(): Promise<AzureAccountManagementState> {
        this.dispose();
        return this.state;
    }
}
