/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as qr from '../sharedInterfaces/queryResult';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';
import { ReactWebViewViewController } from '../controllers/reactWebviewViewController';

export class QueryResultWebViewController extends ReactWebViewViewController<qr.QueryResultWebViewState, qr.QueryResultReducers> {
	private _queryResultStateMap: Map<string, qr.QueryResultWebViewState> = new Map<string, qr.QueryResultWebViewState>();

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
			}
		});
	}

	public getQueryResultState(uri: string): qr.QueryResultWebViewState {
		return this._queryResultStateMap.get(uri);
	}
}
