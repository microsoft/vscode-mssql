/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import { AuthenticationType, ConnectionDialogWebviewState, FormComponent, FormComponentOptions, FormComponentType, FormEvent, FormTabs, IConnectionDialogProfile } from '../sharedInterfaces/connections';
import ConnectionManager from '../controllers/connectionManager';
import { IConnectionInfo } from 'vscode-mssql';

export class ConnectionDialogWebViewController extends ReactWebViewPanelController<ConnectionDialogWebviewState> {
	constructor(
		context: vscode.ExtensionContext,
		private _connectionManager: ConnectionManager,
		_connectionInfo?: IConnectionInfo
	) {
		super(
			context,
			'Connection Dialog',
			'connectionDialog.js',
			'connectionDialog.css',
			{
				recentConnections: [],
				selectedFormTab: FormTabs.Parameters,
				connectionProfile: {} as IConnectionDialogProfile,
				formComponents: [],
			},
			vscode.ViewColumn.Active,
			{
				dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor_inverse.svg'),
				light: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor.svg')
			}
		);
		this.initialize(_connectionInfo);
	}

	private async initialize(connectionInfo: IConnectionDialogProfile | undefined) {
		const recentConnections = this._connectionManager.connectionStore.loadAllConnections(true).map(c => c.connectionCreds) as IConnectionDialogProfile[];

		this.state = {
			connectionProfile: await this.loadConnection(this.state.connectionProfile),
			recentConnections: recentConnections,
			selectedFormTab: FormTabs.Parameters,
			formComponents: this.generateFormComponents()
		};

		this.registerRpcHandlers();
	}

	private async loadConnection(connection: IConnectionDialogProfile): Promise<IConnectionDialogProfile> {
		// Set default authentication type if not set
		if (!connection.authenticationType) {
			connection.authenticationType = AuthenticationType.SqlLogin;
		}
		// Load the password if it is saved
		if (connection.savePassword) {
			const password = await this._connectionManager.connectionStore.lookupPassword(connection, connection.connectionString !== undefined);
			connection.password = password;
		}
		return connection;
	}

	private generateFormComponents(): FormComponent[] {
		const result: FormComponent[] = [
			{
				type: FormComponentType.Input,
				propertyName: 'server',
				label: 'Server',
			},
			{
				type: FormComponentType.Dropdown,
				propertyName: 'authenticationType',
				label: 'Authentication Type',
				options: [
					{
						displayName: 'SQL Login',
						value: AuthenticationType.SqlLogin
					},
					{
						displayName: 'Windows Authentication',
						value: AuthenticationType.Integrated
					},
					{
						displayName: 'Azure MFA',
						value: AuthenticationType.AzureMFA
					}
				]
			},
			{
				propertyName: 'user',
				label: 'User Name',
				type: FormComponentType.Input,
				hidden: this.state.connectionProfile?.authenticationType ? this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin : true
			},
			{
				propertyName: 'password',
				label: 'Password',
				type: FormComponentType.Password,
				hidden: this.state.connectionProfile?.authenticationType ? this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin : true
			},
			{
				propertyName: 'accountId',
				label: 'Azure Account',
				type: FormComponentType.Dropdown,
				options: this.getAzureAccounts(),
				hidden: this.state.connectionProfile?.authenticationType ? this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA : true
			}
		];
		console.log('generateFormComponents', result);
		return result;
	}

	private getAzureAccounts(): FormComponentOptions[] {
		const accounts = this._connectionManager.accountStore.getAccounts();
		return accounts.map(a => {
			return {
				displayName: a.displayInfo.displayName,
				value: a.key.id
			};
		});
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
			'formAction': async (state, payload: {
				event: FormEvent
			}) => {
				state.connectionProfile[payload.event.propertyName] = payload.event.value;
				state.formComponents = this.generateFormComponents();
				return state;
			},
			'loadConnection': async (state, payload: {
				connection: IConnectionDialogProfile
			}) => {
				return {
					...state,
					connectionProfile: await this.loadConnection(payload.connection),
					selectedFormTab: payload.connection.connectionString ? FormTabs.ConnectionString : FormTabs.Parameters
				};
			}
		});
	}
}