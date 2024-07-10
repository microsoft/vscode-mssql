/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from 'vscode-mssql';
import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import { ConnectionStore } from '../models/connectionStore';
import { getConnectionDisplayName } from '../models/connectionInfo';
export enum FormTabs {
	Parameters = 'parameter',
	ConnectionString = 'connString'
}
export class ConnectionDialogWebViewController extends ReactWebViewPanelController<vscodeMssql.ConnectionDialog.ConnectionDialogWebviewState> {
	constructor(context: vscode.ExtensionContext, private _connectionStore: ConnectionStore) {
		super(
			context,
			'Connection Dialog',
			'connectionDialog.js',
			'connectionDialog.css',
			{
				recentConnections: [],
				selectedFormTab: FormTabs.Parameters
			},
			vscode.ViewColumn.Active,
			{
				dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor_inverse.svg'),
				light: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor.svg')
			}
		);
		this.initialize();
	}

	private async initialize() {
		const recentConnections = await this._connectionStore.getRecentlyUsedConnections();
		console.log('recentConnections', recentConnections);
		this.state = {
			recentConnections: recentConnections.map(c => {
				return {
					...c,
					profileName: getConnectionDisplayName(c)
				};
			}),
			selectedFormTab: FormTabs.Parameters
		};
		this.registerRpcHandlers();
	}

	private registerRpcHandlers() {
		this.registerReducers({
			'setFormTab': async (state, payload: {
				tab: FormTabs
			}) => {
				return {
					...state,
					selectedFormTab: payload.tab
				};
			},
			'loadConnection': async (state, payload: {
				connection: vscodeMssql.ConnectionDialog.ConnectionInfo
			}) => {
				return {
					...state,
					loadedConnection: payload.connection,
					selectedFormTab: payload.connection.connectionString ? FormTabs.ConnectionString : FormTabs.Parameters
				};
			}
		});
	}
}