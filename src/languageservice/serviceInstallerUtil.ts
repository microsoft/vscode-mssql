/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Runtime, PlatformInformation } from "../models/platform";
import Config from "../configurations/config";
import ServiceDownloadProvider from "./serviceDownloadProvider";
import DecompressProvider from "./decompressProvider";
import HttpClient from "./httpClient";
import ServerProvider from "./server";
import { IStatusView } from "./interfaces";
import { ILogger } from "../models/interfaces";

export class StubStatusView implements IStatusView {
    constructor(private _log: (msg: string) => void) {}

    installingService(): void {
        this._log("...");
    }
    serviceInstalled(): void {
        this._log("Service installed");
    }
    serviceInstallationFailed(): void {
        this._log("Service installation failed");
    }
    updateServiceDownloadingProgress(downloadPercentage: number): void {
        if (downloadPercentage === 100) {
            this._log("100%");
        }
    }
}

export class StubLogger implements ILogger {
    constructor(private _log: (msg: string) => void) {}

    logDebug(message: string): void {
        this._log(message);
    }

    increaseIndent(): void {
        // no-op
    }

    decreaseIndent(): void {
        // no-op
    }

    append(message?: string): void {
        this._log(message);
    }
    appendLine(message?: string): void {
        this._log(message);
    }
}

const config = new Config();
const logger = new StubLogger(console.log);
const statusView = new StubStatusView(console.log);
const httpClient = new HttpClient();
const decompressProvider = new DecompressProvider();
let downloadProvider = new ServiceDownloadProvider(
    config,
    logger,
    statusView,
    httpClient,
    decompressProvider,
);
let serverProvider = new ServerProvider(downloadProvider, config, statusView);

/*
 * Installs the service for the given platform if it's not already installed.
 */
export function installService(runtime: Runtime): Promise<String> {
    if (runtime === undefined) {
        return PlatformInformation.getCurrent().then((platformInfo) => {
            if (platformInfo.isValidRuntime) {
                return serverProvider.getOrDownloadServer(platformInfo.runtimeId);
            } else {
                throw new Error("unsupported runtime");
            }
        });
    } else {
        return serverProvider.getOrDownloadServer(runtime);
    }
}

/*
 * Returns the install folder path for given platform.
 */
export function getServiceInstallDirectory(runtime: Runtime): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        if (runtime === undefined) {
            PlatformInformation.getCurrent()
                .then((platformInfo) => {
                    if (platformInfo.isValidRuntime) {
                        resolve(downloadProvider.getOrMakeInstallDirectory(platformInfo.runtimeId));
                    } else {
                        reject("unsupported runtime");
                    }
                })
                .catch((error) => {
                    reject(error);
                });
        } else {
            resolve(downloadProvider.getOrMakeInstallDirectory(runtime));
        }
    });
}

/*
 * Returns the path to the root folder of service install location.
 */
export function getServiceInstallDirectoryRoot(): string {
    let directoryPath: string = downloadProvider.getInstallDirectoryRoot();
    directoryPath = directoryPath.replace("\\{#version#}\\{#platform#}", "");
    directoryPath = directoryPath.replace("/{#version#}/{#platform#}", "");
    return directoryPath;
}
