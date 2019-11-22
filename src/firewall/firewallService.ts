/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import VscodeWrapper from '../controllers/vscodeWrapper';

export class FirewallService {

    private _client: SqlToolsServiceClient;
    private _isSignedIn: boolean = false;
    private _accountExtension: vscode.Extension<any> = vscode.extensions.getExtension('ms-vscode.azure-account');
    public isActive = this._accountExtension.exports.isActive;

    constructor(
        private _connectionManager: ConnectionManager,
        private _vscodeWrapper: VscodeWrapper
    ) {
        this._client = this._connectionManager.client;
    }

    public getAccounts(): any[] {
        if (this._isSignedIn) {
            let accounts = this._accountExtension.exports.accounts;
            return accounts;
        } else {
            // show error message to sign in for firewall
        }
    }
}
