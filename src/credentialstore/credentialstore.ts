/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as Contracts from '../models/contracts';
import * as Utils from '../models/utils';
import { ICredentialStore } from './icredentialstore';
import SqlToolsServerClient from '../languageservice/serviceclient';

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 *
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {

	private _secretStorage: vscode.SecretStorage;

	constructor(
		private _context: vscode.ExtensionContext,
		private _client?: SqlToolsServerClient
	) {
		if (!this._client) {
			this._client = SqlToolsServerClient.instance;
		}
		this._secretStorage = this._context.secrets;
	}

	/**
	 * Gets a credential saved in the credential store
	 *
	 * @param {string} credentialId the ID uniquely identifying this credential
	 * @returns {Promise<Credential>} Promise that resolved to the credential, or undefined if not found
	 */
	public async readCredential(credentialId: string): Promise<Contracts.Credential> {
		let self = this;
		let cred: Contracts.Credential = new Contracts.Credential();
		cred.credentialId = credentialId;
		const returnedCred = await self._client.sendRequest(Contracts.ReadCredentialRequest.type, cred);
		return returnedCred;
	}

	public async saveCredential(credentialId: string, password: any): Promise<boolean> {
		let self = this;
		let cred: Contracts.Credential = new Contracts.Credential();
		cred.credentialId = credentialId;
		cred.password = password;
		/* This is only done for linux because this is going to be
		* the default credential system for linux in a future release
		*/
		if (Utils.isLinux) {
			await this._secretStorage.store(credentialId, password);
		}
		const success = await self._client.sendRequest(Contracts.SaveCredentialRequest.type, cred);
		return success;
	}

	public async deleteCredential(credentialId: string): Promise<boolean> {
		let self = this;
		let cred: Contracts.Credential = new Contracts.Credential();
		cred.credentialId = credentialId;
		if (Utils.isLinux) {
			await this._secretStorage.delete(credentialId);
		}
		const success = await self._client.sendRequest(Contracts.DeleteCredentialRequest.type, cred);
		return success;
	}
}
