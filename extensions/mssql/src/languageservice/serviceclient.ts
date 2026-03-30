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
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as Utils from "../models/utils";
import { Logger } from "../models/logger";
import * as Constants from "../constants/constants";
import ServerProvider from "./server";
import ServiceDownloadProvider from "./serviceDownloadProvider";
import DecompressProvider from "./decompressProvider";
import DownloadHelper from "./downloadHelper";
import ExtConfig from "../configurations/extConfig";
import DotnetRuntimeProvider from "./dotnetRuntimeProvider";
import { PlatformInformation, Runtime } from "../models/platform";
import { ServiceClient } from "../constants/locConstants";
import { ServerStatusView } from "./serverStatus";
import StatusView from "../views/statusView";
import * as LanguageServiceContracts from "../models/contracts/languageService";
import { getErrorMessage } from "../utils/utils";
import { getAppDataPath, getEnableConnectionPoolingConfig } from "../azure/utils";
import { serviceName } from "../azure/constants";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

const STS_OVERRIDE_ENV_VAR = "MSSQL_SQLTOOLSSERVICE";
const SERVICE_LAUNCH_TELEMETRY_VIEW = TelemetryViews.ServiceClient;

type ServiceLaunchType =
    | "override"
    | "platformInstalled"
    | "portableInstalled"
    | "portableDownloaded"
    | "platformDownloaded";

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
export class LanguageClientErrorHandler {
    /**
     * Creates an instance of LanguageClientErrorHandler.
     * @memberOf LanguageClientErrorHandler
     */
    constructor(private _name: string) {}

    /**
     * Show an error message prompt with a link to known issues wiki page
     * @memberOf LanguageClientErrorHandler
     */
    showOnErrorPrompt(message: string): void {
        vscode.window
            .showErrorMessage(
                ServiceClient.serviceCrashed(this._name, message),
                ServiceClient.viewKnownIssues,
            )
            .then((action) => {
                if (action === ServiceClient.viewKnownIssues) {
                    void vscode.env.openExternal(
                        vscode.Uri.parse(Constants.sqlToolsServiceCrashLink),
                    );
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
    error(error: Error, _message: IMessage, _count: number): ErrorAction {
        this.showOnErrorPrompt(getErrorMessage(error));

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
        this.showOnErrorPrompt("The service process was unexpectedly closed.");

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
        private _server: ServerProvider,
        private _logger: Logger,
        private _statusView: StatusView,
        private _vscodeWrapper: VscodeWrapper,
        private _dotnetRuntimeProvider: DotnetRuntimeProvider,
    ) {}

    // gets or creates the singleton SQL Tools service client instance
    public static get instance(): SqlToolsServiceClient {
        if (SqlToolsServiceClient._instance === undefined) {
            let config = new ExtConfig();
            let vscodeWrapper = new VscodeWrapper();

            let logger = Logger.create(vscodeWrapper.outputChannel, "SQL Tools Service");

            let serverStatusView = new ServerStatusView();
            let downloadHelper = new DownloadHelper();
            let decompressProvider = new DecompressProvider();
            let downloadProvider = new ServiceDownloadProvider(
                config,
                logger,
                serverStatusView,
                downloadHelper,
                decompressProvider,
            );
            let serviceProvider = new ServerProvider(downloadProvider, serverStatusView);
            let statusView = new StatusView(vscodeWrapper);
            let dotnetRuntimeProvider = new DotnetRuntimeProvider(logger);
            SqlToolsServiceClient._instance = new SqlToolsServiceClient(
                serviceProvider,
                logger,
                statusView,
                vscodeWrapper,
                dotnetRuntimeProvider,
            );
        }
        return SqlToolsServiceClient._instance;
    }

    // initialize the SQL Tools Service Client instance by launching
    // out-of-proc server through the LanguageClient
    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        this._logger.verbose("Initializing SQL Tools Service Client for mssql extension");
        this._logPath = context.logUri.fsPath;
        const platformInfo = await PlatformInformation.getCurrent();
        return this.initializeForPlatform(platformInfo, context);
    }

    public async initializeForPlatform(
        platformInfo: PlatformInformation,
        context: vscode.ExtensionContext,
    ): Promise<void> {
        if (this._vscodeWrapper !== undefined) {
            this._vscodeWrapper.outputChannel.show(true); // Preserve focus.
        }

        if (!platformInfo.isValidRuntime) {
            const unsupportedPlatformMessage = `Unsupported platform: ${platformInfo.platform} and architecture: ${platformInfo.architecture}`;
            this._logger.error(unsupportedPlatformMessage);
            throw new Error(unsupportedPlatformMessage);
        }

        this._logger.verbose(
            `Detected runtime: ${platformInfo.platform} ${platformInfo.architecture}`,
        );

        const launchServer = async (serverInstallFolder: string, runtime: Runtime) => {
            this._sqlToolsServicePath = serverInstallFolder;
            await this.initializeLanguageClient(serverInstallFolder, runtime, context);
            await this._client.onReady();
        };

        /**
         * Attempt to launch the service from a path specified by an environment variable.
         * This is used for debugging and allows for launching a locally built version of the service without
         * having to replace the service in the extension installation folder.
         */
        const stsFolderOverride = process.env[STS_OVERRIDE_ENV_VAR];
        if (stsFolderOverride) {
            try {
                await launchServer(stsFolderOverride, Runtime.Portable);
                this.sendServiceLaunchTelemetry("override", Runtime.Portable, platformInfo);
                return;
            } catch (err) {
                this._logger.error(
                    `Failed to launch SQL Tools Service with overridden path: ${getErrorMessage(err)}`,
                );
                /**
                 * We shouldn't fall back to other launch attempts if the override env variable is set,
                 * since the user explicitly requested to launch from that location.
                 * Show an error message and don't attempt other launch options in this case.
                 */
                throw err;
            }
        }

        /**
         * Attempt to launch offline OS-specific version of service first.
         */
        try {
            const osSpecificServerPath = await this._server.tryGetServerInstallFolder(
                platformInfo.runtimeId,
            );
            if (osSpecificServerPath) {
                this._logger.verbose(
                    `Found OS-specific SQL Tools Service install folder: ${osSpecificServerPath}`,
                );
                await launchServer(osSpecificServerPath, platformInfo.runtimeId);
                this.sendServiceLaunchTelemetry(
                    "platformInstalled",
                    platformInfo.runtimeId,
                    platformInfo,
                );
                return;
            }
        } catch (err) {
            this._logger.error(
                `Failed to launch SQL Tools Service with OS-specific runtime: ${getErrorMessage(err)}`,
            );
        }

        /**
         * Attempt to launch portable version of service next, if not present then download and launch it.
         */
        try {
            let portableServerPath = await this._server.tryGetServerInstallFolder(Runtime.Portable);
            const launchType: ServiceLaunchType = portableServerPath
                ? "portableInstalled"
                : "portableDownloaded";
            if (!portableServerPath) {
                this._logger.verbose(`Could not find portable SQL Tools Service executable.`);
                portableServerPath = await this._server.downloadAndGetServerInstallFolder(
                    Runtime.Portable,
                );
            }
            this._logger.verbose(
                `Found portable SQL Tools Service install folder: ${portableServerPath}`,
            );
            await launchServer(portableServerPath, Runtime.Portable);
            this.sendServiceLaunchTelemetry(launchType, Runtime.Portable, platformInfo);
            return;
        } catch (err) {
            this._logger.error(
                `Failed to launch SQL Tools Service with portable runtime: ${getErrorMessage(err)}`,
            );
        }

        /**
         * Finally, attempt to download and launch the service for detected runtime. This is a temporary
         * fallback and should be removed once we have confidence in the reliability of our portable service.
         */
        try {
            const downloadedServerPath = await this._server.downloadAndGetServerInstallFolder(
                platformInfo.runtimeId,
            );
            await launchServer(downloadedServerPath, platformInfo.runtimeId);
            this.sendServiceLaunchTelemetry(
                "platformDownloaded",
                platformInfo.runtimeId,
                platformInfo,
            );
            return;
        } catch (err) {
            this.logger.error(
                `Failed to download and launch SQL Tools Service: ${getErrorMessage(err)}`,
            );
            sendErrorEvent(
                SERVICE_LAUNCH_TELEMETRY_VIEW,
                TelemetryActions.ServiceStartFailed,
                err instanceof Error ? err : new Error(getErrorMessage(err)),
                false,
                undefined,
                undefined,
                {
                    launchType: "allLaunchStrategiesFailed",
                    detectedRuntime: platformInfo.runtimeId,
                    platform: platformInfo.platform,
                    architecture: platformInfo.architecture,
                },
            );
            const displayError = ServiceClient.unableToStartService(getErrorMessage(err));
            // Determine if this is a download failure or a runtime acquisition failure
            const action = await vscode.window.showErrorMessage(
                displayError,
                ServiceClient.downloadOfflineVsix,
                ServiceClient.copyLinkToClipboard,
            );
            if (action === ServiceClient.downloadOfflineVsix) {
                void vscode.env.openExternal(vscode.Uri.parse(Constants.offlineVsixUrl));
            } else if (action === ServiceClient.copyLinkToClipboard) {
                await vscode.env.clipboard.writeText(Constants.offlineVsixUrl);
                void vscode.window.showInformationMessage(ServiceClient.linkCopiedToClipboard);
            }
            throw new Error(displayError);
        }
    }

    private async initializeLanguageClient(
        serverFolder: string,
        runtime: Runtime,
        context: vscode.ExtensionContext,
    ): Promise<void> {
        if (serverFolder === undefined) {
            this.logger.error("Service folder path is undefined.");
            throw new Error("Service path is undefined.");
        }

        this._logger.verbose(
            `Attempting to launch SQL Tools Service from install folder: ${serverFolder} for runtime: ${runtime}`,
        );

        const sqlToolsServicePath = await this._server.tryGetExecutablePathInFolder(
            serverFolder,
            runtime,
            "MicrosoftSqlToolsServiceLayer",
        );
        if (!sqlToolsServicePath) {
            this.logger.logDebug(
                "Sql Tools Service executable was not found in expected location.",
            );
            throw new Error("Sql Tools Service executable was not found in expected location.");
        }
        this.client = await this.createLanguageClient(sqlToolsServicePath);

        const resourceProviderServicePath = await this._server.tryGetExecutablePathInFolder(
            serverFolder,
            runtime,
            "SqlToolsResourceProviderService",
        );
        if (!resourceProviderServicePath) {
            this.logger.logDebug(
                "Resource Provider Service executable was not found in expected location.",
            );
            throw new Error(
                "Resource Provider Service executable was not found in expected location.",
            );
        }
        this._resourceClient = await this.createResourceClient(resourceProviderServicePath);

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

    private async createLanguageClient(executablePath: string): Promise<LanguageClient> {
        let serverOptions: ServerOptions =
            await this.generateSqlToolsServiceServerOptions(executablePath);
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
            errorHandler: new LanguageClientErrorHandler(Constants.sqlToolsServiceName),
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

    private async createResourceClient(executablePath: string): Promise<LanguageClient> {
        // add resource provider path here
        let serverOptions = await this.generateResourceServiceServerOptions(executablePath);
        const clientOptions: LanguageClientOptions = {
            errorHandler: new LanguageClientErrorHandler(Constants.resourceServiceName),
        };
        let client = new LanguageClient(
            Constants.resourceServiceName,
            serverOptions,
            clientOptions,
        );
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

    private sendServiceLaunchTelemetry(
        launchType: ServiceLaunchType,
        serviceRuntime: Runtime,
        platformInfo: PlatformInformation,
    ): void {
        sendActionEvent(SERVICE_LAUNCH_TELEMETRY_VIEW, TelemetryActions.ServiceStarted, {
            launchType,
            serviceRuntime,
            detectedRuntime: platformInfo.runtimeId,
            platform: platformInfo.platform,
            architecture: platformInfo.architecture,
        });
    }

    /**
     * Common logic to determine executable launch args based on whether the service is a .dll or an executable file.
     * @param executablePath The path to the service executable
     * @returns The command and args to launch the service with
     */
    private async launchCommandAndArgs(
        executablePath: string,
    ): Promise<{ command: string; args: string[] }> {
        if (executablePath.endsWith(".dll")) {
            try {
                return {
                    command: await this._dotnetRuntimeProvider.acquireDotnetRuntime(),
                    args: [executablePath],
                };
            } catch (err) {
                const runtimeError =
                    err instanceof Error ? err : new Error(ServiceClient.runtimeNotFoundError);
                sendErrorEvent(
                    SERVICE_LAUNCH_TELEMETRY_VIEW,
                    TelemetryActions.AcquireDotnetRuntimeFailed,
                    runtimeError,
                    true, // include error message
                    undefined,
                    undefined,
                );
                this._logger.error(
                    `Failed to acquire .NET runtime for launching service: ${getErrorMessage(runtimeError)}`,
                );
                throw runtimeError;
            }
        } else {
            return {
                command: executablePath,
                args: [],
            };
        }
    }

    /**
     * Generate launch commands and args for sts
     * @param servicePath The path to the service executable
     * @returns The server options to launch the service with
     */
    private async generateSqlToolsServiceServerOptions(
        servicePath: string,
    ): Promise<ServerOptions> {
        let { command, args } = await this.launchCommandAndArgs(servicePath);
        // Get the extenion's configuration

        // Populate common args
        args = args.concat(
            Utils.getCommonLaunchArgsAndCleanupOldLogFiles(
                servicePath,
                this._logPath,
                "sqltools.log",
            ),
        );

        // Send application name and path to determine MSAL cache location
        args.push("--application-name", serviceName);
        args.push("--data-path", getAppDataPath());

        /**
         * Adds a dummy argument to sts to indicate that the server is launched
         * from the VS Code debug panel. This helps distinguish the sts process
         * in the process list (for .NET Core attach), especially when multiple
         * instances of the extension are running. This is particularly useful on
         * macOS, where the process path is not visible in the process list.
         */
        if (process.env[STS_OVERRIDE_ENV_VAR]) {
            args.push("--vscode-debug-launch");
        }

        // Enable SQL Auth Provider registration for Azure MFA Authentication
        args.push("--enable-sql-authentication-provider");

        // Enable Connection pooling to improve connection performance
        const enableConnectionPooling = getEnableConnectionPoolingConfig();
        if (enableConnectionPooling) {
            args.push("--enable-connection-pooling");
        }

        let locale = vscode.env.language;
        args.push("--locale");
        args.push(locale);

        // Enable parallel message processing to improve performance
        args.push("--parallel-message-processing");
        args.push("--parallel-message-processing-limit");
        args.push(String(100));

        // run the service host using dotnet.exe from the path
        return {
            command,
            args,
            transport: TransportKind.stdio,
        };
    }

    /**
     * Generate launch commands and args for resource provider service
     * @param executablePath The path to the resource provider service executable
     * @returns The server options to launch the service with
     */
    private async generateResourceServiceServerOptions(
        executablePath: string,
    ): Promise<ServerOptions> {
        let { command, args } = await this.launchCommandAndArgs(executablePath);
        args = [
            ...args,
            ...Utils.getCommonLaunchArgsAndCleanupOldLogFiles(
                executablePath,
                this._logPath,
                "resourceprovider.log",
            ),
        ];
        return {
            command,
            args,
            transport: TransportKind.stdio,
        };
    }

    /**
     * Send a request to the service client
     * @param type The of the request to make
     * @param params The params to pass with the request
     * @returns A thenable object for when the request receives a response
     */
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
     * @param type The notification type to send
     * @param params The params to pass with the notification
     */
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
    public onNotification<P, R0>(
        type: NotificationType<P, R0>,
        handler: NotificationHandler<P>,
    ): void {
        if (this._client !== undefined) {
            return this.client.onNotification(type, handler);
        }
    }

    /**
     * Register a handler for a request type
     * @param type The request type to register the handler for
     * @param handler The handler to register
     * @returns void
     */
    public onRequest<P, R, E, R0>(
        type: RequestType<P, R, E, R0>,
        handler: (params: P) => Thenable<R> | R,
    ): void {
        if (this._client !== undefined) {
            return this.client.onRequest(type, handler);
        }
    }
}
