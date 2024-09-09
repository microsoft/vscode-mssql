/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebviewPanelController } from "../controllers/reactWebviewController";
import { AuthenticationType, ConnectionDialogReducers, ConnectionDialogWebviewState, FormTabType, IConnectionDialogProfile } from '../sharedInterfaces/connectionDialog';
import { IConnectionInfo } from 'vscode-mssql';
import MainController from '../controllers/mainController';
import { getConnectionDisplayName } from '../models/connectionInfo';
import { AzureController } from '../azure/azureController';
import { ObjectExplorerProvider } from '../objectExplorer/objectExplorerProvider';
import { CapabilitiesResult, GetCapabilitiesRequest } from '../models/contracts/connection';
import { ConnectionOption } from 'azdata';
import { Logger } from '../models/logger';
import VscodeWrapper from '../controllers/vscodeWrapper';
import * as LocalizedConstants from '../constants/locConstants';
import { FormItemSpec, FormItemActionButton, FormItemOptions, FormItemType } from '../reactviews/common/forms/form';
import { ApiStatus } from '../sharedInterfaces/webview';

export class ConnectionDialogWebviewController extends ReactWebviewPanelController<ConnectionDialogWebviewState, ConnectionDialogReducers> {
	private _connectionToEditCopy: IConnectionDialogProfile | undefined;

	private static _logger: Logger;

	constructor(
		context: vscode.ExtensionContext,
		private _mainController: MainController,
		private _objectExplorerProvider: ObjectExplorerProvider,
		private _connectionToEdit?: IConnectionInfo
	) {
		super(
			context,
			LocalizedConstants.connectionDialog,
			'connectionDialog',
			new ConnectionDialogWebviewState({
				connectionProfile: {} as IConnectionDialogProfile,
				recentConnections: [],
				selectedFormTab: FormTabType.Parameters,
				connectionFormComponents: {
					mainComponents: [],
					advancedComponents: {}
				},
				connectionStringComponents: [],
				connectionStatus: ApiStatus.NotStarted,
				formError: ''
			}),
			vscode.ViewColumn.Active,
			{
				dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor_dark.svg'),
				light: vscode.Uri.joinPath(context.extensionUri, 'media', 'connectionDialogEditor_light.svg')
			}
		);

		if (!ConnectionDialogWebviewController._logger) {
			const vscodeWrapper = new VscodeWrapper();
			const channel = vscodeWrapper.createOutputChannel(LocalizedConstants.connectionDialog);
			ConnectionDialogWebviewController._logger = Logger.create(channel);
		}

		this.registerRpcHandlers();
		this.initializeDialog().catch(err => vscode.window.showErrorMessage(err.toString()));
	}

	private async initializeDialog() {
		await this.loadRecentConnections();
		if (this._connectionToEdit) {
			await this.loadConnectionToEdit();
		} else {
			await this.loadEmptyConnection();
		}


		this.state.connectionFormComponents = await this.generateConnectionFormComponents();
		this.state.connectionStringComponents = await this.generateConnectionStringComponents();

		await this.updateItemVisibility();
		this.state = this.state;
	}

	private async loadRecentConnections() {
		const recentConnections = this._mainController.connectionManager.connectionStore.loadAllConnections(true).map(c => c.connectionCreds);
		const dialogConnections: IConnectionDialogProfile[] = [];
		for (let i = 0; i < recentConnections.length; i++) {
			dialogConnections.push(await this.initializeConnectionForDialog(recentConnections[i]));
		}
		this.state.recentConnections = dialogConnections;
		this.state = this.state;
	}

	private async loadConnectionToEdit() {
		if (this._connectionToEdit) {
			this._connectionToEditCopy = structuredClone(this._connectionToEdit);
			const connection = await this.initializeConnectionForDialog(this._connectionToEdit);
			this.state.connectionProfile = connection;
			this.state = this.state;
		}
	}

	private async loadEmptyConnection() {
		const emptyConnection = {
			authenticationType: AuthenticationType.SqlLogin,
		} as IConnectionDialogProfile;
		this.state.connectionProfile = emptyConnection;
	}

	private async initializeConnectionForDialog(connection: IConnectionInfo): Promise<IConnectionDialogProfile> {
		// Load the password if it's saved
		const isConnectionStringConnection = connection.connectionString !== undefined && connection.connectionString !== '';
		if (!isConnectionStringConnection) {
			const password = await this._mainController.connectionManager.connectionStore.lookupPassword(connection, isConnectionStringConnection);
			connection.password = password;
		} else {
			// If the connection is a connection string connection with SQL Auth:
			//   * the full connection string is stored as the "password" in the credential store
			//   * we need to extract the password from the connection string
			// If the connection is a connection string connection with a different auth type, then there's nothing in the credential store.

			const connectionString = await this._mainController.connectionManager.connectionStore.lookupPassword(connection, isConnectionStringConnection);

			if (connectionString) {
				const passwordIndex = connectionString.toLowerCase().indexOf('password=');

				if (passwordIndex !== -1) {
					// extract password from connection string; found between 'Password=' and the next ';'
					const passwordStart = passwordIndex + 'password='.length;
					const passwordEnd = connectionString.indexOf(';', passwordStart);
					if (passwordEnd !== -1) {
						connection.password = connectionString.substring(passwordStart, passwordEnd);
					}

					// clear the connection string from the IConnectionDialogProfile so that the ugly connection string key
					// that's used to look up the actual connection string (with password) isn't displayed
					connection.connectionString = '';
				}
			}
		}

		const dialogConnection = connection as IConnectionDialogProfile;
		// Set the display name
		dialogConnection.displayName = dialogConnection.profileName ? dialogConnection.profileName : getConnectionDisplayName(connection);
		return dialogConnection;
	}

	private async updateItemVisibility() {
		const selectedTab = this.state.selectedFormTab;
		let hiddenProperties: (keyof IConnectionDialogProfile)[] = [];
		if (selectedTab === FormTabType.Parameters) {
			if (this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin) {
				hiddenProperties.push('user', 'password', 'savePassword');
			}
			if (this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA) {
				hiddenProperties.push('accountId', 'tenantId');
			}
			if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA) {
				// Hide tenantId if accountId has only one tenant
				const tenants = await this.getTenants(this.state.connectionProfile.accountId);
				if (tenants.length === 1) {
					hiddenProperties.push('tenantId');
				}
			}
		}

		for (const component of this.state.connectionFormComponents.mainComponents) {
				component.hidden = hiddenProperties.includes(component.propertyName);
		}
	}

	private getActiveFormComponents(): FormItemSpec<IConnectionDialogProfile>[] {
		if (this.state.selectedFormTab === FormTabType.Parameters) {
			return this.state.connectionFormComponents.mainComponents;
		}
		return this.state.connectionStringComponents;
	}

	private getFormComponent(propertyName: keyof IConnectionDialogProfile): FormItemSpec<IConnectionDialogProfile> | undefined {

		return this.getActiveFormComponents().find(c => c.propertyName === propertyName);
	}

	private async getAccounts(): Promise<FormItemOptions[]> {
		const accounts = await this._mainController.azureAccountService.getAccounts();
		return accounts.map(account => {
			return {
				displayName: account.displayInfo.displayName,
				value: account.displayInfo.userId
			};
		});

	}

	private async getTenants(accountId: string): Promise<FormItemOptions[]> {
		const account = (await this._mainController.azureAccountService.getAccounts()).find(account => account.displayInfo.userId === accountId);
		if (!account) {
			return [];
		}
		const tenants = account.properties.tenants;
		if (!tenants) {
			return [];
		}
		return tenants.map(tenant => {
			return {
				displayName: tenant.displayName,
				value: tenant.id
			};
		});
	}

	private convertToFormComponent(connOption: ConnectionOption): FormItemSpec<IConnectionDialogProfile> {
		switch (connOption.valueType) {
			case 'boolean':
				return {
					propertyName: connOption.name as keyof IConnectionDialogProfile,
					label: connOption.displayName,
					required: connOption.isRequired,
					type: FormItemType.Checkbox,
					tooltip: connOption.description,
				};
			case 'string':
				return {
					propertyName: connOption.name as keyof IConnectionDialogProfile,
					label: connOption.displayName,
					required: connOption.isRequired,
					type: FormItemType.Input,
					tooltip: connOption.description,
				};
			case 'password':
				return {
				propertyName: connOption.name as keyof IConnectionDialogProfile,
				label: connOption.displayName,
				required: connOption.isRequired,
				type: FormItemType.Password,
				tooltip: connOption.description,
			};

			case 'number':
				return {
					propertyName: connOption.name as keyof IConnectionDialogProfile,
					label: connOption.displayName,
					required: connOption.isRequired,
					type: FormItemType.Input,
					tooltip: connOption.description,
				};
			case 'category':
				return {
					propertyName: connOption.name as keyof IConnectionDialogProfile,
					label: connOption.displayName,
					required: connOption.isRequired,
					type: FormItemType.Dropdown,
					tooltip: connOption.description,
					options: connOption.categoryValues.map(v => {
						return {
							displayName: v.displayName ?? v.name, // Use name if displayName is not provided
							value: v.name
						};
					}),
				};
			default:
				ConnectionDialogWebviewController._logger.log(`Unhandled connection option type: ${connOption.valueType}`);
			}
	}

	private async completeFormComponents(components: Map<string, {option: ConnectionOption, component: FormItemSpec<IConnectionDialogProfile>}>) {
		// Add additional components that are not part of the connection options
		components.set('savePassword', {
			option: undefined,
			component: {
				propertyName: 'savePassword',
				label: LocalizedConstants.savePassword,
				required: false,
				type: FormItemType.Checkbox,
			}
		});

		components.set('accountId', {
			option: undefined,
			component: {
				propertyName: 'accountId',
				label: LocalizedConstants.azureAccount,
				required: true,
				type: FormItemType.Dropdown,
				options: await this.getAccounts(),
				placeholder: LocalizedConstants.selectAnAccount,
				actionButtons: await this.getAzureActionButtons(),
				validate: (value: string) => {
					if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA && !value) {
						return {
							isValid: false,
							validationMessage: LocalizedConstants.azureAccountIsRequired
						};
					}
					return {
						isValid: true,
						validationMessage: ''
					};
				},
			}
		});

		components.set('tenantId', {
			option: undefined,
			component: {
				propertyName: 'tenantId',
				label: LocalizedConstants.tenantId,
				required: true,
				type: FormItemType.Dropdown,
				options: [],
				hidden: true,
				placeholder: LocalizedConstants.selectATenant,
				validate: (value: string) => {
					if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA && !value) {
						return {
							isValid: false,
							validationMessage: LocalizedConstants.tenantIdIsRequired
						};
					}
					return {
						isValid: true,
						validationMessage: ''
					};
				}
			}
		});

		components.set('profileName', {
			option: undefined,
			component: {
			propertyName: 'profileName',
			label: LocalizedConstants.profileName,
			required: false,
			type: FormItemType.Input,
			}
		});

		// add missing validation functions for generated components
		components.get('server')!.component.validate = (value: string) => {
			if (this.state.selectedFormTab === FormTabType.Parameters && !value) {
				return {
					isValid: false,
					validationMessage: LocalizedConstants.serverIsRequired
				};
			}
			return {
				isValid: true,
				validationMessage: ''
			};
		};

		components.get('user')!.component.validate = (value: string) => {
			if (this.state.connectionProfile.authenticationType === AuthenticationType.SqlLogin && !value) {
				return {
					isValid: false,
					validationMessage: LocalizedConstants.usernameIsRequired
				};
			}
			return {
				isValid: true,
				validationMessage: ''
			};
		};
	}

	private _mainOptionNames = new Set<string>([
		'server',
		'authenticationType',
		'user',
		'password',
		'savePassword',
		'accountId',
		'tenantId',
		'database',
		'trustServerCertificate',
		'encrypt',
		'profileName'
	]);

	private async generateConnectionFormComponents(): Promise<{
		mainComponents: FormItemSpec<IConnectionDialogProfile>[],
		advancedComponents: {[category: string]: FormItemSpec<IConnectionDialogProfile>[]}
	}> {
		// get list of connection options from Tools Service
		const result: CapabilitiesResult = await this._mainController.connectionManager.client.sendRequest(GetCapabilitiesRequest.type, {});
		const connectionOptions: ConnectionOption[] = result.capabilities.connectionProvider.options;

		// convert connection options to form components
		const allConnectionFormComponents = new Map<string, {option: ConnectionOption, component: FormItemSpec<IConnectionDialogProfile>}>();

		for (const option of connectionOptions) {
			allConnectionFormComponents.set(option.name, {option, component: this.convertToFormComponent(option)});
		}

		await this.completeFormComponents(allConnectionFormComponents);

		// organize the main components and advanced components
		// main components are few-enough that there's no grouping, but advanced components get grouped by category
		const mainComponents: FormItemSpec<IConnectionDialogProfile>[] = [];
		const advancedComponents: {[category: string]: FormItemSpec<IConnectionDialogProfile>[]} = {};

		for (const [optionName, {option, component}] of allConnectionFormComponents) {
			if (this._mainOptionNames.has(optionName)) {
				mainComponents.push(component);
			} else {
				if (!advancedComponents[option.groupName]) {
					advancedComponents[option.groupName] = [component];
				} else {
					advancedComponents[option.groupName].push(component);
				}
			}
		}

		return {mainComponents, advancedComponents};
	}

	private async generateConnectionStringComponents(): Promise<FormItemSpec<IConnectionDialogProfile>[]> {
		return [
			{
				type: FormItemType.TextArea,
				propertyName: 'connectionString',
				label: LocalizedConstants.connectionString,
				required: true,
				validate: (value: string) => {
					if (this.state.selectedFormTab === FormTabType.ConnectionString && !value) {
						return {
							isValid: false,
							validationMessage: LocalizedConstants.connectionStringIsRequired
						};
					}
					return {
						isValid: true,
						validationMessage: ''
					};
				}
			},
			{
				propertyName: 'profileName',
				label: LocalizedConstants.profileName,
				required: false,
				type: FormItemType.Input,
			}
		];
	}

	private async validateFormComponents(propertyName?: keyof IConnectionDialogProfile): Promise<number> {
		let errorCount = 0;
		if (propertyName) {
			const component = this.getFormComponent(propertyName);
			if (component && component.validate) {
				component.validation = component.validate(this.state.connectionProfile[propertyName]);
				if (!component.validation.isValid) {
					return 1;
				}
			}
		}
		else {
			this.getActiveFormComponents().forEach(c => {
				if (c.hidden) {
					c.validation = {
						isValid: true,
						validationMessage: ''
					};
					return;
				} else {
					if (c.validate) {
						c.validation = c.validate(this.state.connectionProfile[c.propertyName]);
						if (!c.validation.isValid) {
							errorCount++;
						}
					}
				}
			});
		}
		return errorCount;
	}

	private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
		const actionButtons: FormItemActionButton[] = [];
		actionButtons.push({
			label: LocalizedConstants.signIn,
			id: 'azureSignIn',
			callback: async () => {
				const account = await this._mainController.azureAccountService.addAccount();
				const accountsComponent = this.getFormComponent('accountId');
				if (accountsComponent) {
					accountsComponent.options = await this.getAccounts();
					this.state.connectionProfile.accountId = account.key.id;
					this.state = this.state;
					await this.handleAzureMFAEdits('accountId');
				}
			}
		});
		if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA && this.state.connectionProfile.accountId) {
			const account = (await this._mainController.azureAccountService.getAccounts()).find(account => account.displayInfo.userId === this.state.connectionProfile.accountId);
			if (account) {
				const session = await this._mainController.azureAccountService.getAccountSecurityToken(account, undefined);
				const isTokenExpired = AzureController.isTokenInValid(session.token, session.expiresOn);
				if (isTokenExpired) {
					actionButtons.push({
						label: LocalizedConstants.refreshTokenLabel,
						id: 'refreshToken',
						callback: async () => {
							const account = (await this._mainController.azureAccountService.getAccounts()).find(account => account.displayInfo.userId === this.state.connectionProfile.accountId);
							if (account) {
								const session = await this._mainController.azureAccountService.getAccountSecurityToken(account, undefined);
								ConnectionDialogWebviewController._logger.log('Token refreshed', session.expiresOn);
							}
						}
					});
				}
			}
		}
		return actionButtons;
	}

	private async handleAzureMFAEdits(propertyName: keyof IConnectionDialogProfile) {
		const mfaComponents: (keyof IConnectionDialogProfile)[] = ['accountId', 'tenantId', 'authenticationType'];
		if (mfaComponents.includes(propertyName)) {
			if (this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA) {
				return;
			}
			const accountComponent = this.getFormComponent('accountId');
			const tenantComponent = this.getFormComponent('tenantId');
			let tenants: FormItemOptions[] = [];
			switch (propertyName) {
				case 'accountId':
					tenants = await this.getTenants(this.state.connectionProfile.accountId);
					if (tenantComponent) {
						tenantComponent.options = tenants;
						if (tenants && tenants.length > 0) {
							this.state.connectionProfile.tenantId = tenants[0].value;
						}
					}
					accountComponent.actionButtons = await this.getAzureActionButtons();
					break;
				case 'tenantId':
					break;
				case 'authenticationType':
					const firstOption = accountComponent.options[0];
					if (firstOption) {
						this.state.connectionProfile.accountId = firstOption.value;
					}
					tenants = await this.getTenants(this.state.connectionProfile.accountId);
					if (tenantComponent) {
						tenantComponent.options = tenants;
						if (tenants && tenants.length > 0) {
							this.state.connectionProfile.tenantId = tenants[0].value;
						}
					}
					accountComponent.actionButtons = await this.getAzureActionButtons();
					break;
			}
		}
	}

	private clearFormError() {
		this.state.formError = '';
		for (const component of this.getActiveFormComponents()) {
			component.validation = undefined;
		}
	}

	private registerRpcHandlers() {
		this.registerReducer('setFormTab', async (state, payload) => {
			this.state.selectedFormTab = payload.tab;
			await this.updateItemVisibility();
			return state;
		});

		this.registerReducer('formAction', async (state, payload) => {
			if (payload.event.isAction) {
				const component = this.getFormComponent(payload.event.propertyName);
				if (component && component.actionButtons) {
					const actionButton = component.actionButtons.find(b => b.id === payload.event.value);
					if (actionButton?.callback) {
						await actionButton.callback();
					}
				}
			} else {
				(this.state.connectionProfile[payload.event.propertyName] as any) = payload.event.value;
				await this.validateFormComponents(payload.event.propertyName);
				await this.handleAzureMFAEdits(payload.event.propertyName);
			}
			await this.updateItemVisibility();
			return state;
		});

		this.registerReducer('loadConnection', async (state, payload) => {
			this._connectionToEditCopy = structuredClone(payload.connection);
			this.clearFormError();
			this.state.connectionProfile = payload.connection;
			await this.updateItemVisibility();
			await this.handleAzureMFAEdits('azureAuthType');
			await this.handleAzureMFAEdits('accountId');
			return state;
		});

		this.registerReducer('connect', async (state) => {
			this.clearFormError();
			this.state.connectionStatus = ApiStatus.Loading;
			this.state.formError = '';
			this.state = this.state;

			const usedFields = new Set<keyof IConnectionDialogProfile>(this.getActiveFormComponents().filter(c => !c.hidden).map(c => c.propertyName));

			Object.keys(this.state.connectionFormComponents.advancedComponents).forEach(group => {
				this.state.connectionFormComponents.advancedComponents[group].forEach(c => {
					if (!c.hidden) {
						usedFields.add(c.propertyName);
					}
				});
			});

			// Clear unused fields (anything that isn't visible due to form selections and isn't an advanced option)
			Object.keys(this.state.connectionProfile).forEach(optionName => {
				if (!usedFields.has(optionName as keyof IConnectionDialogProfile)) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(this.state.connectionProfile[optionName as keyof IConnectionDialogProfile] as any) = undefined;
				}
			});

			// Perform final validation of all inputs
			const errorCount = await this.validateFormComponents();
			if (errorCount > 0) {
				this.state.connectionStatus = ApiStatus.Error;
				return state;
			}

			try {
				const result = await this._mainController.connectionManager.connectionUI.validateAndSaveProfileFromDialog(this.state.connectionProfile as any);
				if (result?.errorMessage) {
					this.state.formError = result.errorMessage;
					this.state.connectionStatus = ApiStatus.Error;
					return state;
				}
				if (this._connectionToEditCopy) {
					await this._mainController.connectionManager.getUriForConnection(this._connectionToEditCopy);
					await this._objectExplorerProvider.removeConnectionNodes([this._connectionToEditCopy]);
					await this._mainController.connectionManager.connectionStore.removeProfile(this._connectionToEditCopy as any);
					await this._objectExplorerProvider.refresh(undefined);
				}
				await this._mainController.connectionManager.connectionUI.saveProfile(this.state.connectionProfile as any);
				const node = await this._mainController.createObjectExplorerSessionFromDialog(this.state.connectionProfile);
				await this._objectExplorerProvider.refresh(undefined);
				await this.loadRecentConnections();
				this.state.connectionStatus = ApiStatus.Loaded;
				await this._mainController.objectExplorerTree.reveal(node, { focus: true, select: true, expand: true });
				await this.panel.dispose();
			} catch (error) {
				this.state.connectionStatus = ApiStatus.Error;
				return state;
			}
			return state;
		});
	}
}
