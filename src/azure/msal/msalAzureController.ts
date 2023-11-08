/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as azureUtils from '../utils';

import { Subscription } from '@azure/arm-subscriptions';
import { ClientAuthError, ILoggerCallback, LogLevel as MsalLogLevel } from '@azure/msal-common';
import { Configuration, PublicClientApplication } from '@azure/msal-node';
import * as Constants from '../../constants/constants';
import * as LocalizedConstants from '../../constants/localizedConstants';
import { ConnectionProfile } from '../../models/connectionProfile';
import { IAccountProvider, IProviderSettings, IToken, IAccountProviderMetadata, AzureResource, ITenant, IPromptFailedResult } from '../../models/contracts/azure';
import { AccountStore } from '../accountStore';
import { AzureController } from '../azureController';
import { getEnableSqlAuthenticationProviderConfig } from '../utils';
import { MsalCachePluginProvider } from './msalCachePlugin';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as AzureConstants from '../constants';
import providerSettings from '../providerSettings';
import { AzureAccountProvider } from './azureAccountProvider';
import { ICredentialStore } from '../../credentialstore/icredentialstore';
import { IAccount, IAzureAccountSession } from 'vscode-mssql';
import { Iterable } from '../iterator';

export class MsalAzureController extends AzureController {

	public providerMap = new Map<string, IAccountProviderMetadata>();
	private _cachePluginProvider: MsalCachePluginProvider;
	private _accountProviders: { [accountProviderId: string]: IAccountProvider } = {};
	private _currentConfig: vscode.WorkspaceConfiguration;
	protected _credentialStore: ICredentialStore;
	protected clientApplication: PublicClientApplication;
	public activeProviderCount: number = 0;

	private getLoggerCallback(): ILoggerCallback {
		return (level: number, message: string, containsPii: boolean) => {
			if (!containsPii) {
				switch (level) {
					case MsalLogLevel.Error:
						this.logger.error(message);
						break;
					case MsalLogLevel.Info:
						this.logger.info(message);
						break;
					case MsalLogLevel.Verbose:
					default:
						this.logger.verbose(message);
						break;
				}
			} else {
				this.logger.pii(message);
			}
		};
	}

	public init(): void {
		// Since this setting is only applicable to MSAL, we can enable it safely only for MSAL Controller
		if (getEnableSqlAuthenticationProviderConfig()) {
			this._isSqlAuthProviderEnabled = true;
		}
		this.handleCloudChange();
		vscode.workspace.onDidChangeConfiguration((changeEvent) => {
			if (changeEvent.affectsConfiguration(AzureConstants.azureCloudsConfig)) {
				this.handleCloudChange();
			}
		});

	}

	public async clearTokenCache(): Promise<void> {
		this.clientApplication.clearCache();
		await this._cachePluginProvider.unlinkMsalCache();

		// Delete Encryption Keys
		await this._cachePluginProvider.clearCacheEncryptionKeys();
	}

	/**
	 * Clears old cache file that is no longer needed on system.
	 */
	private async clearOldCacheIfExists(): Promise<void> {
		let filePath = path.join(await this.findOrMakeStoragePath(), AzureConstants.oldMsalCacheFileName);
		try {
			await fsPromises.access(filePath);
			await fsPromises.rm(filePath);
			this.logger.verbose(`Old cache file removed successfully.`);
		} catch (e) {
			if (e.code !== 'ENOENT') {
				this.logger.verbose(`Error occurred while removing old cache file: ${e}`);
			} // else file doesn't exist.
		}
	}

	public async login(providerId: string): Promise<IAccount | undefined> {
		let provider = this.fetchProvider(providerId);
		let response = await provider.prompt();
		return response ? response as IAccount : undefined;
	}

	public async isAccountInCache(account: IAccount): Promise<boolean> {
		let provider = this.fetchProvider(account.key.providerId);
		await this.clearOldCacheIfExists();
		let accountInfo = provider.checkAccountInCache(account)
		return accountInfo !== undefined;
	}

	//TODO:@cssuh remove this and map to azureAccountProvider?
	public async refreshAccessToken(account: IAccount, accountStore: AccountStore, tenantId: string | undefined,
		settings: AzureResource): Promise<IToken | undefined> {
		let newAccount: IAccount | IPromptFailedResult;
		let provider: IAccountProvider;
		try {
			provider = this.fetchProvider(account.key.providerId);
			let token = await provider.getAccountSecurityToken(account, AzureConstants.organizationTenant.id, settings)

			if (!token) {
				return undefined;
			}
			return token;
		} catch (ex) {
			if (ex instanceof ClientAuthError && ex.errorCode === AzureConstants.noAccountInSilentRequestError) {
				try {
					// Account needs re-authentication
					newAccount = await provider.refresh(account);
					if (!this.isAccountResult(newAccount)) {
						return undefined
					}
					if (newAccount!.isStale === true) {
						return undefined;
					}
					await accountStore.addAccount(newAccount!);
					provider = this.fetchProvider(newAccount!.key.providerId)
					return await provider.getAccountSecurityToken(
						account, tenantId ?? account.properties.owningTenant.id, settings
					);
				} catch (ex) {
					this._vscodeWrapper.showErrorMessage(ex);
				}
			} else {
				this._vscodeWrapper.showErrorMessage(ex);
			}
		}
	}

	/**
	 * Gets the token for given account and updates the connection profile with token information needed for AAD authentication
	 */
	public async populateAccountProperties(profile: ConnectionProfile, accountStore: AccountStore, settings: AzureResource): Promise<ConnectionProfile> {
		let providerId: string;
		let account: IAccount;
		if (profile.providerId) {
			providerId = profile.providerId;
			account = await this.addAccount(accountStore, providerId);
		} else {
			providerId = await this.promptProvider();
			if (!providerId) {
				return undefined;
			}
			account = await this.addAccount(accountStore, providerId);
		}
		// get provider and run provider.prompt() to get the token
		// this just needs to fill in the token information in the profile
		let provider = this.fetchProvider(account!.key.providerId);
		profile.user = account!.displayInfo.displayName;
		profile.email = account!.displayInfo.email;
		profile.accountId = account!.key.id;

		// Skip fetching access token for profile if Sql Authentication Provider is enabled.
		if (!this.isSqlAuthProviderEnabled()) {
			if (!profile.tenantId) {
				await this.promptForTenantChoice(account!, profile);
			}

			const token = await provider.getAccountSecurityToken(
				account!, profile.tenantId, settings
			);

			if (!token) {
				let errorMessage = LocalizedConstants.msgGetTokenFail;
				this.logger.error(errorMessage);
				this._vscodeWrapper.showErrorMessage(errorMessage);
			} else {
				profile.azureAccountToken = token.token;
				profile.expiresOn = token.expiresOn;
			}
		} else {
			this.logger.verbose('SQL Authentication Provider is enabled, access token will not be acquired by extension.');
		}
		return profile;
	}

	public async promptProvider(): Promise<string | undefined> {
		const vals = Iterable.consume(this._accountService.providerMap.values())[0];

		let pickedValue: string | undefined;
		if (vals.length === 0) {
			// this.logger.error("You have no clouds enabled. Go to Settings -> Search Azure Account Configuration -> Enable at least one cloud");
		}
		if (vals.length > 1) {
			const buttons: vscode.QuickPickItem[] = vals.map(v => {
				return { label: v.displayName } as vscode.QuickPickItem;
			});

			await this._vscodeWrapper.showQuickPick(buttons, { placeHolder: "Choose an authentication provider" }).then((picked) => {
				pickedValue = picked?.label;
			});

		} else {
			pickedValue = vals[0].displayName;
		}

		const v = vals.filter(v => v.displayName === pickedValue)?.[0];

		if (!v) {
		// this.logger.error("You didn't select any authentication provider. Please try again.");
		// 	return undefined;
		}
		return v.id;
	}


	/**
	 * Returns Azure sessions with subscriptions, tenant and token for each given account
	 */
	public async getAccountSessions(account: IAccount): Promise<IAzureAccountSession[]> {
		let provider = this.fetchProvider(account.key.providerId);
		const sessions: IAzureAccountSession[] = [];
		const tenants = <ITenant[]>account.properties.tenants;
		for (const tenant of tenants) {
			const tenantId = tenant.id;
			const token = await provider.getAccountSecurityToken(account, tenantId, AzureResource.ResourceManagement);
			const subClient = this._subscriptionClientFactory(token!);
			const newSubPages = await subClient.subscriptions.list();
			const array = await azureUtils.getAllValues<Subscription, IAzureAccountSession>(newSubPages, (nextSub) => {
				return {
					subscription: nextSub,
					tenantId: tenantId,
					account: account,
					token: token
				};
			});
			sessions.push(...array);
		}

		return sessions.sort((a, b) => (a.subscription.displayName || '').localeCompare(b.subscription.displayName || ''));
	}

	public async removeAccount(account: IAccount): Promise<void> {
		let provider = this.fetchProvider(account.key.providerId);
		provider.clear(account.key);
	}

	private async handleCloudChange() {
		// Grab the stored config and the latest config
		let newConfig = vscode.workspace.getConfiguration(AzureConstants.azureCloudsConfig);
		let oldConfig = this._currentConfig;
		this._currentConfig = newConfig;

		// Determine what providers need to be changed
		let providerChanges: Promise<void>[] = [];
		for (let provider of providerSettings) {
			// If the old config doesn't exist, then assume everything was disabled
			// There will always be a new config value
			let oldConfigValue = oldConfig
				? oldConfig.get<boolean>(provider.configKey)
				: false;
			let newConfigValue = newConfig.get<boolean>(provider.configKey);

			// Case 1: Provider config has not changed - do nothing
			if (oldConfigValue === newConfigValue) {
				continue;
			}

			// Case 2: Provider was enabled and is now disabled - unregister provider
			if (oldConfigValue && !newConfigValue) {
				providerChanges.push(this.unregisterAccountProvider(provider));
				this.activeProviderCount--;
			}

			// Case 3: Provider was disabled and is now enabled - register provider
			if (!oldConfigValue && newConfigValue) {
				providerChanges.push(this.registerAccountProvider(provider));
				this.activeProviderCount++;
			}

			// Case 4: Provider was added from JSON - register provider
			if (provider.configKey !== AzureConstants.enablePublicCloud && provider.configKey !== AzureConstants.enableUsGovCloud && provider.configKey !== AzureConstants.enableChinaCloud) {
				providerChanges.push(this.registerAccountProvider(provider));
				this.activeProviderCount++;
			}
		}
		// if (this.activeProviderCount === 0) {
		// 	void vscode.window.showWarningMessage(loc.noCloudsEnabled, loc.enablePublicCloud, loc.dismiss).then(async (result) => {
		// 		if (result === loc.enablePublicCloud) {
		// 			await vscode.workspace.getConfiguration(Constants.AccountsAzureCloudSection).update(loc.enablePublicCloudCamel, true, vscode.ConfigurationTarget.Global);
		// 		}
		// 	});
		// }

		// Process all the changes before continuing
		await Promise.all(providerChanges);
	}

	private async registerAccountProvider(provider: IProviderSettings): Promise<void> {
		const tokenCacheKeyMsal = Constants.msalCacheFileName
		await this.clearOldCacheIfExists();
		try {
			if (!this._credentialStore) {
				throw new Error('Credential store not registered');
			}

			let storagePath = await this.findOrMakeStoragePath();
			// MSAL Cache Plugin
			this._cachePluginProvider = new MsalCachePluginProvider(tokenCacheKeyMsal, storagePath, this._vscodeWrapper, this.logger, this._credentialStore );

			const msalConfiguration: Configuration = {
				auth: {
					clientId: provider.metadata.settings.clientId,
					authority: 'https://login.windows.net/common'
				},
				system: {
					loggerOptions: {
						loggerCallback: this.getLoggerCallback(),
						logLevel: MsalLogLevel.Trace,
						piiLoggingEnabled: true
					}
				},
				cache: {
					cachePlugin: this._cachePluginProvider?.getCachePlugin()
				}
			}

			this.clientApplication = new PublicClientApplication(msalConfiguration);
			let accountProvider = new AzureAccountProvider(provider.metadata as IAccountProviderMetadata,
				this.context, this.clientApplication, this._vscodeWrapper, this.logger);
			this._accountProviders[provider.metadata.id] = accountProvider;
			this._accountService.registerProvider(provider.metadata, accountProvider);
		} catch (e) {
			console.error(`Failed to register account provider: ${e}`);
		}
	}

	private async unregisterAccountProvider(provider: IProviderSettings): Promise<void> {
		try {
			this._accountService.unregisterProvider(provider.metadata)
			delete this._accountProviders[provider.metadata.id];
		} catch (e) {
			console.error(`Failed to unregister account provider: ${e}`);
		}
	}

	private isAccountResult(result: IAccount | IPromptFailedResult): result is IAccount {
		return typeof (<IAccount>result).displayInfo === 'object';
	}


	private fetchProvider(providerId: string): IAccountProvider | undefined {
		return this._accountProviders[providerId];
	}
}

/**
 * Parameters that go along when a provider's account list changes
 */
export interface UpdateAccountListEventParams {
	/**
	 * ID of the provider who's account list changes
	 */
	providerId: string;

	/**
	 * Updated list of accounts, sorted appropriately
	 */
	accountList: IAccount[];
}
