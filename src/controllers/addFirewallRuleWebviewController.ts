/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { AddFirewallRuleState, AddFirewallRuleReducers } from "../sharedInterfaces/addFirewallRule";
import { FirewallService } from "../firewall/firewallService";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { errorFirewallRule } from "../constants/constants";
import { Deferred } from "../protocol";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as Loc from "../constants/locConstants";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class AddFirewallRuleWebviewController extends ReactWebviewPanelController<
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
        private firewallService: FirewallService,
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
                accounts: [],
                tenants: {},
                addFirewallRuleState: ApiStatus.NotStarted,
            },
            {
                title: initializationProps.serverName
                    ? Loc.FirewallRule.addFirewallRuleToServer(initializationProps.serverName)
                    : Loc.FirewallRule.addFirewallRule,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                },
            },
        );
        this.registerRpcHandlers();
        this.updateState();

        void this.initializeDialog(initializationProps.errorMessage).then(() => {
            this.updateState();
            this.initialized.resolve();
        });
    }

    /**
     * Initialize the controller
     */
    private async initializeDialog(errorMessage: string): Promise<void> {
        // Check if user is signed into Azure, and populate the dialog if they are
        this.state.isSignedIn = await VsCodeAzureHelper.isSignedIn();

        if (this.state.isSignedIn) {
            await this.populateAzureAccountInfo(this.state);
        }

        // Extract the client IP address from the error message
        const handleFirewallErrorResult = await this.firewallService.handleFirewallRule(
            errorFirewallRule,
            errorMessage,
        );

        if (!handleFirewallErrorResult.result) {
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.AddFirewallRule,
                new Error(errorMessage),
                true, // includeErrorMessage; parse failed because it couldn't detect an IP address, so that'd be the only PII
                undefined, // errorCode
                undefined, // errorType
            );

            // Proceed with 0.0.0.0 as the client IP, and let user fill it out manually.
            handleFirewallErrorResult.ipAddress = "0.0.0.0";
        }

        this.state.clientIp = handleFirewallErrorResult.ipAddress;
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
            state.addFirewallRuleState = ApiStatus.Loading;
            this.updateState(state);

            try {
                await this.firewallService.createFirewallRuleWithVscodeAccount(
                    payload.firewallRuleSpec,
                    this.state.serverName,
                );

                sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.AddFirewallRule);

                this.dialogResult.resolve(true);
                await this.panel.dispose();
            } catch (err) {
                state.message = getErrorMessage(err);
                state.addFirewallRuleState = ApiStatus.Error;

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
            await this.populateAzureAccountInfo(state);

            return state;
        });
    }

    public async populateAzureAccountInfo(state: AddFirewallRuleState): Promise<void> {
        const auth = await VsCodeAzureHelper.confirmVscodeAzureSignin();

        if (!auth) {
            const errorMessage = Loc.Azure.azureSignInFailedOrWasCancelled;

            this.logger.error(errorMessage);
            this.vscodeWrapper.showErrorMessage(errorMessage);

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
                state.tenants[t.account.id] = [
                    { displayName: t.displayName, tenantId: t.tenantId },
                ];
            }
        }
    }
}
