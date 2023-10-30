/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAccountKey } from '../models/contracts/azure';
import * as Constants from '../constants/constants';
import { Logger } from '../models/logger';
import { deepClone } from '../models/utils';
import { IAccount } from 'vscode-mssql';

export class AccountStore {
	private _activeOperation?: Promise<any>;
	private readonly deprecatedProviders = ['azurePublicCloud'];

	constructor(
		private _context: vscode.ExtensionContext,
		private _logger: Logger
	) { }

	public getAccount(key: string): IAccount | undefined {
		let account: IAccount | undefined;
		let configValues = this._context.globalState.get<IAccount[]>(Constants.configAzureAccount);
		if (!configValues) {
			throw new Error('No Azure accounts stored');
		}
		for (let value of configValues) {
			// Compare account IDs considering multi-tenant account ID format with MSAL.
			if (value.key.id === key || value.key.id.startsWith(key) || key.startsWith(value.key.id)) {
				account = value;
				break;
			}
		}
		return account;
	}

	public async removeAccount(key: IAccountKey): Promise<void> {
		if (!key) {
			this._logger.error('Azure Account key not received for removal request.');
		}
		let configValues = await this.readFromMemento();
		configValues = configValues.filter(val => val.key.id !== key.id);
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
		if (account) {
			let configValues = await this.readFromMemento();
			// remove element if already present in map
			if (configValues.length > 0) {
				configValues = configValues.filter(val => val.key.id !== account.key.id);
			} else {
				configValues = [];
			}
			configValues.unshift(account);
			await this._context.globalState.update(Constants.configAzureAccount, configValues);
		} else {
			this._logger.error('Empty Azure Account cannot be added to account store.');
		}
	}

	public async clearAccounts(): Promise<void> {
		let configValues = [];
		await this._context.globalState.update(Constants.configAzureAccount, configValues);
		this._logger.verbose('Cleared all saved Azure accounts');
	}

	public async getAccountsByProvider(providerId: string): Promise<IAccount[]> {
		const accounts = await this.doOperation(async () => {
			const accounts = await this.readFromMemento();
			return accounts.filter(account => account.key.providerId === providerId);
		});
		return accounts ?? [];
	}

	public async getAllAccounts(): Promise<IAccount[]> {
		const accounts = await this.doOperation(async () => {
			await this.cleanupDeprecatedAccounts();
			return this.readFromMemento();
		});
		return accounts ?? [];
	}

	public cleanupDeprecatedAccounts(): Promise<void> {
		return this.readFromMemento()
			.then(accounts => {
				// No need to waste cycles
				if (!accounts || accounts.length === 0) {
					return Promise.resolve();
				}
				// Remove old accounts that are now deprecated
				try {
					accounts = accounts.filter(account => {
						const providerKey = account?.key?.providerId;
						// Account has no provider, remove it.
						if (providerKey === undefined) {
							return false;
						}
						// Returns true if the account isn't from a deprecated provider
						return !this.deprecatedProviders.includes(providerKey);
					});
				} catch (ex) {
					// this.logService.error(ex);
					return Promise.resolve();
				}
				return this.writeToMemento(accounts);
			});
	}

	// PRIVATE METHODS /////////////////////////////////////////////////////

	private readFromMemento(): Promise<IAccount[]> {
		// Initialize the account list if it isn't already
		let accounts = 	this._context.globalState.get<IAccount[]>(Constants.configAzureAccount) ?? [];

		if (!accounts) {
			accounts = [];
		}
		this._logger.info(`Read accounts from memento ${JSON.stringify(accounts)}`);
		// Make a deep copy of the account list to ensure that the memento list isn't obliterated
		accounts = deepClone(accounts);

		return Promise.resolve(accounts);
	}

	private writeToMemento(accounts: IAccount[]): Promise<void> {
		// Store a shallow copy of the account list to disconnect the memento list from the active list
		this._context.globalState.update(Constants.configAzureAccount, deepClone(accounts));
		return Promise.resolve();
	}

	private doOperation<T>(op: () => Promise<T>): Promise<T | undefined> {
		// Initialize the active operation to an empty promise if necessary
		let activeOperation = this._activeOperation || Promise.resolve();

		// Chain the operation to perform to the end of the existing promise
		activeOperation = activeOperation.then(op);

		// Add a catch at the end to make sure we can continue after any errors
		activeOperation = activeOperation.then(undefined, err => {
			this._logger.error(err);
		});

		// Point the current active operation to this one
		this._activeOperation = activeOperation;
		return <Promise<T>>this._activeOperation;
	}
}
