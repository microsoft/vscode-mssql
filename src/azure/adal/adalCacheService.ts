/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CachingProvider } from '@microsoft/ads-adal-library';
import * as keytarType from 'keytar';
import { join } from 'path';
import VscodeWrapper from '../../controllers/vscodeWrapper';
import { ICredentialStore } from '../../credentialstore/icredentialstore';
import { AuthLibrary } from '../../models/contracts/azure';
import { Logger } from '../../models/logger';
import { FileEncryptionHelper } from '../fileEncryptionHelper';
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
			return await db.remove(`${service}${separator}${account}`);
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
		private _serviceName: string,
		private readonly _credentialStore: ICredentialStore,
		private readonly _vscodeWrapper: VscodeWrapper,
		private readonly _logger: Logger,
		private readonly _userStoragePath: string
	) { }

	// tslint:disable:no-empty
	async clear(): Promise<void> { }

	async init(): Promise<void> {
		this._serviceName = this._serviceName.replace(/-/g, '_');

		let filePath = join(this._userStoragePath, this._serviceName);
		let fileEncryptionHelper = new FileEncryptionHelper(AuthLibrary.ADAL, this._credentialStore, this._vscodeWrapper, this._logger, this._serviceName);
		this.db = new StorageService(filePath, this._logger, fileEncryptionHelper.fileOpener, fileEncryptionHelper.fileSaver);
		await this.db.initialize();

		this.keytar = await getFileKeytar(this.db);
	}

	async set(id: string, key: string): Promise<void> {
		if (id.includes(separator)) {
			throw new Error('Separator included in ID');
		}

		try {
			const keytar = this.getKeytar();
			return await keytar.setPassword(this._serviceName, id, key);
		} catch (ex) {
			console.warn(`Adding key failed: ${ex}`);
		}
	}

	async get(id: string): Promise<string | undefined> {
		try {
			const keytar = this.getKeytar();
			const result = await keytar.getPassword(this._serviceName, id);

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
			return await keytar.deletePassword(this._serviceName, id);
		} catch (ex) {
			console.warn(`Clearing key failed: ${ex}`);
			return false;
		}
	}

	async findCredentials(prefix: string): Promise<{ account: string, password: string }[]> {
		try {
			const keytar = this.getKeytar();
			return await keytar.getPasswords(`${this._serviceName}${separator}${prefix}`);
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
