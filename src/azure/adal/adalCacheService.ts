/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CachingProvider } from '@microsoft/ads-adal-library';
import * as keytarType from 'keytar';
import { join } from 'path';
import { StorageService } from './storageService';

export type MultipleAccountsResponse = { account: string, password: string }[];

// allow-any-unicode-next-line
const separator = '§';

async function getFileKeytar(db: StorageService): Promise<Keytar | undefined> {
	const fileKeytar: Keytar = {
		async getPassword(service: string, account: string): Promise<string> {
			return db.get(`${service}${separator}${account}`);
		},

		async setPassword(service: string, account: string, password: string): Promise<void> {
			await db.set(`${service}${separator}${account}`, password);
		},

		async deletePassword(service: string, account: string): Promise<boolean> {
			await db.remove(`${service}${separator}${account}`);
			return true;
		},

		async getPasswords(service: string): Promise<MultipleAccountsResponse> {
			const result = db.getPrefix(`${service}`);
			if (!result) {
				return [];
			}

			return result.map(({ key, value }) => {
				return {
					account: key.split(separator)[1],
					password: value
				};
			});
		}
	};
	return fileKeytar;
}


export type Keytar = {
	getPassword: typeof keytarType['getPassword'];
	setPassword: typeof keytarType['setPassword'];
	deletePassword: typeof keytarType['deletePassword'];
	getPasswords: (service: string) => Promise<MultipleAccountsResponse>;
	findCredentials?: typeof keytarType['findCredentials'];
};

export class SimpleTokenCache implements CachingProvider {
	private keytar: Keytar | undefined;
	public db: StorageService;

	constructor(
		private serviceName: string,
		private readonly userStoragePath: string
	) { }

	// tslint:disable:no-empty
	async clear(): Promise<void> { }

	async init(): Promise<void> {
		this.serviceName = this.serviceName.replace(/-/g, '_');

		let filePath = join(this.userStoragePath, this.serviceName);
		this.db = new StorageService(filePath);
		await this.db.initialize();

		this.keytar = await getFileKeytar(this.db);
	}

	async set(id: string, key: string): Promise<void> {
		if (id.includes(separator)) {
			throw new Error('Separator included in ID');
		}

		try {
			const keytar = this.getKeytar();
			return await keytar.setPassword(this.serviceName, id, key);
		} catch (ex) {
			console.warn(`Adding key failed: ${ex}`);
		}
	}

	async get(id: string): Promise<string | undefined> {
		try {
			const keytar = this.getKeytar();
			const result = await keytar.getPassword(this.serviceName, id);

			if (result === null) {
				return undefined;
			}

			return result;
		} catch (ex) {
			console.warn(`Getting key failed: ${ex}`);
			return undefined;
		}
	}

	async remove(id: string): Promise<boolean> {
		try {
			const keytar = this.getKeytar();
			return await keytar.deletePassword(this.serviceName, id);
		} catch (ex) {
			console.warn(`Clearing key failed: ${ex}`);
			return false;
		}
	}

	async findCredentials(prefix: string): Promise<{ account: string, password: string }[]> {
		try {
			const keytar = this.getKeytar();
			return await keytar.getPasswords(`${this.serviceName}${separator}${prefix}`);
		} catch (ex) {
			console.warn(`Finding credentials failed: ${ex}`);
			return [];
		}
	}

	private getKeytar(): Keytar {
		if (!this.keytar) {
			throw new Error('Keytar not initialized');
		}
		return this.keytar;
	}
}
