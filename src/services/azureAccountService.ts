/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureAccountService, IAzureAccountSession } from "vscode-mssql";
import { AccountStore } from "../azure/accountStore";
import { AzureController } from "../azure/azureController";
import providerSettings from "../azure/providerSettings";
import { IAccount, IToken } from "../models/contracts/azure";

export class AzureAccountService implements IAzureAccountService {
    constructor(
        private _azureController: AzureController,
        private _accountStore: AccountStore,
    ) {}

    public async addAccount(): Promise<IAccount> {
        return await this._azureController.addAccount(this._accountStore);
    }

    public async getAccounts(): Promise<IAccount[]> {
        return await this._accountStore.getAccounts();
    }

    public async getAccountSecurityToken(
        account: IAccount,
        tenantId: string | undefined,
    ): Promise<IToken> {
        return await this._azureController.getAccountSecurityToken(
            account,
            tenantId,
            providerSettings.resources.azureManagementResource,
        );
    }

    /**
     * Returns Azure sessions with subscription, tenant and token for each given account
     */
    public async getAccountSessions(account: IAccount): Promise<IAzureAccountSession[]> {
        return await this._azureController.getAccountSessions(account);
    }
}
