/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { AddFirewallRuleState, AddFirewallRuleReducers } from "../sharedInterfaces/addFirewallRule";
import { confirmVscodeAzureSignin } from "../connectionconfig/azureHelpers";
import { FirewallService } from "../firewall/firewallService";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { errorFirewallRule } from "../constants/constants";
import { Deferred } from "../protocol";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";

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
        initialzationProps: {
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
                serverName: initialzationProps.serverName,
                message: initialzationProps.errorMessage,
                clientIp: "",
                isSignedIn: false,
                tenants: [],
            },
            {
                title: `Add Firewall Rule${initialzationProps.serverName ? ` to ${initialzationProps.serverName}` : ""}`,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                },
            },
        );
        this.registerRpcHandlers();
        this.updateState();

        void this.initializeDialog(initialzationProps.errorMessage).then(() => {
            this.updateState();
            this.initialized.resolve();
        });
    }

    /**
     * Initialize the controller
     */
    private async initializeDialog(errorMessage: string): Promise<void> {
        // Check if user is signed into Azure, and populate the dialog if they are
        const auth: VSCodeAzureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();

        this.state.isSignedIn = await auth.isSignedIn();

        if (this.state.isSignedIn) {
            await this.populateTentants(this.state);
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
            this.completed.resolve(false);
            this.panel.dispose();
            // this.disposeWithResult(false);
            return state;
        });

        this.registerReducer("addFirewallRule", async (state, payload) => {
            try {
                await this.firewallService.createFirewallRuleWithVscodeAccount(
                    payload.firewallRuleSpec,
                    this.state.serverName,
                );

                sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.AddFirewallRule);

                this.completed.resolve(true);
                await this.panel.dispose();
            } catch (err) {
                state.message = getErrorMessage(err);

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
            await this.populateTentants(state);

            return state;
        });
    }

    public async populateTentants(state: AddFirewallRuleState): Promise<void> {
        const auth = await confirmVscodeAzureSignin();

        if (!auth) {
            const errorMessage = "Azure sign-in failed or was cancelled.";

            this.logger.error(errorMessage);
            this.vscodeWrapper.showErrorMessage(errorMessage);

            return;
        }

        const tenants = await auth.getTenants();

        state.isSignedIn = true;
        state.tenants = tenants.map((t) => {
            return {
                name: t.displayName,
                id: t.tenantId,
            };
        });
    }
}
