/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import { locConstants } from "../../../../common/locConstants";
import {
    QueryResultReducers,
    ResultSetSummary,
} from "../../../../../sharedInterfaces/queryResult";
import { VscodeWebviewContext } from "../../../../common/vscodeWebviewProvider";
import { QueryResultState } from "../../queryResultStateProvider";
import { HybridDataProvider } from "../hybridDataProvider";
import { tryCombineSelectionsForResults } from "../utils";
import "./contextMenu.css";

export class ContextMenu<T extends Slick.SlickData> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private uri: string;
    private resultSetSummary: ResultSetSummary;
    private webViewState: VscodeWebviewContext<
        QueryResultState,
        QueryResultReducers
    >;

    constructor(
        uri: string,
        resultSetSummary: ResultSetSummary,
        webViewState: VscodeWebviewContext<
            QueryResultState,
            QueryResultReducers
        >,
    ) {
        this.uri = uri;
        this.resultSetSummary = resultSetSummary;
        this.webViewState = webViewState;
    }

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.handler.subscribe(
            this.grid.onContextMenu,
            (e: Event, args: Slick.OnContextMenuEventArgs<T>) =>
                this.handleContextMenu(e, args),
        );
    }

    public destroy() {
        this.handler.unsubscribeAll();
    }

    private handleContextMenu(
        e: Event,
        args: Slick.OnContextMenuEventArgs<T>,
    ): void {
        e.preventDefault();

        const $contextMenu = jQuery(
            `<ul id="contextMenu" style="display:none; position:absolute; background:#fff; border:1px solid #ccc; list-style:none; padding:5px;">` +
                `<li data-action="select-all" style="padding:5px; cursor:pointer;">Select All</li>` +
                `<li data-action="copy" style="padding:5px; cursor:pointer;">Copy</li>` +
                `<li data-action="copy-with-headers" style="padding:5px; cursor:pointer;">Copy with Headers</li>` +
                `<li data-action="copy-headers" style="padding:5px; cursor:pointer;">Copy Headers</li>` +
                `</ul>`,
        );
        // Remove any existing context menus to avoid duplication
        jQuery("#contextMenu").remove();

        // Append the menu to the body and set its position
        jQuery("body").append($contextMenu);

        let cell = this.grid.getCellFromEvent(e);
        $contextMenu
            .data("row", cell.row)
            .css("top", e.pageY)
            .css("left", e.pageX)
            .show();

        jQuery("body").one("click", function () {
            $contextMenu.hide();
        });

        $contextMenu.on("click", "li", async (event) => {
            const action = jQuery(event.target).data("action");
            await this.handleMenuAction(action, args);
            $contextMenu.hide(); // Hide the menu after an action is clicked
        });
    }

    private async handleMenuAction(action: string, args): Promise<void> {
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
                await this.webViewState.extensionRpc.call("copyWithHeaders", {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: undefined,
                });
                console.log("Copy Headers action triggered");
                break;
            default:
                console.warn("Unknown action:", action);
        }
    }
}
