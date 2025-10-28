/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VscodeWrapper from "../controllers/vscodeWrapper";
import * as Constants from "../constants/constants";
import * as vscode from "vscode";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import {
    openExecutionPlanWebview,
    saveExecutionPlan,
    showPlanXml,
    showQuery,
    updateTotalCost,
} from "../controllers/sharedExecutionPlanUtils";
import { sendActionEvent } from "../telemetry/telemetry";
import * as qr from "../sharedInterfaces/queryResult";
import { QueryResultWebviewPanelController } from "./queryResultWebviewPanelController";
import { QueryResultWebviewController } from "./queryResultWebViewController";
import store, { SubKeys } from "./singletonStore";
import { JsonFormattingEditProvider } from "../utils/jsonFormatter";
import * as LocalizedConstants from "../constants/locConstants";

export const MAX_VIEW_COLUMN = 9;

export function getNewResultPaneViewColumn(
    uri: string,
    vscodeWrapper: VscodeWrapper,
): vscode.ViewColumn {
    // // Find configuration options
    let config = vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, uri);
    let splitPaneSelection = config[Constants.configSplitPaneSelection];

    switch (splitPaneSelection) {
        case "current":
            return vscodeWrapper.activeTextEditor.viewColumn;
        case "end":
            const visibleEditors = vscode.window.visibleTextEditors;
            const maxViewColumn = visibleEditors.reduce((max, editor) => {
                return editor.viewColumn && editor.viewColumn > max ? editor.viewColumn : max;
            }, 0);
            return Math.min(maxViewColumn + 1, MAX_VIEW_COLUMN) as vscode.ViewColumn;
        /**
         * 'next' is the default case.
         */
        case "next":
        default:
            const currentEditor = vscode.window.visibleTextEditors.find((editor) => {
                return (
                    editor.document.uri.toString(true) === uri && editor.viewColumn !== undefined
                );
            });
            if (!currentEditor) {
                return vscode.ViewColumn.One;
            }

            const newViewColumn = Math.min(
                (currentEditor.viewColumn ?? 1) + 1,
                MAX_VIEW_COLUMN,
            ) as vscode.ViewColumn;
            return newViewColumn;
    }
}

export function registerCommonRequestHandlers(
    webviewController: QueryResultWebviewController | QueryResultWebviewPanelController,
    correlationId: string,
) {
    let webviewViewController: QueryResultWebviewController =
        webviewController instanceof QueryResultWebviewController
            ? webviewController
            : webviewController.getQueryResultWebviewViewController();

    webviewController.onRequest(qr.GetRowsRequest.type, async (message) => {
        const result = await webviewViewController
            .getSqlOutputContentProvider()
            .rowRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.rowStart,
                message.numberOfRows,
            );
        return result;
    });

    webviewController.onRequest(qr.SetEditorSelectionRequest.type, async (message) => {
        if (!message.uri || !message.selectionData) {
            console.warn(
                `Invalid setEditorSelection request.  Uri: ${message.uri}; selectionData: ${JSON.stringify(message.selectionData)}`,
            );
            return;
        }

        return await webviewViewController
            .getSqlOutputContentProvider()
            .editorSelectionRequestHandler(message.uri, message.selectionData);
    });

    webviewController.onRequest(qr.SaveResultsWebviewRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.SaveResults, {
            correlationId: correlationId,
            format: message.format,
            selection: JSON.stringify(message.selection),
            origin: message.origin,
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .saveResultsRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.format,
                message.selection,
            );
    });

    webviewController.onRequest(qr.CopySelectionRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResults, {
            correlationId: correlationId,
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .copyRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
                shouldIncludeHeaders(message.includeHeaders),
            );
    });

    webviewController.onRequest(qr.CopyHeadersRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyHeaders, {
            correlationId: correlationId,
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .copyHeadersRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
    });

    webviewController.onRequest(qr.CopyAsCsvRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResults, {
            correlationId: correlationId,
            format: "csv",
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .copyAsCsvRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
    });

    webviewController.onRequest(qr.CopyAsJsonRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResults, {
            correlationId: correlationId,
            format: "json",
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .copyAsJsonRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
    });

    webviewController.onRequest(qr.CopyAsInClauseRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResults, {
            correlationId: correlationId,
            format: "in-clause",
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .copyAsInClauseRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
    });

    webviewController.onRequest(qr.CopyAsInsertIntoRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResults, {
            correlationId: correlationId,
            format: "insert-into",
        });
        return await webviewViewController
            .getSqlOutputContentProvider()
            .copyAsInsertIntoRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
    });

    // Register request handlers for query result filters
    webviewController.onRequest(qr.GetFiltersRequest.type, async (message) => {
        return store.get(message.uri, SubKeys.Filter);
    });

    webviewController.onRequest(qr.SetFiltersRequest.type, async (message) => {
        store.set(message.uri, SubKeys.Filter, message.filters);
    });

    webviewController.onRequest(qr.SetColumnWidthsRequest.type, async (message) => {
        store.set(message.uri, SubKeys.ColumnWidth, message.columnWidths);
    });

    webviewController.onRequest(qr.GetColumnWidthsRequest.type, async (message) => {
        return store.get(message.uri, SubKeys.ColumnWidth);
    });

    webviewController.onNotification(qr.SetGridScrollPositionNotification.type, async (message) => {
        if (message.scrollLeft === 0 && message.scrollTop === 0) {
            // If both scrollLeft and scrollTop are 0, we don't need to store this position
            return;
        }
        let scrollPositions: Map<string, { scrollTop: number; scrollLeft: number }> = store.get(
            message.uri,
            SubKeys.GridScrollPosition,
        );
        if (!scrollPositions) {
            scrollPositions = new Map<
                string,
                {
                    scrollTop: number;
                    scrollLeft: number;
                }
            >();
        }

        scrollPositions.set(message.gridId, {
            scrollTop: message.scrollTop,
            scrollLeft: message.scrollLeft,
        });
        // Update the scroll positions in the store
        store.set(message.uri, SubKeys.GridScrollPosition, scrollPositions);
    });

    webviewController.onRequest(qr.GetGridScrollPositionRequest.type, async (message) => {
        const scrollPositions = store.get(message.uri, SubKeys.GridScrollPosition) as Map<
            string,
            { scrollTop: number; scrollLeft: number }
        >;
        if (scrollPositions && scrollPositions.has(message.gridId)) {
            return scrollPositions.get(message.gridId);
        } else {
            // If no scroll position is found, return default values
            return undefined;
        }
    });

    webviewController.onNotification(
        qr.SetGridPaneScrollPositionNotification.type,
        async (message) => {
            if (message.scrollTop === 0) {
                // If scrollTop is 0, we don't need to store this position
                return;
            }
            store.set(message.uri, SubKeys.PaneScrollPosition, {
                scrollTop: message.scrollTop,
            });
        },
    );

    webviewController.onRequest(qr.GetGridPaneScrollPositionRequest.type, async (message) => {
        return store.get(message.uri, SubKeys.PaneScrollPosition) ?? { scrollTop: 0 };
    });

    webviewController.onNotification(qr.SetSelectionSummaryRequest.type, async (message) => {
        // Fetch all the data needed for the summary
        await webviewViewController
            .getSqlOutputContentProvider()
            .generateSelectionSummaryData(
                message.uri,
                message.batchId,
                message.resultId,
                message.selection,
            );
    });

    webviewController.registerReducer("setResultTab", async (state, payload) => {
        state.tabStates.resultPaneTab = payload.tabId;
        return state;
    });
    webviewController.registerReducer("setResultViewMode", async (state, payload) => {
        if (!state.tabStates) {
            state.tabStates = {
                resultPaneTab: qr.QueryResultPaneTabs.Results,
                resultViewMode: payload.viewMode,
            };
        } else {
            state.tabStates.resultViewMode = payload.viewMode;
        }
        return state;
    });
    webviewController.registerReducer("openFileThroughLink", async (state, payload) => {
        // TO DO: add formatting? ADS doesn't do this, but it may be nice...

        // If the content is an execution plan XML, open it in the execution plan tab
        if (
            payload.type === Constants.xml &&
            payload.content.startsWith(Constants.queryPlanXmlStart)
        ) {
            if (state.isExecutionPlan) {
                state.tabStates.resultPaneTab = qr.QueryResultPaneTabs.ExecutionPlan;
                return state;
            }
            openExecutionPlanWebview(
                webviewViewController.getContext(),
                webviewViewController.getVsCodeWrapper(),
                webviewViewController.executionPlanService,
                webviewViewController.sqlDocumentService,
                payload.content,
                Constants.queryPlan,
            );
            return state;
        }

        const newDoc = await vscode.workspace.openTextDocument({
            content: payload.content,
            language: payload.type,
        });

        if (payload.type === Constants.json) {
            const formatter = new JsonFormattingEditProvider();
            const edits = await formatter.provideDocumentFormattingEdits(newDoc);
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(newDoc.uri, edits);
            await vscode.workspace.applyEdit(workspaceEdit);
        }

        void vscode.window.showTextDocument(newDoc);

        return state;
    });
    webviewController.registerReducer("saveExecutionPlan", async (state, payload) => {
        return (await saveExecutionPlan(state, payload)) as qr.QueryResultWebviewState;
    });
    webviewController.registerReducer("showPlanXml", async (state, payload) => {
        return (await showPlanXml(state, payload)) as qr.QueryResultWebviewState;
    });
    webviewController.registerReducer("showQuery", async (state, payload) => {
        return (await showQuery(
            state,
            payload,
            webviewViewController.sqlDocumentService,
            state.uri,
        )) as qr.QueryResultWebviewState;
    });
    webviewController.registerReducer("updateTotalCost", async (state, payload) => {
        return (await updateTotalCost(state, payload)) as qr.QueryResultWebviewState;
    });
    webviewController.onRequest(qr.ShowFilterDisabledMessageRequest.type, async () => {
        vscode.window.showInformationMessage(
            LocalizedConstants.inMemoryDataProcessingThresholdExceeded,
        );
    });
}

export function recordLength(record: any): number {
    return Object.keys(record).length;
}

export function messageToString(message: qr.IMessage): string {
    if (message.link?.text) {
        return `${message.message}${message.link.text}`;
    }
    return message.message;
}

/**
 * Checks if the setting to open query results in a new tab by default is enabled.
 * @returns True if the setting is enabled, false otherwise.
 */
export function isOpenQueryResultsInTabByDefaultEnabled(): boolean {
    return vscode.workspace.getConfiguration().get(Constants.configOpenQueryResultsInTabByDefault);
}

/**
 * Counts the number of result sets in the given summaries.
 * @param resultSetSummaries The result set summaries to count.
 * @returns The number of result sets.
 */
export function countResultSets(
    resultSetSummaries: Record<number, Record<number, qr.ResultSetSummary>>,
): number {
    let count = 0;
    for (const batchId in resultSetSummaries) {
        if (Object.prototype.hasOwnProperty.call(resultSetSummaries, batchId)) {
            count += Object.keys(resultSetSummaries[batchId]).length;
        }
    }
    return count;
}

/**
 * Calculate selection summary statistics for grid selections
 * @param selections Array of grid selection ranges
 * @param grid Mock grid object with getCellNode method
 * @param isSelection Whether this is an actual selection (true) or clearing stats (false)
 * @returns Promise<SelectionSummaryStats> Summary statistics
 */
export async function selectionSummaryHelper(
    selections: qr.ISlickRange[],
    grid: {
        getCellNode: (row: number, col: number) => HTMLElement | undefined;
        getColumns: () => any[];
    },
    isSelection: boolean,
): Promise<qr.SelectionSummaryStats> {
    const summary: qr.SelectionSummaryStats = {
        count: -1,
        average: "",
        sum: 0,
        min: 0,
        max: 0,
        removeSelectionStats: !isSelection,
        distinctCount: -1,
        nullCount: -1,
    };

    if (!isSelection) {
        return summary;
    }

    const columns = grid.getColumns();
    if (!columns || columns.length === 0) {
        return summary;
    }

    if (!selections || selections.length === 0) {
        return summary;
    }

    // Reset values for actual calculation
    summary.count = 0;
    summary.distinctCount = 0;
    summary.nullCount = 0;
    summary.min = Infinity;
    summary.max = -Infinity;
    summary.removeSelectionStats = false;

    const distinct = new Set<string>();
    let numericCount = 0;

    const isFiniteNumber = (v: string): boolean => {
        const n = Number(v);
        return Number.isFinite(n);
    };

    for (const selection of selections) {
        for (let row = selection.fromRow; row <= selection.toRow; row++) {
            for (let col = selection.fromCell; col <= selection.toCell; col++) {
                const cell = grid.getCellNode(row, col);
                if (!cell) {
                    continue;
                }

                summary.count++;
                const cellText = cell.innerText;

                if (cellText === "NULL" || cellText === null || cellText === undefined) {
                    summary.nullCount++;
                    continue;
                }

                distinct.add(cellText);

                if (isFiniteNumber(cellText)) {
                    const n = Number(cellText);
                    numericCount++;
                    summary.sum += n;
                    if (n < summary.min) summary.min = n;
                    if (n > summary.max) summary.max = n;
                }
            }
        }
    }

    summary.distinctCount = distinct.size;

    // Only compute average when we actually saw numeric cells
    if (numericCount > 0) {
        summary.average = (summary.sum / numericCount).toFixed(3);
    } else {
        summary.average = "";
    }

    // Normalize min/max if there were no numeric values
    if (!Number.isFinite(summary.min)) summary.min = 0;
    if (!Number.isFinite(summary.max)) summary.max = 0;

    return summary;
}

export function getInMemoryGridDataProcessingThreshold(): number {
    return (
        vscode.workspace
            .getConfiguration()
            .get<number>(Constants.configInMemoryDataProcessingThreshold) ?? 5000
    );
}

export function shouldIncludeHeaders(includeHeaders: boolean): boolean {
    if (includeHeaders !== undefined) {
        // Respect the value explicity passed into the method
        return includeHeaders;
    }
    // else get config option from vscode config
    return vscode.workspace.getConfiguration().get<boolean>(Constants.copyIncludeHeaders);
}
