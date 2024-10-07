/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import { ReactWebviewViewController } from "../controllers/reactWebviewViewController";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";

export class QueryResultWebviewController extends ReactWebviewViewController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _queryResultStateMap: Map<string, qr.QueryResultWebviewState> =
        new Map<string, qr.QueryResultWebviewState>();
    private _sqlOutputContentProvider: SqlOutputContentProvider;

    constructor(context: vscode.ExtensionContext) {
        super(context, "queryResult", {
            resultSetSummaries: {},
            messages: [],
            tabStates: {
                resultPaneTab: qr.QueryResultPaneTabs.Messages,
            },
        });

        void this.initialize();
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerRequestHandler("getRows", async (message) => {
            return await this._sqlOutputContentProvider.rowRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.rowStart,
                message.numberOfRows,
            );
        });
        this.registerRequestHandler("setEditorSelection", async (message) => {
            return await this._sqlOutputContentProvider.editorSelectionRequestHandler(
                message.uri,
                message.selectionData,
            );
        });
        this.registerRequestHandler("saveResults", async (message) => {
            return await this._sqlOutputContentProvider.saveResultsRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.format,
                message.selection,
            );
        });
        this.registerReducer("setResultTab", async (state, payload) => {
            state.tabStates.resultPaneTab = payload.tabId;
            return state;
        });
    }

    public addQueryResultState(uri: string): void {
        this._queryResultStateMap.set(uri, {
            resultSetSummaries: {},
            messages: [],
            tabStates: {
                resultPaneTab: qr.QueryResultPaneTabs.Messages,
            },
            uri: uri,
        });
    }

    public getQueryResultState(uri: string): qr.QueryResultWebviewState {
        var res = this._queryResultStateMap.get(uri);
        if (!res) {
            // This should never happen
            throw new Error(`No query result state found for uri ${uri}`);
        }
        return res;
    }

    public setSqlOutputContentProvider(
        provider: SqlOutputContentProvider,
    ): void {
        this._sqlOutputContentProvider = provider;
    }
}
