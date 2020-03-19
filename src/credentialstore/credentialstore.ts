/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import * as Contracts from '../models/contracts';
import { ICredentialStore } from './icredentialstore';
import SqlToolsServerClient from '../languageservice/serviceclient';

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 *
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {

    constructor(private _client?: SqlToolsServerClient) {
        if (!this._client) {
            this._client = SqlToolsServerClient.instance;
        }
    }

    /**
     * Gets a credential saved in the credential store
     *
     * @param {string} credentialId the ID uniquely identifying this credential
     * @returns {Promise<Credential>} Promise that resolved to the credential, or undefined if not found
     */
    public async readCredential(credentialId: string): Promise<Contracts.Credential> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        try {
            const returnedCred: Contracts.Credential = await this._client.sendRequest(Contracts.ReadCredentialRequest.type, cred);
            return returnedCred;
        } catch (error) {
            throw error;
        }
    }


    public async saveCredential(credentialId: string, password: any): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        cred.password = password;
        try {
            const status = this._client.sendRequest(Contracts.SaveCredentialRequest.type, cred);
            return status;
        } catch (error) {
            throw error;
        }
    }

    public async deleteCredential(credentialId: string): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        try {
            const status = await this._client.sendRequest(Contracts.DeleteCredentialRequest.type, cred);
            return status;
        } catch (error) {
            throw error;
        }
    }
}
