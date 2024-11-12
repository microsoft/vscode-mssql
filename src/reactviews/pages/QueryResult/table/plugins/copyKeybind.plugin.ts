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
import { tryCombineSelectionsForResults } from "../utils";

/**
 * Implements the various additional navigation  keybindings we want out of slickgrid
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
    ) {
        this.uri = uri;
        this.resultSetSummary = resultSetSummary;
        this.webViewState = webViewState;
    }

    public init(grid: Slick.Grid<T>) {
        this.grid = grid;
        // this.grid.onKeyDown.subscribe(this.handleKeyDown.bind(this));
        this.handler.subscribe(this.grid.onKeyDown, (e: Slick.DOMEvent) =>
            this.handleKeyDown(e as unknown as KeyboardEvent),
        );
    }

    public destroy() {
        this.grid.onKeyDown.unsubscribe();
    }

    private async handleKeyDown(e: KeyboardEvent): Promise<void> {
        let handled = false;
        if (e.keyCode === 67 && e.metaKey) {
            handled = true;
            let selectedRanges = this.grid
                .getSelectionModel()
                .getSelectedRanges();
            let selection = tryCombineSelectionsForResults(selectedRanges);

            await this.webViewState.extensionRpc.call("copySelection", {
                uri: this.uri,
                batchId: this.resultSetSummary.batchId,
                resultId: this.resultSetSummary.id,
                selection: selection,
            });
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
}
