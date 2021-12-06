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
import { IConnectionProfile } from '../models/interfaces';

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
        this._context.globalState.update(Utils.configPasswordsMigrated, false);
        this._passwordsMigrated = this._context.globalState.get(Utils.configPasswordsMigrated);
        this._useNativeCredentials = Utils.useNativeCredentials();
    }

    /**
     * Initializes the credential store by migrating any old passwords
     * to the native secret store if the native credential setting is set
     */
    public async initialize(): Promise<void> {
        if (this._useNativeCredentials && !this._passwordsMigrated) {
            await this.migratePasswords();
            this._passwordsMigrated = true;
            this._context.globalState.update(Utils.configPasswordsMigrated, this._passwordsMigrated);
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
        // Use native credential if the setting is on
        if (this._useNativeCredentials) {
            return this.nativeReadCredential(credentialId, cred);
        } else {
            return this._client.sendRequest(Contracts.ReadCredentialRequest.type, cred);
        }
    }


    /**
     * Saves a credential in the credential store
     *
     * @param credentialId the ID uniquely identifying this credential
     * @param password the password that needs to be saved with the credential
     */
    public async saveCredential(credentialId: string, password: string): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        cred.password = password;
        // Use native credential if the setting is on
        if (this._useNativeCredentials) {
            await this.nativeSaveCredential(credentialId, cred);
            return true;
        } else {
            return this._client.sendRequest(Contracts.SaveCredentialRequest.type, cred);
        }
    }

    /**
     * Removes a credential from the credential store
     * @param credentialId the ID uniquely identifying this credential
     */
    public async deleteCredential(credentialId: string): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        // Use native credential if the setting is on
        if (this._useNativeCredentials) {
            await this.nativeDeleteCredential(credentialId);
            return true;
        } else {
            return this._client.sendRequest(Contracts.DeleteCredentialRequest.type, cred);
        }
    }

    // Native Credential implementations

    private async nativeReadCredential(credentialId: string, cred: Contracts.Credential): Promise<Contracts.Credential> {
        const savedPassword: string = await this._context.secrets.get(credentialId);
        cred.password = savedPassword;
        return cred;
    }

    private async nativeSaveCredential(credentialId: string, password: any): Promise<void> {
        await this._context.secrets.store(credentialId, password);
    }

    private async nativeDeleteCredential(credentialId: string): Promise<void> {
        await this._context.secrets.delete(credentialId);
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
            await this.migrateCredential(conn);
        }
        return Utils.removeCredentialFile();
    }


    private async migrateCredential(conn: IConnectionProfile): Promise<boolean> {
        const credentialId = ConnectionStore.formatCredentialIdForCred(conn);
        const credential = await this._client.sendRequest(Contracts.ReadCredentialRequest.type, { credentialId, password: undefined });
        if (credential.password) {
            const password = credential.password;
            // save it in secret store
            await this._secretStorage.store(credentialId, password);
            return this._client.sendRequest(Contracts.DeleteCredentialRequest.type,
                    { credentialId, password: undefined });
        } else {
            return false;
        }
    }
}
