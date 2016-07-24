/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { workspace, Disposable, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind } from 'vscode-languageclient';

export default class SqlToolsServiceClient
{
    private static _instance: SqlToolsServiceClient = undefined;

    private _client: LanguageClient = undefined;

    public getClient(): LanguageClient
    {
        return this._client;
    }

    // gets or creates the singleton SQL Tools service client instance
    public static getInstance(): SqlToolsServiceClient
    {
        if (this._instance == undefined)
        {
            this._instance = new SqlToolsServiceClient();
        }
        return this._instance;
    }

    public initialize(context: ExtensionContext) {

        let serverCommand = 'dotnet.exe';
        let serverArgs = [ context.asAbsolutePath(path.join('tools', 'servicehost.dll')) ];
        let serverOptions: ServerOptions = {  command: serverCommand, args: serverArgs, transport: TransportKind.stdio  };

        // Options to control the language client
        let clientOptions: LanguageClientOptions = {
            documentSelector: ['sql'],
            synchronize: {
                configurationSection: 'sqlTools'
            }
        }

        // cache the client instance for later use
        this._client = new LanguageClient('sqlserverclient', serverOptions, clientOptions);

        // Create the language client and start the client.
        let disposable = this._client.start();

        // Push the disposable to the context's subscriptions so that the
        // client can be deactivated on extension deactivation
        context.subscriptions.push(disposable);
    }
}
