/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import vscode = require('vscode');
import { IAccount } from '../models/contracts/azure/accountInterfaces';
import Constants = require('../constants/constants');
import Utils = require('../models/utils');


export class AccountStore {
    constructor(
        private _context: vscode.ExtensionContext
    ) { }

    public getAccounts(): IAccount[] {
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
        if (!configValues) {
            configValues = [];
        }
        return configValues;
    }

    public getAccount(key: string): IAccount {
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
        if (!configValues) {
            // Throw error message saying there are no accounts stored
        }
        for (let account of configValues) {
            if (account.key.accountId === key) {
                return account;
            }
        }
        // Throw error message saying the account was not found
        return undefined;
    }

    /**
     * Adds an account to the account store.
     * Password values are stored to a separate credential store if the "savePassword" option is true
     *
     * @param {IAccount} account the account to add
     * @returns {Promise<void>} a Promise that returns when the connection was saved
     */
    public addAccount(account: IAccount): Promise<void> {
        const self = this;
        //TODO: add check to make sure account is not already present from the current list of accounts

        return new Promise<void>((resolve, reject) => {
            let configValues = self.getAccounts();
            // Remove the account from the list if it already exists
            configValues = configValues.filter(value => !Utils.isSameAccount(<IAccount>value, <IAccount>account));
            configValues.unshift(account);
            self._context.globalState.update(Constants.configAzureAccount, configValues)
            .then(() => {
                // And resolve / reject at the end of the process
                resolve(undefined);
            }, err => {
                reject(err);
            });
        });
    }

    public async clearAccounts(): Promise<void> {
        try {
            await this._context.globalState.update(Constants.configAzureAccount, []);
        } catch (error) {
            Promise.reject(error);
        }
    }


}