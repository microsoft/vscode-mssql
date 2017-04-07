/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { ExtensionContext, workspace, window, OutputChannel, languages } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions,
    TransportKind, RequestType, NotificationType, NotificationHandler,
    ErrorAction, CloseAction, ResponseError } from 'vscode-languageclient';

import VscodeWrapper from '../controllers/vscodeWrapper';
import Telemetry from '../models/telemetry';
import * as Utils from '../models/utils';
import {VersionRequest} from '../models/contracts';
import {Logger} from '../models/logger';
import Constants = require('../constants/constants');
import ServerProvider from './server';
import ServiceDownloadProvider from './serviceDownloadProvider';
import DecompressProvider from './decompressProvider';
import HttpClient from './httpClient';
import ExtConfig from  '../configurations/extConfig';
import {PlatformInformation} from '../models/platform';
import {ServerInitializationResult, ServerStatusView} from './serverStatus';
import StatusView from '../views/statusView';
import * as LanguageServiceContracts from '../models/contracts/languageService';
let vscode = require('vscode');

let opener = require('opener');
let _channel: OutputChannel = undefined;

/**
 * @interface IMessage
 */
interface IMessage {
    jsonrpc: string;
}

/**
 * Handle Language Service client errors
 * @class LanguageClientErrorHandler
 */
class LanguageClientErrorHandler {

    private vscodeWrapper: VscodeWrapper;

    /**
     * Creates an instance of LanguageClientErrorHandler.
     * @memberOf LanguageClientErrorHandler
     */
    constructor() {
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
    }

    /**
     * Show an error message prompt with a link to known issues wiki page
     * @memberOf LanguageClientErrorHandler
     */
    showOnErrorPrompt(): void {
        Telemetry.sendTelemetryEvent('SqlToolsServiceCrash');

        this.vscodeWrapper.showErrorMessage(
          Constants.sqlToolsServiceCrashMessage,
          Constants.sqlToolsServiceCrashButton).then(action => {
            if (action && action === Constants.sqlToolsServiceCrashButton) {
                opener(Constants.sqlToolsServiceCrashLink);
            }
        });
    }

    /**
     * Callback for language service client error
     *
     * @param {Error} error
     * @param {Message} message
     * @param {number} count
     * @returns {ErrorAction}
     *
     * @memberOf LanguageClientErrorHandler
     */
    error(error: Error, message: IMessage, count: number): ErrorAction {
        this.showOnErrorPrompt();

        // we don't retry running the service since crashes leave the extension
        // in a bad, unrecovered state
        return ErrorAction.Shutdown;
    }

    /**
     * Callback for language service client closed
     *
     * @returns {CloseAction}
     *
     * @memberOf LanguageClientErrorHandler
     */
    closed(): CloseAction {
        this.showOnErrorPrompt();

        // we don't retry running the service since crashes leave the extension
        // in a bad, unrecovered state
        return CloseAction.DoNotRestart;
    }
}

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

    constructor(
        private _server: ServerProvider,
        private _logger: Logger,
        private _statusView: StatusView) {
    }

    // gets or creates the singleton SQL Tools service client instance
    public static get instance(): SqlToolsServiceClient {
        if (this._instance === undefined) {
            let config = new ExtConfig();
            _channel = window.createOutputChannel(Constants.serviceInitializingOutputChannelName);
            let logger = new Logger(text => _channel.append(text));
            let serverStatusView = new ServerStatusView();
            let httpClient = new HttpClient();
            let decompressProvider = new DecompressProvider();
            let downloadProvider = new ServiceDownloadProvider(config, logger, serverStatusView, httpClient,
            decompressProvider);
            let serviceProvider = new ServerProvider(downloadProvider, config, serverStatusView);
            let statusView = new StatusView();
            this._instance = new SqlToolsServiceClient(serviceProvider, logger, statusView);
        }
        return this._instance;
    }

    // initialize the SQL Tools Service Client instance by launching
    // out-of-proc server through the LanguageClient
    public initialize(context: ExtensionContext): Promise<ServerInitializationResult> {
         this._logger.appendLine(Constants.serviceInitializing);

         return PlatformInformation.GetCurrent().then( platformInfo => {
            return this.initializeForPlatform(platformInfo, context);
         });
    }

    public initializeForPlatform(platformInfo: PlatformInformation, context: ExtensionContext): Promise<ServerInitializationResult> {
        let self = this;
        return new Promise<ServerInitializationResult>( (resolve, reject) => {
            // Log some stuff about the platform
            self._logger.appendLine(Constants.commandsNotAvailableWhileInstallingTheService);
            self._logger.appendLine();
            self._logger.append(`Platform: ${platformInfo.toString()}`);

            // Make sure that the platform we're running on is valid
            if (!platformInfo.isValidRuntime()) {
                Utils.showErrorMsg(Constants.unsupportedPlatformErrorMessage);
                Telemetry.sendTelemetryEvent('UnsupportedPlatform', {platform: platformInfo.toString()} );
                reject('Invalid Platform');
                return;
            }

            // We have a valid platform, log what it is
            self._logger.appendLine(platformInfo.runtimeId ? ` (${platformInfo.getRuntimeDisplayName()})` : '');
            self._logger.appendLine();

            // Download the service if necessary
            this._server.getServerPath(platformInfo.runtimeId).then(serverPath => {
                // Determine if the service is already installed
                if (serverPath === undefined) {
                    // Service is not installed
                    // Open output to show download logs
                    if (_channel !== undefined) {
                        _channel.show();
                    }

                    // Start downloading the service
                    self._server.downloadServerFiles(platformInfo.runtimeId).then(installedServerPath => {
                        self.initializeLanguageClient(installedServerPath, context).then(() => {
                            resolve(new ServerInitializationResult(true, true, installedServerPath));
                        });
                    }).catch(downloadErr => {
                        reject(downloadErr);
                    });
                } else {
                    // Service is already installed
                    self.initializeLanguageClient(serverPath, context).then(() => {
                        resolve(new ServerInitializationResult(false, true, serverPath));
                    });
                }
            });
        });
    }

    /**
     * Initializes the SQL language configuration
     *
     * @memberOf SqlToolsServiceClient
     */
    private initializeLanguageConfiguration(): void {
        languages.setLanguageConfiguration('sql', {
            comments: {
                lineComment: '--',
                blockComment: ['/*', '*/']
            },

            brackets: [
                ['{', '}'],
                ['[', ']'],
                ['(', ')']
            ],

            __characterPairSupport: {
                autoClosingPairs: [
                    { open: '{', close: '}' },
                    { open: '[', close: ']' },
                    { open: '(', close: ')' },
                    { open: '"', close: '"', notIn: ['string'] },
                    { open: '\'', close: '\'', notIn: ['string', 'comment'] }
                ]
            }
        });
    }

    private initializeLanguageClient(serverPath: string, context: ExtensionContext): Promise<void> {
        let self = this;

        // Stop if we have an invalid path
        if (serverPath === undefined) {
            Utils.logDebug(Constants.invalidServiceFilePath);
            throw new Error(Constants.invalidServiceFilePath);
        }

        // Server path was good, so start initializing it
        self.initializeLanguageConfiguration();
        let serverOptions: ServerOptions = self.createServerOptions(serverPath);
        let clientOptions: LanguageClientOptions = {
            documentSelector: ['sql'],
            synchronize: {
                configurationSection: 'mssql'
            },
            errorHandler: new LanguageClientErrorHandler()
        };

        // Create and start the client
        let client = new LanguageClient(Constants.sqlToolsServiceName, serverOptions, clientOptions);
        let disposableClient = client.start();
        context.subscriptions.push(disposableClient);

        return client.onReady().then(() => {
            self._client = client;
            self.checkServiceCompatibility();
            client.onNotification(LanguageServiceContracts.TelemetryNotification.type, self.handleLanguageServiceTelemetryNotification());
            client.onNotification(LanguageServiceContracts.StatusChangedNotification.type, self.handleLanguageServiceStatusNotification());
        });
    }

    private handleLanguageServiceTelemetryNotification(): NotificationHandler<LanguageServiceContracts.TelemetryParams> {
        return (event: LanguageServiceContracts.TelemetryParams): void => {
            Telemetry.sendTelemetryEvent(event.params.eventName, event.params.properties, event.params.measures);
        };
    }

    /**
     * Public for testing purposes only.
     */
    public handleLanguageServiceStatusNotification(): NotificationHandler<LanguageServiceContracts.StatusChangeParams> {
        return (event: LanguageServiceContracts.StatusChangeParams): void => {
            this._statusView.languageServiceStatusChanged(event.ownerUri, event.status);
        };
    }

    private createServerOptions(servicePath): ServerOptions {
        let serverArgs = [];
        let serverCommand: string = servicePath;
        if (servicePath.endsWith('.dll')) {
            serverArgs = [servicePath];
            serverCommand = 'dotnet';
        }

        // Get the extenion's configuration
        let config = workspace.getConfiguration(Constants.extensionConfigSectionName);
        if (config) {
            // Enable diagnostic logging in the service if it is configured
            let logDebugInfo = config[Constants.configLogDebugInfo];
            if (logDebugInfo) {
                serverArgs.push('--enable-logging');
            }

            // Send Locale for sqltoolsservice localization
            let applyLocalization = config[Constants.configApplyLocalization];
            if (applyLocalization) {
                let locale = vscode.env.language;
                serverArgs.push('--locale ' + locale);
            }
        }


        // run the service host using dotnet.exe from the path
        let serverOptions: ServerOptions = {  command: serverCommand, args: serverArgs, transport: TransportKind.stdio  };
        return serverOptions;
    }

    /**
     * Send a request to the service client
     * @param type The of the request to make
     * @param params The params to pass with the request
     * @type P The type of the parameters provided in the request
     * @type R The type of the result from successful execution of the request
     * @type E The type of the data object in an error response. Can be void if data is not expected
     *         or any if anything can be returned.
     * @returns A thenable object for when the request receives a response
     */
    public sendRequest<P, R, E>(type: RequestType<P, R, ResponseError<E>, void>, params?: P): Thenable<R> {
        if (this.client !== undefined) {
            return this.client.sendRequest<P, R, ResponseError<E>, void>(type, params, undefined);
        }
    }

    /**
     * Send a notification to the service client
     * @param params The params to pass with the notification
     */
    public sendNotification<P>(type: NotificationType<P, void>, params?: P): void {
        if (this.client !== undefined) {
            this.client.sendNotification(type, params);
        }
    }

    /**
     * Register a handler for a notification type
     * @param type The notification type to register the handler for
     * @param handler The handler to register
     */
    public onNotification<P>(type: NotificationType<P, void>, handler: NotificationHandler<P>): void {
        if (this._client !== undefined) {
             return this.client.onNotification(type, handler);
        }
    }

    public checkServiceCompatibility(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this._client.sendRequest(VersionRequest.type, undefined).then((result) => {
                 Utils.logDebug('sqlserverclient version: ' + result);

                 if (result === undefined || !result.startsWith(Constants.serviceCompatibleVersion)) {
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
