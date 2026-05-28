/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WebviewPanelController } from "./webviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { AddFirewallRuleState, AddFirewallRuleReducers } from "../sharedInterfaces/addFirewallRule";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { Deferred } from "../protocol";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as Loc from "../constants/locConstants";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class AddFirewallRuleWebviewController extends WebviewPanelController<
    AddFirewallRuleState,
    AddFirewallRuleReducers,
    boolean
> {
    public readonly initialized: Deferred<void> = new Deferred<void>();

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        initializationProps: {
            serverName: string;
            errorMessage: string;
        },
    ) {
        super(
            context,
            vscodeWrapper,
            "AddFirewallRule",
            "addFirewallRule",
            {
                serverName: initializationProps.serverName,
                message: initializationProps.errorMessage,
                clientIp: "",
                isSignedIn: false,
                loadingAccounts: true,
                accounts: [],
                tenants: {},
                addFirewallRuleStatus: ApiStatus.NotStarted,
            },
            {
                title: initializationProps.serverName
                    ? Loc.FirewallRule.addFirewallRuleToServer(initializationProps.serverName)
                    : Loc.FirewallRule.addFirewallRule,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "addFirewallRule_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "addFirewallRule_dark.svg",
                    ),
                },
            },
        );
        this.registerRpcHandlers();
        this.updateState();

        void this.initializeDialog(initializationProps.errorMessage)
            .then(() => {
                this.updateState();
                this.initialized.resolve();
            })
            .catch((err) => {
                this.logger.error(
                    `Error initializing AddFirewallRuleWebviewController: ${getErrorMessage(err)}`,
                );
                this.initialized.reject(err);
            });
    }

    /**
     * Initialize the controller
     */
    private async initializeDialog(errorMessage: string): Promise<void> {
        const accountLoadingPromise = this.loadAzureAccounts(); // Load accounts and extract client IP in parallel
        this.state.clientIp = getIpFromFirewallError(errorMessage);

        await accountLoadingPromise;
    }

    private async loadAzureAccounts(): Promise<void> {
        try {
            this.state.isSignedIn = await VsCodeAzureHelper.isSignedIn();

            if (this.state.isSignedIn) {
                await populateAzureAccountInfo(this.state, false /* forceSignInPrompt */);
            }
        } finally {
            this.state.loadingAccounts = false;
            this.updateState();
        }
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerRpcHandlers(): void {
        this.registerReducer("closeDialog", async (state) => {
            this.dialogResult.resolve(false);
            this.panel.dispose();
            return state;
        });

        this.registerReducer("addFirewallRule", async (state, payload) => {
            state.addFirewallRuleStatus = ApiStatus.Loading;
            this.updateState(state);

            try {
                const serverInfo = await VsCodeAzureHelper.findAzureSqlServerByFqdn(
                    payload.firewallRuleSpec.azureAccountInfo.accountId,
                    payload.firewallRuleSpec.azureAccountInfo.tenantId,
                    this.state.serverName,
                );

                const [startIp, endIp] =
                    typeof payload.firewallRuleSpec.ip === "string"
                        ? [payload.firewallRuleSpec.ip, payload.firewallRuleSpec.ip]
                        : [payload.firewallRuleSpec.ip.startIp, payload.firewallRuleSpec.ip.endIp];

                await VsCodeAzureHelper.createFirewallRule(
                    serverInfo.subscription,
                    serverInfo.resourceGroupName,
                    serverInfo.serverName,
                    payload.firewallRuleSpec.name,
                    startIp,
                    endIp,
                );

                sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.AddFirewallRule);

                this.dialogResult.resolve(true);
                await this.panel.dispose();
            } catch (err) {
                state.message = getErrorMessage(err);
                state.addFirewallRuleStatus = ApiStatus.Error;

                sendErrorEvent(
                    TelemetryViews.AddFirewallRule,
                    TelemetryActions.AddFirewallRule,
                    err,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        failure: err.Name,
                    },
                );
            }

            return state;
        });

        this.registerReducer("signIntoAzure", async (state) => {
            state.loadingAccounts = true;
            this.updateState(state);

            try {
                await populateAzureAccountInfo(state, true /* forceSignInPrompt */);
            } finally {
                state.loadingAccounts = false;
            }

            return state;
        });
    }
}

export async function populateAzureAccountInfo(
    state: AddFirewallRuleState,
    forceSignInPrompt: boolean,
): Promise<void> {
    let auth: VSCodeAzureSubscriptionProvider;

    try {
        auth = (await VsCodeAzureHelper.signIn(forceSignInPrompt)).auth;
    } catch (error) {
        console.error(`Error signing into Azure: ${getErrorMessage(error)}`);
        return;
    }

    state.isSignedIn = true;

    const accounts = await VsCodeAzureHelper.getAccounts();

    state.accounts = accounts.map((a) => {
        return {
            displayName: a.label,
            accountId: a.id,
        };
    });

    const tenants = await auth.getTenants();

    for (const t of tenants) {
        if (t.account.id in state.tenants) {
            state.tenants[t.account.id].push({
                displayName: t.displayName,
                tenantId: t.tenantId,
            });
        } else {
            state.tenants[t.account.id] = [{ displayName: t.displayName, tenantId: t.tenantId }];
        }
    }
}

export function getIpFromFirewallError(errorMessage: string): string {
    const ipRegex = /(\d{1,3}\.){3}\d{1,3}/;
    const match = errorMessage.match(ipRegex);
    return match ? match[0] : "";
}
