/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';

import SqlToolsServiceClient from '../languageservice/serviceclient';
import { AccountStore } from './accountStore';
import { AzureResource, IAccountProvider, IAccountProviderMetadata, ITenant, IToken } from '../models/contracts/azure';
import { IAccount } from 'vscode-mssql';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { Iterable } from './iterator';

export class AccountService {

	public providerMap = new Map<string, IAccountProviderMetadata>();
	public _providers: { [id: string]: IAccountProviderWithMetadata } = {};

	private _account: IAccount = undefined;
	protected readonly commonTenant: ITenant = {
		id: 'common',
		displayName: 'common'
	};

	constructor(
		private _client: SqlToolsServiceClient,
		private _accountStore: AccountStore,
		private _vscodeWrapper: VscodeWrapper
	) { }

	public get account(): IAccount {
		return this._account;
	}

	public setAccount(account: IAccount): void {
		this._account = account;
	}

	public get client(): SqlToolsServiceClient {
		return this._client;
	}

	public unregisterProvider(providerMetadata: IAccountProviderMetadata): void {
		this.providerMap.delete(providerMetadata.id);
		const p = this._providers[providerMetadata.id];
		this.fireAccountListUpdate(p, false);
		// Delete this account provider
		delete this._providers[providerMetadata.id];
	}

	public async registerProvider(providerMetadata: IAccountProviderMetadata, provider: IAccountProvider): Promise<void> {
		this.providerMap.set(providerMetadata.id, providerMetadata);
		this._providers[providerMetadata.id] = {
			metadata: providerMetadata,
			provider: provider,
			accounts: []
		};

		const accounts = await this._accountStore.getAccountsByProvider(providerMetadata.id);
		const updatedAccounts = await provider.initialize(accounts);

		// Don't add the accounts that are explicitly marked to be deleted to the cache.
		this._providers[providerMetadata.id].accounts = updatedAccounts.filter(s => !s.delete);

		const writePromises = updatedAccounts.map(async (account) => {
			if (account.delete === true) {
				return this._accountStore.removeAccount(account.key);
			}
			return this._accountStore.addAccount(account);
		});
		await Promise.all(writePromises);
	}

	private fireAccountListUpdate(provider: IAccountProviderWithMetadata, sort: boolean): void {
		// Step 1) Get and sort the list
		if (sort) {
			provider.accounts.sort((a: IAccount, b: IAccount) => {
				if (a.displayInfo.displayName < b.displayInfo.displayName) {
					return -1;
				}
				if (a.displayInfo.displayName > b.displayInfo.displayName) {
					return 1;
				}
				return 0;
			});
		}
	}


	/**
	 * Creates access token mappings for user selected account and tenant.
	 * @param account User account to fetch tokens for.
	 * @param tenantId Tenant Id for which refresh token is needed
	 * @returns Security token mappings
	 */
	public async createSecurityTokenMapping(account: IAccount, tenantId: string): Promise<any> {
		// TODO: match type for mapping in mssql and sqltoolsservice
		let mapping = {};
		mapping[tenantId] = {
			token: (await this.getToken(account, tenantId)).token
		};
		return mapping;
	}

	public async promptProvider(): Promise<string | undefined> {
		const vals = Iterable.consume(this.providerMap.values())[0];

		let pickedValue: string | undefined;
		if (vals.length === 0) {
			// this.logger.error("You have no clouds enabled. Go to Settings -> Search Azure Account Configuration -> Enable at least one cloud");
		}
		if (vals.length > 1) {
			const buttons: vscode.QuickPickItem[] = vals.map(v => {
				return { label: v.displayName } as vscode.QuickPickItem;
			});

			await this._vscodeWrapper.showQuickPick(buttons, { placeHolder: 'Choose an authentication provider' }).then((picked) => {
				pickedValue = picked?.label;
			});

		} else {
			pickedValue = vals[0].displayName;
		}

		const provider = vals.filter(val => val.displayName === pickedValue)?.[0];

		if (!provider) {
		// this.logger.error("You didn't select any authentication provider. Please try again.");
		// 	return undefined;
		}
		return provider.id;
	}


	public async getToken(account: IAccount, tenantId: string): Promise<IToken> {
		return await this.findProvider(account.key.providerId)?.provider.getAccountSecurityToken(account, tenantId, AzureResource.ResourceManagement);
	}

	public getHomeTenant(account: IAccount): ITenant {
		// Home is defined by the API
		// Lets pick the home tenant - and fall back to commonTenant if they don't exist
		return account.properties.tenants.find(t => t.tenantCategory === 'Home') ?? account.properties.tenants[0] ?? this.commonTenant;
	}

	private findProvider(providerId: string): IAccountProviderWithMetadata {
		return this._providers[providerId];
	}
}

/**
 * Joins together an account provider, its metadata, and its accounts, used in the provider list
 */
export interface IAccountProviderWithMetadata {
	metadata: IAccountProviderMetadata;
	provider: IAccountProvider;
	accounts: IAccount[];
}
