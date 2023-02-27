/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SecureStorageProvider } from '@microsoft/ads-adal-library';
import { constants as fsConstants, promises as fs } from 'fs';

export class AlreadyInitializedError extends Error {
}

export class StorageService implements SecureStorageProvider {

	private db: { [key: string]: string };
	private isSaving = false;
	private isDirty = false;
	private saveInterval: NodeJS.Timer;

	constructor(
		private readonly dbPath: string
	) {
	}

	public async set(key: string, value: string): Promise<void> {
		await this.waitForFileSave();
		this.db[key] = value;
		this.isDirty = true;
	}

	public async get(key: string): Promise<string> {
		return this.db[key];
	}

	public async clear(): Promise<void> {
		await this.waitForFileSave();
		this.db = {};
		this.isDirty = true;
	}

	public async remove(key: string): Promise<boolean> {
		await this.waitForFileSave();
		delete this.db[key];
		this.isDirty = true;
		return true;
	}

	public getPrefix(keyPrefix: string): { key: string, value: string }[] {
		return Object.entries(this.db).filter(([key]) => {
			return key.startsWith(keyPrefix);
		}).map(([key, value]) => {
			return { key, value };
		});
	}

	public async deletePrefix(keyPrefix: string): Promise<void> {
		await this.waitForFileSave();
		Object.keys(this.db).forEach(s => {
			if (s.startsWith(keyPrefix)) {
				delete this.db[s];
			}
		});
		this.isDirty = true;
	}

	public async initialize(): Promise<void> {
		this.setupSaveTask();
		let fileContents: string;
		try {
			await fs.access(this.dbPath, fsConstants.R_OK);
			fileContents = await fs.readFile(this.dbPath, { encoding: 'utf-8' });
		} catch (ex) {
			console.log(`file db does not exist ${ex}`);
			await this.createFile();
			this.db = {};
			this.isDirty = true;
			return;
		}

		try {
			this.db = JSON.parse(fileContents);
		} catch (ex) {
			console.log(`DB was corrupted, resetting it ${ex}`);
			await this.createFile();
			this.db = {};
		}
	}

	private setupSaveTask(): NodeJS.Timer {
		return setInterval(() => this.save(), 20 * 1000);
	}

	public async shutdown(): Promise<void> {
		await this.waitForFileSave();
		clearInterval((this.saveInterval));
		await this.save();
	}

	public async save(): Promise<void> {
		try {
			await this.waitForFileSave();
			if (this.isDirty === false) {
				return;
			}

			this.isSaving = true;
			let contents = JSON.stringify(this.db);
			await fs.writeFile(this.dbPath, contents, { encoding: 'utf-8' });
			this.isDirty = false;
		} catch (ex) {
			console.log(`File saving is erroring! ${ex}`);
		} finally {
			this.isSaving = false;
		}
	}

	private async waitForFileSave(): Promise<void> {
		const cleanupCrew: NodeJS.Timer[] = [];

		const sleepToFail = (time: number): Promise<void> => {
			return new Promise((_, reject) => {
				const timeout = setTimeout(function (): void {
					reject(new Error('timeout'));
				}, time);
				cleanupCrew.push(timeout);
			});
		};

		const poll = (func: () => boolean): Promise<void> => {
			return new Promise(resolve => {
				const interval = setInterval(() => {
					if (func() === true) {
						resolve();
					}
				}, 100);
				cleanupCrew.push(interval);
			});
		};

		if (this.isSaving) {
			const timeout = sleepToFail(5 * 1000);
			const check = poll(() => !this.isSaving);

			try {
				return await Promise.race([timeout, check]);
			} catch (ex) {
				throw new Error('Save timed out');
			} finally {
				cleanupCrew.forEach(clearInterval);
			}
		}
	}
	private async createFile(): Promise<void> {
		return fs.writeFile(this.dbPath, '', { encoding: 'utf8' });
	}
}
