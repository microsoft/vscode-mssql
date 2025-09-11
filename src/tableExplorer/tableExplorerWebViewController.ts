/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    TableExplorerWebViewState,
    TableExplorerReducers,
} from "../sharedInterfaces/tableExplorer";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
// import ConnectionManager from "../controllers/connectionManager";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
// import { TableExplorerService } from "../services/tableExplorerService";

export class TableExplorerWebViewController extends ReactWebviewPanelController<
    TableExplorerWebViewState,
    TableExplorerReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        // private _tableExplorerService: TableExplorerService,
        // private _connectionManager: ConnectionManager,
        private _targetNode: TreeNodeInfo,
    ) {
        const tableName = _targetNode?.metadata?.name || "Table";
        const databaseName = ObjectExplorerUtils.getDatabaseName(_targetNode);
        const serverName = _targetNode?.connectionProfile?.server || "";

        super(
            context,
            vscodeWrapper,
            "tableExplorer",
            "tableExplorer",
            {
                tableName: tableName,
                databaseName: databaseName,
                serverName: serverName,
                connectionProfile: _targetNode?.connectionProfile,
                schemaName: _targetNode?.metadata?.schema || "dbo",
                isLoading: false,
            },
            {
                title: `Table Explorer: ${tableName}`,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Table.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Table.svg",
                    ),
                },
            },
        );

        this.logger.info(
            `TableExplorerWebViewController created for table: ${tableName} in database: ${databaseName}`,
        );

        void this.initialize();
        this.registerRpcHandlers();
    }

    /**
     * Initializes the table explorer with the given node context.
     */
    private async initialize(): Promise<void> {
        if (!this._targetNode) {
            const errorMessage = "Unable to find object explorer node";
            await vscode.window.showErrorMessage(errorMessage);
            return;
        }

        this.logger.info(`Initializing table explorer for table: ${this.state.tableName}`);

        // Update the state with initial information
        this.updateState(this.state);
    }

    private registerRpcHandlers(): void {
        // this.registerReducer("getTableInfo", async (state) => {
        //     this.logger.verbose(
        //         `Getting table information for: ${state.tableName}`,
        //     );
        //     state.isLoading = true;
        //     this.updateState(state);
        //     try {
        //         // Get connection URI for the current connection
        //         const connectionUri = await this._connectionManager.getUriForConnection(
        //             state.connectionProfile!
        //         );
        //         // Get table metadata from the service
        //         const metadata = await this._tableExplorerService.getTableMetadata(
        //             connectionUri,
        //             state.tableName,
        //             state.schemaName || "dbo"
        //         );
        //         state.tableMetadata = metadata;
        //         state.isLoading = false;
        //     } catch (error) {
        //         this.logger.error(`Error getting table info: ${error}`);
        //         state.isLoading = false;
        //     }
        //     this.updateState(state);
        //     return state;
        // });
        // this.registerReducer("refreshTableInfo", async (state) => {
        //     this.logger.info(
        //         `Refreshing table information for: ${state.tableName}`,
        //     );
        //     // Refresh logic - same as getTableInfo for now
        //     return this.invokeReducer("getTableInfo", state, {});
        // });
    }
}
