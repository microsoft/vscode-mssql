/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as qr from "../sharedInterfaces/queryResult";
import { ReactWebviewViewController } from "../controllers/reactWebviewViewController";

export class QueryResultWebviewController extends ReactWebviewViewController<
    qr.QueryResultWebviewState,
    qr.QueryResultReducers
> {
    private _queryResultStateMap: Map<string, qr.QueryResultWebviewState> =
        new Map<string, qr.QueryResultWebviewState>();
    private _rowRequestHandler:
        | ((
              uri: string,
              batchId: number,
              resultId: number,
              rowStart: number,
              numberOfRows: number,
          ) => Promise<qr.ResultSetSubset>)
        | undefined;

    constructor(context: vscode.ExtensionContext) {
        super(context, "queryResult", {
            value: "",
            messages: [],
            tabStates: {
                resultPaneTab: qr.QueryResultPaneTabs.Messages,
            },
        });
        this.initialize();
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerRequestHandler("getRows", async (message) => {
            return await this._rowRequestHandler(
                message.uri,
                message.batchId,
                message.resultId,
                message.rowStart,
                message.numberOfRows,
            );
        });
        this.registerReducer("setResultTab", async (state, payload) => {
            state.tabStates.resultPaneTab = payload.tabId;
            return state;
        });
    }

    public addQueryResultState(uri: string): void {
        this._queryResultStateMap.set(uri, {
            value: "",
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

    public setRowRequestHandler(
        handler: (
            uri: string,
            batchId: number,
            resultId: number,
            rowStart: number,
            numberOfRows: number,
        ) => Promise<qr.ResultSetSubset>,
    ): void {
        this._rowRequestHandler = handler;
    }
}
