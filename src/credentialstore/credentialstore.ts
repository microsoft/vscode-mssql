/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as Contracts from '../models/contracts';
import { ICredentialStore } from './icredentialstore';
import SqlToolsServerClient from '../languageservice/serviceclient';
import * as Utils from '../models/utils';
import * as Constants from '../constants/constants';
import { ConnectionStore } from '../models/connectionStore';

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 *
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {

    private _useNativeCredentials: boolean;
    private _passwordsMigrated: boolean;
    private _secretStorage: vscode.SecretStorage;

    constructor(
        private _context: vscode.ExtensionContext,
        private _client?: SqlToolsServerClient) {
        if (!this._client) {
            this._client = SqlToolsServerClient.instance;
        }
        this._secretStorage = this._context.secrets;
        this._passwordsMigrated = this._context.globalState.get(Utils.configPasswordsMigrated);
        this._useNativeCredentials = Utils.useNativeCredentials();
        if (this._useNativeCredentials && !this._passwordsMigrated) {
            this.migratePasswords().then(() => {
                this._passwordsMigrated = true;
                this._context.globalState.update(Utils.configPasswordsMigrated, this._passwordsMigrated);
            });
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
        try {
            let returnedCred: Contracts.Credential;

            // Use native credential if the setting is on
            if (this._useNativeCredentials) {
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
            if (this._useNativeCredentials) {
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
            if (this._useNativeCredentials) {
                success = await this.nativeDeleteCredential(credentialId);
            } else {
                success = await this._client.sendRequest(Contracts.DeleteCredentialRequest.type, cred);
            }
            return success;
        } catch (err) {
            throw(err);
        }
    }

    // Native Credential implementations

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
     *
     * @returns Migrates all saved credentials to the native credential system
     */
    private async migratePasswords(): Promise<void> {
        const connections = vscode.workspace.getConfiguration(Constants.extensionName).get<any[]>(Constants.connectionsArrayName);
        const savedPasswordConnections = connections.filter(conn => conn.savePassword === true);
        for (let i = 0; i < savedPasswordConnections.length; i++) {
            let conn = savedPasswordConnections[i];
            await this.cleanCredential(conn);
        }
        await Utils.removeCredentialFile();
    }


    private async cleanCredential(conn): Promise<boolean> {
        const credentialId = ConnectionStore.formatCredentialId(conn);
        const credential = await this._client.sendRequest(Contracts.ReadCredentialRequest.type, { credentialId, password: undefined });
        if (credential.password) {
            const password = credential.password;
            // save it in secret store
            await this._secretStorage.store(credentialId, password);
            // check if it's saved
            const savedPassword = await this._secretStorage.get(credentialId);
            if (savedPassword === password) {
                // delete from tools service
                const result = await this._client.sendRequest(Contracts.DeleteCredentialRequest.type,
                    { credentialId, password: undefined });
                return result;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }
}
