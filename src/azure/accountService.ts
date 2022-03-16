/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { IAccount, IAccountKey } from 'vscode-mssql';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import { IAzureSession } from '../models/interfaces';
import * as Constants from '../constants/constants';
import { AzureController } from './azureController';
import { AccountStore } from './accountStore';
import providerSettings from '../azure/providerSettings';
import { Tenant, Token } from '@microsoft/ads-adal-library';

export class AccountService {

	private _account: IAccount = undefined;
	private _isStale: boolean;
	protected readonly commonTenant: Tenant = {
		id: 'common',
		displayName: 'common'
	};

	constructor(
		private _client: SqlToolsServiceClient,
		private _accountStore: AccountStore,
		private _azureController: AzureController
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

	public convertToAzureAccount(azureSession: IAzureSession): IAccount {
		let tenant = {
			displayName: Constants.tenantDisplayName,
			id: azureSession.tenantId,
			userId: azureSession.userId
		};
		let key: IAccountKey = {
			providerId: Constants.resourceProviderId,
			id: azureSession.userId
		};
		let account: IAccount = {
			key: key,
			displayInfo: {
				userId: azureSession.userId,
				displayName: undefined,
				accountType: undefined,
				name: undefined
			},
			properties: {
				tenants: [tenant]
			},
			isStale: this._isStale,
			isSignedIn: false
		};
		return account;
	}

	public async createSecurityTokenMapping(): Promise<any> {
		// TODO: match type for mapping in mssql and sqltoolsservice
		let mapping = {};
		mapping[this.getHomeTenant(this.account).id] = {
			token: (await this.refreshToken(this.account)).token
		};
		return mapping;
	}

	public async refreshToken(account): Promise<Token> {
		return await this._azureController.refreshToken(account, this._accountStore, providerSettings.resources.azureManagementResource);
	}

	public getHomeTenant(account: IAccount): Tenant {
		// Home is defined by the API
		// Lets pick the home tenant - and fall back to commonTenant if they don't exist
		return account.properties.tenants.find(t => t.tenantCategory === 'Home') ?? account.properties.tenants[0] ?? this.commonTenant;
	}


}
