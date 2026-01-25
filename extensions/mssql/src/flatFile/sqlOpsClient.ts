/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServerProvider } from "@microsoft/ads-service-downloader";
import { ServerOptions, TransportKind } from "vscode-languageclient";
import * as vscode from "vscode";
import * as path from "path";
import { EventAndListener } from "eventemitter2";
import { FlatFileFeature } from "./flatFileFeature";
import { promises as fs } from "fs";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import {
    configLogDebugInfo,
    extensionConfigSectionName,
    languageId,
    mssqlProviderName,
    sqlOpsServiceName,
} from "../constants/constants";
import * as Loc from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { LanguageClientErrorHandler } from "../languageservice/serviceclient";
import {
    ClientOptions,
    CustomOutputChannel,
    SqlOpsDataClient,
    Events,
    LogLevel,
} from "./clientInterfaces";

export class SqlOpsClient {
    private statusView: vscode.StatusBarItem;

    constructor(private outputChannel: vscode.OutputChannel) {
        this.statusView = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    }

    public async startService(context: vscode.ExtensionContext): Promise<SqlOpsDataClient> {
        const configPath = path.join(context.extensionPath, "flatFileConfig.json");
        const rawConfig = await fs.readFile(configPath);
        let clientOptions: ClientOptions = this.createClientOptions();
        try {
            const installationStart = Date.now();
            let client: SqlOpsDataClient;
            let serviceBinaries = await this.downloadBinaries(context, rawConfig);
            const installationComplete = Date.now();
            let serverOptions = this.generateServerOptions(serviceBinaries, context);
            client = new SqlOpsDataClient(sqlOpsServiceName, serverOptions, clientOptions);
            const processStart = Date.now();
            client.onReady().then(() => {
                const processEnd = Date.now();
                this.statusView.text = Loc.SqlOps.serviceStarted(sqlOpsServiceName);
                setTimeout(() => {
                    this.statusView.hide();
                }, 1500);
                sendActionEvent(
                    TelemetryViews.SQLOps,
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
            this.statusView.show();
            this.statusView.text = Loc.SqlOps.serviceStarting(sqlOpsServiceName);
            let disposable = client.start();
            context.subscriptions.push(disposable);
            return client;
        } catch (error) {
            sendErrorEvent(TelemetryViews.SQLOps, TelemetryActions.ServiceStarted, error, false);
            vscode.window.showErrorMessage(
                Loc.SqlOps.serviceStartFailed(sqlOpsServiceName, error.message),
            );
            // Just resolve to avoid unhandled promise. We show the error to the user.
            return undefined;
        }
    }

    public async downloadBinaries(
        context: vscode.ExtensionContext,
        rawConfig: Buffer,
    ): Promise<string> {
        const config = JSON.parse(rawConfig.toString());
        config.installDirectory = path.join(context.extensionPath, config.installDirectory);
        config.proxy = vscode.workspace.getConfiguration("http").get("proxy");
        config.strictSSL = vscode.workspace.getConfiguration("http").get("proxyStrictSSL", true);
        const serverdownloader = new ServerProvider(config);
        serverdownloader.eventEmitter.onAny(this.generateHandleServerProviderEvent());
        return serverdownloader.getOrDownloadServer();
    }

    private createClientOptions(): ClientOptions {
        return {
            providerId: mssqlProviderName,
            errorHandler: new LanguageClientErrorHandler(),
            synchronize: {
                configurationSection: [extensionConfigSectionName, languageId],
            },
            features: [
                // we only want to add new features
                FlatFileFeature,
            ],
            outputChannel: new CustomOutputChannel(),
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

    private generateHandleServerProviderEvent(): EventAndListener {
        let dots = 0;
        return (e: string, ...args: any[]) => {
            switch (e) {
                case Events.INSTALL_START:
                    this.outputChannel.show(true);
                    this.statusView.show();
                    this.outputChannel.appendLine(
                        Loc.SqlOps.installingServiceTo(sqlOpsServiceName, args[0]),
                    );
                    this.statusView.text = Loc.SqlOps.installingService(sqlOpsServiceName);
                    break;
                case Events.INSTALL_END:
                    this.outputChannel.appendLine(Loc.SqlOps.serviceInstalled(sqlOpsServiceName));
                    break;
                case Events.DOWNLOAD_START:
                    this.outputChannel.appendLine(Loc.SqlOps.downloadingService(sqlOpsServiceName));
                    this.outputChannel.append(
                        Loc.SqlOps.downloadSize(
                            Math.ceil(args[1] / 1024).toLocaleString(vscode.env.language),
                        ),
                    );
                    this.statusView.text = Loc.SqlOps.downloadingService(sqlOpsServiceName);

                    break;
                case Events.DOWNLOAD_PROGRESS:
                    let newDots = Math.ceil(args[0] / 5);
                    if (newDots > dots) {
                        this.outputChannel.append(".".repeat(newDots - dots));
                        dots = newDots;
                    }
                    break;
                case Events.DOWNLOAD_END:
                    this.outputChannel.appendLine(Loc.SqlOps.downloadComplete(sqlOpsServiceName));
                    break;
                case Events.ENTRY_EXTRACTED:
                    this.outputChannel.appendLine(
                        Loc.SqlOps.entryExtracted(args[0], args[1], args[2]),
                    );
                    break;
                case Events.LOG_EMITTED:
                    if (args[0] >= LogLevel.Warning) {
                        this.outputChannel.appendLine(args[1]);
                    }
                    break;
                default:
                    break;
            }
        };
    }
}
