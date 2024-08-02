/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import ConnectionManager from "../controllers/connectionManager";
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import UntitledSqlDocumentService from '../controllers/untitledSqlDocumentService';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import { QueryPlanWebViewState } from '../sharedInterfaces/queryPlan';


export class QueryPlanWebViewController extends ReactWebViewPanelController<QueryPlanWebViewState> {
	constructor(context: vscode.ExtensionContext,
		private _sqlOutputService: SqlOutputContentProvider,
		private _connectionManager: ConnectionManager,
		private _untitledSqlDocumentService: UntitledSqlDocumentService,
	) {
		super(context, 'Query Plan', 'queryPlan.js', 'queryPlan.css', {
			apiState: {
			}
		}, vscode.ViewColumn.Active, {
			dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'queryPlan_inverse.svg'),
			light: vscode.Uri.joinPath(context.extensionUri, 'media', 'queryPlan.svg')
		});
		this.initialize();
	}

	private async initialize() {
		this._sqlOutputService;
		this._connectionManager;
		this._untitledSqlDocumentService;

		this.registerRpcHandlers();
	}

	private registerRpcHandlers() {
		this.registerReducers({

		});
	}
}