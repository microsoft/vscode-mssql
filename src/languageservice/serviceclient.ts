/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions,
    TransportKind, RequestType, NotificationType, NotificationHandler } from 'vscode-languageclient';
import * as Utils from '../models/utils';
import {VersionRequest} from '../models/contracts';
import Constants = require('../models/constants');
import ServerProvider from './server';
import ServiceDownloadProvider from './download';
import {ExtensionWrapper, Logger} from './extUtil';
import ExtConfig from  '../configurations/extConfig';
import StatusView from '../views/statusView';
import {Platform, getCurrentPlatform} from '../models/platform';

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

    constructor(private _server: ServerProvider) {
    }

    // gets or creates the singleton SQL Tools service client instance
    public static get instance(): SqlToolsServiceClient {
        if (this._instance === undefined) {
            let config = new ExtConfig();
            let logger = new Logger();
            let downloadProvider = new ServiceDownloadProvider(config, logger);
            let statusView = new StatusView();
            let extWrapper = new ExtensionWrapper();
            let serviceProvider = new ServerProvider(downloadProvider, config, statusView, extWrapper);

            this._instance = new SqlToolsServiceClient(serviceProvider);
        }
        return this._instance;
    }

    // initialize the SQL Tools Service Client instance by launching
    // out-of-proc server through the LanguageClient
    public initialize(context: ExtensionContext): Promise<boolean> {
        return new Promise<boolean>( (resolve, reject) => {
            const platform = getCurrentPlatform();
            if (platform === Platform.Unknown) {
                throw new Error('Invalid Platform');
            }
            this._server.getServerPath(platform).then(serverPath => {
                let serverArgs = [];
                let serverCommand = serverPath;
                if (serverPath.endsWith('.dll')) {
                    serverArgs = [serverPath];
                    serverCommand = 'dotnet';
                }
                // run the service host using dotnet.exe from the path
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
                this.client.onReady().then( () => {
                    this.checkServiceCompatibility();
                });
                // Create the language client and start the client.
                let disposable = this.client.start();

                // Push the disposable to the context's subscriptions so that the
                // client can be deactivated on extension deactivation
                context.subscriptions.push(disposable);
                resolve(true);

            });
        });
    }

    /**
     * Send a request to the service client
     * @param type The of the request to make
     * @param params The params to pass with the request
     * @returns A thenable object for when the request receives a response
     */
    public sendRequest<P, R, E>(type: RequestType<P, R, E>, params?: P): Thenable<R> {
        if (this.client !== undefined) {
            return this.client.sendRequest(type, params);
        }
    }

    /**
     * Register a handler for a notification type
     * @param type The notification type to register the handler for
     * @param handler The handler to register
     */
    public onNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>): void {
        if (this._client !== undefined) {
             return this.client.onNotification(type, handler);
        }
    }

    public checkServiceCompatibility(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this._client.sendRequest(VersionRequest.type, undefined).then((result) => {
                 Utils.logDebug('sqlserverclient version: ' + result);

                 if (!result || !result.startsWith(Constants.serviceCompatibleVersion)) {
                     Utils.showErrorMsg(Constants.serviceNotCompatibleError);
                     Utils.logDebug(Constants.serviceNotCompatibleError);
                     resolve(false);
                 } else {
                     resolve(true);
                 }
            });
        });
    }
}
