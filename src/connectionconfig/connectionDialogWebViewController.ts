/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import { AuthenticationType, ComponentValidationState, ConnectionDialogWebviewState, FormComponent, FormComponentActionButton, FormComponentOptions, FormComponentType, FormEvent, FormTabs, IConnectionDialogProfile } from '../sharedInterfaces/connections';
import ConnectionManager from '../controllers/connectionManager';
import { IConnectionInfo } from 'vscode-mssql';
import { getConnectionDisplayName } from '../models/connectionInfo';
import MainController from '../controllers/mainController';
import { Deferred } from '../protocol';

export class ConnectionDialogWebViewController extends ReactWebViewPanelController<ConnectionDialogWebviewState> {
	constructor(
		context: vscode.ExtensionContext,
		private _connectionManager: ConnectionManager,
		_connectionInfo?: IConnectionInfo,
		private _mainController?: MainController
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
		if (connectionInfo?.connectionString) {
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
				required: true,
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString,
				validate: (value: string) => {
					if (!value) {
						return {
							validationMessage: 'Server is required',
							ComponentValidationState: ComponentValidationState.Error
						};
					}
					return {
						validationMessage: undefined,
						ComponentValidationState: value ? undefined : ComponentValidationState.Error
					};
				}
			},
			{
				type: FormComponentType.Input,
				propertyName: 'connectionString',
				label: 'Connection String',
				required: true,
				hidden: this.state.selectedFormTab === FormTabs.Parameters,
				validate: (value: string) => {
					if (!value) {
						return {
							validationMessage: 'Connection String is required',
							ComponentValidationState: ComponentValidationState.Error
						};
					}
				}
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
				validate: (value: string) => {
					if (!value) {
						return {
							validationMessage: 'Username is required',
							ComponentValidationState: ComponentValidationState.Error
						};
					}
				}
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
				options: this.getAzureAccounts(),
				hidden: this.state.selectedFormTab === FormTabs.ConnectionString ? true : this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA,
				placeholder: 'Select an account',
				actionButtons: this.getAccountActionButtons(),
				validate: (value: string) => {
					if (!value) {
						return {
							validationMessage: 'Azure Account is required',
							ComponentValidationState: ComponentValidationState.Error
						};
					}
 				},
				onChange: (value: string) => {

				}
			},
			{
				propertyName: 'tenantId',
				label: 'Tenant ID',
				required: true,
				type: FormComponentType.Dropdown,
				options: this.getTenantIds(this.state.connectionProfile.accountId),
				hidden: this.isTenantDropdownHidden(),
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

	private getAzureAccounts(): FormComponentOptions[] {
		const accounts = this._connectionManager.accountStore.getAccounts();
		return accounts.map(a => {
			return {
				displayName: a.displayInfo.displayName,
				value: a.key.id
			};
		});
	}

	private isTenantDropdownHidden(): boolean {
		if (this.state.selectedFormTab === FormTabs.ConnectionString) {
			return true;
		}
		if (this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA) {
			return true;
		}
		if (this.getTenantIds(this.state.connectionProfile.accountId).length === 1) {
			return true;
		}
		return false;
	}

	private getAccountActionButtons(): FormComponentActionButton[] {
		const actionButtons: FormComponentActionButton[] = [];
		actionButtons.push({
			label: 'Add Account',
			id: 'addAccount',
			callback: async () => {
				const newAccount = await this._connectionManager.addAccount();
				if (newAccount) {
					this.state.connectionProfile.accountId = newAccount.key.id;
				}
			}
		});
		if (this.state.connectionProfile.accountId) {
			const accountId = this._connectionManager.accountStore.getAccount(this.state.connectionProfile.accountId);
			if (accountId?.isStale) {
				actionButtons.push({
					label: 'Refresh Account',
					id: 'refreshAccount',
					callback: async () => {
					}
				});
			}
		}
		return actionButtons;
	}

	private getTenantIds(key: string | undefined): FormComponentOptions[] {
		if (key === undefined) {
			return [];
		}
		let tenantIds = this._connectionManager.accountStore.getAccount(key).properties.tenants;
		if (tenantIds === undefined && tenantIds.length === 0) {
			return [];
		}
		tenantIds = tenantIds.filter(t => t.displayName === "Default Directory");
		const result = tenantIds.map(t => {
			return {
				displayName: t.displayName,
				value: t.id
			};
		});
		return result;
	}

	private registerRpcHandlers() {
		this.registerReducers({
			'setFormTab': async (state, payload: {
				tab: FormTabs
			}) => {
				this.state.selectedFormTab = payload.tab;
				this.state.formComponents = this.generateFormComponents();
				return state;
			},
			'formAction': async (state, payload: {
				event: FormEvent
			}) => {
				const formComponent = this.state.formComponents.find(c => c.propertyName === payload.event.propertyName);
				if (payload.event.isAction) {
					await formComponent?.actionButtons?.find(b => b.id === payload.event.value)?.callback();
				} else {
					state.connectionProfile[payload.event.propertyName] = payload.event.value;
					if(formComponent?.onChange){
						formComponent.onChange(state.connectionProfile[payload.event.propertyName]);
					}
				}
				const newComponent = this.generateFormComponents();
				newComponent.forEach((c, idx) => {
					const oldComponent = state.formComponents[idx];
					if(c.propertyName === payload.event.propertyName && c.validate){
						const validationResult = c.validate(state.connectionProfile[c.propertyName]);
						if(validationResult){
							formComponent.validationMessage = validationResult.validationMessage;
							formComponent.validationState = validationResult.ComponentValidationState;
						}
					}
					else if (oldComponent.validationMessage !== undefined) {
						c.validationMessage = oldComponent.validationMessage;
						c.validationState = oldComponent.validationState;
					}
				});
				state.formComponents = newComponent;
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
			},
			'connect': async (state) => {
				// clear out all hidden fields
				let invalidCount = 0;
				this.state.formComponents.forEach(c => {
					// Clear out validation messages
					c.validationMessage = undefined;
					c.validationState = undefined;
					if (!c.hidden && c.validate) {
						const validationResult = c.validate(this.state.connectionProfile[c.propertyName]);
						if (validationResult.validationMessage !== undefined) {
							invalidCount++;
							c.validationMessage = validationResult.validationMessage;
							c.validationState = validationResult.ComponentValidationState;
						}

					}
				});

				// If there are invalid fields, return the state without connecting
				if (invalidCount > 0) {
					return state;
				}

				// Clear out fields that are hidden
				this.state.formComponents.forEach(c => {
					if (c.hidden) {
						(this.state.connectionProfile[c.propertyName] as any) = undefined;
					}
				});
				const connectionPromise = new Deferred<boolean>();
				const result = await this._mainController.connect('', this.state.connectionProfile, connectionPromise,  true);
				if (result){
					const connectionSucceeded = await connectionPromise;
				}
				return state;
			}
		});
	}
}