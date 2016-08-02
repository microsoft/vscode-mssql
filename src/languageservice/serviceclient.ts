/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient';

// The Service Client class handles communication with the VS Code LanguageClient
export default class SqlToolsServiceClient {
    // singleton instance
    private static _instance: SqlToolsServiceClient = undefined;

    // VS Code Language Client
    private _client: LanguageClient = undefined;

    // getter method for the Language Client
    public getClient(): LanguageClient {
        return this._client;
    }

    // gets or creates the singleton SQL Tools service client instance
    public static getInstance(): SqlToolsServiceClient {
        if (this._instance === undefined) {
            this._instance = new SqlToolsServiceClient();
        }
        return this._instance;
    }

    // initialize the SQL Tools Service Client instance by launching
    // out-of-proc server through the LanguageClient
    public initialize(context: ExtensionContext): void {

        // run the service host using dotnet.exe from the path
        let serverCommand = 'dotnet';
        let serverArgs = [ context.asAbsolutePath(path.join('tools', 'Microsoft.SqlTools.ServiceHost.dll')) ];
        let serverOptions: ServerOptions = {  command: serverCommand, args: serverArgs, transport: TransportKind.stdio  };

        // Options to control the language client
        let clientOptions: LanguageClientOptions = {
            documentSelector: ['sql'],
            synchronize: {
                configurationSection: 'sqlTools'
            }
        };

        // cache the client instance for later use
        this._client = new LanguageClient('sqlserverclient', serverOptions, clientOptions);

        // Create the language client and start the client.
        let disposable = this._client.start();

        // Push the disposable to the context's subscriptions so that the
        // client can be deactivated on extension deactivation
        context.subscriptions.push(disposable);
    }
}
