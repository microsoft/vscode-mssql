/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CachingProvider } from '@microsoft/ads-adal-library';
import * as keytarType from 'keytar';
import { join, parse } from 'path';
import { CredentialStore } from '../../credentialstore/credentialstore';
import { FileEncryptionHelper } from './fileEncryptionHelper';
import { StorageService } from './storageService';

function getSystemKeytar(): Keytar | undefined {
	try {
		return require('keytar');
	} catch (err) {
		console.warn(err);
	}

	return undefined;
}

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
		private readonly userStoragePath: string,
		private readonly forceFileStorage: boolean = false,
		private readonly credentialStore: CredentialStore,
	) { }

	async clear(): Promise<void> { }

	async init(): Promise<void> {
		this.serviceName = this.serviceName.replace(/-/g, '_');
		let keytar: Keytar | undefined;
		if (this.forceFileStorage === false) {
			keytar = getSystemKeytar();
			// Add new method to keytar
			if (keytar) {
				keytar.getPasswords = async (service: string): Promise<MultipleAccountsResponse> => {
					const [serviceName, accountPrefix] = service.split(separator);
					if (serviceName === undefined || accountPrefix === undefined) {
						throw new Error('Service did not have separator: ' + service);
					}
					const results = await keytar!.findCredentials!(serviceName);
					return results.filter(({ account }) => {
						return account.startsWith(accountPrefix);
					});
				};
			}
		} else {
			let filePath = join(this.userStoragePath, this.serviceName);
			const fileName = parse(filePath).base;
			const fileEncryptionHelper: FileEncryptionHelper = new FileEncryptionHelper(this.credentialStore, fileName);
			this.db = new StorageService(filePath, fileEncryptionHelper.fileOpener, fileEncryptionHelper.fileSaver);
			await this.db.initialize();
			keytar = await getFileKeytar(this.db);
		}

		this.keytar = keytar;
	}

	async set(id: string, key: string): Promise<void> {
		if (!this.forceFileStorage && key.length > 2500) { // Windows limitation
			throw new Error('Key length is longer than 2500 chars');
		}

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