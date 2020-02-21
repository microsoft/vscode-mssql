/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import { ExtensionContext, workspace, window, OutputChannel, languages } from 'vscode';
import {
    LanguageClient, LanguageClientOptions, ServerOptions,
    TransportKind, RequestType, NotificationType, NotificationHandler,
    ErrorAction, CloseAction
} from 'vscode-languageclient';
import * as path from 'path';
import VscodeWrapper from '../controllers/vscodeWrapper';
import * as Utils from '../models/utils';
import { VersionRequest } from '../models/contracts';
import { Logger } from '../models/logger';
import Constants = require('../constants/constants');
import ServerProvider from './server';
import ServiceDownloadProvider from './serviceDownloadProvider';
import DecompressProvider from './decompressProvider';
import HttpClient from './httpClient';
import ExtConfig from '../configurations/extConfig';
import { PlatformInformation } from '../models/platform';
import { ServerInitializationResult, ServerStatusView } from './serverStatus';
import StatusView from '../views/statusView';
import * as LanguageServiceContracts from '../models/contracts/languageService';
import { IConfig } from '../languageservice/interfaces';
let vscode = require('vscode');

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

    /**
     * Creates an instance of LanguageClientErrorHandler.
     * @memberOf LanguageClientErrorHandler
     */
    constructor(private vscodeWrapper?: VscodeWrapper) {
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
    }

    /**
     * Show an error message prompt with a link to known issues wiki page
     * @memberOf LanguageClientErrorHandler
     */
    showOnErrorPrompt(): void {
        this.vscodeWrapper.showErrorMessage(
            Constants.sqlToolsServiceCrashMessage,
            Constants.sqlToolsServiceCrashButton).then(action => {
                if (action && action === Constants.sqlToolsServiceCrashButton) {
                    vscode.env.openExternal(vscode.Uri.parse(Constants.sqlToolsServiceCrashLink));
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

    private _logPath: string;

    // singleton instance
    private static _instance: SqlToolsServiceClient = undefined;

    // VS Code Language Client
    private _client: LanguageClient = undefined;
    private _resourceClient: LanguageClient = undefined;

    // getter method for the Language Clients
    private get client(): LanguageClient {
        return this._client;
    }

    private set client(client: LanguageClient) {
        this._client = client;
    }

    constructor(
        private _config: IConfig,
        private _server: ServerProvider,
        private _logger: Logger,
        private _statusView: StatusView,
        private _vscodeWrapper: VscodeWrapper) {
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
            let vscodeWrapper = new VscodeWrapper();
            let statusView = new StatusView(vscodeWrapper);
            this._instance = new SqlToolsServiceClient(config, serviceProvider, logger, statusView, vscodeWrapper);
        }
        return this._instance;
    }

    // initialize the SQL Tools Service Client instance by launching
    // out-of-proc server through the LanguageClient
    public initialize(context: ExtensionContext): Promise<ServerInitializationResult> {
        this._logger.appendLine(Constants.serviceInitializing);
        this._logPath = context.logPath;
        return PlatformInformation.getCurrent().then(platformInfo => {
            return this.initializeForPlatform(platformInfo, context);
        });
    }

    public initializeForPlatform(platformInfo: PlatformInformation, context: ExtensionContext): Promise<ServerInitializationResult> {
        return new Promise<ServerInitializationResult>((resolve, reject) => {
            this._logger.appendLine(Constants.commandsNotAvailableWhileInstallingTheService);
            this._logger.appendLine();
            this._logger.append(`Platform: ${platformInfo.toString()}`);
            if (!platformInfo.isValidRuntime()) {
                Utils.showErrorMsg(Constants.unsupportedPlatformErrorMessage);
                reject('Invalid Platform');
            } else {
                if (platformInfo.runtimeId) {
                    this._logger.appendLine(` (${platformInfo.getRuntimeDisplayName()})`);
                } else {
                    this._logger.appendLine();
                }
                this._logger.appendLine();

                // For macOS we need to ensure the tools service version is set appropriately
                this.updateServiceVersion(platformInfo);

                this._server.getServerPath(platformInfo.runtimeId).then(async serverPath => {
                    if (serverPath === undefined) {
                        // Check if the service already installed and if not open the output channel to show the logs
                        if (_channel !== undefined) {
                            _channel.show();
                        }
                        let installedServerPath = await this._server.downloadServerFiles(platformInfo.runtimeId);
                        this.initializeLanguageClient(installedServerPath, context, platformInfo.isWindows());
                        await this._client.onReady();
                        resolve(new ServerInitializationResult(true, true, installedServerPath));
                    } else {
                        this.initializeLanguageClient(serverPath, context, platformInfo.isWindows());
                        await this._client.onReady();
                        resolve(new ServerInitializationResult(false, true, serverPath));
                    }
                }).catch(err => {
                    Utils.logDebug(Constants.serviceLoadingFailed + ' ' + err);
                    Utils.showErrorMsg(Constants.serviceLoadingFailed);
                    reject(err);
                });
            }
        });
    }

    private updateServiceVersion(platformInfo: PlatformInformation): void {
        if (platformInfo.isMacOS() && platformInfo.isMacVersionLessThan('10.12.0')) {
            // Version 1.0 is required as this is the last one supporting downlevel macOS versions
            this._config.useServiceVersion(1);
        }
    }

    /**
     * Gets the known service version of the backing tools service. This can be useful for filtering
     * commands that are not supported if the tools service is below a certain known version
     *
     * @returns {number}
     * @memberof SqlToolsServiceClient
     */
    public getServiceVersion(): number {
        return this._config.getServiceVersion();
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

    private initializeLanguageClient(serverPath: string, context: ExtensionContext, isWindows: boolean): void {
        if (serverPath === undefined) {
            Utils.logDebug(Constants.invalidServiceFilePath);
            throw new Error(Constants.invalidServiceFilePath);
        } else {
            let self = this;
            self.initializeLanguageConfiguration();
            let serverOptions: ServerOptions = this.createServerOptions(serverPath);
            this.client = this.createLanguageClient(serverOptions);
            let executablePath = isWindows ? Constants.windowsResourceClientPath : Constants.unixResourceClientPath;
            let resourcePath = path.join(path.dirname(serverPath), executablePath);
            this._resourceClient = this.createResourceClient(resourcePath);

            if (context !== undefined) {
                // Create the language client and start the client.
                let disposable = this.client.start();

                // Start the resource client
                let resourceDisposable = this._resourceClient.start();

                // Push the disposable to the context's subscriptions so that the
                // client can be deactivated on extension deactivation

                context.subscriptions.push(disposable);
                context.subscriptions.push(resourceDisposable);
            }
        }
    }

    private createLanguageClient(serverOptions: ServerOptions): LanguageClient {
        // Options to control the language client
        let clientOptions: LanguageClientOptions = {
            documentSelector: ['sql'],
            synchronize: {
                configurationSection: 'mssql'
            },
            errorHandler: new LanguageClientErrorHandler(this._vscodeWrapper)
        };

        // cache the client instance for later use
        let client = new LanguageClient(Constants.sqlToolsServiceName, serverOptions, clientOptions);
        client.onReady().then(() => {
            this.checkServiceCompatibility();

            client.onNotification(LanguageServiceContracts.StatusChangedNotification.type, this.handleLanguageServiceStatusNotification());
        });

        return client;
    }

    private generateResourceServiceServerOptions(executablePath: string): ServerOptions {
        let launchArgs = Utils.getCommonLaunchArgsAndCleanupOldLogFiles(this._logPath, 'resourceprovider.log', executablePath);
        return { command: executablePath, args: launchArgs, transport: TransportKind.stdio };
    }

    private createResourceClient(resourcePath: string): LanguageClient {
        // add resource provider path here
        let serverOptions = this.generateResourceServiceServerOptions(resourcePath);
        // client options are undefined since we don't want to send language events to the
        // server, since it's handled by the main client
        let client = new LanguageClient(Constants.resourceServiceName, serverOptions, undefined);
        return client;
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
                serverArgs.push('--locale');
                serverArgs.push(locale);
            }
        }


        // run the service host using dotnet.exe from the path
        let serverOptions: ServerOptions = { command: serverCommand, args: serverArgs, transport: TransportKind.stdio };
        return serverOptions;
    }

    /**
     * Send a request to the service client
     * @param type The of the request to make
     * @param params The params to pass with the request
     * @returns A thenable object for when the request receives a response
     */
    // tslint:disable-next-line:no-unused-variable
    public sendRequest<P, R, E, R0>(type: RequestType<P, R, E, R0>, params?: P): Thenable<R> {
        if (this.client !== undefined) {
            return this.client.sendRequest(type, params);
        }
    }

    /**
     * Send a request to the service client
     * @param type The of the request to make
     * @param params The params to pass with the request
     * @returns A thenable object for when the request receives a response
     */
    // tslint:disable-next-line:no-unused-variable
    public sendResourceRequest<P, R, E, R0>(type: RequestType<P, R, E, R0>, params?: P): Thenable<R> {
        if (this._resourceClient !== undefined) {
            return this._resourceClient.sendRequest(type, params);
        }
    }

    /**
     * Send a notification to the service client
     * @param params The params to pass with the notification
     */
    // tslint:disable-next-line:no-unused-variable
    public sendNotification<P, R0>(type: NotificationType<P, R0>, params?: P): void {
        if (this.client !== undefined) {
            this.client.sendNotification(type, params);
        }
    }

    /**
     * Register a handler for a notification type
     * @param type The notification type to register the handler for
     * @param handler The handler to register
     */
    // tslint:disable-next-line:no-unused-variable
    public onNotification<P, R0>(type: NotificationType<P, R0>, handler: NotificationHandler<P>): void {
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
