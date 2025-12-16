/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { BackupDatabaseReducers, BackupDatabaseState } from "../sharedInterfaces/backupDatabase";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";

export class BackupDatabaseWebviewController extends ReactWebviewPanelController<
    BackupDatabaseState,
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
                databaseNode: {
                    label: databaseNode.label.toString(),
                    nodePath: databaseNode.nodePath,
                    nodeStatus: databaseNode.nodeStatus,
                },
            },
            {
                title: `Backup Database - ${databaseNode.label.toString()}`, // Sets the webview title
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
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("getDatabase", async (state, _payload) => {
            return state;
        });
    }
}
