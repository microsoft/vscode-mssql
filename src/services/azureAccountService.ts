/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as mssql from 'vscode-mssql';
import { AccountStore } from '../azure/accountStore';
import { AzureController } from '../azure/azureController';
import providerSettings from '../azure/providerSettings';

export class AzureAccountService implements mssql.IAzureAccountService {

	constructor(
		private _azureController: AzureController,
		private _accountStore: AccountStore) {
	}

	public async addAccount(): Promise<mssql.IAccount> {
		return await this._azureController.addAccount(this._accountStore);
	}

	public async getAccounts(): Promise<mssql.IAccount[]> {
		return await this._accountStore.getAccounts();
	}

	public async getAccountSecurityToken(account: mssql.IAccount, tenantId: string | undefined): Promise<mssql.Token> {
		return await this._azureController.getAccountSecurityToken(account, tenantId, providerSettings.resources.azureManagementResource);
	}

	/**
	 * Returns Azure sessions with subscription, tenant and token for each given account
	 */
	public async getAccountSessions(account: mssql.IAccount): Promise<mssql.IAzureAccountSession[]> {
		return await this._azureController.getAccountSessions(account);
	}
}
