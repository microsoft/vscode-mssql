/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import * as vscode from "vscode";
import { createServiceIdentifier } from "extension-toolkit/base";
import { IExtensionContextService } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { logger } from "../models/logger";

export interface Credential {
    credentialId: string;
    password: string;
}

export const ICredentialStore = createServiceIdentifier<ICredentialStore>("credentialStore");

/**
 * A credential store that securely stores sensitive information in a platform-specific manner
 *
 * @exports
 */
export interface ICredentialStore {
    readonly _serviceBrand: undefined;
    readCredential(credentialId: string): Promise<Credential>;
    saveCredential(credentialId: string, password: string): Promise<boolean>;
    deleteCredential(credentialId: string): Promise<void>;
}

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {
    declare readonly _serviceBrand: undefined;

    private _secretStorage: vscode.SecretStorage;
    private _logger: ILogger;

    constructor(@IExtensionContextService contextService: IExtensionContextService) {
        this._secretStorage = contextService.context.secrets;
        this._logger = logger.withPrefix("CredentialStore");
    }

    /**
     * Gets a credential saved in the credential store
     * @param credentialId the ID uniquely identifying this credential
     * @returns Promise that resolved to the credential, or undefined if not found
     */
    public async readCredential(credentialId: string): Promise<Credential> {
        const vscodeCodeCred = await this._secretStorage.get(credentialId);
        if (vscodeCodeCred === undefined) {
            this._logger.debug(
                `No credential found for id ${credentialId} in VS Code Secret Storage.`,
            );
            return undefined;
        }

        this._logger.debug(
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
