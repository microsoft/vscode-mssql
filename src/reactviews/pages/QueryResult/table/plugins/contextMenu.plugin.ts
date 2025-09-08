/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CopyAsCsvRequest,
    CopyAsJsonRequest,
    CopyHeadersRequest,
    CopySelectionRequest,
    CopyWithHeadersRequest,
    DbCellValue,
    GridContextMenuAction,
    ResultSetSummary,
    SendToClipboardRequest,
} from "../../../../../sharedInterfaces/queryResult";
import { QueryResultReactProvider } from "../../queryResultStateProvider";
import { IDisposableDataProvider } from "../dataProvider";
import { HybridDataProvider } from "../hybridDataProvider";
import { selectEntireGrid, selectionToRange, tryCombineSelectionsForResults } from "../utils";

export class ContextMenu<T extends Slick.SlickData> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();

    constructor(
        private uri: string,
        private resultSetSummary: ResultSetSummary,
        private queryResultContext: QueryResultReactProvider,
        private dataProvider: IDisposableDataProvider<T>,
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

        // Ask outer React app to show menu at coordinates
        this.queryResultContext.showGridContextMenu(
            adjustedX,
            adjustedY,
            async (action: GridContextMenuAction) => {
                await this.handleMenuAction(action);
                this.queryResultContext.hideGridContextMenu();
            },
        );
    }

    private async handleMenuAction(action: GridContextMenuAction): Promise<void> {
        let selectedRanges = this.grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges);

        // If no selection exists, create a selection for the entire grid
        if (!selection || selection.length === 0) {
            selection = selectEntireGrid(this.grid);
        }

        switch (action) {
            case GridContextMenuAction.SelectAll:
                this.queryResultContext.log("Select All action triggered");
                const data = this.grid.getData() as HybridDataProvider<T>;
                let selectionModel = this.grid.getSelectionModel();
                selectionModel.setSelectedRanges([
                    new Slick.Range(0, 0, data.length - 1, this.grid.getColumns().length - 1),
                ]);
                break;
            case GridContextMenuAction.CopySelection:
                this.queryResultContext.log("Copy action triggered");
                if (this.dataProvider.isDataInMemory) {
                    this.queryResultContext.log(
                        "Sorted/filtered grid detected, fetching data from data provider",
                    );
                    let range = selectionToRange(selection[0]);
                    let data = await this.dataProvider.getRangeAsync(range.start, range.length);
                    const dataArray = data.map((map) => {
                        const maxKey = Math.max(...Array.from(Object.keys(map)).map(Number)); // Get the maximum key
                        return Array.from(
                            { length: maxKey + 1 },
                            (_, index) =>
                                ({
                                    rowId: index,
                                    displayValue: map[index].displayValue || null,
                                }) as DbCellValue,
                        );
                    });
                    await this.queryResultContext.extensionRpc.sendRequest(
                        SendToClipboardRequest.type,
                        {
                            uri: this.uri,
                            data: dataArray,
                            batchId: this.resultSetSummary.batchId,
                            resultId: this.resultSetSummary.id,
                            selection: selection,
                            headersFlag: false,
                        },
                    );
                } else {
                    await this.queryResultContext.extensionRpc.sendRequest(
                        CopySelectionRequest.type,
                        {
                            uri: this.uri,
                            batchId: this.resultSetSummary.batchId,
                            resultId: this.resultSetSummary.id,
                            selection: selection,
                        },
                    );
                }

                break;
            case GridContextMenuAction.CopyWithHeaders:
                this.queryResultContext.log("Copy with headers action triggered");

                if (this.dataProvider.isDataInMemory) {
                    this.queryResultContext.log(
                        "Sorted/filtered grid detected, fetching data from data provider",
                    );

                    let range = selectionToRange(selection[0]);
                    let data = await this.dataProvider.getRangeAsync(range.start, range.length);
                    const dataArray = data.map((map) => {
                        const maxKey = Math.max(...Array.from(Object.keys(map)).map(Number)); // Get the maximum key
                        return Array.from(
                            { length: maxKey + 1 },
                            (_, index) =>
                                ({
                                    rowId: index,
                                    displayValue: map[index].displayValue || null,
                                }) as DbCellValue,
                        );
                    });
                    await this.queryResultContext.extensionRpc.sendRequest(
                        SendToClipboardRequest.type,
                        {
                            uri: this.uri,
                            data: dataArray,
                            batchId: this.resultSetSummary.batchId,
                            resultId: this.resultSetSummary.id,
                            selection: selection,
                            headersFlag: true,
                        },
                    );
                } else {
                    await this.queryResultContext.extensionRpc.sendRequest(
                        CopyWithHeadersRequest.type,
                        {
                            uri: this.uri,
                            batchId: this.resultSetSummary.batchId,
                            resultId: this.resultSetSummary.id,
                            selection: selection,
                        },
                    );
                }

                break;
            case GridContextMenuAction.CopyHeaders:
                this.queryResultContext.log("Copy Headers action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyHeadersRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                });
                break;
            case GridContextMenuAction.CopyAsCsv:
                this.queryResultContext.log("Copy as CSV action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyAsCsvRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                    includeHeaders: true, // Default to including headers for CSV
                });
                break;
            case GridContextMenuAction.CopyAsJson:
                this.queryResultContext.log("Copy as JSON action triggered");
                await this.queryResultContext.extensionRpc.sendRequest(CopyAsJsonRequest.type, {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                    includeHeaders: true, // Default to including headers for JSON
                });
                break;
            default:
                console.warn("Unknown action:", action);
        }
    }
}
