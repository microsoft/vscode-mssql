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
        const subsetResult = await this._tableExplorerService.subset(this.state.ownerUri, 0, 100);
        this.state.resultSet = subsetResult;

        this.updateState();
    }

    private registerRpcHandlers(): void {
        this.registerReducer("commitChanges", async (state) => {
            this.logger.info(`Committing changes for: ${state.tableName}`);
            try {
                await this._tableExplorerService.commit(state.ownerUri);
                vscode.window.showInformationMessage("Changes saved successfully");
            } catch (error) {
                this.logger.error(`Error committing changes: ${error}`);
                vscode.window.showErrorMessage(`Failed to save changes: ${error}`);
            }
            return state;
        });

        this.registerReducer("loadSubset", async (state, payload) => {
            this.logger.info(`Loading subset with rowCount: ${payload.rowCount}`);
            try {
                const subsetResult = await this._tableExplorerService.subset(
                    state.ownerUri,
                    0,
                    payload.rowCount,
                );
                state.resultSet = subsetResult;
                this.logger.info(`Loaded ${subsetResult.rowCount} rows`);
            } catch (error) {
                this.logger.error(`Error loading subset: ${error}`);
                vscode.window.showErrorMessage(`Failed to load data: ${error}`);
            }
            return state;
        });

        this.registerReducer("createRow", async (state) => {
            this.logger.info(`Creating new row for: ${state.tableName}`);
            try {
                const result = await this._tableExplorerService.createRow(state.ownerUri);
                vscode.window.showInformationMessage("New row created successfully");
                this.logger.info(`Created row with ID: ${result.newRowId}`);

                // Reload the result set to reflect the new row
                const subsetResult = await this._tableExplorerService.subset(
                    state.ownerUri,
                    0,
                    100,
                );
                state.resultSet = subsetResult;
                this.logger.info(`Reloaded ${subsetResult.rowCount} rows after creation`);
            } catch (error) {
                this.logger.error(`Error creating row: ${error}`);
                vscode.window.showErrorMessage(`Failed to create row: ${error}`);
            }
            return state;
        });

        this.registerReducer("deleteRow", async (state, payload) => {
            this.logger.info(`Deleting row: ${payload.rowId}`);
            try {
                await this._tableExplorerService.deleteRow(state.ownerUri, payload.rowId);
                vscode.window.showInformationMessage("Row deleted successfully");

                if (state.resultSet) {
                    const updatedSubset = state.resultSet.subset.filter(
                        (row) => row.id !== payload.rowId,
                    );
                    state.resultSet = {
                        ...state.resultSet,
                        subset: updatedSubset,
                        rowCount: updatedSubset.length,
                    };
                    this.logger.info(`Updated result set, now has ${updatedSubset.length} rows`);
                }
            } catch (error) {
                this.logger.error(`Error deleting row: ${error}`);
                vscode.window.showErrorMessage(`Failed to delete row: ${error}`);
            }
            return state;
        });

        this.registerReducer("updateCell", async (state, payload) => {
            this.logger.info(`Updating cell: row ${payload.rowId}, column ${payload.columnId}`);
            try {
                const updateCellResult = await this._tableExplorerService.updateCell(
                    state.ownerUri,
                    payload.rowId,
                    payload.columnId,
                    payload.newValue,
                );

                // Update the cell value in the result set to keep state in sync
                if (state.resultSet && updateCellResult.cell) {
                    const rowIndex = state.resultSet.subset.findIndex(
                        (row) => row.id === payload.rowId,
                    );
                    if (rowIndex !== -1) {
                        state.resultSet.subset[rowIndex].cells[payload.columnId] =
                            updateCellResult.cell;
                        this.logger.info(
                            `Updated cell in result set at row ${rowIndex}, column ${payload.columnId}`,
                        );
                    }
                }

                this.logger.info(`Cell updated successfully`);
            } catch (error) {
                this.logger.error(`Error updating cell: ${error}`);
                vscode.window.showErrorMessage(`Failed to update cell: ${error}`);
            }
            return state;
        });
    }

    /**
     * Disposes the Table Explorer webview controller and cleans up resources.
     * This is called when the webview tab is closed.
     */
    public override dispose(): void {
        if (this.state.ownerUri) {
            this.logger.info(
                `Disposing Table Explorer resources for ownerUri: ${this.state.ownerUri}`,
            );
            void this._tableExplorerService.dispose(this.state.ownerUri).catch((error) => {
                this.logger.error(`Error disposing table explorer service: ${error}`);
            });
        }

        super.dispose();
    }
}
