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
import { QueryResultContextProps } from "../../queryResultStateProvider";
import { IDisposableDataProvider } from "../dataProvider";
import { HybridDataProvider } from "../hybridDataProvider";
import { selectionToRange, tryCombineSelectionsForResults } from "../utils";
import "./contextMenu.css";

export class ContextMenu<T extends Slick.SlickData> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private activeContextMenu: JQuery<HTMLElement> | null = null;

    constructor(
        private uri: string,
        private resultSetSummary: ResultSetSummary,
        private queryResultContext: QueryResultContextProps,
        private webViewState: VscodeWebviewContext<QueryResultWebviewState, QueryResultReducers>,
        private dataProvider: IDisposableDataProvider<T>,
    ) {
        this.uri = uri;
        this.resultSetSummary = resultSetSummary;
        this.webViewState = webViewState;
    }

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.handler.subscribe(this.grid.onContextMenu, (e: Event) => this.handleContextMenu(e));
        this.handler.subscribe(this.grid.onHeaderClick, (e: Event) => this.headerClickHandler(e));
        this.handler.subscribe(this.grid.onHeaderContextMenu, (e: Event) =>
            this.handleHeaderContextMenu(e),
        );
    }

    public destroy() {
        this.handler.unsubscribeAll();
    }

    private headerClickHandler(e: Event): void {
        if (!(jQuery(e.target!) as any).closest("#contextMenu").length) {
            if (this.activeContextMenu) {
                this.activeContextMenu.hide();
            }
        }
    }

    private handleHeaderContextMenu(e: Event): void {
        e.preventDefault();
        let mouseEvent = e as MouseEvent;

        // Get the column from the header click
        let cell = this.grid.getCellFromEvent(e);
        let columnDef = this.grid.getColumns()[cell.cell];

        if (!columnDef || !columnDef.resizable) {
            return;
        }

        const $contextMenu = jQuery(
            `<ul id="headerContextMenu">` +
                `<li data-action="auto-resize" class="contextMenu">${locConstants.queryResult.autoResizeColumn}</li>` +
                `<li data-action="resize-column" class="contextMenu">${locConstants.queryResult.resizeColumn}</li>` +
                `</ul>`,
        );

        // Remove any existing context menus to avoid duplication
        jQuery("#headerContextMenu").remove();
        jQuery("#contextMenu").remove();

        // Append the menu to the body and set its position
        jQuery("body").append($contextMenu);

        $contextMenu
            .data("column", columnDef)
            .data("columnIndex", cell.cell)
            .css("top", mouseEvent.pageY)
            .css("left", mouseEvent.pageX)
            .show();

        this.activeContextMenu = $contextMenu;
        jQuery("body").one("click", () => {
            $contextMenu.hide();
            this.activeContextMenu = null;
        });

        $contextMenu.on("click", "li", async (event) => {
            const action = jQuery(event.target).data("action");
            const columnDef = $contextMenu.data("column");
            const columnIndex = $contextMenu.data("columnIndex");
            await this.handleHeaderMenuAction(action, columnDef, columnIndex);
            $contextMenu.hide(); // Hide the menu after an action is clicked
            this.activeContextMenu = null;
        });
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

        this.activeContextMenu = $contextMenu;
        jQuery("body").one("click", () => {
            $contextMenu.hide();
            this.activeContextMenu = null;
        });

        $contextMenu.on("click", "li", async (event) => {
            const action = jQuery(event.target).data("action");
            await this.handleMenuAction(action);
            $contextMenu.hide(); // Hide the menu after an action is clicked
            this.activeContextMenu = null;
        });
    }

    private async handleMenuAction(action: string): Promise<void> {
        let selectedRanges = this.grid.getSelectionModel().getSelectedRanges();
        let selection = tryCombineSelectionsForResults(selectedRanges);
        switch (action) {
            case "select-all":
                this.queryResultContext.log("Select All action triggered");
                const data = this.grid.getData() as HybridDataProvider<T>;
                let selectionModel = this.grid.getSelectionModel();
                selectionModel.setSelectedRanges([
                    new Slick.Range(0, 0, data.length - 1, this.grid.getColumns().length - 1),
                ]);
                break;
            case "copy":
                this.queryResultContext.log("Copy action triggered");
                if (this.dataProvider.isDataInMemory) {
                    this.queryResultContext.log(
                        "Sorted/filtered grid detected, fetching data from data provider",
                    );
                    let range = selectionToRange(selection[0]);
                    let data = await this.dataProvider.getRangeAsync(range.start, range.length);
                    const dataArray = data.map((map) => {
                        const maxKey = Math.max(...Array.from(Object.keys(map)).map(Number)); // Get the maximum key
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
                    await this.webViewState.extensionRpc.call("copySelection", {
                        uri: this.uri,
                        batchId: this.resultSetSummary.batchId,
                        resultId: this.resultSetSummary.id,
                        selection: selection,
                    });
                }

                break;
            case "copy-with-headers":
                this.queryResultContext.log("Copy with headers action triggered");

                if (this.dataProvider.isDataInMemory) {
                    this.queryResultContext.log(
                        "Sorted/filtered grid detected, fetching data from data provider",
                    );

                    let range = selectionToRange(selection[0]);
                    let data = await this.dataProvider.getRangeAsync(range.start, range.length);
                    const dataArray = data.map((map) => {
                        const maxKey = Math.max(...Array.from(Object.keys(map)).map(Number)); // Get the maximum key
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
                        headersFlag: true,
                    });
                } else {
                    await this.webViewState.extensionRpc.call("copyWithHeaders", {
                        uri: this.uri,
                        batchId: this.resultSetSummary.batchId,
                        resultId: this.resultSetSummary.id,
                        selection: selection,
                    });
                }

                break;
            case "copy-headers":
                this.queryResultContext.log("Copy Headers action triggered");
                await this.webViewState.extensionRpc.call("copyHeaders", {
                    uri: this.uri,
                    batchId: this.resultSetSummary.batchId,
                    resultId: this.resultSetSummary.id,
                    selection: selection,
                });
                break;
            default:
                console.warn("Unknown action:", action);
        }
    }

    private async handleHeaderMenuAction(
        action: string,
        columnDef: Slick.Column<T>,
        columnIndex: number,
    ): Promise<void> {
        switch (action) {
            case "auto-resize":
                this.queryResultContext.log("Auto resize column action triggered");
                this.autoResizeColumn(columnDef);
                break;
            case "resize-column":
                this.queryResultContext.log("Resize column action triggered");
                this.showResizeDialog(columnIndex);
                break;
            default:
                console.warn("Unknown header action:", action);
        }
    }

    private autoResizeColumn(columnDef: Slick.Column<T>): void {
        // Trigger the auto-resize functionality similar to double-click
        // Find the header element and trigger the double-click handler
        const headerElement = jQuery(this.grid.getHeaderRowColumn(columnDef.id!)).closest(
            ".slick-header-column",
        );
        if (headerElement.length > 0) {
            const doubleClickEvent = jQuery.Event("dblclick");
            headerElement.find(".slick-resizable-handle").trigger(doubleClickEvent);
        }
    }

    private showResizeDialog(columnIndex: number): void {
        const columns = this.grid.getColumns();
        const currentWidth = columns[columnIndex].width || 100;

        // Create dialog elements
        const dialog = document.createElement("div");
        const title = document.createElement("div");
        const subtext = document.createElement("div");
        const inputBox = document.createElement("input");
        const buttonContainer = document.createElement("div");
        const applyButton = document.createElement("button");
        const cancelButton = document.createElement("button");

        // Style the dialog
        dialog.style.cssText = `
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            padding: 20px;
            background: var(--vscode-editor-background, white);
            border: 1px solid var(--vscode-panel-border, #ccc);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            z-index: 1000;
            min-width: 300px;
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            color: var(--vscode-foreground, black);
        `;
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-labelledby", "resize-dialog-title");
        dialog.setAttribute("aria-describedby", "resize-dialog-description");
        dialog.tabIndex = 0;

        title.id = "resize-dialog-title";
        title.textContent = "Resize Column";
        title.style.cssText = `
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground, black);
        `;

        subtext.id = "resize-dialog-description";
        subtext.textContent = "Enter the desired column width in pixels";
        subtext.style.cssText = `
            font-size: 14px;
            color: var(--vscode-descriptionForeground, #666);
            margin-bottom: 12px;
        `;

        inputBox.type = "number";
        inputBox.placeholder = "Enter column width";
        inputBox.min = "1";
        inputBox.max = "1000";
        inputBox.value = currentWidth.toString();
        inputBox.style.cssText = `
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border, #ccc);
            background: var(--vscode-input-background, white);
            color: var(--vscode-input-foreground, black);
            border-radius: 3px;
            box-sizing: border-box;
            margin-bottom: 16px;
            font-size: 14px;
        `;
        inputBox.setAttribute("aria-label", "Column width in pixels");
        inputBox.setAttribute("aria-describedby", "resize-dialog-description");

        buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        `;

        const buttonStyle = `
            padding: 8px 16px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            font-family: inherit;
        `;

        applyButton.textContent = "Apply";
        applyButton.style.cssText =
            buttonStyle +
            `
            background: var(--vscode-button-background, #0078d4);
            color: var(--vscode-button-foreground, white);
        `;
        applyButton.setAttribute("aria-label", "Apply column width changes");

        cancelButton.textContent = "Cancel";
        cancelButton.style.cssText =
            buttonStyle +
            `
            background: var(--vscode-button-secondaryBackground, #6c757d);
            color: var(--vscode-button-secondaryForeground, white);
        `;
        cancelButton.setAttribute("aria-label", "Cancel column width changes");

        // Append elements to dialog
        buttonContainer.appendChild(applyButton);
        buttonContainer.appendChild(cancelButton);
        dialog.appendChild(title);
        dialog.appendChild(subtext);
        dialog.appendChild(inputBox);
        dialog.appendChild(buttonContainer);
        document.body.appendChild(dialog);

        // Focus the input
        inputBox.focus();
        inputBox.select();

        const removeDialog = () => {
            if (document.body.contains(dialog)) {
                document.body.removeChild(dialog);
            }
        };

        // Apply button event listener
        applyButton.addEventListener("click", () => {
            const newWidth = parseInt(inputBox.value, 10);
            if (newWidth && newWidth > 0 && newWidth <= 1000) {
                const allColumns = this.grid.getColumns();
                allColumns[columnIndex].width = newWidth;
                this.grid.setColumns(allColumns);
                this.grid.onColumnsResized.notify();
            }
            removeDialog();
        });

        // Cancel button event listener
        cancelButton.addEventListener("click", removeDialog);

        // Enter key to apply, Escape key to cancel
        inputBox.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applyButton.click();
            } else if (e.key === "Escape") {
                e.preventDefault();
                removeDialog();
            }
        });

        // Escape key anywhere in dialog to cancel
        dialog.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                removeDialog();
            }
        });
    }
}
