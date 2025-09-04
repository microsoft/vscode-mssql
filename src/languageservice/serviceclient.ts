/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    RequestType,
    NotificationType,
    NotificationHandler,
    ErrorAction,
    CloseAction,
} from "vscode-languageclient";
import * as path from "path";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as Utils from "../models/utils";
import { Logger } from "../models/logger";
import * as Constants from "../constants/constants";
import ServerProvider from "./server";
import ServiceDownloadProvider from "./serviceDownloadProvider";
import DecompressProvider from "./decompressProvider";
import HttpClient from "./httpClient";
import ExtConfig from "../configurations/extConfig";
import { PlatformInformation } from "../models/platform";
import { ServerInitializationResult, ServerStatusView } from "./serverStatus";
import StatusView from "../views/statusView";
import * as LanguageServiceContracts from "../models/contracts/languageService";
import { IConfigUtils } from "../languageservice/interfaces";
import { exists } from "../utils/utils";
import { env } from "process";
import {
    getAppDataPath,
    getEnableConnectionPoolingConfig,
    getEnableSqlAuthenticationProviderConfig,
} from "../azure/utils";
import { serviceName } from "../azure/constants";

const STS_OVERRIDE_ENV_VAR = "MSSQL_SQLTOOLSSERVICE";

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
        this.vscodeWrapper
            .showErrorMessage(
                Constants.sqlToolsServiceCrashMessage,
                Constants.sqlToolsServiceCrashButton,
            )
            .then((action) => {
                if (action && action === Constants.sqlToolsServiceCrashButton) {
                    vscode.env.openExternal(vscode.Uri.parse(Constants.sqlToolsServiceCrashLink));
                }
            });
    }

    /**
     * Callback for language service client error
     *
     * @param error
     * @param message
     * @param count
     * @returns
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
     * @returns
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
    private _sqlToolsServicePath: string | undefined = undefined;
    /**
     * Path to the root of the SQL Tools Service folder
     */
    public get sqlToolsServicePath(): string | undefined {
        return this._sqlToolsServicePath;
    }

    private _logPath: string;

    // singleton instance
    private static _instance: SqlToolsServiceClient = undefined;

    // VS Code Language Client
    private _client: LanguageClient = undefined;
    private _resourceClient: LanguageClient = undefined;

    // getter method for the Language Client
    private get client(): LanguageClient {
        return this._client;
    }

    private set client(client: LanguageClient) {
        this._client = client;
    }

    // getter method for language client diagnostic collection
    public get diagnosticCollection(): vscode.DiagnosticCollection {
        return this._client.diagnostics;
    }

    public get logger(): Logger {
        return this._logger;
    }

    constructor(
        private _config: IConfigUtils,
        private _server: ServerProvider,
        private _logger: Logger,
        private _statusView: StatusView,
        private _vscodeWrapper: VscodeWrapper,
    ) {}

    // gets or creates the singleton SQL Tools service client instance
    public static get instance(): SqlToolsServiceClient {
        if (SqlToolsServiceClient._instance === undefined) {
            let config = new ExtConfig();
            let vscodeWrapper = new VscodeWrapper();

            let logger = Logger.create(vscodeWrapper.outputChannel, "SQL Tools Service");

            let serverStatusView = new ServerStatusView();
            let httpClient = new HttpClient();
            let decompressProvider = new DecompressProvider();
            let downloadProvider = new ServiceDownloadProvider(
                config,
                logger,
                serverStatusView,
                httpClient,
                decompressProvider,
            );
            let serviceProvider = new ServerProvider(downloadProvider, config, serverStatusView);
            let statusView = new StatusView(vscodeWrapper);
            SqlToolsServiceClient._instance = new SqlToolsServiceClient(
                config,
                serviceProvider,
                logger,
                statusView,
                vscodeWrapper,
            );
        }
        return SqlToolsServiceClient._instance;
    }

    // initialize the SQL Tools Service Client instance by launching
    // out-of-proc server through the LanguageClient
    public initialize(context: vscode.ExtensionContext): Promise<ServerInitializationResult> {
        this._logger.appendLine(Constants.serviceInitializing);
        this._logPath = context.logUri.fsPath;
        return PlatformInformation.getCurrent().then((platformInfo) => {
            return this.initializeForPlatform(platformInfo, context);
        });
    }

    public initializeForPlatform(
        platformInfo: PlatformInformation,
        context: vscode.ExtensionContext,
    ): Promise<ServerInitializationResult> {
        return new Promise<ServerInitializationResult>((resolve, reject) => {
            this._logger.appendLine(Constants.commandsNotAvailableWhileInstallingTheService);
            this._logger.appendLine();
            this._logger.append(`Platform: ${platformInfo.toString()}`);
            if (!platformInfo.isValidRuntime) {
                Utils.showErrorMsg(Constants.unsupportedPlatformErrorMessage);
                reject("Invalid Platform");
            } else {
                if (platformInfo.runtimeId) {
                    this._logger.appendLine(` (${platformInfo.getRuntimeDisplayName()})`);
                } else {
                    this._logger.appendLine();
                }
                this._logger.appendLine();

                // For macOS we need to ensure the tools service version is set appropriately
                this.updateServiceVersion(platformInfo);

                this._server
                    .getServerPath(platformInfo.runtimeId)
                    .then(async (serverPath) => {
                        if (serverPath === undefined) {
                            // Check if the service already installed and if not open the output channel to show the logs
                            if (this._vscodeWrapper !== undefined) {
                                this._vscodeWrapper.outputChannel.show();
                            }
                            let installedServerPath = await this._server.downloadServerFiles(
                                platformInfo.runtimeId,
                            );
                            this._sqlToolsServicePath = path.dirname(installedServerPath);
                            await this.initializeLanguageClient(
                                installedServerPath,
                                context,
                                platformInfo.isWindows,
                            );
                            await this._client.onReady();
                            resolve(
                                new ServerInitializationResult(true, true, installedServerPath),
                            );
                        } else {
                            this._sqlToolsServicePath = path.dirname(serverPath);
                            await this.initializeLanguageClient(
                                serverPath,
                                context,
                                platformInfo.isWindows,
                            );
                            await this._client.onReady();
                            resolve(new ServerInitializationResult(false, true, serverPath));
                        }
                    })
                    .catch((err) => {
                        this.logger.logDebug(Constants.serviceLoadingFailed + " " + err);
                        Utils.showErrorMsg(Constants.serviceLoadingFailed);
                        reject(err);
                    });
            }
        });
    }

    private updateServiceVersion(platformInfo: PlatformInformation): void {
        if (platformInfo.isMacOS && platformInfo.isMacVersionLessThan("10.12.0")) {
            // Version 1.0 is required as this is the last one supporting downlevel macOS versions
            this._config.useServiceVersion(1);
        }
    }

    /**
     * Gets the known service version of the backing tools service. This can be useful for filtering
     * commands that are not supported if the tools service is below a certain known version
     *
     * @returns
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
        vscode.languages.setLanguageConfiguration("sql", {
            comments: {
                lineComment: "--",
                blockComment: ["/*", "*/"],
            },

            brackets: [
                ["{", "}"],
                ["[", "]"],
                ["(", ")"],
            ],

            __characterPairSupport: {
                autoClosingPairs: [
                    { open: "{", close: "}" },
                    { open: "[", close: "]" },
                    { open: "(", close: ")" },
                    { open: '"', close: '"', notIn: ["string"] },
                    { open: "'", close: "'", notIn: ["string", "comment"] },
                ],
            },
        });
    }

    private async initializeLanguageClient(
        serverPath: string,
        context: vscode.ExtensionContext,
        isWindows: boolean,
    ): Promise<void> {
        if (serverPath === undefined) {
            this.logger.logDebug(Constants.invalidServiceFilePath);
            throw new Error(Constants.invalidServiceFilePath);
        } else {
            let overridePath: string | undefined = undefined;
            this.initializeLanguageConfiguration();
            // This env var is used to override the base install location of STS - primarily to be used for debugging scenarios.
            try {
                const exeFiles = this._config.getSqlToolsExecutableFiles();
                const stsRootPath = env[STS_OVERRIDE_ENV_VAR];
                if (stsRootPath) {
                    for (const exeFile of exeFiles) {
                        const serverFullPath = path.join(stsRootPath, exeFile);
                        if (await exists(serverFullPath)) {
                            const overrideMessage = `Using ${exeFile} from ${stsRootPath}`;
                            void vscode.window.showInformationMessage(overrideMessage);
                            console.log(overrideMessage);
                            overridePath = serverFullPath;
                            break;
                        }
                    }
                    if (!overridePath) {
                        console.warn(
                            `Could not find valid SQL Tools Service EXE from ${JSON.stringify(exeFiles)} at ${stsRootPath}, falling back to config`,
                        );
                    }
                }
            } catch (err) {
                console.warn(
                    "Unexpected error getting override path for SQL Tools Service client ",
                    err,
                );
                // Fall back to config if something unexpected happens here
            }
            // Use the override path if we have one, otherwise just use the original serverPath passed in
            let serverOptions: ServerOptions = this.createServiceLayerServerOptions(
                overridePath || serverPath,
            );
            this.client = this.createLanguageClient(serverOptions);
            let executablePath = isWindows
                ? Constants.windowsResourceClientPath
                : Constants.unixResourceClientPath;
            let resourcePath = path.join(path.dirname(serverPath), executablePath);
            // See if the override path exists and has the resource client as well, and if so use that instead
            if (overridePath) {
                const overrideDir = path.dirname(overridePath);
                const resourceOverridePath = path.join(overrideDir, executablePath);
                const resourceClientOverrideExists = await exists(resourceOverridePath);
                if (resourceClientOverrideExists) {
                    const overrideMessage = `Using ${resourceOverridePath} from ${overrideDir}`;
                    void vscode.window.showInformationMessage(overrideMessage);
                    console.log(overrideMessage);
                    resourcePath = resourceOverridePath;
                }
            }
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
            documentSelector: ["sql"],
            diagnosticCollectionName: "mssql",
            synchronize: {
                configurationSection: [
                    Constants.extensionConfigSectionName,
                    Constants.telemetryConfigSectionName,
                ],
            },
            errorHandler: new LanguageClientErrorHandler(this._vscodeWrapper),
        };

        // cache the client instance for later use
        let client = new LanguageClient(
            Constants.sqlToolsServiceName,
            serverOptions,
            clientOptions,
        );
        void client.onReady().then(() => {
            client.onNotification(
                LanguageServiceContracts.StatusChangedNotification.type,
                this.handleLanguageServiceStatusNotification(),
            );
        });

        return client;
    }

    private generateResourceServiceServerOptions(executablePath: string): ServerOptions {
        let launchArgs = Utils.getCommonLaunchArgsAndCleanupOldLogFiles(
            executablePath,
            this._logPath,
            "resourceprovider.log",
        );
        return {
            command: executablePath,
            args: launchArgs,
            transport: TransportKind.stdio,
        };
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

    private createServiceLayerServerOptions(servicePath: string): ServerOptions {
        let serverArgs = [];
        let serverCommand: string = servicePath;
        if (servicePath.endsWith(".dll")) {
            serverArgs = [servicePath];
            serverCommand = "dotnet";
        }
        // Get the extenion's configuration
        let config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName);
        if (config) {
            // Populate common args
            serverArgs = serverArgs.concat(
                Utils.getCommonLaunchArgsAndCleanupOldLogFiles(
                    servicePath,
                    this._logPath,
                    "sqltools.log",
                ),
            );

            // Enable diagnostic logging in the service if it is configured
            let logDebugInfo = config[Constants.configLogDebugInfo];
            if (logDebugInfo) {
                serverArgs.push("--enable-logging");
            }

            // Send application name and path to determine MSAL cache location
            serverArgs.push("--application-name", serviceName);
            serverArgs.push("--data-path", getAppDataPath());

            /**
             * Adds a dummy argument to sts to indicate that the server is launched
             * from the VS Code debug panel. This helps distinguish the sts process
             * in the process list (for .NET Core attach), especially when multiple
             * instances of the extension are running. This is particularly useful on
             * macOS, where the process path is not visible in the process list.
             */
            if (process.env[STS_OVERRIDE_ENV_VAR]) {
                serverArgs.push("--vscode-debug-launch");
            }

            // Enable SQL Auth Provider registration for Azure MFA Authentication
            const enableSqlAuthenticationProvider = getEnableSqlAuthenticationProviderConfig();
            if (enableSqlAuthenticationProvider) {
                serverArgs.push("--enable-sql-authentication-provider");
            }

            // Enable Connection pooling to improve connection performance
            const enableConnectionPooling = getEnableConnectionPoolingConfig();
            if (enableConnectionPooling) {
                serverArgs.push("--enable-connection-pooling");
            }

            let locale = vscode.env.language;
            serverArgs.push("--locale");
            serverArgs.push(locale);
        }

        // run the service host using dotnet.exe from the path
        let serverOptions: ServerOptions = {
            command: serverCommand,
            args: serverArgs,
            transport: TransportKind.stdio,
        };
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
    public sendResourceRequest<P, R, E, R0>(
        type: RequestType<P, R, E, R0>,
        params?: P,
    ): Thenable<R> {
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
    public onNotification<P, R0>(
        type: NotificationType<P, R0>,
        handler: NotificationHandler<P>,
    ): void {
        if (this._client !== undefined) {
            return this.client.onNotification(type, handler);
        }
    }

    public onRequest<P, R, E, R0>(
        type: RequestType<P, R, E, R0>,
        handler: (params: P) => Thenable<R> | R,
    ): void {
        if (this._client !== undefined) {
            return this.client.onRequest(type, handler);
        }
    }
}
