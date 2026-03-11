/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

export interface Credential {
    credentialId: string;
    password: string;
}

/**
 * A credential store that securely stores sensitive information in a platform-specific manner
 *
 * @exports
 */
export interface ICredentialStore {
    readCredential(credentialId: string): Promise<Credential>;
    saveCredential(credentialId: string, password: string): Promise<boolean>;
    deleteCredential(credentialId: string): Promise<void>;
}
