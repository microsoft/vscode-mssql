/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import { AddFirewallRuleState, AddFirewallRuleReducers } from "../sharedInterfaces/addFirewallRule";
import { AddFirewallRuleDialogProps } from "../sharedInterfaces/connectionDialog";

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
        dialogProps: AddFirewallRuleDialogProps,
    ) {
        super(
            context,
            vscodeWrapper,
            "AddFirewallRule",
            "addFirewallRule",
            { addFirewallRuleProps: dialogProps },
            {
                title: `Add Firewall Rule${dialogProps.serverName ? ` to ${dialogProps.serverName}` : ""}`,
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
        this.updateState();

        // Register reducers for handling actions from the webview
        this.registerReducers();
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerReducers(): void {}
}
