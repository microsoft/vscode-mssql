/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CopyAsCsvRequest,
    CopyAsJsonRequest,
    CopyAsInClauseRequest,
    CopyAsInsertIntoRequest,
    CopyHeadersRequest,
    CopySelectionRequest,
    GridContextMenuAction,
    OpenGeneratedQueryRequest,
    ResolveTableNameRequest,
    ResultSetSummary,
} from "../../../../../sharedInterfaces/queryResult";
import { QueryResultReactProvider } from "../../queryResultStateProvider";
import { HybridDataProvider } from "../hybridDataProvider";
import type { IDisposableDataProvider } from "../dataProvider";
import {
    convertDisplayedSelectionToActual,
    selectEntireGrid,
    tryCombineSelections,
    tryCombineSelectionsForResults,
} from "../utils";
import {
    generateDelete,
    generateInsertForRows,
    generateSelect,
    generateUpdate,
    getSelectedColumnIndices,
    isFullRowSelected,
    isSingleRowSelection,
} from "../../../../common/sqlScriptGenerator";

export class ContextMenu<T extends Slick.SlickData> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();

    constructor(
        private uri: string,
        private resultSetSummary: ResultSetSummary,
        private queryResultContext: QueryResultReactProvider,
    ) {
        this.uri = uri;
        this.resultSetSummary = resultSetSummary;
    }

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.handler.subscribe(this.grid.onContextMenu, (e: Event) => this.handleContextMenu(e));
        this.handler.subscribe(this.grid.onHeaderClick, (e: Event) => this.headerClickHandler(e));
    }

    public destroy() {
        this.handler.unsubscribeAll();
        this.queryResultContext.hideGridContextMenu();
    }

    private headerClickHandler(_e: Event): void {
        // Close any active menu when header is clicked
        this.queryResultContext.hideGridContextMenu();
    }

    private handleContextMenu(e: Event): void {
        e.preventDefault();
        const mouseEvent = e as MouseEvent;
        // Calculate adjusted x/y so the menu fits within viewport (with some estimated size)
        const margin = 8;
        const estimatedWidth = 260; // approximate width
        const estimatedHeight = 260; // approximate height
        const maxX = Math.max(margin, window.innerWidth - estimatedWidth - margin);
        const maxY = Math.max(margin, window.innerHeight - estimatedHeight - margin);
        const adjustedX = Math.min(Math.max(mouseEvent.pageX, margin), maxX);
        const adjustedY = Math.min(Math.max(mouseEvent.pageY, margin), maxY);

        const gridColumns = this.grid.getColumns();
        const dataSelection = tryCombineSelections(
            this.grid.getSelectionModel().getSelectedRanges(),
        );
        const isSingleRow = isSingleRowSelection(dataSelection);
        const isFullRow = isSingleRow && isFullRowSelected(dataSelection, gridColumns);

        // Ask outer React app to show menu at coordinates
        this.queryResultContext.showGridContextMenu(
            adjustedX,
            adjustedY,
            async (action: GridContextMenuAction) => {
                await this.handleMenuAction(action);
                this.queryResultContext.hideGridContextMenu();
            },
            { showRowActions: isSingleRow && !isFullRow, showInsertAction: isFullRow },
        );
    }

    private async handleMenuAction(action: GridContextMenuAction): Promise<void> {
        const log = this.queryResultContext.log;
        let selectedRanges = this.grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges);

        // If no selection exists, create a selection for the entire grid
        if (!selection || selection.length === 0) {
            selection = selectEntireGrid(this.grid);
        }

        const convertedSelection = convertDisplayedSelectionToActual(this.grid, selection);

        switch (action) {
            case GridContextMenuAction.SelectAll:
                log.trace("Select All action triggered");
                const data = this.grid.getData() as HybridDataProvider<T>;
                let selectionModel = this.grid.getSelectionModel();
                selectionModel.setSelectedRanges([
                    new Slick.Range(0, 0, data.length - 1, this.grid.getColumns().length - 1),
                ]);
                break;
            case GridContextMenuAction.CopySelection:
                log.trace("Copy action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopySelectionRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: convertedSelection,
                    includeHeaders: false,
                });
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.CopyWithHeaders:
                log.trace("Copy with headers action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopySelectionRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: convertedSelection,
                    includeHeaders: true,
                });
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.CopyHeaders:
                log.trace("Copy Headers action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyHeadersRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: convertedSelection,
                });
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.CopyAsCsv:
                log.trace("Copy as CSV action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyAsCsvRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: convertedSelection,
                });
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.CopyAsJson:
                log.trace("Copy as JSON action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyAsJsonRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: convertedSelection,
                    includeHeaders: true, // Default to including headers for JSON
                });
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.CopyAsInClause:
                log.trace("Copy as IN clause action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyAsInClauseRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: convertedSelection,
                });
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.CopyAsInsertInto:
                log.trace("Copy as INSERT INTO action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(
                    CopyAsInsertIntoRequest.type,
                    {
                        uri: this.uri,
                        batchId: this.resultSetSummary.batchId,
                        resultId: this.resultSetSummary.id,
                        selection: convertedSelection,
                    },
                );
                this.queryResultContext.showCopyIndicator();
                break;
            case GridContextMenuAction.GenerateSelect:
            case GridContextMenuAction.GenerateUpdate:
            case GridContextMenuAction.GenerateDelete:
            case GridContextMenuAction.GenerateInsert: {
                log.trace(`${action} action triggered`);
                const gridColumns = this.grid.getColumns();
                const dataSelection = tryCombineSelections(
                    this.grid.getSelectionModel().getSelectedRanges(),
                );
                if (!isSingleRowSelection(dataSelection)) {
                    log.warn("Generate query actions require a single-row selection");
                    break;
                }
                const [range] = dataSelection;
                const dataProvider = this.grid.getData() as IDisposableDataProvider<T>;
                const columnInfo = this.resultSetSummary.columnInfo;
                const row = range.fromRow;
                const selectedColumnIndices = getSelectedColumnIndices([range], gridColumns);

                const resolved = await this.queryResultContext.extensionRpc.sendRequest(
                    ResolveTableNameRequest.type,
                    { uri: this.uri, batchId: this.resultSetSummary.batchId },
                );
                const fallback = resolved.tableName
                    ? { tableName: resolved.tableName, schemaName: resolved.schemaName }
                    : undefined;

                let sql: string;
                if (action === GridContextMenuAction.GenerateSelect) {
                    sql = generateSelect(
                        row,
                        selectedColumnIndices,
                        gridColumns,
                        dataProvider,
                        columnInfo,
                        fallback,
                    );
                } else if (action === GridContextMenuAction.GenerateUpdate) {
                    sql = generateUpdate(
                        row,
                        selectedColumnIndices,
                        gridColumns,
                        dataProvider,
                        columnInfo,
                        fallback,
                    );
                } else if (action === GridContextMenuAction.GenerateDelete) {
                    sql = generateDelete(
                        row,
                        selectedColumnIndices,
                        gridColumns,
                        dataProvider,
                        columnInfo,
                        fallback,
                    );
                } else {
                    sql = generateInsertForRows(
                        [range],
                        gridColumns,
                        dataProvider,
                        columnInfo,
                        fallback,
                    );
                }

                await this.queryResultContext.extensionRpc.sendRequest(
                    OpenGeneratedQueryRequest.type,
                    {
                        uri: this.uri,
                        sql,
                    },
                );
                break;
            }
            default:
                log.warn(`Unknown action: ${action}`);
        }
    }
}
