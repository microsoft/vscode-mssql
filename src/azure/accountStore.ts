/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import vscode = require('vscode');
import { IAccount } from '../models/contracts/azure/accountInterfaces';
import Constants = require('../constants/constants');
import Utils = require('../models/utils');
import AzureAuth = require('@cssuh/ads-adal-library');
import { config } from 'vscode-nls';

// export interface IAccount {
//     account: IAccount;
//     azureAuth: AzureAuth;
// }
// export class AccountMapping implements IAccount {
//     account: IAccount;
//     azureAuth: AzureAuth;
//     constructor(
//         account: IAccount, azureAuth: AzureAuth
//     ) {
//         this.account = account;
//         this.azureAuth = azureAuth;
//     }
// }

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
        let account: IAccount;
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
        if (!configValues) {
            // Throw error message saying there are no accounts stored
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
        return;
    }

    /**
     * Adds an account to the account store.
     * Password values are stored to a separate credential store if the "savePassword" option is true
     *
     * @param {IAccount} account the account to add
     * @returns {Promise<void>} a Promise that returns when the connection was saved
     */
    public addAccount(account: IAccount, azureAuth: AzureAuth): Promise<void> {
        const self = this;
        //TODO: add check to make sure account is not already present from the current list of accounts

        return new Promise<void>((resolve, reject) => {
            let configValues = self.getAccounts();
            // remove element if already present in map
            if (configValues.length > 0) {
                let i = 0;
                for (let value of configValues) {
                    if (value.key.id === account.key.id) {
                        configValues.splice(i, 1);
                        break;
                    }
                    i++;
                }
            } else {
                configValues = [];
            }
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
            let configValues = [];
            await this._context.globalState.update(Constants.configAzureAccount, configValues);
        } catch (error) {
            Promise.reject(error);
        }
    }


}
