/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardEvent } from "react";
import {
    ResultSetSummary,
    CopySelectionRequest,
} from "../../../../../sharedInterfaces/queryResult";
import {
    convertDisplayedSelectionToActual,
    selectEntireGrid,
    tryCombineSelectionsForResults,
} from "../utils";
import { QueryResultReactProvider } from "../../queryResultStateProvider";
import { GetPlatformRequest } from "../../../../../sharedInterfaces/webview";
import { KeyCode } from "../../../../common/keys";

/**
 * Implements the various additional navigation keybindings we want out of slickgrid
 */
export class CopyKeybind<T extends Slick.SlickData> implements Slick.Plugin<T> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private uri: string;
    private resultSetSummary: ResultSetSummary;

    constructor(
        uri: string,
        resultSetSummary: ResultSetSummary,
        private _qrContext: QueryResultReactProvider,
    ) {
        this.uri = uri;
        this.resultSetSummary = resultSetSummary;
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
        let platform = await this._qrContext.extensionRpc.sendRequest(GetPlatformRequest.type);
        if (platform === "darwin") {
            // Cmd + C
            if (e.metaKey && e.code === KeyCode.KeyC) {
                handled = true;
                await this.handleCopySelection(this.grid, this.uri, this.resultSetSummary);
            }
        } else {
            if (e.ctrlKey && e.code === KeyCode.KeyC) {
                handled = true;
                await this.handleCopySelection(this.grid, this.uri, this.resultSetSummary);
            }
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
    public async handleCopySelection(
        grid: Slick.Grid<T>,
        uri: string,
        resultSetSummary: ResultSetSummary,
    ) {
        const selectedRanges = grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges) ?? [];

        if (!selection || selection.length === 0) {
            selection = selectEntireGrid(grid);
        }

        const convertedSelection = convertDisplayedSelectionToActual(grid, selection);

        await this._qrContext.extensionRpc.sendRequest(CopySelectionRequest.type, {
            uri: uri,
            batchId: resultSetSummary.batchId,
            resultId: resultSetSummary.id,
            selection: convertedSelection,
            includeHeaders: undefined, // Keeping it undefined so that it can be determined by user settings
        });
    }
}
