/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import { AuthenticationType, ConnectionDialogWebviewState, FormComponent, FormComponentOptions, FormComponentType, FormEvent, FormTabs, IConnectionDialogProfile } from '../sharedInterfaces/connections';
import ConnectionManager from '../controllers/connectionManager';
import { IConnectionInfo } from 'vscode-mssql';
import { getConnectionDisplayName } from '../models/connectionInfo';

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
		const storedConnections = (await this._connectionManager.connectionStore.loadAllConnections(true)).map(c => c.connectionCreds) as IConnectionDialogProfile[];
		for (let i = 0; i < storedConnections.length; i++) {
			storedConnections[i] = await this.loadConnection(storedConnections[i]);
		}
		let tab = FormTabs.Parameters;
		if(connectionInfo?.connectionString) {
			tab = FormTabs.ConnectionString;
		}

		this.state = {
			connectionProfile: await this.loadConnection(this.state.connectionProfile),
			recentConnections: storedConnections,
			selectedFormTab: tab,
			formComponents: this.generateFormComponents()
		};

		this.registerRpcHandlers();
	}

	private async loadConnection(connection: IConnectionDialogProfile | undefined): Promise<IConnectionDialogProfile> {
		// Set default authentication type if not set
		if (!connection.authenticationType) {
			connection.authenticationType = AuthenticationType.SqlLogin;
		}

		if (!connection.profileName && (connection.server || connection.connectionString)) {
			connection.profileName = getConnectionDisplayName(connection);
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
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString
			},
			{
				type: FormComponentType.Input,
				propertyName: 'connectionString',
				label: 'Connection String',
				hidden: this.state.selectedFormTab === FormTabs.Parameters
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
				],
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString
			},
			{
				// Hidden if connection string is set or if the authentication type is not SQL Login
				propertyName: 'user',
				label: 'User Name',
				type: FormComponentType.Input,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin
			},
			{
				propertyName: 'password',
				label: 'Password',
				type: FormComponentType.Password,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin
			},
			{
				propertyName: 'savePassword',
				label: 'Save Password',
				type: FormComponentType.Checkbox,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin
			},
			{
				propertyName: 'accountId',
				label: 'Azure Account',
				type: FormComponentType.Dropdown,
				options: this.getAzureAccounts(),
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA,
				placeholder: 'Select an account'
			},
			{
				propertyName: 'trustServerCertificate',
				label: 'Trust Server Certificate',
				type: FormComponentType.Checkbox,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString
			},
			{
				propertyName: 'encrypt',
				label: 'Encrypt Connection',
				type: FormComponentType.Dropdown,
				options: [
					{
						displayName: 'Optional',
						value: 'Optional'
					},
					{
						displayName: 'Mandatory',
						value: 'Mandatory'
					},
					{
						displayName: 'Strict',
						value: 'Strict (Requires SQL Server 2022 or Azure SQL)'
					}
				],
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString
			},
			{
				propertyName: 'profileName',
				label: 'Profile Name',
				type: FormComponentType.Input,
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
				this. state.selectedFormTab = payload.tab;
				this.state.formComponents = this.generateFormComponents();
				return state;
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