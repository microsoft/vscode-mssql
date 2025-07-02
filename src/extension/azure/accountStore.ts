/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IAccount } from "../models/contracts/azure";
import * as Constants from "../constants/constants";
import { Logger } from "../models/logger";

export class AccountStore {
    constructor(
        private _context: vscode.ExtensionContext,
        private _logger: Logger,
    ) {}

    public getAccounts(): IAccount[] {
        let configValues =
            this._context.globalState.get<IAccount[]>(Constants.configAzureAccount) ?? [];
        this._logger.verbose(
            `Retreived ${configValues?.length} Azure accounts from account store.`,
        );
        return configValues;
    }

    public getAccount(key: string): IAccount | undefined {
        let account: IAccount | undefined;
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
        if (!configValues) {
            throw new Error("No Azure accounts stored");
        }
        for (let value of configValues) {
            // Compare account IDs considering multi-tenant account ID format with MSAL.
            if (
                value.key.id === key ||
                value.key.id.startsWith(key) ||
                key.startsWith(value.key.id)
            ) {
                account = value;
                break;
            }
        }
        return account;
    }

    public removeAccount(key: string): void {
        if (!key) {
            this._logger.error("Azure Account key not received for removal request.");
        }
        let configValues = this.getAccounts();
        configValues = configValues.filter((val) => val.key.id !== key);
        this._context.globalState.update(Constants.configAzureAccount, configValues);
        return;
    }

    /**
     * Adds an account to the account store.
     *
     * @param account the account to add
     * @returns a Promise that returns when the account was saved
     */
    public async addAccount(account: IAccount): Promise<void> {
        if (account) {
            let configValues = this.getAccounts();
            // remove element if already present in map
            if (configValues.length > 0) {
                configValues = configValues.filter((val) => val.key.id !== account.key.id);
            } else {
                configValues = [];
            }
            configValues.unshift(account);
            await this._context.globalState.update(Constants.configAzureAccount, configValues);
        } else {
            this._logger.error("Empty Azure Account cannot be added to account store.");
        }
    }

    public async pruneAccounts(): Promise<void> {
        let configValues = this.getAccounts();
        configValues = configValues.filter((val) => {
            if (val.key) {
                return true;
            } else {
                this._logger.info(
                    "Unexpected empty account key, removing account from account store.",
                );
                return false;
            }
        });
        await this._context.globalState.update(Constants.configAzureAccount, configValues);
        return;
    }

    public async clearAccounts(): Promise<void> {
        let configValues = [];
        await this._context.globalState.update(Constants.configAzureAccount, configValues);
        this._logger.verbose("Cleared all saved Azure accounts");
    }
}
