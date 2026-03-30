/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Runtime } from "../models/platform";
import ConfigUtils from "../configurations/configUtils";
import ServiceDownloadProvider from "./serviceDownloadProvider";
import DecompressProvider from "./decompressProvider";
import DownloadHelper from "./downloadHelper";
import ServerProvider from "./server";
import { IStatusView } from "./interfaces";
import { ILogger } from "../models/interfaces";
const del = require("del");

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

    verbose(msg: any, ..._vals: any[]): void {
        this._log(msg);
    }

    warn(msg: any, ..._vals: any[]): void {
        this._log(msg);
    }

    error(msg: any, ..._vals: any[]): void {
        this._log(msg);
    }

    piiSanitized(
        _msg: any,
        _objsToSanitize: { name: string; objOrArray: any | any[] }[],
        _stringsToShorten: { name: string; value: string }[],
        ..._vals: any[]
    ): void {
        // no-op
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

const config = new ConfigUtils();
const logger = new StubLogger(console.log);
const statusView = new StubStatusView(console.log);
const downloadHelper = new DownloadHelper();
const decompressProvider = new DecompressProvider();
let downloadProvider = new ServiceDownloadProvider(
    config,
    logger,
    statusView,
    downloadHelper,
    decompressProvider,
);
let serverProvider = new ServerProvider(downloadProvider, statusView);

/*
 * Cleans existing service install and reinstalls the service for the runtime.
 */
export async function cleanAndInstallService(runtime: Runtime): Promise<void> {
    logger.verbose(`Cleaning and installing service for runtime: ${runtime}`);
    const serviceInstallDirectoryRoot = getServiceInstallDirectoryRoot();
    try {
        await del(serviceInstallDirectoryRoot, { force: true });
        logger.verbose(`Deleted service install directory: ${serviceInstallDirectoryRoot}`);
    } catch (error) {
        logger.error(`Error deleting service install directory: ${error.message}`);
        throw error;
    }
    try {
        await resolvedDependencies.downloadAndGetServerInstallFolder(runtime);
    } catch (error) {
        logger.error(`Error installing service for runtime ${runtime}: ${error.message}`);
        throw error;
    }
    logger.verbose(`Service installation complete for runtime: ${runtime}`);
}

/*
 * Returns the path to the root folder of service install location.
 */
export function getServiceInstallDirectoryRoot(): string {
    let directoryPath: string = downloadProvider.getInstallDirectoryRootPath();
    directoryPath = directoryPath.replace("\\{#version#}\\{#platform#}", "");
    directoryPath = directoryPath.replace("/{#version#}/{#platform#}", "");
    return directoryPath;
}
