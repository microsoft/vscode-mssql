/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as tmp from "tmp";
import { Runtime, getRuntimeDisplayName } from "../models/platform";
import {
    IConfigUtils,
    IStatusView,
    IPackage,
    PackageError,
    IHttpClient,
    IDecompressProvider,
} from "./interfaces";
import { Logger } from "../models/logger";
import * as Constants from "../constants/constants";
import * as fs from "fs/promises";

/*
 * Service Download Provider class which handles downloading the SQL Tools service.
 */
export default class ServiceDownloadProvider {
    constructor(
        private _config: IConfigUtils,
        private _logger: Logger,
        private _statusView: IStatusView,
        private _httpClient: IHttpClient,
        private _decompressProvider: IDecompressProvider,
    ) {
        // Ensure our temp files get cleaned up in case of error.
        tmp.setGracefulCleanup();
    }

    /**
     * Returns the download url for given platform
     */
    public getDownloadFileName(platform: Runtime): string {
        let fileNamesJson = this._config.getSqlToolsConfigValue("downloadFileNames");
        let fileName = fileNamesJson[platform.toString()];

        if (fileName === undefined) {
            if (process.platform === "linux") {
                throw new Error("Unsupported linux distribution");
            } else {
                throw new Error(`Unsupported platform: ${process.platform}`);
            }
        }

        return fileName;
    }

    /**
     * Returns SQL tools service installed folder, creating it if it doesn't exist.
     */
    public async getOrMakeInstallDirectory(platform: Runtime): Promise<string> {
        let basePath = this.getInstallDirectoryRoot();
        let versionFromConfig = this._config.getSqlToolsPackageVersion();
        basePath = basePath.replace("{#version#}", versionFromConfig);
        basePath = basePath.replace("{#platform#}", getRuntimeDisplayName(platform));
        try {
            await fs.mkdir(basePath, { recursive: true });
        } catch {
            // Best effort to make the folder, if it already exists (expected scenario) or something else happens
            // then just carry on
        }
        return basePath;
    }

    /**
     * Returns SQL tools service installed folder root.
     */
    public getInstallDirectoryRoot(): string {
        let installDirFromConfig = this._config.getSqlToolsInstallDirectory();
        let basePath: string;
        if (path.isAbsolute(installDirFromConfig)) {
            basePath = installDirFromConfig;
        } else {
            // The path from config is relative to the out folder
            basePath = path.join(__dirname, "../" + installDirFromConfig);
        }
        return basePath;
    }

    private getGetDownloadUrl(fileName: string): string {
        let baseDownloadUrl = this._config.getSqlToolsServiceDownloadUrl();
        let version = this._config.getSqlToolsPackageVersion();
        baseDownloadUrl = baseDownloadUrl.replace("{#version#}", version);
        baseDownloadUrl = baseDownloadUrl.replace("{#fileName#}", fileName);
        return baseDownloadUrl;
    }

    /**
     * Downloads the SQL tools service and decompress it in the install folder.
     */
    public async installSQLToolsService(platform: Runtime): Promise<boolean> {
        const fileName = this.getDownloadFileName(platform);
        const installDirectory = await this.getOrMakeInstallDirectory(platform);

        this._logger.appendLine(`${Constants.serviceInstallingTo} ${installDirectory}.`);
        const urlString = this.getGetDownloadUrl(fileName);

        const isZipFile: boolean = path.extname(fileName) === ".zip";

        let pkg: IPackage = {
            installPath: installDirectory,
            url: urlString,
            tmpFile: undefined,
            isZipFile: isZipFile,
        };

        const tmpResult = await this.createTempFile(pkg);
        pkg.tmpFile = tmpResult;

        this._logger.appendLine(
            `${Constants.serviceDownloading} ${urlString} to ${tmpResult.name}`,
        );

        try {
            await this._httpClient.downloadFile(pkg.url, pkg, this._logger, this._statusView);
            this._logger.logDebug(`Downloaded to ${pkg.tmpFile.name}...`);
            this._logger.appendLine(" Done!");
            await this.install(pkg);
        } catch (err) {
            this._logger.appendLine(`[ERROR] ${err}`);
            throw err;
        }
        return true;
    }

    private createTempFile(pkg: IPackage): Promise<tmp.SynchrounousResult> {
        return new Promise<tmp.SynchrounousResult>((resolve, reject) => {
            tmp.file({ prefix: "package-" }, (err, filePath, fd, cleanupCallback) => {
                if (err) {
                    return reject(new PackageError("Error from tmp.file", pkg, err));
                }

                resolve(<tmp.SynchrounousResult>{
                    name: filePath,
                    fd: fd,
                    removeCallback: cleanupCallback,
                });
            });
        });
    }

    private install(pkg: IPackage): Promise<void> {
        this._logger.appendLine("Installing...");
        this._statusView.installingService();

        return new Promise<void>((resolve, reject) => {
            this._decompressProvider
                .decompress(pkg, this._logger)
                .then((_) => {
                    this._statusView.serviceInstalled();
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }
}
