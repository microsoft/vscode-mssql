/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { ICredentialStore } from '../credentialstore/icredentialstore';
import { AuthLibrary } from '../models/contracts/azure';
import { DidChangeEncryptionIVKeyParams, EncryptionKeysChangedNotification } from '../models/contracts/connection';
import { Logger } from '../models/logger';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { azureAccountProviderCredentials } from './constants';
import { getEnableSqlAuthenticationProviderConfig } from './utils';

export class FileEncryptionHelper {
	constructor(
		private readonly _authLibrary: AuthLibrary,
		private readonly _credentialStore: ICredentialStore,
		private readonly _vscodeWrapper: VscodeWrapper,
		protected readonly _logger: Logger,
		protected readonly _fileName: string
	) {
		this._algorithm = this._authLibrary === AuthLibrary.MSAL ? 'aes-256-cbc' : 'aes-256-gcm';
		this._bufferEncoding = this._authLibrary === AuthLibrary.MSAL ? 'utf16le' : 'hex';
		this._binaryEncoding = this._authLibrary === AuthLibrary.MSAL ? 'base64' : 'hex';
	}

	private _algorithm: string;
	private _bufferEncoding: BufferEncoding;
	private _binaryEncoding: crypto.BinaryToTextEncoding;
	private _ivBuffer: Buffer | undefined;
	private _keyBuffer: Buffer | undefined;

	public async init(): Promise<void> {

		const ivCredId = `${this._fileName}-iv`;
		const keyCredId = `${this._fileName}-key`;

		const iv = await this.readEncryptionKey(ivCredId);
		const key = await this.readEncryptionKey(keyCredId);

		if (!iv || !key) {
			this._ivBuffer = crypto.randomBytes(16);
			this._keyBuffer = crypto.randomBytes(32);

			if (!await this.saveEncryptionKey(ivCredId, this._ivBuffer.toString(this._bufferEncoding))
				|| !await this.saveEncryptionKey(keyCredId, this._keyBuffer.toString(this._bufferEncoding))) {
				this._logger.error(`Encryption keys could not be saved in credential store, this will cause access token persistence issues.`);
				await this.showCredSaveErrorOnWindows();
			}
		} else {
			this._ivBuffer = Buffer.from(iv, this._bufferEncoding);
			this._keyBuffer = Buffer.from(key, this._bufferEncoding);
		}

		if (this._authLibrary === AuthLibrary.MSAL && getEnableSqlAuthenticationProviderConfig()) {
			SqlToolsServerClient.instance.sendNotification(EncryptionKeysChangedNotification.type,
				<DidChangeEncryptionIVKeyParams>{
					iv: this._ivBuffer.toString(this._bufferEncoding),
					key: this._keyBuffer.toString(this._bufferEncoding)
				});
		}
	}

	fileSaver = async (content: string): Promise<string> => {
		if (!this._keyBuffer || !this._ivBuffer) {
			await this.init();
		}
		const cipherIv = crypto.createCipheriv(this._algorithm, this._keyBuffer!, this._ivBuffer!);
		let cipherText = `${cipherIv.update(content, 'utf8', this._binaryEncoding)}${cipherIv.final(this._binaryEncoding)}`;
		if (this._authLibrary === AuthLibrary.ADAL) {
			cipherText += `%${(cipherIv as crypto.CipherGCM).getAuthTag().toString(this._binaryEncoding)}`;
		}
		return cipherText;
	}

	fileOpener = async (content: string): Promise<string> => {
		if (!this._keyBuffer || !this._ivBuffer) {
			await this.init();
		}
		let encryptedText = content;
		const decipherIv = crypto.createDecipheriv(this._algorithm, this._keyBuffer!, this._ivBuffer!);
		if (this._authLibrary === AuthLibrary.ADAL) {
			const split = content.split('%');
			if (split.length !== 2) {
				throw new Error('File didn\'t contain the auth tag.');
			}
			(decipherIv as crypto.DecipherGCM).setAuthTag(Buffer.from(split[1], this._binaryEncoding));
			encryptedText = split[0];
		}
		return `${decipherIv.update(encryptedText, this._binaryEncoding, 'utf8')}${decipherIv.final('utf8')}`;
	}

	/**
	 * Creates credential Id similar to ADS to prevent creating multiple credentials
	 * and this will also be read by STS in same pattern.
	 * @param credentialId Credential Id
	 * @returns Prefix credential Id.
	 */
	private getPrefixedCredentialId(credentialId: string): string {
		return `${azureAccountProviderCredentials}|${credentialId}`;
	}

	private async readEncryptionKey(credentialId: string): Promise<string | undefined> {
		return (await this._credentialStore.readCredential(this.getPrefixedCredentialId(credentialId)))?.password;
	}

	private async saveEncryptionKey(credentialId: string, password: string): Promise<boolean> {
		let status: boolean = false;
		let prefixedCredentialId = this.getPrefixedCredentialId(credentialId);
		try {
			await this._credentialStore.saveCredential(prefixedCredentialId, password)
				.then((result) => {
					status = result;
					if (result) {
						this._logger.info(`FileEncryptionHelper: Successfully saved encryption key ${prefixedCredentialId} for ${this._authLibrary} persistent cache encryption in system credential store.`);
					}
				}, (e => {
					throw Error(`FileEncryptionHelper: Could not save encryption key: ${prefixedCredentialId}: ${e}`);
				}));
		} catch (ex) {
			if (os.platform() === 'win32') {
				this._logger.error(`FileEncryptionHelper: Please try cleaning saved credentials from Windows Credential Manager created by Azure Data Studio to allow creating new credentials.`);
			}
			this._logger.error(ex);
			throw ex;
		}
		return status;
	}

	private async showCredSaveErrorOnWindows(): Promise<void> {
		if (os.platform() === 'win32') {
			await this._vscodeWrapper.showWarningMessageAdvanced(LocalizedConstants.msgAzureCredStoreSaveFailedError, undefined,
				[LocalizedConstants.reloadChoice, LocalizedConstants.cancel])
				.then(async (selection) => {
					if (selection === LocalizedConstants.reloadChoice) {
						await vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				}, error => {
					this._logger.error(error);
				});
		}
	}
}
