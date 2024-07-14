/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import { AuthenticationType, ConnectionDialogWebviewState, FormComponent, FormComponentType, FormEvent, FormTabs, IConnectionDialogProfile } from '../sharedInterfaces/connectionDialog';
import { IConnectionInfo } from 'vscode-mssql';
import MainController from '../controllers/mainController';
import { getConnectionDisplayName } from '../models/connectionInfo';

export class ConnectionDialogWebViewController extends ReactWebViewPanelController<ConnectionDialogWebviewState> {
	constructor(
		context: vscode.ExtensionContext,
		private _mainController?: MainController,
		private _connectionToEdit?: IConnectionInfo,
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
				formComponents: new Map<keyof IConnectionDialogProfile, FormComponent>(),
			},
			vscode.ViewColumn.Active,
			{
				dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor_inverse.svg'),
				light: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor.svg')
			}
		);
		this.registerRpcHandlers();
		this.initializeDialog().catch(err => vscode.window.showErrorMessage(err.toString()));
	}

	private async initializeDialog() {
		await this.loadRecentConnections();
		if(this._connectionToEdit) {
			await this.loadConnectionToEdit();
		}
	}

	private async loadRecentConnections() {
		const recentConnections = this._mainController.connectionManager.connectionStore.loadAllConnections(true).map(c => c.connectionCreds);
		const dialogConnections = [];
		for (let i = 0; i < recentConnections.length; i++) {
			dialogConnections.push(await this.intializeConnectionForDialog(recentConnections[i]));
		}
		this.state.recentConnections = dialogConnections;
		this.state = this.state;
	}

	private async loadConnectionToEdit() {
		if (this._connectionToEdit) {
			const connection = await this.intializeConnectionForDialog(this._connectionToEdit);
			this.state.connectionProfile = connection;
			this.state = this.state;
		}
	}

	private async intializeConnectionForDialog(connection: IConnectionInfo) {
		// Load the password if it's saved
		const isConnectionStringConnection = connection.connectionString !== undefined && connection.connectionString !== '';
		connection.password = await this._mainController.connectionManager.connectionStore.lookupPassword(connection, isConnectionStringConnection);
		const dialogConnection = connection as IConnectionDialogProfile;
		// Set the profile name
		dialogConnection.profileName = getConnectionDisplayName(connection);
		return dialogConnection;
	}

	private generateFormComponents(): FormComponent[] {
		const result: FormComponent[] = [
			{
				type: FormComponentType.Input,
				propertyName: 'server',
				label: 'Server',
				required: true,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString,
			},
			{
				type: FormComponentType.Input,
				propertyName: 'connectionString',
				label: 'Connection String',
				required: true,
				hidden: this.state.selectedFormTab === FormTabs.Parameters,
			},
			{
				type: FormComponentType.Dropdown,
				propertyName: 'authenticationType',
				label: 'Authentication Type',
				required: true,
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
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString,
			},
			{
				// Hidden if connection string is set or if the authentication type is not SQL Login
				propertyName: 'user',
				label: 'User Name',
				type: FormComponentType.Input,
				required: true,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin,
			},
			{
				propertyName: 'password',
				label: 'Password',
				required: false,
				type: FormComponentType.Password,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin
			},
			{
				propertyName: 'savePassword',
				label: 'Save Password',
				required: false,
				type: FormComponentType.Checkbox,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin
			},
			{
				propertyName: 'accountId',
				label: 'Azure Account',
				required: true,
				type: FormComponentType.Dropdown,
				options: [],
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA,
				placeholder: 'Select an account',
				actionButtons: []
			},
			{
				propertyName: 'tenantId',
				label: 'Tenant ID',
				required: true,
				type: FormComponentType.Dropdown,
				options: [],
				hidden: true,
				placeholder: 'Select a tenant'
			},
			{
				propertyName: 'trustServerCertificate',
				label: 'Trust Server Certificate',
				required: false,
				type: FormComponentType.Checkbox,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString
			},
			{
				propertyName: 'encrypt',
				label: 'Encrypt Connection',
				required: false,
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
				required: false,
				type: FormComponentType.Input,
			}
		];
		return result;
	}

	private registerRpcHandlers() {
		this.registerReducers({
			'setFormTab': async (state, payload: {
				tab: FormTabs
			}) => {
				return state;
			},
			'formAction': async (state, payload: {
				event: FormEvent
			}) => {
				return state;
			},
			'loadConnection': async (state, payload: {
				connection: IConnectionDialogProfile
			}) => {
				return state;
			},
			'connect': async (state) => {
				return state;
			}
		});
	}
}