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
    IMssqlAzureAccount,
} from "../sharedInterfaces/azureAccountManagement";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";

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
                tenants: [],
                selectedTenant: undefined,
                isLoadingTenants: false,
                subscriptions: [],
                selectedSubscription: undefined,
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

    private async getAccountsForState(): Promise<IMssqlAzureAccount[]> {
        const accounts = await VsCodeAzureHelper.getAccounts();
        return accounts.map((account) => ({
            accountId: account.id,
            displayName: account.label,
        }));
    }

    /**
     * Load Azure accounts
     */
    private async loadAzureAccounts(): Promise<void> {
        this.state.isLoading = true;
        this.updateState();

        try {
            this.state.accounts = await this.getAccountsForState();

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
                const signInResult = await VsCodeAzureHelper.signIn();
                if (signInResult) {
                    const accounts = await VsCodeAzureHelper.getAccounts();
                    if (accounts.length > 0) {
                        state.accounts = accounts.map((account) => ({
                            accountId: account.id,
                            displayName: account.label,
                        }));
                    }

                    state.isLoading = false;
                    state.message = "Successfully signed in to Azure";
                } else {
                    state.isLoading = false;
                    state.message = "Azure sign-in cancelled";
                }
            } catch (error) {
                state.isLoading = false;
                state.message = `Error signing in: ${error}`;
            }

            return state;
        });

        this.registerReducer("selectAccount", async (state, payload) => {
            state.selectedAccount = state.accounts.find((a) => a.accountId === payload.accountId);

            if (state.selectedAccount !== undefined) {
                state.message = `Selected account: ${payload.accountId}`;

                // Clear previous tenant and subscription selection and load tenants for the selected account
                state.selectedTenant = undefined;
                state.tenants = [];
                state.selectedSubscription = undefined;
                state.subscriptions = [];

                // Load tenants for the selected account using the account ID
                await this.loadTenantsForAccount(payload.accountId, state);
            }

            return state;
        });

        this.registerReducer("loadTenants", async (state, payload) => {
            await this.loadTenantsForAccount(payload.accountId, state);
            return state;
        });

        this.registerReducer("selectTenant", async (state, payload) => {
            state.selectedTenant = state.tenants.find((t) => t.tenantId === payload.tenantId);

            if (state.selectedAccount !== undefined && state.selectedTenant !== undefined) {
                state.message = `Selected tenant: ${payload.tenantId}`;
                // Clear previous subscription selection and load subscriptions for the selected tenant
                state.selectedSubscription = undefined;
                state.subscriptions = [];
                const azureTenant = {
                    tenantId: state.selectedTenant.tenantId,
                    displayName: state.selectedTenant.displayName,
                };
                state.subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(
                    azureTenant as any,
                );
            }
            return state;
        });

        this.registerReducer("selectSubscription", async (state, payload) => {
            state.selectedSubscription = state.subscriptions.find(
                (s) => s.subscriptionId === payload.subscriptionId,
            );
            if (state.selectedSubscription) {
                state.message = `Selected subscription: ${state.selectedSubscription.displayName}`;
            }
            return state;
        });
    }

    /**
     * Load tenants for a specific account
     */
    private async loadTenantsForAccount(
        accountId: string,
        state: AzureAccountManagementState,
    ): Promise<void> {
        state.isLoadingTenants = true;
        this.updateState(state);

        try {
            const tenants = await VsCodeAzureHelper.getTenantsForAccount(accountId);
            state.tenants = tenants.map((t) => ({
                displayName: t.displayName,
                tenantId: t.tenantId,
            }));
            state.isLoadingTenants = false;
            this.updateState(state);
        } catch (error) {
            state.isLoadingTenants = false;
            state.message = `Error loading tenants: ${error}`;
            this.updateState(state);
        }
    }
}
