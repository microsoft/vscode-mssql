/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from '../../constants/constants';
import * as LocalizedConstants from '../../constants/localizedConstants';
import * as azureUtils from '../utils';

import { Subscription } from '@azure/arm-subscriptions';
import { AzureAuth, AzureCodeGrant, AzureDeviceCode, CachingProvider } from '@microsoft/ads-adal-library';
import { IAzureAccountSession } from 'vscode-mssql';
import providerSettings from '../../azure/providerSettings';
import { ConnectionProfile } from '../../models/connectionProfile';
import { AzureAuthType, IAADResource, IAccount, ITenant, IToken } from '../../models/contracts/azure';
import { AccountStore } from '../accountStore';
import { AzureController } from '../azureController';
import { getAzureActiveDirectoryConfig } from '../utils';
import { SimpleTokenCache } from './adalCacheService';
import { AzureAuthRequest } from './azureAuthRequest';
import { AzureErrorLookup } from './azureErrorLookup';
import { AzureMessageDisplayer } from './azureMessageDisplayer';
import { AzureStringLookup } from './azureStringLookup';
import { AzureUserInteraction } from './azureUserInteraction';
import { StorageService } from './storageService';

export class AdalAzureController extends AzureController {
	private _authMappings = new Map<AzureAuthType, AzureAuth>();
	private cacheProvider: SimpleTokenCache;
	private storageService: StorageService;
	private authRequest: AzureAuthRequest;
	private azureStringLookup: AzureStringLookup;
	private azureUserInteraction: AzureUserInteraction;
	private azureErrorLookup: AzureErrorLookup;
	private azureMessageDisplayer: AzureMessageDisplayer;

	public init(): void {
		this.azureStringLookup = new AzureStringLookup();
		this.azureErrorLookup = new AzureErrorLookup();
		this.azureMessageDisplayer = new AzureMessageDisplayer();
	}

	public async loadTokenCache(): Promise<void> {
		let authType = getAzureActiveDirectoryConfig();
		if (!this._authMappings.has(authType)) {
			await this.handleAuthMapping();
		}
	}

	public async login(authType: AzureAuthType): Promise<IAccount | undefined> {
		let azureAuth = await this.getAzureAuthInstance(authType);
		let response = await azureAuth!.startLogin();
		return response ? response as IAccount : undefined;
	}

	public isAccountInCache(account: IAccount): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	public async getAccountSecurityToken(account: IAccount, tenantId: string, settings: IAADResource): Promise<IToken | undefined> {
		let token: IToken | undefined;
		let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
		tenantId = tenantId ? tenantId : azureAuth!.getHomeTenant(account).id;
		token = await azureAuth!.getAccountSecurityToken(
			account, tenantId, settings
		);
		return token;
	}

	public async refreshAccessToken(account: IAccount, accountStore: AccountStore, tenantId: string | undefined, settings: IAADResource)
		: Promise<IToken | undefined> {
		try {
			let token: IToken | undefined;
			let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
			let newAccount = await azureAuth!.refreshAccess(account);
			if (newAccount.isStale === true) {
				return undefined;
			}
			await accountStore.addAccount(newAccount as IAccount);

			token = await this.getAccountSecurityToken(
				account, tenantId!, settings
			);
			return token;
		} catch (ex) {
			let errorMsg = this.azureErrorLookup.getSimpleError(ex.errorCode);
			this._vscodeWrapper.showErrorMessage(errorMsg);
		}
	}

	/**
	 * Gets the token for given account and updates the connection profile with token information needed for AAD authentication
	 */
	public async populateAccountProperties(profile: ConnectionProfile, accountStore: AccountStore, settings: IAADResource): Promise<ConnectionProfile> {
		let account = await this.addAccount(accountStore);
		profile.user = account!.displayInfo.displayName;
		profile.email = account!.displayInfo.email;
		profile.accountId = account!.key.id;

		if (!profile.tenantId) {
			await this.promptForTenantChoice(account!, profile);
		}

		const token = await this.getAccountSecurityToken(
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

		return profile;
	}

	public async refreshTokenWrapper(profile, accountStore: AccountStore, accountAnswer, settings: IAADResource): Promise<ConnectionProfile | undefined> {
		let account = accountStore.getAccount(accountAnswer.key.id);
		if (!account) {
			await this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgAccountNotFound);
			throw new Error(LocalizedConstants.msgAccountNotFound);
		}
		let azureAccountToken = await this.refreshToken(account, accountStore, settings, profile.tenantId);
		if (!azureAccountToken) {
			let errorMessage = LocalizedConstants.msgAccountRefreshFailed;
			return this._vscodeWrapper.showErrorMessage(errorMessage, LocalizedConstants.refreshTokenLabel).then(async result => {
				if (result === LocalizedConstants.refreshTokenLabel) {
					let refreshedProfile = await this.populateAccountProperties(profile, accountStore, settings);
					return refreshedProfile;
				} else {
					return undefined;
				}
			});
		}

		profile.azureAccountToken = azureAccountToken.token;
		profile.expiresOn = azureAccountToken.expiresOn;
		profile.user = account.displayInfo.displayName;
		profile.email = account.displayInfo.email;
		profile.accountId = account.key.id;
		return profile;
	}

	public async refreshToken(account: IAccount, accountStore: AccountStore, settings: IAADResource, tenantId: string | undefined): Promise<IToken | undefined> {
		try {
			let token: IToken | undefined;
			let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
			let newAccount = await azureAuth!.refreshAccess(account);
			if (newAccount.isStale === true) {
				return undefined;
			}
			await accountStore.addAccount(newAccount as IAccount);

			token = await this.getAccountSecurityToken(
				account, tenantId!, settings
			);
			return token;
		} catch (ex) {
			let errorMsg = this.azureErrorLookup.getSimpleError(ex.errorCode);
			this._vscodeWrapper.showErrorMessage(errorMsg);
		}
	}

	/**
	 * Returns Azure sessions with subscriptions, tenant and token for each given account
	 */
	public async getAccountSessions(account: IAccount): Promise<IAzureAccountSession[]> {
		let sessions: IAzureAccountSession[] = [];
		const tenants = <ITenant[]>account.properties.tenants;
		for (const tenantId of tenants.map(t => t.id)) {
			const token = await this.getAccountSecurityToken(account, tenantId, providerSettings.resources.azureManagementResource);
			const subClient = this._subscriptionClientFactory(token!);
			const newSubPages = subClient.subscriptions.list();
			const array = await azureUtils.getAllValues<Subscription, IAzureAccountSession>(newSubPages, (nextSub) => {
				return {
					subscription: nextSub,
					tenantId: tenantId,
					account: account,
					token: token
				};
			});
			sessions = sessions.concat(array);
		}

		return sessions.sort((a, b) => (a.subscription.displayName || '').localeCompare(b.subscription.displayName || ''));
	}

	public async handleAuthMapping(): Promise<void> {
		if (!this._credentialStoreInitialized) {

			let storagePath = await this.findOrMakeStoragePath();
			// ADAL Cache Service
			this.cacheProvider = new SimpleTokenCache(Constants.adalCacheFileName, this._credentialStore, this._vscodeWrapper, this.logger, storagePath!);
			await this.cacheProvider.init();
			this.storageService = this.cacheProvider.db;
			// MSAL Cache Provider
			this._credentialStoreInitialized = true;
			this.logger.verbose(`Credential store initialized.`);

			this.authRequest = new AzureAuthRequest(this.context, this.logger);
			await this.authRequest.startServer();
			this.azureUserInteraction = new AzureUserInteraction(this.authRequest.getState());
		}

		this._authMappings.clear();
		const configuration = getAzureActiveDirectoryConfig();

		if (configuration === AzureAuthType.AuthCodeGrant) {
			this._authMappings.set(AzureAuthType.AuthCodeGrant, new AzureCodeGrant(
				providerSettings, this.storageService, this.cacheProvider as CachingProvider, this.logger,
				this.azureMessageDisplayer, this.azureErrorLookup, this.azureUserInteraction,
				this.azureStringLookup, this.authRequest
			));
		} else if (configuration === AzureAuthType.DeviceCode) {
			this._authMappings.set(AzureAuthType.DeviceCode, new AzureDeviceCode(
				providerSettings, this.storageService, this.cacheProvider as CachingProvider, this.logger,
				this.azureMessageDisplayer, this.azureErrorLookup, this.azureUserInteraction,
				this.azureStringLookup, this.authRequest
			));
		}
	}

	private async getAzureAuthInstance(authType: AzureAuthType): Promise<AzureAuth | undefined> {
		if (!this._authMappings.has(authType)) {
			await this.handleAuthMapping();
		}
		return this._authMappings.get(authType);
	}

	public async removeAccount(account: IAccount): Promise<void> {
		let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
		await azureAuth!.deleteAccountCache(account.key);
		this.logger.verbose(`Account deleted from cache successfully: ${account.key.id}`);
	}

	/**
	 * Returns true if token is invalid or expired
	 * @param token Token
	 * @param token expiry
	 */
	public static isTokenInValid(token: string, expiresOn?: number): boolean {
		return (!token || this.isTokenExpired(expiresOn));
	}

	/**
	 * Returns true if token is expired
	 * @param token expiry
	 */
	public static isTokenExpired(expiresOn?: number): boolean {
		if (!expiresOn) {
			return true;
		}
		const currentTime = new Date().getTime() / 1000;
		const maxTolerance = 2 * 60; // two minutes
		return (expiresOn - currentTime < maxTolerance);
	}
}
