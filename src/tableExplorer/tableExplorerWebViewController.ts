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
                currentRowCount: 100, // Default row count for data loading
                newRows: [], // Track newly created rows
                updateScript: undefined, // No script initially
                showScriptPane: false, // Script pane hidden by default
                currentPage: 1, // Start on page 1
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
                showRestorePromptAfterClose: false, // Will be set to true when changes are made
            },
        );

        this.logger.info(
            `TableExplorerWebViewController created for table: ${tableName} in database: ${databaseName}`,
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
        if (!this._targetNode) {
            await vscode.window.showErrorMessage(
                LocConstants.TableExplorer.unableToOpenTableExplorer,
            );
            return;
        }

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
            // Don't show error message to user since this is an automatic background update
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
            this.logger.info(`Committing changes for: ${state.tableName}`);
            try {
                await this._tableExplorerService.commit(state.ownerUri);
                vscode.window.showInformationMessage(
                    LocConstants.TableExplorer.changesSavedSuccessfully,
                );

                // Clear the new rows array since they're now committed to the database
                state.newRows = [];
                // Reset the prompt flag since there are no more unsaved changes
                this.showRestorePromptAfterClose = false;
                this.logger.info("Cleared new rows after successful commit");
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

                // Append any newly created rows to the subset
                state.resultSet = {
                    ...subsetResult,
                    subset: [...subsetResult.subset, ...state.newRows],
                    rowCount: subsetResult.rowCount + state.newRows.length,
                };
                state.currentRowCount = payload.rowCount; // Store the user's selection

                this.updateState();

                this.logger.info(
                    `Loaded ${subsetResult.rowCount} rows from database + ${state.newRows.length} new rows`,
                );
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

                // Add the new row to the newRows tracking array
                state.newRows.push(result.row);

                // Mark that we have unsaved changes
                this.showRestorePromptAfterClose = true;

                // Append the new row to the existing result set
                if (state.resultSet) {
                    state.resultSet = {
                        ...state.resultSet,
                        subset: [...state.resultSet.subset, result.row],
                        rowCount: state.resultSet.rowCount + 1,
                    };

                    this.updateState();

                    this.logger.info(
                        `Added new row to result set, now has ${state.resultSet.rowCount} rows (${state.newRows.length} new)`,
                    );
                } else {
                    this.logger.warn("Cannot add row: result set is undefined");
                }

                await this.regenerateScriptIfVisible(state);
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

                // Remove from newRows array if it's a newly created row
                state.newRows = state.newRows.filter((row) => row.id !== payload.rowId);

                // Mark that we have unsaved changes
                this.showRestorePromptAfterClose = true;

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

                // Mark that we have unsaved changes
                this.showRestorePromptAfterClose = true;

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

                await this.regenerateScriptIfVisible(state);
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

                await this.regenerateScriptIfVisible(state);
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

                await this.regenerateScriptIfVisible(state);
            } catch (error) {
                this.logger.error(`Error reverting row: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToRevertRow(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("generateScript", async (state) => {
            this.logger.info(`Generating update script for: ${state.tableName}`);
            try {
                const scriptResult = await this._tableExplorerService.generateScripts(
                    state.ownerUri,
                );
                // Join the array of scripts into a single string with newlines
                const combinedScript = scriptResult.scripts?.join("\n") || "";
                this.logger.info(
                    `Script result received: ${scriptResult.scripts?.length} script(s), combined length: ${combinedScript.length}`,
                );
                state.updateScript = combinedScript;
                state.showScriptPane = true; // Automatically show the script pane

                this.logger.info(
                    `State before updateState - updateScript length: ${state.updateScript?.length}, showScriptPane: ${state.showScriptPane}`,
                );
                this.updateState();
                this.logger.info(
                    `State after updateState - this.state.updateScript length: ${this.state.updateScript?.length}`,
                );

                this.logger.info("Script generated successfully");
            } catch (error) {
                this.logger.error(`Error generating script: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToGenerateScript(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("openScriptInEditor", async (state) => {
            this.logger.info("Opening script in SQL editor");
            try {
                if (state.updateScript) {
                    const doc = await vscode.workspace.openTextDocument({
                        content: state.updateScript,
                        language: "sql",
                    });
                    await vscode.window.showTextDocument(doc);
                    this.logger.info("Script opened in SQL editor successfully");
                } else {
                    vscode.window.showWarningMessage(LocConstants.TableExplorer.noScriptToOpen);
                }
            } catch (error) {
                this.logger.error(`Error opening script in editor: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToOpenScript(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("copyScriptToClipboard", async (state) => {
            this.logger.info("Copying script to clipboard");
            try {
                if (state.updateScript) {
                    await vscode.env.clipboard.writeText(state.updateScript);
                    await vscode.window.showInformationMessage(
                        LocConstants.TableExplorer.scriptCopiedToClipboard,
                    );
                    this.logger.info("Script copied to clipboard successfully");
                } else {
                    vscode.window.showWarningMessage(LocConstants.TableExplorer.noScriptToCopy);
                }
            } catch (error) {
                this.logger.error(`Error copying script to clipboard: ${error}`);
                vscode.window.showErrorMessage(
                    LocConstants.TableExplorer.failedToCopyScript(getErrorMessage(error)),
                );
            }
            return state;
        });

        this.registerReducer("toggleScriptPane", async (state) => {
            state.showScriptPane = !state.showScriptPane;
            this.logger.info(`Script pane toggled to: ${state.showScriptPane}`);
            this.updateState();
            return state;
        });

        this.registerReducer("setCurrentPage", async (state, payload) => {
            state.currentPage = payload.pageNumber;
            this.logger.info(`Current page set to: ${payload.pageNumber}`);
            // Don't call updateState here - this is called FROM the grid, not TO the grid
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
            // No action needed - just close without saving
        } else {
            // User pressed ESC or clicked X - treat as discard
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
