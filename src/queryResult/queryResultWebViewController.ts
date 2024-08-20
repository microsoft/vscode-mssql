/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as qr from '../sharedInterfaces/queryResult';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';

export class QueryResultWebViewController extends ReactWebViewPanelController<qr.QueryResultWebViewState, qr.QueryResultReducers> {
	constructor(context: vscode.ExtensionContext,
	) {
		super(context, 'Query Result', WebviewRoute.queryResult, {
			value: 42,
			messages: [
				{ message: 'Message 1', timestamp: '12:00' },
				{ message: 'Message 2', timestamp: '12:01' },
				{ message: 'Message 3', timestamp: '12:02' },
			],
			tabStates: {
				resultPaneTab: qr.QueryResultPaneTabs.Messages
			}
		}, vscode.ViewColumn.Active, {
			dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'tableDesignerEditor_inverse.svg'),
			light: vscode.Uri.joinPath(context.extensionUri, 'media', 'tableDesignerEditor.svg')
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

}
