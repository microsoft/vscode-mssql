/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as qr from '../sharedInterfaces/queryResult';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';
import { ReactWebViewViewController } from '../controllers/reactWebviewViewController';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';

export class QueryResultWebViewController extends ReactWebViewViewController<qr.QueryResultWebViewState, qr.QueryResultReducers> {
	private _queryResultStateMap: Map<string, qr.QueryResultWebViewState> = new Map<string, qr.QueryResultWebViewState>();
	private _outputContentProvider: SqlOutputContentProvider;

	constructor(context: vscode.ExtensionContext,
	) {
		super(context, WebviewRoute.queryResult, {
			value: '',
			messages: [],
			tabStates: {
				resultPaneTab: qr.QueryResultPaneTabs.Messages
			}
		});
		this.initialize();
	}

	private async initialize() {
		this.registerRpcHandlers();
	}

	private registerRpcHandlers() {
		this.registerRequestHandler('getRows', async (message) => {
			return await this._outputContentProvider.rowRequestHandler(message.uri, message.batchId, message.resultId, message.rowStart, message.numberOfRows)
		});
		this.registerReducer('setResultTab', async (state, payload) => {
			state.tabStates.resultPaneTab = payload.tabId;
			return state;
		});
	}

	public addQueryResultState(uri: string): void {
		this._queryResultStateMap.set(uri, {
			value: '',
			messages: [],
			tabStates: {
				resultPaneTab: qr.QueryResultPaneTabs.Messages
			},
			uri: uri
		});
	}

	public getQueryResultState(uri: string): qr.QueryResultWebViewState {
		return this._queryResultStateMap.get(uri);
	}

	public setSqlOutputContentProvider(provider: SqlOutputContentProvider): void {
		this._outputContentProvider = provider;
	}
}
