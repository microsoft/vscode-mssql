/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as tmp from "tmp";
import * as vscode from "vscode";
import { Runtime, getRuntimeDisplayName } from "../models/platform";
import {
    IConfigUtils,
    IStatusView,
    IPackage,
    PackageError,
    IDecompressProvider,
} from "./interfaces";
import * as Constants from "../constants/constants";
import * as fs from "fs/promises";
import { ILogger } from "../models/interfaces";
import DownloadHelper from "./downloadHelper";
import { validateExtractedBinaries } from "./signatureVerifier";

/*
 * Service Download Provider class which handles downloading the SQL tools service.
 */
export default class ServiceDownloadProvider {
    constructor(
        private _config: IConfigUtils,
        private _logger: ILogger,
        private _statusView: IStatusView,
        private _downloadHelper: DownloadHelper,
        private _decompressProvider: IDecompressProvider,
    ) {
        // Ensure our temp files get cleaned up in case of error.
        tmp.setGracefulCleanup();
    }

    /**
     * Returns the download url for given platform
     */
    private getRuntimeDownloadPackageFileName(platform: Runtime): string {
        let fileNamesJson: any = this._config.getSqlToolsConfigValue("downloadFileNames");

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

    private async getInstallDirectoryPathForRuntime(runtime: Runtime): Promise<string> {
        let basePath = this.getInstallDirectoryRootPath();
        let versionFromConfig: string = this._config.getSqlToolsPackageVersion();
        basePath = basePath.replace("{#version#}", versionFromConfig);
        basePath = basePath.replace("{#platform#}", getRuntimeDisplayName(runtime));
        return basePath;
    }

    /**
     * Checks if the service is present and return the path of the installed service and if not present, returns undefined.
     * @param runtime
     */
    public async tryGetInstallDirectory(runtime: Runtime): Promise<string | undefined> {
        let basePath = await this.getInstallDirectoryPathForRuntime(runtime);
        try {
            await fs.access(basePath);
            return basePath;
        } catch {
            return undefined;
        }
    }

    /**
     * Returns SQL tools service installed folder, creating it if it doesn't exist.
     */
    public async getOrCreateInstallDirectory(platform: Runtime): Promise<string> {
        let basePath = await this.getInstallDirectoryPathForRuntime(platform);
        if (await this.tryGetInstallDirectory(platform)) {
            return basePath;
        }
        this._logger.verbose(
            `Creating install directory for platform ${platform} at path ${basePath}`,
        );
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
    public getInstallDirectoryRootPath(): string {
        let installDirFromConfig: string = this._config.getSqlToolsInstallDirectory();

        let basePath: string;
        if (path.isAbsolute(installDirFromConfig)) {
            basePath = installDirFromConfig;
        } else {
            // The path from config is relative to the out folder
            basePath = path.join(__dirname, "../" + installDirFromConfig);
        }
        return basePath;
    }

    /**
     * Downloads the SQL tools service and decompresses it in the install folder.
     */
    public async downloadAndInstallService(platform: Runtime): Promise<boolean> {
        const fileName = this.getRuntimeDownloadPackageFileName(platform);
        const installDirectory = await this.getOrCreateInstallDirectory(platform);

        this._logger.appendLine(`${Constants.serviceInstallingTo} ${installDirectory}.`);
        const urlString = this.buildDownloadUrl(fileName);

        const isZipFile: boolean = path.extname(fileName) === ".zip";

        this._logger.appendLine(`${Constants.serviceDownloading} ${urlString}`);
        let pkg: IPackage = {
            installPath: installDirectory,
            url: urlString,
            tmpFile: undefined,
            isZipFile: isZipFile,
        };
        const tmpResult = await this.createTempPackageFile(pkg);
        pkg.tmpFile = tmpResult;

        try {
            await this._downloadHelper.downloadFile(pkg.url, pkg, this._logger, this._statusView);
            this._logger.logDebug(`Downloaded to ${pkg.tmpFile.name}...`);
            this._logger.appendLine(" Done!");
            await this.decompressAndInstallPackage(pkg);
        } catch (err) {
            this._logger.appendLine(`[ERROR] ${err}`);
            throw err;
        }

        const verificationDisabled = vscode.workspace
            .getConfiguration(Constants.extensionConfigSectionName)
            .get<boolean>(Constants.configDisableSignatureVerification, false);

        if (verificationDisabled) {
            this._logger.warn(
                `Signature verification is disabled by configuration ` +
                    `(${Constants.extensionConfigSectionName}.${Constants.configDisableSignatureVerification}). ` +
                    "Skipping binary signature checks.",
            );
            return true;
        }

        try {
            await validateExtractedBinaries(installDirectory, platform, this._logger);
        } catch (err) {
            this._logger.error(String(err));
            try {
                await fs.rm(installDirectory, { recursive: true, force: true });
            } catch (cleanupErr) {
                this._logger.error(
                    `Failed to remove install directory after signature validation failure: ${cleanupErr}`,
                );
            }
            throw new Error(
                vscode.l10n.t(
                    "SQL Tools Service installation failed because one or more downloaded binaries did not pass Microsoft signature validation. The downloaded files were removed for safety.",
                ),
            );
        }

        return true;
    }

    private buildDownloadUrl(fileName: string): string {
        let baseDownloadUrl: string = this._config.getSqlToolsServiceDownloadUrl();
        let version: string = this._config.getSqlToolsPackageVersion();

        baseDownloadUrl = baseDownloadUrl.replace("{#version#}", version);
        baseDownloadUrl = baseDownloadUrl.replace("{#fileName#}", fileName);
        return baseDownloadUrl;
    }

    private createTempPackageFile(pkg: IPackage): Promise<tmp.SynchrounousResult> {
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

    private async decompressAndInstallPackage(pkg: IPackage): Promise<void> {
        this._logger.appendLine("Installing ...");
        this._statusView.installingService();
        await this._decompressProvider.decompress(pkg, this._logger);
        this._statusView.serviceInstalled();
    }
}
