/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageClient, ServerOptions, TransportKind } from "vscode-languageclient";
import * as vscode from "vscode";
import { FlatFileFeature } from "./flatFileFeature";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import {
    configLogDebugInfo,
    extensionConfigSectionName,
    languageId,
    mssqlProviderName,
    flatFileServiceName,
} from "../constants/constants";
import * as Loc from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { LanguageClientErrorHandler } from "../languageservice/serviceclient";
import { FlatFileClientOptions } from "./clientInterfaces";
import { ServerStatusView } from "../languageservice/serverStatus";
import DownloadHelper from "../languageservice/downloadHelper";
import DecompressProvider from "../languageservice/decompressProvider";
import ServiceDownloadProvider from "../languageservice/serviceDownloadProvider";
import { DownloadType } from "../languageservice/interfaces";
import ExtConfig from "../configurations/extConfig";
import { Logger } from "../models/logger";
import vscodeWrapper from "../controllers/vscodeWrapper";
import ServerProvider from "../languageservice/server";
import { PlatformInformation } from "../models/platform";

export class FlatFileClient {
    private config: ExtConfig = new ExtConfig();
    private logger: Logger;
    private serverStatusView: ServerStatusView = new ServerStatusView();
    private httpClient: DownloadHelper = new DownloadHelper();
    private decompressProvider = new DecompressProvider();
    private downloadProvider: ServiceDownloadProvider;
    private serverProvider: ServerProvider;

    constructor(vsCodeWrapper: vscodeWrapper) {
        this.logger = Logger.create(vsCodeWrapper.outputChannel, "Flat File Service");

        this.downloadProvider = new ServiceDownloadProvider(
            this.config,
            this.logger,
            this.serverStatusView,
            this.httpClient,
            this.decompressProvider,
            DownloadType.FlatFileService,
        );
        this.serverProvider = new ServerProvider(
            this.downloadProvider,
            this.config,
            this.serverStatusView,
        );
    }

    /**
     * Starts the SQL Ops client for flat file, which includes downloading the service if not already present, and starting the language client.
     * @param context The vscode extension context, used for storage and other extension related functionality.
     * @returns The flat file client
     */
    public async startFlatFileService(
        context: vscode.ExtensionContext,
    ): Promise<LanguageClient | undefined> {
        let clientOptions: FlatFileClientOptions = this.createClientOptions();
        try {
            const installationStart = Date.now();
            let client: LanguageClient;
            let serviceBinaries = await PlatformInformation.getCurrent().then((platformInfo) => {
                return this.downloadBinaries(platformInfo);
            });
            const installationComplete = Date.now();
            let serverOptions = this.generateServerOptions(serviceBinaries, context);
            client = new LanguageClient(flatFileServiceName, serverOptions, clientOptions);
            const processStart = Date.now();
            void client.onReady().then(() => {
                const processEnd = Date.now();
                this.serverStatusView.statusBarItem.text =
                    Loc.FlatFileImport.serviceStarted(flatFileServiceName);
                setTimeout(() => {
                    this.serverStatusView.statusBarItem.hide();
                }, 1500);
                sendActionEvent(
                    TelemetryViews.FlatFile,
                    TelemetryActions.ServiceStarted,
                    {},
                    {
                        installationTime: installationComplete - installationStart,
                        processStartupTime: processEnd - processStart,
                        totalTime: processEnd - installationStart,
                        beginningTimestamp: installationStart,
                    },
                );
            });
            client.registerFeatures(clientOptions.features.map((feature) => new feature(client)));
            this.serverStatusView.statusBarItem.show();
            this.serverStatusView.statusBarItem.text =
                Loc.FlatFileImport.serviceStarting(flatFileServiceName);
            let disposable = client.start();
            context.subscriptions.push(disposable);
            return client;
        } catch (error) {
            sendErrorEvent(TelemetryViews.FlatFile, TelemetryActions.ServiceStarted, error, false);
            vscode.window.showErrorMessage(
                Loc.FlatFileImport.serviceStartFailed(flatFileServiceName, error.message),
            );
            // Just resolve to avoid unhandled promise. We show the error to the user.
            return undefined;
        }
    }

    public async downloadBinaries(platformInfo: PlatformInformation): Promise<string> {
        const serverPath = await this.serverProvider.getServerPath(platformInfo.runtimeId);

        if (serverPath === undefined) {
            const installedServerPath = await this.serverProvider.downloadServerFiles(
                platformInfo.runtimeId,
            );
            return installedServerPath;
        }

        return serverPath;
    }

    private createClientOptions(): FlatFileClientOptions {
        return {
            providerId: mssqlProviderName,
            errorHandler: new LanguageClientErrorHandler(),
            synchronize: {
                configurationSection: [extensionConfigSectionName, languageId],
            },
            features: [
                // We only want to add new features
                // Add more SQL Opsfeatures here as needed
                FlatFileFeature,
            ],
        };
    }

    private generateServerOptions(
        executablePath: string,
        context: vscode.ExtensionContext,
    ): ServerOptions {
        let launchArgs = [];
        launchArgs.push("--log-dir");
        let logFileLocation = context.logUri.fsPath;
        launchArgs.push(logFileLocation);
        let config = vscode.workspace.getConfiguration(extensionConfigSectionName);
        if (config) {
            let logDebugInfo = config[configLogDebugInfo];
            if (logDebugInfo) {
                launchArgs.push("--enable-logging");
            }
        }

        return { command: executablePath, args: launchArgs, transport: TransportKind.stdio };
    }
}
