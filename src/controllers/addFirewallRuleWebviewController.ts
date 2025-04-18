/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { AddFirewallRuleState, AddFirewallRuleReducers } from "../sharedInterfaces/addFirewallRule";
import { ApiStatus } from "../sharedInterfaces/webview";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class AddFirewallRuleWebviewController extends ReactWebviewPanelController<
    AddFirewallRuleState,
    AddFirewallRuleReducers
> {
    /**
     * Creates a new instance of AddFirewallRuleController
     */
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        serverName?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "AddFirewallRule",
            "addFirewallRule",
            {
                // Initial state
                loadingStatus: ApiStatus.NotStarted,
                serverName: serverName,
                ipAddress: "", // Will be populated during initialization
                tenants: [],
            },
            {
                title: "Add Firewall Rule",
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                },
            },
        );

        void this.initialize();
    }

    /**
     * Initialize the controller
     */
    private async initialize(): Promise<void> {
        // Update status to loading
        this.state.loadingStatus = ApiStatus.Loading;
        this.updateState();

        // Register reducers for handling actions from the webview
        this.registerReducers();

        try {
            // Get the current IP address
            const ipAddress = await this.getCurrentIpAddress();

            // Update the state with the IP address and change status to ready
            this.state.ipAddress = ipAddress;
            this.state.loadingStatus = ApiStatus.Loaded;
            this.updateState();
        } catch (error) {
            // Handle error case
            this.state.loadingStatus = ApiStatus.Error;
            this.state.errorMessage =
                error instanceof Error ? error.message : "Unknown error occurred";
            this.updateState();
        }
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerReducers(): void {}

    /**
     * Get the current public IP address
     */
    private async getCurrentIpAddress(): Promise<string> {
        // This is a placeholder implementation
        // In a real implementation, this would call a service to get the public IP

        // Simulate a delay to show loading state
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Return a mock IP address for now
        return "192.168.1.1";
    }
}
