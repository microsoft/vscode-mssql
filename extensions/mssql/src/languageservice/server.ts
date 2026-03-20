/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { Runtime } from "../models/platform";
import ServiceDownloadProvider from "./serviceDownloadProvider";
import { IConfigUtils, IStatusView } from "./interfaces";
import * as fs from "fs/promises";

/*
 * Service Provider class finds the SQL tools service executable file or downloads it if doesn't exist.
 */
export default class ServerProvider {
    constructor(
        private _downloadProvider: ServiceDownloadProvider,
        private _config: IConfigUtils,
        private _statusView: IStatusView,
    ) {}

    /**
     * Given a file path, returns the path to the SQL Tools service file.
     */
    public async findServerPath(filePath: string): Promise<string | undefined> {
        let stats;
        try {
            stats = await fs.lstat(filePath);
        } catch {
            return undefined;
        }
        // If a file path was passed, assume its the launch file.
        if (stats.isFile()) {
            return filePath;
        }

        // Otherwise, search the specified folder.
        if (this._config !== undefined) {
            let executableFiles: string[] = this._config.getSqlToolsExecutableFiles();

            for (const executableFile of executableFiles) {
                const executablePath = path.join(filePath, executableFile);
                try {
                    if (await fs.stat(executablePath)) {
                        return executablePath;
                    }
                } catch (err) {
                    // no-op, the exe files list has all possible options and so depending on the platform we expect some
                    // to always fail
                }
            }
        }
        return undefined;
    }

    /**
     * Download the service if doesn't exist and returns the file path.
     * Checks the platform-specific install directory first, then the portable directory,
     * Downloads the service for the given runtime if not already present.
     * At runtime, this downloads the portable (framework-dependent) package.
     * During offline packaging, a platform-specific runtime is passed directly.
     */
    public async getOrDownloadServer(runtime: Runtime): Promise<string> {
        // Attempt to find launch file path first from options, and then from the default install location.
        // If service can't be found, download it.

        const serverPath = await this.getServerPath(runtime);
        if (serverPath === undefined) {
            return this.downloadServerFiles(runtime);
        } else {
            return serverPath;
        }
    }

    /**
     * Returns the path of the installed service if it exists, or undefined if not.
     * Checks the platform-specific directory first (offline VSIX with built-in runtime),
     * then falls back to the portable (framework-dependent) directory.
     */
    public async getServerPath(runtime: Runtime): Promise<string | undefined> {
        // Check platform-specific directory first (self-contained builds include their own dotnet)
        if (runtime !== Runtime.Portable) {
            const installDirectory =
                await this._downloadProvider.getOrMakeInstallDirectory(runtime);
            const platformPath = await this.findServerPath(installDirectory);
            if (platformPath) {
                return platformPath;
            }
        }

        // Fall back to portable (framework-dependent) directory
        const portableDirectory = await this._downloadProvider.getOrMakeInstallDirectory(
            Runtime.Portable,
        );
        return this.findServerPath(portableDirectory);
    }

    /**
     * Downloads the service and returns the path of the installed service if it exists
     */
    public async downloadServerFiles(runtime: Runtime): Promise<string> {
        const installDirectory = await this._downloadProvider.getOrMakeInstallDirectory(runtime);
        try {
            await this._downloadProvider.installService(runtime);
            return this.findServerPath(installDirectory);
        } catch (err) {
            this._statusView.serviceInstallationFailed();
            throw err;
        }
    }
}
