/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VscodeWrapper from "../controllers/vscodeWrapper";
import * as Constants from "../constants/constants";
import * as vscode from "vscode";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import {
    createExecutionPlanGraphs,
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

export function getNewResultPaneViewColumn(
    uri: string,
    vscodeWrapper: VscodeWrapper,
): vscode.ViewColumn {
    // // Find configuration options
    let config = vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, uri);
    let splitPaneSelection = config[Constants.configSplitPaneSelection];
    let viewColumn: vscode.ViewColumn;

    switch (splitPaneSelection) {
        case "current":
            viewColumn = vscodeWrapper.activeTextEditor.viewColumn;
            break;
        case "end":
            viewColumn = vscode.ViewColumn.Three;
            break;
        // default case where splitPaneSelection is next or anything else
        default:
            // if there's an active text editor
            if (vscodeWrapper.isEditingSqlFile) {
                viewColumn = vscodeWrapper.activeTextEditor.viewColumn;
                if (viewColumn === vscode.ViewColumn.One) {
                    viewColumn = vscode.ViewColumn.Two;
                } else {
                    viewColumn = vscode.ViewColumn.Three;
                }
            } else {
                // otherwise take default results column
                viewColumn = vscode.ViewColumn.Two;
            }
    }
    return viewColumn;
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
        let currentState = webviewViewController.getQueryResultState(message.uri);
        if (
            currentState.isExecutionPlan &&
            currentState.resultSetSummaries[message.batchId] &&
            // check if the current result set is the result set that contains the xml plan
            currentState.resultSetSummaries[message.batchId][message.resultId].columnInfo[0]
                .columnName === Constants.showPlanXmlColumnName
        ) {
            currentState.executionPlanState.xmlPlans[`${message.batchId},${message.resultId}`] =
                result.rows[0][0].displayValue;
        }
        // if we are on the last result set and still don't have any xml plans
        // then we should not show the query plan. for example, this happens
        // if user runs actual plan with all print statements
        else if (
            // check that we're on the last batch
            message.batchId === recordLength(currentState.resultSetSummaries) - 1 &&
            // check that we're on the last result within the batch
            message.resultId ===
                recordLength(currentState.resultSetSummaries[message.batchId]) - 1 &&
            // check that there's we have no xml plans
            (!currentState.executionPlanState?.xmlPlans ||
                !recordLength(currentState.executionPlanState.xmlPlans))
        ) {
            currentState.isExecutionPlan = false;
            currentState.actualPlanEnabled = false;
        }
        webviewViewController.setQueryResultState(message.uri, currentState);
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

    webviewController.onRequest(qr.SendToClipboardRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResults, {
            correlationId: correlationId,
        });
        return webviewViewController
            .getSqlOutputContentProvider()
            .sendToClipboard(
                message.uri,
                message.data,
                message.batchId,
                message.resultId,
                message.selection,
                message.headersFlag,
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
                false,
            );
    });

    webviewController.onRequest(qr.CopyWithHeadersRequest.type, async (message) => {
        sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.CopyResultsHeaders, {
            correlationId: correlationId,
            format: undefined,
            selection: undefined,
            origin: undefined,
        });
        return await webviewViewController.getSqlOutputContentProvider().copyRequestHandler(
            message.uri,
            message.batchId,
            message.resultId,
            message.selection,
            true, //copy headers flag
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

    webviewController.onRequest(qr.SetSelectionSummaryRequest.type, async (message) => {
        const controller =
            webviewController instanceof QueryResultWebviewPanelController
                ? webviewController.getQueryResultWebviewViewController()
                : webviewController;

        controller.updateSelectionSummaryStatusItem(message.summary);
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
    webviewController.registerReducer("getExecutionPlan", async (state, payload) => {
        // because this is an overridden call, this makes sure it is being
        // called properly
        if (!("uri" in payload)) return state;

        const currentResultState = webviewViewController.getQueryResultState(payload.uri);
        // Ensure execution plan state exists and execution plan graphs have not loaded
        if (
            currentResultState.executionPlanState &&
            currentResultState.executionPlanState.executionPlanGraphs.length === 0 &&
            // Check for non-empty XML plans and result summaries
            recordLength(currentResultState.executionPlanState.xmlPlans) &&
            recordLength(currentResultState.resultSetSummaries) &&
            // Verify XML plans match expected number of result sets
            recordLength(currentResultState.executionPlanState.xmlPlans) ===
                webviewViewController.getNumExecutionPlanResultSets(
                    currentResultState.resultSetSummaries,
                    currentResultState.actualPlanEnabled,
                )
        ) {
            state = (await createExecutionPlanGraphs(
                state,
                webviewViewController.getExecutionPlanService(),
                Object.values(currentResultState.executionPlanState.xmlPlans),
                "QueryResults",
            )) as qr.QueryResultWebviewState;
            state.executionPlanState.loadState = ApiStatus.Loaded;
            state.tabStates.resultPaneTab = qr.QueryResultPaneTabs.ExecutionPlan;
        }

        return state;
    });
    webviewController.registerReducer("openFileThroughLink", async (state, payload) => {
        // TO DO: add formatting? ADS doesn't do this, but it may be nice...
        const newDoc = await vscode.workspace.openTextDocument({
            content: payload.content,
            language: payload.type,
        });

        if (payload.type === "json") {
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
            webviewViewController.getUntitledDocumentService(),
        )) as qr.QueryResultWebviewState;
    });
    webviewController.registerReducer("updateTotalCost", async (state, payload) => {
        return (await updateTotalCost(state, payload)) as qr.QueryResultWebviewState;
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
