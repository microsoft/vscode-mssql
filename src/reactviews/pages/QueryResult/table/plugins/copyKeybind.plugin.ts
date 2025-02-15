/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardEvent } from "react";
import {
    QueryResultWebviewState,
    QueryResultReducers,
    ResultSetSummary,
} from "../../../../../sharedInterfaces/queryResult";
import { VscodeWebviewContext } from "../../../../common/vscodeWebviewProvider";
import { selectionToRange, tryCombineSelectionsForResults } from "../utils";
import { Keys } from "../../keys";
import { IDisposableDataProvider } from "../dataProvider";

/**
 * Implements the various additional navigation keybindings we want out of slickgrid
 */
export class CopyKeybind<T extends Slick.SlickData> implements Slick.Plugin<T> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private uri: string;
    private resultSetSummary: ResultSetSummary;
    private webViewState: VscodeWebviewContext<
        QueryResultWebviewState,
        QueryResultReducers
    >;

    constructor(
        uri: string,
        resultSetSummary: ResultSetSummary,
        webViewState: VscodeWebviewContext<
            QueryResultWebviewState,
            QueryResultReducers
        >,
        private dataProvider: IDisposableDataProvider<T>,
    ) {
        this.uri = uri;
        this.resultSetSummary = resultSetSummary;
        this.webViewState = webViewState;
    }

    public init(grid: Slick.Grid<T>) {
        this.grid = grid;
        this.handler.subscribe(this.grid.onKeyDown, (e: Slick.DOMEvent) =>
            this.handleKeyDown(e as unknown as KeyboardEvent),
        );
    }

    public destroy() {
        this.grid.onKeyDown.unsubscribe();
    }

    private async handleKeyDown(e: KeyboardEvent): Promise<void> {
        let handled = false;
        let platform = await this.webViewState.extensionRpc.call("getPlatform");
        if (platform === "darwin") {
            // Cmd + C
            if (e.metaKey && e.key === Keys.c) {
                handled = true;
                await this.handleCopySelection(
                    this.grid,
                    this.webViewState,
                    this.uri,
                    this.resultSetSummary,
                );
            }
        } else {
            if (e.ctrlKey && e.key === Keys.c) {
                handled = true;
                await this.handleCopySelection(
                    this.grid,
                    this.webViewState,
                    this.uri,
                    this.resultSetSummary,
                );
            }
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
    public async handleCopySelection(
        grid: Slick.Grid<T>,
        webViewState: VscodeWebviewContext<
            QueryResultWebviewState,
            QueryResultReducers
        >,
        uri: string,
        resultSetSummary: ResultSetSummary,
    ) {
        //TODO: handle isdatainmemory just like context menu
        let selectedRanges = grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges);

        if (this.dataProvider.isDataInMemory) {
            let range = selectionToRange(selection[0]);
            let data = await this.dataProvider.getRangeAsync(
                range.start,
                range.length,
            );
            const dataArray = data.map((map) => {
                const maxKey = Math.max(
                    ...Array.from(Object.keys(map)).map(Number),
                ); // Get the maximum key
                return Array.from({ length: maxKey + 1 }, (_, index) => ({
                    rowId: index,
                    displayValue: map[index].displayValue || null,
                }));
            });

            await this.webViewState.extensionRpc.call("sendToClipboard", {
                uri: this.uri,
                data: dataArray,
                batchId: this.resultSetSummary.batchId,
                resultId: this.resultSetSummary.id,
                selection: selection,
                headersFlag: false,
            });
        } else {
            await webViewState.extensionRpc.call("copySelection", {
                uri: uri,
                batchId: resultSetSummary.batchId,
                resultId: resultSetSummary.id,
                selection: selection,
            });
        }
    }
}
