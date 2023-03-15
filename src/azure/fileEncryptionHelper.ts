/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import { ICredentialStore } from '../credentialstore/icredentialstore';
import { AuthLibrary } from '../models/contracts/azure';
import { Logger } from '../models/logger';

export abstract class FileEncryptionHelper {
	constructor(
		private readonly _credentialStore: ICredentialStore,
		private readonly _logger: Logger,
		protected readonly _fileName: string
	) { }

	protected _authLibrary!: AuthLibrary;

	public abstract fileOpener(content: string): Promise<string>;

	public abstract fileSaver(content: string): Promise<string>;

	public abstract init(): Promise<void>;

	protected async readEncryptionKey(credentialId: string): Promise<string | undefined> {
		return (await this._credentialStore.readCredential(credentialId))?.password;
	}

	protected async saveEncryptionKey(credentialId: string, password: string): Promise<void> {
		try {
			await this._credentialStore.saveCredential(credentialId, password)
				.then((result) => {
					this._logger.log(`SaveCredential '${credentialId}' result: ${result}`);
				}, (e => {
					throw Error(`FileEncryptionHelper: Could not save encryption key: ${credentialId}: ${e}`);
				}));
			this._logger.info(`FileEncryptionHelper: Successfully saved encryption key ${credentialId} for ${this._authLibrary} persistent cache encryption in system credential store.`);
		} catch (ex) {
			if (os.platform() === 'win32') {
				this._logger.error(`FileEncryptionHelper: Please try cleaning saved credentials from Windows Credential Manager created by Azure Data Studio to allow creating new credentials.`);
			}
			this._logger.error(ex);
			throw ex;
		}
	}
}
