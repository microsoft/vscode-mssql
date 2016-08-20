/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';


// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import { Credential } from '../credential';

/**
 * A credential store that securely stores sensitive information in a platform-specific manner
 *
 * @export
 * @interface ICredentialStore
 */
export interface ICredentialStore {
    getCredential(credentialId: string): Promise<Credential>;
    setCredential(credentialId: string, username: string, password: any): Promise<void>;
    removeCredential(credentialId: string): Promise<void>;
    getCredentialByName(credentialId: string, username: string): Promise<Credential>;
    removeCredentialByName(credentialId: string, username: string): Promise<void>;
}
