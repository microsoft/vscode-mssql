/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import {
    AzureAccountManagementState,
    AzureAccountManagementReducers,
} from "../sharedInterfaces/azureAccountManagement";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

/**
 * Controller for the Azure Account Management dialog
 */
export class AzureAccountManagementWebviewController extends ReactWebviewPanelController<
    AzureAccountManagementState,
    AzureAccountManagementReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        initializationProps?: Partial<AzureAccountManagementState>,
    ) {
        super(
            context,
            vscodeWrapper,
            "AzureAccountManagement",
            "azureAccountManagement",
            {
                message: "Manage your Azure accounts",
                accounts: [],
                isLoading: false,
                selectedAccount: undefined,
                ...(initializationProps || {}),
            },
            {
                title: "Azure Account Management",
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                },
            },
        );
        this.registerRpcHandlers();
        this.updateState();

        // Initialize by loading accounts
        void this.loadAzureAccounts();
    }

    /**
     * Load Azure accounts
     */
    private async loadAzureAccounts(): Promise<void> {
        this.state.isLoading = true;
        this.updateState();

        try {
            // TODO: Implement actual account loading logic
            // This would typically call Azure account service
            // For now, we'll just simulate it with sample data
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Sample data - in the real implementation, get this from Azure account service
            this.state.accounts = ["account1@example.com", "account2@example.com"];

            this.state.isLoading = false;
            this.updateState();
        } catch (error) {
            this.state.isLoading = false;
            this.state.message = `Error loading accounts: ${error}`;
            this.updateState();
        }
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerRpcHandlers(): void {
        this.registerReducer("closeDialog", async (state) => {
            this.panel.dispose();
            return state;
        });

        this.registerReducer("signIntoAzureAccount", async (state) => {
            sendActionEvent(TelemetryViews.AzureAccountManagement, TelemetryActions.AzureSignIn);

            state.isLoading = true;
            this.updateState(state);

            try {
                // TODO: Implement actual Azure sign in logic
                // This would typically call the Azure authentication service
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // Simulate adding a new account
                if (!state.accounts.includes("new-account@example.com")) {
                    state.accounts = [...state.accounts, "new-account@example.com"];
                }

                state.isLoading = false;
                state.message = "Successfully signed in to Azure";
            } catch (error) {
                state.isLoading = false;
                state.message = `Error signing in: ${error}`;
            }

            return state;
        });

        this.registerReducer("selectAccount", async (state, payload) => {
            if (payload.account && state.accounts.includes(payload.account)) {
                state.selectedAccount = payload.account;
                state.message = `Selected account: ${payload.account}`;
            }
            return state;
        });
    }
}
