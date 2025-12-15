/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import {
    BackupDatabaseReducers,
    BackupDatabaseWebviewState,
} from "../sharedInterfaces/backupDatabase";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";

export class BackupDatabaseWebviewController extends ReactWebviewPanelController<
    BackupDatabaseWebviewState,
    BackupDatabaseReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        databaseNode: TreeNodeInfo,
    ) {
        super(
            context,
            vscodeWrapper,
            "backupDatabase",
            "backupDatabase",
            {
                loadState: ApiStatus.Loading,
                databaseNode: databaseNode,
            },
            {
                title: `Backup Database - ${databaseNode.label}`, // Sets the webview title
                viewColumn: vscode.ViewColumn.Active, // Sets the view column of the webview
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_light.svg",
                    ),
                },
            },
        );
        void this.initialize();
    }

    private async initialize() {
        this.updateState();
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("getDatabase", async (state, payload) => {
            return state;
        });
    }
}
