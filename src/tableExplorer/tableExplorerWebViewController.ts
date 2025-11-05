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
import * as LocConstants from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { generateGuid } from "../models/utils";

export class TableExplorerWebViewController extends ReactWebviewPanelController<
    TableExplorerWebViewState,
    TableExplorerReducers
> {
    private operationId: string;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _tableExplorerService: ITableExplorerService,
        private _connectionManager: ConnectionManager,
        private _targetNode: TreeNodeInfo,
    ) {
        const tableName = _targetNode?.metadata?.name || "Table";
        const schemaName = _targetNode?.metadata?.schema;
        const databaseName = ObjectExplorerUtils.getDatabaseName(_targetNode);
        const serverName = _targetNode?.connectionProfile?.server || "";
        const qualifiedTableName = schemaName ? `${schemaName}.${tableName}` : tableName;

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
                schemaName: schemaName,
                isLoading: false,
                ownerUri: "",
                resultSet: undefined,
                currentRowCount: 100, // Default row count for data loading
                newRows: [], // Track newly created rows
                updateScript: undefined, // No script initially
                showScriptPane: false, // Script pane hidden by default
                currentPage: 1, // Start on page 1
                failedCells: [], // Track cells that failed to update
            },
            {
                title: LocConstants.TableExplorer.title(qualifiedTableName),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "EditTableData_Dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "EditTableData_Light.svg",
                    ),
                },
                showRestorePromptAfterClose: false, // Will be set to true when changes are made
            },
        );

        this.operationId = generateGuid();
        this.logger.info(
            `TableExplorerWebViewController created for table: ${tableName} in database: ${databaseName} - OperationId: ${this.operationId}`,
        );

        this._tableExplorerService.sqlToolsClient.onNotification(
            EditSessionReadyNotification.type,
            this.handleEditSessionReadyNotification(),
        );

        void this.initialize();
        this.registerRpcHandlers();
    }

    /**
     * Initializes the table explorer with the given node context.
     */
    private async initialize(): Promise<void> {
        const startTime = Date.now();
        const endActivity = startActivity(
            TelemetryViews.TableExplorer,
            TelemetryActions.Initialize,
            generateGuid(),
            {
                startTime: startTime.toString(),
                operationId: this.operationId,
            },
        );

        if (!this._targetNode) {
            this.logger.error(`No target node provided - OperationId: ${this.operationId}`);
            endActivity.endFailed(
                new Error("No target node provided for table explorer"),
                true,
                undefined,
                undefined,
                {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                },
            );

            await vscode.window.showErrorMessage(
                LocConstants.TableExplorer.unableToOpenTableExplorer,
            );
            return;
        }

        try {
            const schemaName = this.state.schemaName;
            const objectName = this.state.tableName;
            const ownerUri = schemaName
                ? `untitled:${schemaName}.${objectName}`
                : `untitled:${objectName}`;

            const objectType = this._targetNode.metadata.metadataTypeName.toUpperCase();

            let connectionCreds = Object.assign({}, this._targetNode.connectionProfile);
            const databaseName = ObjectExplorerUtils.getDatabaseName(this._targetNode);

            this.logger.info(
                `Initializing table explorer for ${schemaName}.${objectName} - OperationId: ${this.operationId}`,
            );

            if (
                !this._connectionManager.isConnected(ownerUri) ||
                connectionCreds.database !== databaseName
            ) {
                connectionCreds.database = databaseName;
                if (!this._connectionManager.isConnecting(ownerUri)) {
                    await this._connectionManager.connect(ownerUri, connectionCreds);
                }
            }

            await this._tableExplorerService.initialize(
                ownerUri,
                objectName,
                schemaName,
                objectType,
                undefined,
            );

            this.logger.info(
                `Table explorer initialized successfully - OperationId: ${this.operationId}`,
            );
            endActivity.end(ActivityStatus.Succeeded, {
                elapsedTime: (Date.now() - startTime).toString(),
                operationId: this.operationId,
            });
        } catch (error) {
            this.logger.error(
                `Error initializing table explorer: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
            );
            endActivity.endFailed(
                new Error(`Failed to initialize table explorer: ${getErrorMessage(error)}`),
                true,
                undefined,
                undefined,
                {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                },
            );
            throw error;
        }
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

    /**
     * Helper method to regenerate the script and update state.
     * Used when script pane is visible and data changes occur.
     */
    private async regenerateScript(state: TableExplorerWebViewState): Promise<void> {
        try {
            const scriptResult = await this._tableExplorerService.generateScripts(state.ownerUri);
            const combinedScript = scriptResult.scripts?.join("\n") || "";
            state.updateScript = combinedScript;
            this.updateState();
            this.logger.info("Script regenerated successfully in real-time");
        } catch (error) {
            this.logger.error(`Error regenerating script: ${error}`);
        }
    }

    /**
     * Helper method to conditionally regenerate script if script pane is visible.
     * Call this after updating state when data changes occur.
     */
    private async regenerateScriptIfVisible(state: TableExplorerWebViewState): Promise<void> {
        if (state.showScriptPane) {
            await this.regenerateScript(state);
        }
    }

    private registerRpcHandlers(): void {
        this.registerReducer("commitChanges", async (state) => {
            this.logger.info(
                `Committing changes for: ${state.tableName} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.CommitChanges,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    newRowsCount: state.newRows.length.toString(),
                },
            );

            try {
                await this._tableExplorerService.commit(state.ownerUri);
                vscode.window.showInformationMessage(
                    LocConstants.TableExplorer.changesSavedSuccessfully,
                );

                // Clear tracking state after successful commit
                state.newRows = [];
                state.failedCells = [];
                this.showRestorePromptAfterClose = false;

                this.logger.info(
                    `Cleared new rows and failed cells after successful commit - OperationId: ${this.operationId}`,
                );

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });
            } catch (error) {
                this.logger.error(
                    `Error committing changes: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to commit changes: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToSaveChanges(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("loadSubset", async (state, payload) => {
            this.logger.info(
                `Loading subset with rowCount: ${payload.rowCount} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.LoadSubset,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    rowCount: payload.rowCount.toString(),
                },
            );

            try {
                const subsetResult = await this._tableExplorerService.subset(
                    state.ownerUri,
                    0,
                    payload.rowCount,
                );

                // Filter out any new uncommitted rows from backend result to avoid duplicates
                // We'll always append them explicitly at the end
                const newRowIds = new Set(state.newRows.map((row) => row.id));
                const backendRowsOnly = subsetResult.subset.filter((row) => !newRowIds.has(row.id));

                // Always append new rows at the end
                state.resultSet = {
                    ...subsetResult,
                    subset: [...backendRowsOnly, ...state.newRows],
                    rowCount: backendRowsOnly.length + state.newRows.length,
                };

                this.logger.info(
                    `Loaded ${backendRowsOnly.length} committed rows from database, appended ${state.newRows.length} new uncommitted rows - OperationId: ${this.operationId}`,
                );

                state.currentRowCount = payload.rowCount;

                this.updateState();

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                    rowsLoaded: subsetResult.rowCount.toString(),
                });
            } catch (error) {
                this.logger.error(
                    `Error loading subset: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to load subset: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToLoadData(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("createRow", async (state) => {
            this.logger.info(
                `Creating new row for: ${state.tableName} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.CreateRow,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const result = await this._tableExplorerService.createRow(state.ownerUri);
                vscode.window.showInformationMessage(
                    LocConstants.TableExplorer.rowCreatedSuccessfully,
                );
                this.logger.info(
                    `Created row with ID: ${result.newRowId} - OperationId: ${this.operationId}`,
                );

                // Track new row and mark unsaved changes
                state.newRows = [...state.newRows, result.row];
                this.showRestorePromptAfterClose = true;

                // Update result set with new row
                if (state.resultSet) {
                    // Create a completely new resultSet object to ensure React detects the change
                    const updatedResultSet = {
                        ...state.resultSet,
                        subset: [...state.resultSet.subset, result.row],
                        rowCount: state.resultSet.rowCount + 1,
                    };

                    state.resultSet = updatedResultSet;

                    this.logger.info(
                        `Added new row to result set, now has ${state.resultSet.rowCount} rows (${state.newRows.length} new)`,
                    );

                    this.updateState();
                } else {
                    // If resultSet doesn't exist yet, we need to initialize it
                    // This can happen if user clicks "Add Row" before data finishes loading
                    this.logger.warn(
                        "resultSet is undefined when adding row - this may cause display issues",
                    );

                    // We'll still update state to show the new row was created
                    // The next data load will incorporate it via the newRows array
                    this.updateState();
                }

                await this.regenerateScriptIfVisible(state);

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });
            } catch (error) {
                this.logger.error(
                    `Error creating row: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to create row: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToCreateNewRow(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("deleteRow", async (state, payload) => {
            this.logger.info(`Deleting row: ${payload.rowId} - OperationId: ${this.operationId}`);

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.DeleteRow,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                await this._tableExplorerService.deleteRow(state.ownerUri, payload.rowId);
                vscode.window.showInformationMessage(LocConstants.TableExplorer.rowRemoved);

                // Remove from newRows tracking if it was a new row
                state.newRows = state.newRows.filter((row) => row.id !== payload.rowId);

                // Remove all failed cells for this row
                if (state.failedCells) {
                    state.failedCells = state.failedCells.filter(
                        (key) => !key.startsWith(`${payload.rowId}-`),
                    );
                }

                this.showRestorePromptAfterClose = true;

                // Update result set
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

                    this.logger.info(
                        `Updated result set, now has ${updatedSubset.length} rows (${state.newRows.length} new)`,
                    );
                }

                await this.regenerateScriptIfVisible(state);

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });
            } catch (error) {
                this.logger.error(
                    `Error deleting row: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to delete row: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRemoveRow(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("updateCell", async (state, payload) => {
            this.logger.info(
                `Updating cell: row ${payload.rowId}, column ${payload.columnId} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.UpdateCell,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const updateCellResult = await this._tableExplorerService.updateCell(
                    state.ownerUri,
                    payload.rowId,
                    payload.columnId,
                    payload.newValue,
                );

                this.showRestorePromptAfterClose = true;

                // Update the cell value in the result set
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

                this.logger.info(`Cell updated successfully - OperationId: ${this.operationId}`);

                await this.regenerateScriptIfVisible(state);

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });
            } catch (error) {
                this.logger.error(
                    `Error updating cell: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                // Track failed cell for UI highlighting
                const failedKey = `${payload.rowId}-${payload.columnId}`;
                if (!state.failedCells) {
                    state.failedCells = [failedKey];
                } else if (!state.failedCells.includes(failedKey)) {
                    state.failedCells = [...state.failedCells, failedKey];
                }

                this.updateState();

                endActivity.endFailed(
                    new Error(`Failed to update cell: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToUpdateCell(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("revertCell", async (state, payload) => {
            this.logger.info(
                `Reverting cell: row ${payload.rowId}, column ${payload.columnId} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.RevertCell,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const revertCellResult = await this._tableExplorerService.revertCell(
                    state.ownerUri,
                    payload.rowId,
                    payload.columnId,
                );

                // Remove from failed cells tracking
                if (state.failedCells) {
                    const failedKey = `${payload.rowId}-${payload.columnId}`;
                    state.failedCells = state.failedCells.filter((key) => key !== failedKey);
                }

                // Update the cell value in the result set
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

                this.logger.info(`Cell reverted successfully - OperationId: ${this.operationId}`);

                await this.regenerateScriptIfVisible(state);

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });
            } catch (error) {
                this.logger.error(
                    `Error reverting cell: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to revert cell: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRevertCell(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("revertRow", async (state, payload) => {
            this.logger.info(`Reverting row: ${payload.rowId} - OperationId: ${this.operationId}`);

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.RevertRow,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const revertRowResult = await this._tableExplorerService.revertRow(
                    state.ownerUri,
                    payload.rowId,
                );

                // Remove all failed cells for this row
                if (state.failedCells) {
                    state.failedCells = state.failedCells.filter(
                        (key) => !key.startsWith(`${payload.rowId}-`),
                    );
                }

                // Update the row in the result set
                if (state.resultSet && revertRowResult.row) {
                    const rowIndex = state.resultSet.subset.findIndex(
                        (row) => row.id === payload.rowId,
                    );

                    if (rowIndex !== -1) {
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

                this.logger.info(`Row reverted successfully - OperationId: ${this.operationId}`);

                await this.regenerateScriptIfVisible(state);

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });
            } catch (error) {
                this.logger.error(
                    `Error reverting row: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to revert row: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRevertRow(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("generateScript", async (state) => {
            this.logger.info(
                `Generating update script for: ${state.tableName} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.TableExplorer,
                TelemetryActions.GenerateScript,
                generateGuid(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const scriptResult = await this._tableExplorerService.generateScripts(
                    state.ownerUri,
                );

                // Combine script array into single string
                const combinedScript = scriptResult.scripts?.join("\n") || "";
                this.logger.info(
                    `Script result received: ${scriptResult.scripts?.length} script(s), combined length: ${combinedScript.length} - OperationId: ${this.operationId}`,
                );

                // Update state with script and show pane
                state.updateScript = combinedScript;
                state.showScriptPane = true;

                this.logger.info(
                    `State before updateState - updateScript length: ${state.updateScript?.length}, showScriptPane: ${state.showScriptPane}`,
                );
                this.updateState();
                this.logger.info(
                    `State after updateState - this.state.updateScript length: ${this.state.updateScript?.length} - OperationId: ${this.operationId}`,
                );

                this.logger.info(
                    `Script generated successfully - OperationId: ${this.operationId}`,
                );

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                    scriptCount: scriptResult.scripts?.length.toString() || "0",
                });
            } catch (error) {
                this.logger.error(
                    `Error generating script: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(`Failed to generate script: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToGenerateScript(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("openScriptInEditor", async (state) => {
            this.logger.info(`Opening script in SQL editor - OperationId: ${this.operationId}`);

            sendActionEvent(TelemetryViews.TableExplorer, TelemetryActions.Open, {
                operationId: this.operationId,
                context: "scriptEditor",
            });

            try {
                if (state.updateScript) {
                    const doc = await vscode.workspace.openTextDocument({
                        content: state.updateScript,
                        language: "sql",
                    });
                    await vscode.window.showTextDocument(doc);

                    this.logger.info(
                        `Script opened in SQL editor successfully - OperationId: ${this.operationId}`,
                    );
                } else {
                    vscode.window.showWarningMessage(LocConstants.TableExplorer.noScriptToOpen);
                }
            } catch (error) {
                this.logger.error(
                    `Error opening script in editor: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToOpenScript(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("copyScriptToClipboard", async (state) => {
            this.logger.info(`Copying script to clipboard - OperationId: ${this.operationId}`);

            sendActionEvent(TelemetryViews.TableExplorer, TelemetryActions.CopyResults, {
                operationId: this.operationId,
                context: "script",
            });

            try {
                if (state.updateScript) {
                    await vscode.env.clipboard.writeText(state.updateScript);
                    await vscode.window.showInformationMessage(
                        LocConstants.TableExplorer.scriptCopiedToClipboard,
                    );

                    this.logger.info(
                        `Script copied to clipboard successfully - OperationId: ${this.operationId}`,
                    );
                } else {
                    vscode.window.showWarningMessage(LocConstants.TableExplorer.noScriptToCopy);
                }
            } catch (error) {
                this.logger.error(
                    `Error copying script to clipboard: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToCopyScript(getErrorMessage(error)),
                );
            }

            return state;
        });

        this.registerReducer("toggleScriptPane", async (state) => {
            state.showScriptPane = !state.showScriptPane;

            this.logger.info(
                `Script pane toggled to: ${state.showScriptPane} - OperationId: ${this.operationId}`,
            );

            sendActionEvent(TelemetryViews.TableExplorer, TelemetryActions.Close, {
                operationId: this.operationId,
                context: "scriptPane",
                action: state.showScriptPane ? "opened" : "closed",
            });
            this.updateState();

            return state;
        });

        this.registerReducer("setCurrentPage", async (state, payload) => {
            state.currentPage = payload.pageNumber;

            this.logger.info(`Current page set to: ${payload.pageNumber}`);

            return state;
        });
    }

    /**
     * Override the base class's showRestorePrompt to handle unsaved changes.
     * This is called from the onDidDispose handler in the base class.
     * Prompts the user to save or discard changes, then allows disposal to continue.
     * Always returns undefined to allow the close to proceed after handling the user's choice.
     */
    protected override async showRestorePrompt(): Promise<{
        title: string;
        run: () => Promise<void>;
    }> {
        const result = await vscode.window.showWarningMessage(
            LocConstants.TableExplorer.unsavedChangesPrompt(this.state.tableName),
            {
                modal: true,
            },
            LocConstants.TableExplorer.Save,
            LocConstants.TableExplorer.Discard,
        );

        // Handle the user's choice
        if (result === LocConstants.TableExplorer.Save) {
            this.logger.info("User chose to save changes before closing");

            try {
                await this._tableExplorerService.commit(this.state.ownerUri);
                vscode.window.showInformationMessage(
                    LocConstants.TableExplorer.changesSavedSuccessfully,
                );

                this.logger.info("Changes saved successfully before closing");
            } catch (error) {
                this.logger.error(`Error saving changes before closing: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToSaveChanges(getErrorMessage(error)),
                );
            }
        } else if (result === LocConstants.TableExplorer.Discard) {
            this.logger.info("User chose to discard changes");
        } else {
            this.logger.info("User dismissed the prompt - treating as discard");
        }

        // Always return undefined to allow disposal to continue
        return undefined;
    }

    /**
     * Disposes the Table Explorer webview controller and cleans up resources.
     * This is called when the webview tab is closed (after any prompts are handled).
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
