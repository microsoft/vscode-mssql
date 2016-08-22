/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions,
    TransportKind, RequestType, NotificationType, INotificationHandler } from 'vscode-languageclient';

// The Service Client class handles communication with the VS Code LanguageClient
export default class SqlToolsServiceClient {
    // singleton instance
    private static _instance: SqlToolsServiceClient = undefined;

    // VS Code Language Client
    private _client: LanguageClient = undefined;

    // getter method for the Language Client
    private get client(): LanguageClient {
        return this._client;
    }

    private set client(client: LanguageClient) {
        this._client = client;
    }

    // gets or creates the singleton SQL Tools service client instance
    public static get instance(): SqlToolsServiceClient {
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
        let serverArgs = [ context.asAbsolutePath(path.join('./out/tools', 'Microsoft.SqlTools.ServiceLayer.dll')) ];
        let serverOptions: ServerOptions = {  command: serverCommand, args: serverArgs, transport: TransportKind.stdio  };

        // Options to control the language client
        let clientOptions: LanguageClientOptions = {
            documentSelector: ['sql'],
            synchronize: {
                configurationSection: 'sqlTools'
            }
        };

        // cache the client instance for later use
        this.client = new LanguageClient('sqlserverclient', serverOptions, clientOptions);

        // Create the language client and start the client.
        let disposable = this.client.start();

        // Push the disposable to the context's subscriptions so that the
        // client can be deactivated on extension deactivation
        context.subscriptions.push(disposable);
    }

    /**
     * Send a request to the service client
     * @param type The of the request to make
     * @param params The params to pass with the request
     * @returns A thenable object for when the request receives a response
     */
    public sendRequest<P, R, E>(type: RequestType<P, R, E>, params?: P): Thenable<R> {
        return this.client.sendRequest(type, params);
    }

    /**
     * Register a handler for a notification type
     * @param type The notification type to register the handler for
     * @param handler The handler to register
     */
    public onNotification<P>(type: NotificationType<P>, handler: INotificationHandler<P>): void {
        return this.client.onNotification(type, handler);
    }
}
