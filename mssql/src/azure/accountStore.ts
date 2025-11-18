/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import { IAccount } from "../models/contracts/azure";
import { Logger } from "../models/logger";
import { Deferred } from "../protocol";
import { getErrorMessage } from "../utils/utils";
import VscodeWrapper from "../controllers/vscodeWrapper";

export class AccountStore {
    public readonly initialized: Deferred<void> = new Deferred<void>();
    private readonly _logger: Logger;

    constructor(
        private _context: vscode.ExtensionContext,
        private _vscodeWrapper: VscodeWrapper,
    ) {
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "AccountStore");

        void this.initialize().then(() => {
            this.initialized.resolve();
        });
    }

    private async initialize(): Promise<void> {
        await this.pruneInvalidAccounts();
    }

    /**
     * Gets all saved Entra accounts from the global state
     */
    public async getAccounts(): Promise<IAccount[]> {
        await this.initialized;
        let accounts =
            this._context.globalState.get<IAccount[]>(Constants.configAzureAccount) ?? [];

        this._logger.info(`Retrieved ${accounts.length} Entra accounts from account store.`);
        return accounts;
    }

    /**
     * Gets a specific Entra account from the global state cache
     * @param key Account key to look up by.  Recommended to be `IAccount.key.id`
     */
    public async getAccount(key: string): Promise<IAccount | undefined> {
        await this.initialized;

        let account: IAccount | undefined;
        let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
        if (!configValues) {
            throw new Error("No Entra accounts stored");
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

    /**
     * Removes a specific Entra account from the global state cache
     * @param key Account key to look up by.  Recommended to be `IAccount.key.id`
     */
    public async removeAccount(key: string): Promise<void> {
        if (!key) {
            this._logger.error("Key must be specified for Entra account removal");
        }

        await this.initialized;

        let configValues = await this.getAccounts();
        configValues = configValues.filter((val) => val.key.id !== key);
        await this._context.globalState.update(Constants.configAzureAccount, configValues);
        return;
    }

    /**
     * Adds an Entra account to the account store.
     * @returns a boolean indicating if the account was successfully added
     */
    public async addAccount(account: IAccount): Promise<boolean> {
        if (!account) {
            this._logger.error("Empty Entra Account cannot be added to account store.");
            return false;
        }

        if (!this.isValidAccount(account)) {
            this._logger.error(
                `Attemped to add incomplete Entra account: ${JSON.stringify(account)}`,
            );
            return false;
        }

        await this.initialized;

        let configValues = await this.getAccounts();

        // remove account if already present in store
        if (configValues.length > 0) {
            configValues = configValues.filter((val) => val.key.id !== account.key.id);
        }

        configValues.unshift(account);
        await this._context.globalState.update(Constants.configAzureAccount, configValues);

        return true;
    }

    /**
     * Removes all Entra accounts that are incomplete because they are missing either a key ID or a display information
     */
    public async pruneInvalidAccounts(): Promise<void> {
        // Because this runs during initialization and the public CRUD calls check for initialization,
        // this method must work directly with the globalState API.

        let accounts =
            this._context.globalState.get<IAccount[]>(Constants.configAzureAccount) ?? [];
        let numRemoved = 0;

        accounts = accounts.filter((val) => {
            try {
                if (this.isValidAccount(val)) {
                    return true;
                } else {
                    numRemoved++;
                    this._logger.info(
                        `Unexpected incomplete Entra account; missing either key ID or display info. Removing account from account store: ${JSON.stringify(val)}`,
                    );
                    return false;
                }
            } catch (err) {
                numRemoved++;
                this._logger.info(
                    `Unexpected incomplete Entra account; removing account from account store.${os.EOL}Error:${os.EOL}${getErrorMessage(err)}${os.EOL + os.EOL}Account:${os.EOL}${JSON.stringify(val)}`,
                );
                return false;
            }
        });

        if (numRemoved > 0) {
            await this._context.globalState.update(Constants.configAzureAccount, accounts);
            this._vscodeWrapper.showInformationMessage(
                Loc.Accounts.invalidEntraAccountsRemoved(numRemoved),
            );
        }

        return;
    }

    /**
     * Removes all saved Entra auth accounts
     */
    public async clearAccounts(): Promise<void> {
        let configValues = [];
        await this._context.globalState.update(Constants.configAzureAccount, configValues);
        this._logger.info("Cleared all saved Entra accounts");
    }

    private isValidAccount(account: IAccount): boolean {
        return account.key?.id !== undefined && account.displayInfo?.displayName !== undefined;
    }
}
