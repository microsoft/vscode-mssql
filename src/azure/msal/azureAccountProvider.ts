/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';


import { AccountInfo, PublicClientApplication } from '@azure/msal-node';
import { AzureAuthType, AzureResource, IAccountKey, IAccountProvider, IAccountProviderMetadata, IPromptFailedResult } from '../../models/contracts/azure';
import { IToken, MsalAzureAuth } from './msalAzureAuth';
import { IDeferred } from '../../models/interfaces';
import { getAzureActiveDirectoryConfig } from '../utils';
import { MsalAzureCodeGrant } from './msalAzureCodeGrant';
import { MsalAzureDeviceCode } from './msalAzureDeviceCode';
import VscodeWrapper from '../../controllers/vscodeWrapper';
import { Logger } from '../../models/logger';
import { IAccount } from 'vscode-mssql';
import * as AzureConstants from '../constants';
import * as LocalizedConstants from '../../constants/localizedConstants';

export class AzureAccountProvider implements IAccountProvider {

	private readonly authMappings = new Map<AzureAuthType, MsalAzureAuth>();
	private initComplete!: IDeferred<void, Error>;
	private initCompletePromise: Promise<void> = new Promise<void>((resolve, reject) => this.initComplete = { resolve, reject });
	public clientApplication: PublicClientApplication;
	public vscodeWrapper: VscodeWrapper;
	public logger: Logger;

	constructor(
		metadata: IAccountProviderMetadata,
		context: vscode.ExtensionContext,
		clientApplication: PublicClientApplication,
		vscodeWrapper: VscodeWrapper,
		logger: Logger
	) {
		this.clientApplication = clientApplication;
		this.vscodeWrapper = vscodeWrapper;
		this.logger = logger;

		vscode.workspace.onDidChangeConfiguration((changeEvent) => {
			const impactProvider = changeEvent.affectsConfiguration(AzureConstants.accountsAzureAuthSection);
			if (impactProvider === true) {
				this.handleAuthMapping(metadata, context);
			}
		});

		this.handleAuthMapping(metadata, context);
	}

	public async initialize(storedAccounts: IAccount[]): Promise<IAccount[]> {
		const accounts: IAccount[] = [];
		// Logger.verbose(`Initializing stored accounts ${JSON.stringify(accounts)}`);
		for (let account of storedAccounts) {
			const azureAuth = this.getAuthMethod(account);
			if (!azureAuth) {
				account.isStale = true;
				accounts.push(account);
			} else {
				account.isStale = false;
				// Check MSAL Cache before adding account, to mark it as stale if it is not present in cache
				const accountInCache = await azureAuth.getAccountFromMsalCache(account.key.id);
				if (!accountInCache) {
					account.isStale = true;
				}
				accounts.push(account);

			}
		}
		this.initComplete.resolve();
		return accounts;
	}

	private async getAzureAuthInstance(authType: AzureAuthType): Promise<MsalAzureAuth | undefined> {
		if (!this.authMappings.has(authType)) {
			throw new Error('Auth type not found');
		}
		return this.authMappings!.get(authType);
	}

	public async getAccountSecurityToken(account: IAccount, tenantId: string, settings: AzureResource): Promise<IToken | undefined> {
		let azureAuth = await this.getAzureAuthInstance(getAzureActiveDirectoryConfig());
		if (azureAuth) {
			// this.logger.piiSantized(`Getting account security token for ${JSON.stringify(account?.key)} (tenant ${tenantId}). Auth Method = ${AzureAuthType[account?.properties.azureAuthType]}`, [], []);
			tenantId = tenantId || account.properties.owningTenant.id;
			let result = await azureAuth.getToken(account, tenantId, settings);
			if (!result || !result.account || !result.account.idTokenClaims) {
				// this.logger.error(`MSAL: getToken call failed`);
				throw Error('Failed to get token');
			} else {
				const token: IToken = {
					key: result.account.homeAccountId,
					token: result.accessToken,
					tokenType: result.tokenType,
					expiresOn: result.account.idTokenClaims.exp
				};
				return token;
			}
		} else {
			if (account) {
				account.isStale = true;
				this.logger.error(`_getAccountSecurityToken: Authentication method not found for account ${account.displayInfo.displayName}`);
				throw Error(LocalizedConstants.msgAuthTypeNotFound);
			} else {
				this.logger.error(`_getAccountSecurityToken: Authentication method not found as account not available.`);
				throw Error(LocalizedConstants.msgAccountNotFound);
			}
		}
	}

	public async handleAuthMapping(metadata: IAccountProviderMetadata, context: vscode.ExtensionContext): Promise<void> {

		this.authMappings.clear();

		const configuration = getAzureActiveDirectoryConfig();

		if (configuration === AzureAuthType.AuthCodeGrant) {
			this.authMappings.set(AzureAuthType.AuthCodeGrant, new MsalAzureCodeGrant(
				metadata, context, this.clientApplication, this.vscodeWrapper, this.logger));
		} else if (configuration === AzureAuthType.DeviceCode) {
			this.authMappings.set(AzureAuthType.DeviceCode, new MsalAzureDeviceCode(
				metadata, context, this.clientApplication, this.vscodeWrapper, this.logger));
		}
	}

	public async checkAccountInCache(account: IAccount): Promise<AccountInfo> {
		let azureAuth = this.getAuthMethod(account);
		return await azureAuth.getAccountFromMsalCache(account.key.id);
	}

	private getAuthMethod(account?: IAccount): MsalAzureAuth {
		if (this.authMappings.size === 1) {
			return this.authMappings.values().next().value;
		}

		const authType: AzureAuthType | undefined = account?.properties?.azureAuthType;
		if (authType) {
			const authMapping = this.authMappings.get(authType);
			if (authMapping) {
				return authMapping;
			}
		}
		return this.authMappings.values().next().value;
	}

	public async prompt(): Promise<IAccount | IPromptFailedResult> {
		const authMethod = this.getAuthMethod();
		return authMethod.startLogin();
	}

	public async refresh(account: IAccount): Promise<IAccount | IPromptFailedResult> {
		await this.clear(account.key);
		return this.prompt();
	}

	public async clear(accountKey: IAccountKey): Promise<void> {
		await this.initCompletePromise;
		await this.getAuthMethod(undefined)?.clearCredentials(accountKey);
	}

	autoOAuthCancelled(): Thenable<void> {
		this.authMappings.forEach(val => val.autoOAuthCancelled());
		return Promise.resolve();
	}
}
