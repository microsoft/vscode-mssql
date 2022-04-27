/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';
import { AzureStringLookup } from '../azure/azureStringLookup';
import { AzureUserInteraction } from '../azure/azureUserInteraction';
import { AzureErrorLookup } from '../azure/azureErrorLookup';
import { AzureMessageDisplayer } from './azureMessageDisplayer';
import { AzureLogger } from '../azure/azureLogger';
import { AzureAuthRequest } from './azureAuthRequest';
import { SimpleTokenCache } from './cacheService';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { CredentialStore } from '../credentialstore/credentialstore';
import { StorageService } from './storageService';
import * as utils from '../models/utils';
import { IAccount } from 'vscode-mssql';
import { AADResource, AzureAuthType, AzureCodeGrant, AzureDeviceCode, Token } from '@microsoft/ads-adal-library';
import { ConnectionProfile } from '../models/connectionProfile';
import { AccountStore } from './accountStore';
import providerSettings from '../azure/providerSettings';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { QuestionTypes, IQuestion, IPrompter, INameValueChoice } from '../prompts/question';
import { Tenant } from '@microsoft/ads-adal-library';
import { AzureAccount } from '../../lib/ads-adal-library/src';
import { Subscription } from '@azure/arm-subscriptions';
import * as mssql from 'vscode-mssql';
import * as azureUtils from './utils';

function getAppDataPath(): string {
	let platform = process.platform;
	switch (platform) {
		case 'win32': return process.env['APPDATA'] || path.join(process.env['USERPROFILE'], 'AppData', 'Roaming');
		case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support');
		case 'linux': return process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
		default: throw new Error('Platform not supported');
	}
}

function getDefaultLogLocation(): string {
	return path.join(getAppDataPath(), 'vscode-mssql');
}

async function findOrMakeStoragePath(): Promise<string | undefined> {
	let defaultLogLocation = getDefaultLogLocation();
	let storagePath = path.join(defaultLogLocation, 'AAD');

	try {
		await fs.mkdir(defaultLogLocation, { recursive: true });
	} catch (e) {
		if (e.code !== 'EEXIST') {
			console.log(`Creating the base directory failed... ${e}`);
			return undefined;
		}
	}

	try {
		await fs.mkdir(storagePath, { recursive: true });
	} catch (e) {
		if (e.code !== 'EEXIST') {
			console.error(`Initialization of vscode-mssql storage failed: ${e}`);
			console.error('Azure accounts will not be available');
			return undefined;
		}
	}

	console.log('Initialized vscode-mssql storage.');
	return storagePath;
}

export class AzureController {

	private authRequest: AzureAuthRequest;
	private azureStringLookup: AzureStringLookup;
	private azureUserInteraction: AzureUserInteraction;
	private azureErrorLookup: AzureErrorLookup;
	private azureMessageDisplayer: AzureMessageDisplayer;
	private cacheService: SimpleTokenCache;
	private storageService: StorageService;
	private context: vscode.ExtensionContext;
	private logger: AzureLogger;
	private prompter: IPrompter;
	private _vscodeWrapper: VscodeWrapper;
	private credentialStoreInitialized = false;

	constructor(
		context: vscode.ExtensionContext,
		prompter: IPrompter,
		logger?: AzureLogger,
		private _subscriptionClientFactory: azureUtils.SubscriptionClientFactory = azureUtils.defaultSubscriptionClientFactory) {
		this.context = context;
		this.prompter = prompter;
		if (!this.logger) {
			this.logger = new AzureLogger();
		}
		if (!this._vscodeWrapper) {
			this._vscodeWrapper = new VscodeWrapper();
		}
	}
	public async init(): Promise<void> {
		this.authRequest = new AzureAuthRequest(this.context, this.logger);
		await this.authRequest.startServer();
		this.azureStringLookup = new AzureStringLookup();
		this.azureUserInteraction = new AzureUserInteraction(this.authRequest.getState());
		this.azureErrorLookup = new AzureErrorLookup();
		this.azureMessageDisplayer = new AzureMessageDisplayer();
	}

	private async promptForTenantChoice(account: AzureAccount, profile: ConnectionProfile): Promise<void> {
		let tenantChoices: INameValueChoice[] = account.properties.tenants?.map(t => ({ name: t.displayName, value: t }));
		if (tenantChoices && tenantChoices.length === 1) {
			profile.tenantId = tenantChoices[0].value.id;
			return;
		}
		let tenantQuestion: IQuestion = {
			type: QuestionTypes.expand,
			name: LocalizedConstants.tenant,
			message: LocalizedConstants.azureChooseTenant,
			choices: tenantChoices,
			shouldPrompt: (answers) => profile.isAzureActiveDirectory() && tenantChoices.length > 1,
			onAnswered: (value: Tenant) => {
				profile.tenantId = value.id;
			}
		};
		await this.prompter.promptSingle(tenantQuestion, true);
	}

	public async addAccount(accountStore: AccountStore): Promise<IAccount> {
		let account: IAccount;
		let config = vscode.workspace.getConfiguration('mssql').get('azureActiveDirectory');
		if (config === utils.azureAuthTypeToString(AzureAuthType.AuthCodeGrant)) {
			let azureCodeGrant = await this.createAuthCodeGrant();
			account = await azureCodeGrant.startLogin();
			await accountStore.addAccount(account);
		} else if (config === utils.azureAuthTypeToString(AzureAuthType.DeviceCode)) {
			let azureDeviceCode = await this.createDeviceCode();
			account = await azureDeviceCode.startLogin();
			await accountStore.addAccount(account);
		}

		return account;
	}

	public async getAccountSecurityToken(account: IAccount, tenantId: string | undefined, settings: AADResource): Promise<Token> {
		let token: Token;
		let config = vscode.workspace.getConfiguration('mssql').get('azureActiveDirectory');
		if (config === utils.azureAuthTypeToString(AzureAuthType.AuthCodeGrant)) {
			let azureCodeGrant = await this.createAuthCodeGrant();
			tenantId = tenantId ? tenantId : azureCodeGrant.getHomeTenant(account).id;
			token = await azureCodeGrant.getAccountSecurityToken(
				account, tenantId, settings
			);
		} else if (config === utils.azureAuthTypeToString(AzureAuthType.DeviceCode)) {
			let azureDeviceCode = await this.createDeviceCode();
			tenantId = tenantId ? tenantId : azureDeviceCode.getHomeTenant(account).id;
			token = await azureDeviceCode.getAccountSecurityToken(
				account, tenantId, settings
			);
		}
		return token;
	}

	/**
	 * Gets the token for given account and updates the connection profile with token information needed for AAD authentication
	 */
	public async populateAccountProperties(profile: ConnectionProfile, accountStore: AccountStore, settings: AADResource): Promise<ConnectionProfile> {
		let account = await this.addAccount(accountStore);

		if (!profile.tenantId) {
			await this.promptForTenantChoice(account, profile);
		}

		const token = await this.getAccountSecurityToken(
			account, profile.tenantId, settings
		);

		if (!token) {
			let errorMessage = LocalizedConstants.msgGetTokenFail;
			this._vscodeWrapper.showErrorMessage(errorMessage);
		} else {
			profile.azureAccountToken = token.token;
			profile.expiresOn = token.expiresOn;
			profile.email = account.displayInfo.email;
			profile.accountId = account.key.id;
		}

		return profile;
	}

	public async refreshTokenWrapper(profile, accountStore, accountAnswer, settings: AADResource): Promise<ConnectionProfile> {
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
		profile.email = account.displayInfo.email;
		profile.accountId = account.key.id;
		return profile;
	}

	public async refreshToken(account: IAccount, accountStore: AccountStore, settings: AADResource, tenantId: string = undefined): Promise<Token | undefined> {
		try {
			let token: Token;
			if (account.properties.azureAuthType === 0) {
				// Auth Code Grant
				let azureCodeGrant = await this.createAuthCodeGrant();
				let newAccount = await azureCodeGrant.refreshAccess(account);
				if (newAccount.isStale === true) {
					return undefined;
				}
				await accountStore.addAccount(newAccount);

				token = await this.getAccountSecurityToken(
					account, tenantId, settings
				);
			} else if (account.properties.azureAuthType === 1) {
				// Auth Device Code
				let azureDeviceCode = await this.createDeviceCode();
				let newAccount = await azureDeviceCode.refreshAccess(account);
				await accountStore.addAccount(newAccount);
				if (newAccount.isStale === true) {
					return undefined;
				}
				token = await this.getAccountSecurityToken(
					account, tenantId, settings
				);
			}
			return token;
		} catch (ex) {
			let errorMsg = this.azureErrorLookup.getSimpleError(ex.errorCode);
			this._vscodeWrapper.showErrorMessage(errorMsg);
		}
	}

	/**
	 * Returns Azure sessions with subscriptions, tenant and token for each given account
	 */
	public async getAccountSessions(account: IAccount): Promise<mssql.IAzureAccountSession[]> {
		let sessions: mssql.IAzureAccountSession[] = [];
		const tenants = <Tenant[]>account.properties.tenants;
		for (const tenantId of tenants.map(t => t.id)) {
			const token = await this.getAccountSecurityToken(account, tenantId, providerSettings.resources.azureManagementResource);
			const subClient = this._subscriptionClientFactory(token);
			const newSubPages = await subClient.subscriptions.list();
			const array = await azureUtils.getAllValues<Subscription, mssql.IAzureAccountSession>(newSubPages, (nextSub) => {
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

	private async createAuthCodeGrant(): Promise<AzureCodeGrant> {
		let azureLogger = new AzureLogger();
		await this.initializeCredentialStore();
		return new AzureCodeGrant(
			providerSettings, this.storageService, this.cacheService, azureLogger,
			this.azureMessageDisplayer, this.azureErrorLookup, this.azureUserInteraction,
			this.azureStringLookup, this.authRequest
		);
	}

	private async createDeviceCode(): Promise<AzureDeviceCode> {
		let azureLogger = new AzureLogger();
		await this.initializeCredentialStore();
		return new AzureDeviceCode(
			providerSettings, this.storageService, this.cacheService, azureLogger,
			this.azureMessageDisplayer, this.azureErrorLookup, this.azureUserInteraction,
			this.azureStringLookup, this.authRequest
		);
	}

	public async removeToken(account): Promise<void> {
		let azureAuth = await this.createAuthCodeGrant();
		await azureAuth.deleteAccountCache(account.key);
		return;
	}

	/**
	 * Checks if this.init() has already been called, initializes the credential store (should only be called once)
	 */
	private async initializeCredentialStore(): Promise<void> {
		if (!this.credentialStoreInitialized) {
			let storagePath = await findOrMakeStoragePath();
			let credentialStore = new CredentialStore(this.context);
			this.cacheService = new SimpleTokenCache('aad', storagePath, true, credentialStore);
			await this.cacheService.init();
			this.storageService = this.cacheService.db;
			this.credentialStoreInitialized = true;
		}
	}


	/**
	 * Verifies if the token still valid, refreshes the token for given account
	 * @param session
	 */
	public async checkAndRefreshToken(
		session: mssql.IAzureAccountSession,
		accountStore: AccountStore): Promise<void> {
		if (session.account && AzureController.isTokenInValid(session.token?.token, session.token.expiresOn)) {
			const token = await this.refreshToken(session.account, accountStore,
				providerSettings.resources.azureManagementResource);
			session.token = token;
		}
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
