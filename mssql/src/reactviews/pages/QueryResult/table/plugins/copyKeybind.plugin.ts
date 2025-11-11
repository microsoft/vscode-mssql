/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardEvent } from "react";
import {
    ResultSetSummary,
    CopySelectionRequest,
    ISlickRange,
    QueryResultSaveAsTrigger,
    SaveResultsWebviewRequest,
    CopyAsInClauseRequest,
    CopyAsInsertIntoRequest,
    CopyAsJsonRequest,
    CopyAsCsvRequest,
    CopyHeadersRequest,
} from "../../../../../sharedInterfaces/queryResult";
import {
    convertDisplayedSelectionToActual,
    selectEntireGrid,
    tryCombineSelectionsForResults,
} from "../utils";
import { QueryResultReactProvider } from "../../queryResultStateProvider";
import { WebviewAction, WebviewKeyBindings } from "../../../../../sharedInterfaces/webview";
import { eventMatchesShortcut } from "../../../../common/keyboardUtils";

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
        public keyBindings: WebviewKeyBindings,
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
        if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopySelection].keyCombination,
            )
        ) {
            handled = true;
            await this.copySelection(false);
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopyWithHeaders].keyCombination,
            )
        ) {
            handled = true;
            await this.copySelection(true);
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopyAllHeaders].keyCombination,
            )
        ) {
            handled = true;
            await this.copyHeaders();
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopyAsCsv].keyCombination,
            )
        ) {
            handled = true;
            await this.copyAsCsv();
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopyAsJson].keyCombination,
            )
        ) {
            handled = true;
            await this.copyAsJson();
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopyAsInsert].keyCombination,
            )
        ) {
            handled = true;
            await this.copyAsInsertInto();
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.ResultGridCopyAsInClause].keyCombination,
            )
        ) {
            handled = true;
            await this.copyAsInClause();
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.QueryResultSaveAsJson].keyCombination,
            )
        ) {
            handled = true;
            await this.saveResults("json");
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.QueryResultSaveAsCsv].keyCombination,
            )
        ) {
            handled = true;
            await this.saveResults("csv");
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.QueryResultSaveAsExcel].keyCombination,
            )
        ) {
            handled = true;
            await this.saveResults("excel");
        } else if (
            eventMatchesShortcut(
                e,
                this.keyBindings[WebviewAction.QueryResultSaveAsInsert].keyCombination,
            )
        ) {
            handled = true;
            await this.saveResults("insert");
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    private getConvertedSelection(): ISlickRange[] {
        const selectedRanges = this.grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges) ?? [];

        if (!selection || selection.length === 0) {
            selection = selectEntireGrid(this.grid);
        }

        return convertDisplayedSelectionToActual(this.grid, selection);
    }

    private async copySelection(includeHeaders?: boolean) {
        const selection = this.getConvertedSelection();

        await this._qrContext.extensionRpc.sendRequest(CopySelectionRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
            includeHeaders,
        });
    }

    private async copyHeaders() {
        const selection = this.getConvertedSelection();

        await this._qrContext.extensionRpc.sendRequest(CopyHeadersRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
        });
    }

    private async copyAsCsv() {
        const selection = this.getConvertedSelection();
        await this._qrContext.extensionRpc.sendRequest(CopyAsCsvRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
        });
    }

    private async copyAsJson() {
        const selection = this.getConvertedSelection();
        await this._qrContext.extensionRpc.sendRequest(CopyAsJsonRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
            includeHeaders: true,
        });
    }

    private async copyAsInsertInto() {
        const selection = this.getConvertedSelection();
        await this._qrContext.extensionRpc.sendRequest(CopyAsInsertIntoRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
        });
    }

    private async copyAsInClause() {
        const selection = this.getConvertedSelection();
        await this._qrContext.extensionRpc.sendRequest(CopyAsInClauseRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
        });
    }

    private async saveResults(format: string) {
        const selection = this.getConvertedSelection();

        await this._qrContext.extensionRpc.sendRequest(SaveResultsWebviewRequest.type, {
            uri: this.uri,
            batchId: this.resultSetSummary.batchId,
            resultId: this.resultSetSummary.id,
            selection,
            format,
            origin: QueryResultSaveAsTrigger.Toolbar,
        });
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
