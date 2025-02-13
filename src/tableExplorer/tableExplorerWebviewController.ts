/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    TableExplorerReducers,
    TableExplorerWebviewState,
} from "../sharedInterfaces/tableExplorer";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";

export class TableExplorerWebviewController extends ReactWebviewPanelController<
    TableExplorerWebviewState,
    TableExplorerReducers
> {
    constructor(
        private context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _targetNode?: TreeNodeInfo,
    ) {
        super(
            context,
            vscodeWrapper,
            "tableExplorer",
            "tableExplorer",
            {
                resultCount: 0,
            },
            {
                //TODO: add database name here
                title: `Table Explorer - [database name]`,
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: true,
            },
        );

        void this.initialize();
    }

    private async initialize() {
        //TODO: uncomment before release, commented now to use command bar call
        // if (!this._targetNode) {
        //     await vscode.window.showErrorMessage(
        //         "Unable to find object explorer node",
        //     );
        //     return;
        // }

        this.state = {
            view: {
                tabs: [
                    {
                        title: "Tables",
                        id: "tables",
                    },
                ],
            },
            //TODO: change this according to config
            resultCount: 10,
        };
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("setTableExplorerResults", (state, results) => {
            // TODO: change number of results displayed, will need to call backend API
            state.resultCount = results.resultCount;
            return state;
        });
    }

    private getTableNameForNode(node: TreeNodeInfo): string {
        if (
            node.metadata?.metadataTypeName === "Table" ||
            node.metadata?.metadataTypeName === "View"
        ) {
            return node.metadata.name;
        } else {
            if (node.parentNode) {
                return this.getTableNameForNode(node.parentNode);
            }
        }
        return "";
    }
}
