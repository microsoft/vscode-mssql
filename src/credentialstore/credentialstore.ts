/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import * as vscode from 'vscode';
import * as Contracts from '../models/contracts';
import { ICredentialStore } from './icredentialstore';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { useNativeCredentials } from '../models/utils';

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 *
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {

    private _useNativeCreds: boolean = false;

    constructor(
        private _context: vscode.ExtensionContext,
        private _client?: SqlToolsServerClient
    ) {
        if (!this._client) {
            this._client = SqlToolsServerClient.instance;
        }
        this._useNativeCreds = useNativeCredentials();
    }

    // Private credential store helpers (Uses native secret store)
    // if the setting is set

    private async nativeReadCredential(credentialId: string, cred: Contracts.Credential): Promise<Contracts.Credential> {
        try {
            const savedPassword: string = await this._context.secrets.get(credentialId);
            cred.password = savedPassword;
            return cred;
        } catch (err) {
            throw(err);
        }
    }

    private async nativeSaveCredential(credentialId: string, password: any): Promise<boolean> {
        try {
            await this._context.secrets.store(credentialId, password);
            const savedPassword = await this._context.secrets.get(credentialId);
            if (savedPassword === password) {
                return true;
            }
            return false;
        } catch (err) {
            throw(err);
        }
    }

    private async nativeDeleteCredential(credentialId: string): Promise<boolean> {
        try {
            await this._context.secrets.delete(credentialId);
            const savedPassword = await this._context.secrets.get(credentialId);
            if (!savedPassword) {
                return true;
            }
            return false;
        } catch (err) {
            throw(err);
        }
    }

    /**
     * Gets a credential saved in the credential store
     *
     * @param {string} credentialId the ID uniquely identifying this credential
     * @returns {Promise<Credential>} Promise that resolved to the credential, or undefined if not found
     */
    public async readCredential(credentialId: string): Promise<Contracts.Credential> {
        const cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        try {
            let returnedCred: Contracts.Credential;

            // Use native credential if the setting is on
            if (this._useNativeCreds) {
                returnedCred = await this.nativeReadCredential(credentialId, cred);
            } else {
                returnedCred = await this._client.sendRequest(Contracts.ReadCredentialRequest.type, cred);
            }
            return returnedCred;
        } catch (err) {
            throw(err);
        }

    }

    /**
     * Saves a credential in the credential store
     *
     * @param credentialId the ID uniquely identifying this credential
     * @param password the password that needs to be saved with the credential
     */
    public async saveCredential(credentialId: string, password: any): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        cred.password = password;
        try {
            let success: boolean;
            // Use native credential if the setting is on
            if (this._useNativeCreds) {
                success = await this.nativeSaveCredential(credentialId, cred);
            } else {
                success = await this._client.sendRequest(Contracts.SaveCredentialRequest.type, cred);
            }
            return success;
        } catch (err) {
            throw(err);
        }
    }

    /**
     * Removes a credential from the credential store
     * @param credentialId the ID uniquely identifying this credential
     */
    public async deleteCredential(credentialId: string): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        try {
            let success: boolean;
            // Use native credential if the setting is on
            if (this._useNativeCreds) {
                success = await this.nativeDeleteCredential(credentialId);
            } else {
                success = await this._client.sendRequest(Contracts.DeleteCredentialRequest.type, cred);
            }
            return success;
        } catch (err) {
            throw(err);
        }
    }
}
