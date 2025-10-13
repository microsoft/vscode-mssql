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
import { ITableExplorerService } from "../services/tableExplorerService";
import { EditSessionReadyNotification } from "../models/contracts/tableExplorer";
import { NotificationHandler } from "vscode-languageclient";
import { Deferred } from "../protocol";
import * as LocConstants from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";

export class TableExplorerWebViewController extends ReactWebviewPanelController<
    TableExplorerWebViewState,
    TableExplorerReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _tableExplorerService: ITableExplorerService,
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
                title: LocConstants.TableExplorer.title(tableName),
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
            await vscode.window.showErrorMessage(
                LocConstants.TableExplorer.unableToOpenTableExplorer,
            );
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
                vscode.window.showInformationMessage(
                    LocConstants.TableExplorer.changesSavedSuccessfully,
                );
            } catch (error) {
                this.logger.error(`Error committing changes: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToSaveChanges(getErrorMessage(error)),
                );
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

                this.updateState();

                this.logger.info(`Loaded ${subsetResult.rowCount} rows`);
            } catch (error) {
                this.logger.error(`Error loading subset: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToLoadData(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("createRow", async (state) => {
            this.logger.info(`Creating new row for: ${state.tableName}`);
            try {
                const result = await this._tableExplorerService.createRow(state.ownerUri);
                vscode.window.showInformationMessage(
                    LocConstants.TableExplorer.newRowCreatedSuccessfully,
                );
                this.logger.info(`Created row with ID: ${result.newRowId}`);

                // Reload the result set to reflect the new row
                const subsetResult = await this._tableExplorerService.subset(
                    state.ownerUri,
                    0,
                    100,
                );
                state.resultSet = subsetResult;

                this.updateState();

                this.logger.info(`Reloaded ${subsetResult.rowCount} rows after creation`);
            } catch (error) {
                this.logger.error(`Error creating row: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToCreateNewRow(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("deleteRow", async (state, payload) => {
            this.logger.info(`Deleting row: ${payload.rowId}`);
            try {
                await this._tableExplorerService.deleteRow(state.ownerUri, payload.rowId);
                vscode.window.showInformationMessage(LocConstants.TableExplorer.rowRemoved);

                if (state.resultSet) {
                    const updatedSubset = state.resultSet.subset.filter(
                        (row) => row.id !== payload.rowId,
                    );
                    state.resultSet = {
                        ...state.resultSet,
                        subset: updatedSubset,
                        rowCount: updatedSubset.length,
                    };

                    this.updateState();

                    this.logger.info(`Updated result set, now has ${updatedSubset.length} rows`);
                }
            } catch (error) {
                this.logger.error(`Error deleting row: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRemoveRow(getErrorMessage(error)),
                );
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

                        this.updateState();

                        this.logger.info(
                            `Updated cell in result set at row ${rowIndex}, column ${payload.columnId}`,
                        );
                    }
                }

                this.logger.info(`Cell updated successfully`);
            } catch (error) {
                this.logger.error(`Error updating cell: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToUpdateCell(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("revertCell", async (state, payload) => {
            this.logger.info(`Reverting cell: row ${payload.rowId}, column ${payload.columnId}`);
            try {
                const revertCellResult = await this._tableExplorerService.revertCell(
                    state.ownerUri,
                    payload.rowId,
                    payload.columnId,
                );

                // Update the cell value in the result set to keep state in sync
                if (state.resultSet && revertCellResult.cell) {
                    const rowIndex = state.resultSet.subset.findIndex(
                        (row) => row.id === payload.rowId,
                    );
                    if (rowIndex !== -1) {
                        state.resultSet = {
                            ...state.resultSet,
                            subset: state.resultSet.subset.map((row, idx) => {
                                if (idx === rowIndex) {
                                    return {
                                        ...row,
                                        cells: row.cells.map((cell, cellIdx) => {
                                            if (cellIdx === payload.columnId) {
                                                return revertCellResult.cell;
                                            }
                                            return cell;
                                        }),
                                    };
                                }
                                return row;
                            }),
                        };

                        this.updateState();

                        this.logger.info(
                            `Reverted cell in result set at row ${rowIndex}, column ${payload.columnId}`,
                        );
                    }
                }

                this.logger.info(`Cell reverted successfully`);
            } catch (error) {
                this.logger.error(`Error reverting cell: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRevertCell(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("revertRow", async (state, payload) => {
            this.logger.info(`Reverting row: ${payload.rowId}`);
            try {
                const revertRowResult = await this._tableExplorerService.revertRow(
                    state.ownerUri,
                    payload.rowId,
                );

                // Update the row in the result set with the reverted row data
                if (state.resultSet && revertRowResult.row) {
                    const rowIndex = state.resultSet.subset.findIndex(
                        (row) => row.id === payload.rowId,
                    );
                    if (rowIndex !== -1) {
                        // Create a new resultSet object to trigger React's change detection
                        state.resultSet = {
                            ...state.resultSet,
                            subset: state.resultSet.subset.map((row, idx) => {
                                if (idx === rowIndex) {
                                    return revertRowResult.row;
                                }
                                return row;
                            }),
                        };

                        this.updateState();

                        this.logger.info(
                            `Reverted row at index ${rowIndex} with ${revertRowResult.row.cells.length} cells`,
                        );
                    }
                }

                this.logger.info(`Row reverted successfully`);
            } catch (error) {
                this.logger.error(`Error reverting row: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRevertRow(getErrorMessage(error)),
                );
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
                this.logger.error(
                    `Error disposing table explorer service: ${getErrorMessage(error)}`,
                );
            });
        }

        super.dispose();
    }
}
