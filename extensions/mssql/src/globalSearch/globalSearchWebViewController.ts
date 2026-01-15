/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    GlobalSearchWebViewState,
    GlobalSearchReducers,
} from "../sharedInterfaces/globalSearch";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { ApiStatus } from "../sharedInterfaces/webview";

export class GlobalSearchWebViewController extends ReactWebviewPanelController<
    GlobalSearchWebViewState,
    GlobalSearchReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        _targetNode: TreeNodeInfo,
    ) {
        const serverName = _targetNode?.connectionProfile?.server || "Server";
        const databaseName = ObjectExplorerUtils.getDatabaseName(_targetNode) || "";

        super(
            context,
            vscodeWrapper,
            "globalSearch",
            "globalSearch",
            {
                serverName: serverName,
                databaseName: databaseName,
                loadStatus: ApiStatus.Loaded,
            },
            {
                title: `Global Search - ${serverName}`,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Search_inverse.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Search.svg",
                    ),
                },
            },
        );

        this.registerRpcHandlers();
    }

    private registerRpcHandlers(): void {
        // Register reducers here as needed
    }
}
