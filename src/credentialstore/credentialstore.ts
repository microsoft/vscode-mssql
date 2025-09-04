/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServerClient from "../languageservice/serviceclient";
import * as Contracts from "../models/contracts";
import * as Utils from "../models/utils";
import { ICredentialStore } from "./icredentialstore";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {
    private _secretStorage: vscode.SecretStorage;

    constructor(
        private _context: vscode.ExtensionContext,
        private _client?: SqlToolsServerClient,
    ) {
        if (!this._client) {
            this._client = SqlToolsServerClient.instance;
        }
        this._secretStorage = this._context.secrets;
    }

    /**
     * Gets a credential saved in the credential store
     * @param credentialId the ID uniquely identifying this credential
     * @returns Promise that resolved to the credential, or undefined if not found
     */
    public async readCredential(credentialId: string): Promise<Contracts.Credential> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;

        const vscodeCodeCred = await this._secretStorage.get(credentialId);

        if (Utils.isLinux) {
            cred.password = vscodeCodeCred;
            return cred;
        }

        const stsCred = await this._client!.sendRequest(Contracts.ReadCredentialRequest.type, cred);

        // Migrate credentials from sts to vscode secret storage
        if (vscodeCodeCred === undefined && stsCred.password) {
            sendActionEvent(TelemetryViews.Credential, TelemetryActions.ReadCredential, {
                migrated: "true",
            });
            await this._secretStorage.store(credentialId, stsCred.password);
            await this._client!.sendRequest(Contracts.DeleteCredentialRequest.type, cred);
            return stsCred;
        }

        cred.password = vscodeCodeCred;
        return cred;
    }

    public async saveCredential(credentialId: string, password: any): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        cred.password = password;
        await this._secretStorage.store(credentialId, password);
        return true;
    }

    public async deleteCredential(credentialId: string): Promise<boolean> {
        let cred: Contracts.Credential = new Contracts.Credential();
        cred.credentialId = credentialId;
        await this._secretStorage.delete(credentialId);
        const success = await this._client!.sendRequest(
            Contracts.DeleteCredentialRequest.type,
            cred,
        );
        return success;
    }
}
