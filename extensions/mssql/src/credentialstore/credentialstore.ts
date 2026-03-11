/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ICredentialStore, Credential } from "./icredentialstore";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {
    private _secretStorage: vscode.SecretStorage;
    private _logger: Logger;

    constructor(
        private _context: vscode.ExtensionContext,
        private _vscodeWrapper: VscodeWrapper,
    ) {
        this._secretStorage = this._context.secrets;
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "CredentialStore");
    }

    /**
     * Gets a credential saved in the credential store
     * @param credentialId the ID uniquely identifying this credential
     * @returns Promise that resolved to the credential, or undefined if not found
     */
    public async readCredential(credentialId: string): Promise<Credential> {
        const vscodeCodeCred = await this._secretStorage.get(credentialId);
        if (vscodeCodeCred === undefined) {
            this._logger.info(
                `No credential found for id ${credentialId} in VS Code Secret Storage.`,
            );
            return undefined;
        }

        this._logger.info(
            `Retrieved credential for id ${credentialId} from VS Code Secret Storage.`,
        );

        return {
            credentialId,
            password: vscodeCodeCred,
        };
    }

    public async saveCredential(credentialId: string, password: string): Promise<boolean> {
        await this._secretStorage.store(credentialId, password);
        return true;
    }

    public async deleteCredential(credentialId: string): Promise<void> {
        await this._secretStorage.delete(credentialId);
    }
}
