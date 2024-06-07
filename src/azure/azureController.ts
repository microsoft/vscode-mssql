/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as utils from '../models/utils';
import * as AzureConstants from './constants';
import * as azureUtils from './utils';

import { promises as fs } from 'fs';
import { IAccount } from 'vscode-mssql';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { ConnectionProfile } from '../models/connectionProfile';
import { AzureResource, ITenant, IToken } from '../models/contracts/azure';
import { Logger, LogLevel } from '../models/logger';
import { INameValueChoice, IPrompter, IQuestion, QuestionTypes } from '../prompts/question';
import { AccountStore } from './accountStore';
import { ICredentialStore } from '../credentialstore/icredentialstore';
import { AccountService } from './accountService';

export abstract class AzureController {
	protected _vscodeWrapper: VscodeWrapper;
	protected logger: Logger;
	protected _isSqlAuthProviderEnabled: boolean = false;

	constructor(
		protected context: vscode.ExtensionContext,
		protected prompter: IPrompter,
		protected _credentialStore: ICredentialStore,
		protected _accountService: AccountService,
		protected _subscriptionClientFactory: azureUtils.SubscriptionClientFactory = azureUtils.defaultSubscriptionClientFactory) {
		if (!this._vscodeWrapper) {
			this._vscodeWrapper = new VscodeWrapper();
		}

		// Setup Logger
		let logLevel: LogLevel = LogLevel[utils.getConfigTracingLevel() as keyof typeof LogLevel];
		let pii = utils.getConfigPiiLogging();
		let _channel = this._vscodeWrapper.createOutputChannel(LocalizedConstants.azureLogChannelName);
		this.logger = new Logger(text => _channel.append(text), logLevel, pii);

		// vscode.workspace.onDidChangeConfiguration((changeEvent) => {
		// 	const impactsProvider = changeEvent.affectsConfiguration(AzureConstants.accountsAzureAuthSection);
		// 	if (impactsProvider === true) {
		// 		this.handleAuthMapping();
		// 	}
		// });
	}

	public abstract init(): void;

	public abstract login(providerId: string): Promise<IAccount | undefined>;

	public abstract populateAccountProperties(profile: ConnectionProfile, accountStore: AccountStore, settings: AzureResource): Promise<ConnectionProfile>;

	public abstract refreshAccessToken(account: IAccount, accountStore: AccountStore,
		tenantId: string | undefined, settings: AzureResource): Promise<IToken | undefined>;

	public abstract isAccountInCache(account: IAccount): Promise<boolean>;

	public abstract removeAccount(account: IAccount): Promise<void>;

	public abstract clearTokenCache(): void;

	public isSqlAuthProviderEnabled(): boolean {
		return this._isSqlAuthProviderEnabled;
	}

	public async addAccount(accountStore: AccountStore, providerId: string): Promise<IAccount | undefined> {
		let account = await this.login(providerId);
		await accountStore.addAccount(account!);
		this.logger.verbose('Account added successfully.');
		return account;
	}

	public async refreshTokenWrapper(profile, accountStore, accountAnswer, settings: AzureResource): Promise<ConnectionProfile | undefined> {
		let account = accountStore.getAccount(accountAnswer.key.id);
		if (!account) {
			await this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgAccountNotFound);
			throw new Error(LocalizedConstants.msgAccountNotFound);
		}
		if (!this._isSqlAuthProviderEnabled) {
			this.logger.verbose(`Account found, refreshing access token for tenant ${profile.tenantId}`);
			let azureAccountToken = await this.refreshAccessToken(account, accountStore, profile.tenantId, settings);
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
		} else {
			this.logger.verbose('Account found and SQL Authentication Provider is enabled, access token will not be refreshed by extension.');
		}
		return profile;
	}

	/**
	 * Returns true if token is invalid or expired
	 * @param token Token
	 * @param token expiry
	 */
	public static isTokenInValid(token: string, expiresOn?: number): boolean {
		return (!token || AzureController.isTokenExpired(expiresOn));
	}

	/**
	 * Returns true if token is expired
	 * @param token expiry
	 */
	public static isTokenExpired(expiresOn?: number): boolean {
		if (!expiresOn) {
			return true;
		}
		const currentTime = Date.now() / 1000;
		const maxTolerance = 2 * 60; // two minutes
		return (expiresOn - currentTime < maxTolerance);
	}

	protected async promptForTenantChoice(account: IAccount, profile: ConnectionProfile): Promise<void> {
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
			onAnswered: (value: ITenant) => {
				profile.tenantId = value.id;
			}
		};
		await this.prompter.promptSingle(tenantQuestion, true);
	}

	// Generates storage path for Azure Account cache, e.g C:\users\<>\AppData\Roaming\Code\Azure Accounts\
	protected async findOrMakeStoragePath(): Promise<string | undefined> {
		let defaultOutputLocation = this.getDefaultOutputLocation();
		let storagePath = path.join(defaultOutputLocation, AzureConstants.azureAccountDirectory);

		try {
			await fs.mkdir(defaultOutputLocation, { recursive: true });
		} catch (e) {
			if (e.code !== 'EEXIST') {
				this.logger.error(`Creating the base directory failed... ${e}`);
				return undefined;
			}
		}

		try {
			await fs.mkdir(storagePath, { recursive: true });
		} catch (e) {
			if (e.code !== 'EEXIST') {
				this.logger.error(`Initialization of vscode-mssql storage failed: ${e}`);
				this.logger.error('Azure accounts will not be available');
				return undefined;
			}
		}

		this.logger.log('Initialized vscode-mssql storage.');
		return storagePath;
	}

	private getDefaultOutputLocation(): string {
		return path.join(azureUtils.getAppDataPath(), AzureConstants.serviceName);
	}
}
