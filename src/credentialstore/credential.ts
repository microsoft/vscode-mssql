/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

export class Credential {
    private _credentialId: string;
    private _username: string;
    private _password: string;

    constructor(credentialId: string, username: string, password: string) {
        this._credentialId = credentialId;
        this._username = username;
        this._password = password;
    }

    public get CredentialId(): string {
        return this._credentialId;
    }
    public get Username(): string {
        return this._username;
    }
    public get Password(): string {
        return this._password;
    }

}
