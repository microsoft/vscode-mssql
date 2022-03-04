/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as mssql from 'vscode-mssql';
import * as vscode from 'vscode';
import { IAccount, Token } from 'vscode-mssql';
import { AccountStore } from '../azure/accountStore';
import { AzureController } from '../azure/azureController';
import providerSettings from '../azure/providerSettings';

export class AzureAccountService implements mssql.IAccountService {

	private _accountStore:  AccountStore;
	constructor(
		private _azureController: AzureController,
		private _context: vscode.ExtensionContext) {
			this._accountStore = new AccountStore(this._context);
		 }

		public async getAccount(): Promise<IAccount> {
			return await this._azureController.getAccount(this._accountStore);
		}
		public async getAccountSecurityToken(account: IAccount, tenantId: string | undefined): Promise<Token> {
			return await this._azureController.getAccountSecurityToken(account, tenantId, providerSettings.resources.azureManagementResource);
		}


}
