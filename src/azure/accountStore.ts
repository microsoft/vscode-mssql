/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import vscode = require('vscode');
import { IAccount } from '../models/contracts/azure/accountInterfaces';
import Constants = require('../constants/constants');

export class AccountStore {
    constructor(
        private _context: vscode.ExtensionContext
    ) { }

    public getAccounts(): IAccount[] {
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount) ?? [];
        return configValues;
    }

    public getAccount(key: string): IAccount | undefined {
        let account: IAccount;
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
        if (!configValues) {
            throw new Error('no accounts stored');
        }
        for (let value of configValues) {
            if (value.key.id === key) {
                account = value;
                break;
            }
        }
        if (!account) {
            // Throw error message saying the account was not found
            return undefined;
        }
        return account;
    }

    public removeAccount(key: string): void {
        let configValues = this.getAccounts();
        configValues = configValues.filter(val => val.key.id !== key);
        this._context.globalState.update(Constants.configAzureAccount, configValues);
        return;
    }

    /**
     * Adds an account to the account store.
     *
     * @param {IAccount} account the account to add
     * @returns {Promise<void>} a Promise that returns when the account was saved
     */
    public async addAccount(account: IAccount): Promise<void> {
        let configValues = this.getAccounts();
        // remove element if already present in map
        if (configValues.length > 0) {
            configValues = configValues.filter(val => val.key.id !== account.key.id);
        } else {
            configValues = [];
        }
        configValues.unshift(account);
        await this._context.globalState.update(Constants.configAzureAccount, configValues);
    }

    public async clearAccounts(): Promise<void> {
        let configValues = [];
        await this._context.globalState.update(Constants.configAzureAccount, configValues);

    }


}
