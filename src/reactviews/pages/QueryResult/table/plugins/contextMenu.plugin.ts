/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryResultReducers,
    QueryResultWebviewState,
    ResultSetSummary,
} from "../../../../../sharedInterfaces/queryResult";
import { locConstants } from "../../../../common/locConstants";
import { VscodeWebviewContext } from "../../../../common/vscodeWebviewProvider";
import { HybridDataProvider } from "../hybridDataProvider";
import { tryCombineSelectionsForResults } from "../utils";
import "./contextMenu.css";

export class ContextMenu<T extends Slick.SlickData> {
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

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.handler.subscribe(this.grid.onContextMenu, (e: Event) =>
            this.handleContextMenu(e),
        );
    }

    public destroy() {
        this.handler.unsubscribeAll();
    }

    private handleContextMenu(e: Event): void {
        e.preventDefault();
        let mouseEvent = e as MouseEvent;
        const $contextMenu = jQuery(
            `<ul id="contextMenu">` +
                `<li data-action="select-all" class="contextMenu">${locConstants.queryResult.selectAll}</li>` +
                `<li data-action="copy" class="contextMenu">${locConstants.queryResult.copy}</li>` +
                `<li data-action="copy-with-headers" class="contextMenu">${locConstants.queryResult.copyWithHeaders}</li>` +
                `<li data-action="copy-headers" class="contextMenu">${locConstants.queryResult.copyHeaders}</li>` +
                `</ul>`,
        );
        // Remove any existing context menus to avoid duplication
        jQuery("#contextMenu").remove();

        // Append the menu to the body and set its position
        jQuery("body").append($contextMenu);

        let cell = this.grid.getCellFromEvent(e);
        $contextMenu
            .data("row", cell.row)
            .css("top", mouseEvent.pageY)
            .css("left", mouseEvent.pageX)
            .show();

        jQuery("body").one("click", function () {
            $contextMenu.hide();
        });

        $contextMenu.on("click", "li", async (event) => {
            const action = jQuery(event.target).data("action");
            await this.handleMenuAction(action);
            $contextMenu.hide(); // Hide the menu after an action is clicked
        });
    }

    private async handleMenuAction(action: string): Promise<void> {
        let selectedRanges = this.grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges);
        switch (action) {
            case "select-all":
                console.log("Select All action triggered");
                const data = this.grid.getData() as HybridDataProvider<T>;
                let selectionModel = this.grid.getSelectionModel();
                selectionModel.setSelectedRanges([
                    new Slick.Range(
                        0,
                        0,
                        data.length - 1,
                        this.grid.getColumns().length - 1,
                    ),
                ]);
                break;
            case "copy":
                await this.webViewState.extensionRpc.call("copySelection", {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                });

                console.log("Copy action triggered");
                break;
            case "copy-with-headers":
                await this.webViewState.extensionRpc.call("copyWithHeaders", {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                });

                console.log("Copy with Headers action triggered");
                break;
            case "copy-headers":
                await this.webViewState.extensionRpc.call("copyHeaders", {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                });
                console.log("Copy Headers action triggered");
                break;
            default:
                console.warn("Unknown action:", action);
        }
    }
}
