/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import MainController from "./controllers/mainController";
import ConnectionManager from "./controllers/connectionManager";

const cordinatingExtensions = ["ms-ossdata.vscode-pgsql"];

export class UriOwnershipCoordinator {
    public uriOwnershipApi: vscodeMssql.UriOwnershipApi;
    private _connectionManager: ConnectionManager;
    private _cordinatingExtensionApis: Map<string, vscodeMssql.UriOwnershipApi> = new Map();

    constructor(
        private _mainController: MainController,
        private _context: vscode.ExtensionContext,
    ) {
        this._connectionManager = this._mainController.connectionManager;
        this.initializeUriOwnershipApi();
        this.loadCoordinatingExtensionsApi();
    }

    private isUriOwnedBySelf(uri: vscode.Uri): boolean {
        return (
            this._connectionManager.isConnected(uri.toString(true)) ||
            this._connectionManager.isConnecting(uri.toString(true))
        );
    }

    private initializeUriOwnershipApi() {
        this.uriOwnershipApi = {
            ownsUri: (uri: vscode.Uri): boolean => {
                return this.isUriOwnedBySelf(uri);
            },
            onDidChangeUriOwnership: this._connectionManager.onConnectionsChanged,
        };
    }

    private loadCoordinatingExtensionsApi() {
        for (const extensionId of cordinatingExtensions) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (!extension) {
                continue;
            }
            if (!extension.isActive) {
                extension.activate().then(() => {
                    this.registerCordinatingExtensionApi(extensionId, extension);
                });
            }
        }
    }

    private registerCordinatingExtensionApi(extensionId: string, extension: vscode.Extension<any>) {
        const api = extension.exports.uriOwnershipApi as vscodeMssql.UriOwnershipApi;
        if (api) {
            this._cordinatingExtensionApis.set(extensionId, api);
        }
    }

    public isOwnedByCoordinatingExtension(uri: vscode.Uri): boolean {
        for (const api of this._cordinatingExtensionApis.values()) {
            if (api.ownsUri(uri)) {
                return true;
            }
        }
        return false;
    }
}
