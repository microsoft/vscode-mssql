/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    TableExplorerWebViewState,
    TableExplorerReducers,
    EditSessionReadyParams,
} from "../sharedInterfaces/tableExplorer";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import ConnectionManager from "../controllers/connectionManager";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TableExplorerService } from "../services/tableExplorerService";
import { EditSessionReadyNotification } from "../models/contracts/tableExplorer";
import { NotificationHandler } from "vscode-languageclient";
import { Deferred } from "../protocol";

export class TableExplorerWebViewController extends ReactWebviewPanelController<
    TableExplorerWebViewState,
    TableExplorerReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _tableExplorerService: TableExplorerService,
        private _connectionManager: ConnectionManager,
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
                ownerUri: "",
                resultSet: undefined,
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

        this._tableExplorerService.sqlToolsClient.onNotification(
            EditSessionReadyNotification.type,
            this.handleEditSessionReadyNotification(),
        );

        const schemaName = this.state.schemaName;
        const objectName = this.state.tableName;
        const ownerUri = schemaName
            ? `untitled:${schemaName}.${objectName}`
            : `untitled:${objectName}`;

        const objectType = this._targetNode.metadata.metadataTypeName.toUpperCase();
        const limitResults = 200;

        let connectionCreds = Object.assign({}, this._targetNode.connectionProfile);
        const databaseName = ObjectExplorerUtils.getDatabaseName(this._targetNode);

        if (
            !this._connectionManager.isConnected(ownerUri) ||
            connectionCreds.database !== databaseName
        ) {
            connectionCreds.database = databaseName;
            if (!this._connectionManager.isConnecting(ownerUri)) {
                const promise = new Deferred<boolean>();
                await this._connectionManager.connect(ownerUri, connectionCreds, promise);
                await promise;
            }
        }

        await this._tableExplorerService.initialize(
            ownerUri,
            objectName,
            schemaName,
            objectType,
            undefined,
            limitResults,
        );
    }

    private handleEditSessionReadyNotification(): NotificationHandler<EditSessionReadyParams> {
        const self = this;
        return (result: EditSessionReadyParams): void => {
            if (result.success) {
                self.state.ownerUri = result.ownerUri;
                self.updateState();

                void self.loadResultSet();
            }
        };
    }

    private async loadResultSet(): Promise<void> {
        const subsetResult = await this._tableExplorerService.subset(
            this.state.ownerUri,
            0,
            200 - 1,
        );
        this.state.resultSet = subsetResult;

        this.updateState();
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

    /**
     * Disposes the Table Explorer webview controller and cleans up resources.
     * This is called when the webview tab is closed.
     */
    public override dispose(): void {
        // Dispose of the table explorer service resources if ownerUri is set
        if (this.state.ownerUri) {
            this.logger.info(
                `Disposing Table Explorer resources for ownerUri: ${this.state.ownerUri}`,
            );
            void this._tableExplorerService.dispose(this.state.ownerUri).catch((error) => {
                this.logger.error(`Error disposing table explorer service: ${error}`);
            });
        }

        // Call parent dispose to clean up webview resources
        super.dispose();
    }
}
