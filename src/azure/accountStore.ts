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

export interface IAccountMapping {
    account: IAccount;
    azureAuth: AzureAuth;
}
export class AccountMapping implements IAccountMapping {
    account: IAccount;
    azureAuth: AzureAuth;
    constructor(
        account: IAccount, azureAuth: AzureAuth
    ) {
        this.account = account;
        this.azureAuth = azureAuth;
    }
}

export class AccountStore {
    private authMappings = new Map<string, IAccountMapping>();
    constructor(
        private _context: vscode.ExtensionContext
    ) { }

    public getAccounts(): Map<string, IAccountMapping> {
        let configValues = this._context.globalState.get<Map<string, IAccountMapping>>(Constants.configAzureAccount);
        if (!configValues) {
            configValues = new Map<string, IAccountMapping>();
        }
        return configValues;
    }

    public getAccount(key: string): IAccountMapping {
        let configValues = this._context.globalState.get<Map<string, IAccountMapping>>(Constants.configAzureAccount);
        if (!configValues) {
            // Throw error message saying there are no accounts stored
        }
        for (let account of configValues) {
            if (account[0] === key) {
                return account[1];
            }
        }
        // Throw error message saying the account was not found
        return undefined;
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
            if (configValues.size > 0) {
                if (configValues.get(account.key.id)) {
                    configValues.delete(account.key.id);
                }
            } else {
                configValues = new Map<string, IAccountMapping>();
            }
            let object = new AccountMapping(account, azureAuth);
            configValues.set(account.key.id, object);
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
            let configValues = new Map<string, IAccountMapping>();
            await this._context.globalState.update(Constants.configAzureAccount, configValues);
        } catch (error) {
            Promise.reject(error);
        }
    }


}
