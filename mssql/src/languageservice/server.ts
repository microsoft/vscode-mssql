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
        const stats = await fs.lstat(filePath);
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
     * Download the SQL tools service if doesn't exist and returns the file path.
     */
    public async getOrDownloadServer(runtime: Runtime): Promise<string> {
        // Attempt to find launch file path first from options, and then from the default install location.
        // If SQL tools service can't be found, download it.

        const serverPath = await this.getServerPath(runtime);
        if (serverPath === undefined) {
            return this.downloadServerFiles(runtime);
        } else {
            return serverPath;
        }
    }

    /**
     * Returns the path of the installed service if it exists, or undefined if not
     */
    public async getServerPath(runtime: Runtime): Promise<string | undefined> {
        const installDirectory = await this._downloadProvider.getOrMakeInstallDirectory(runtime);
        return this.findServerPath(installDirectory);
    }

    /**
     * Downloads the service and returns the path of the installed service if it exists
     */
    public async downloadServerFiles(runtime: Runtime): Promise<string> {
        const installDirectory = await this._downloadProvider.getOrMakeInstallDirectory(runtime);
        try {
            await this._downloadProvider.installSQLToolsService(runtime);
            return this.findServerPath(installDirectory);
        } catch (err) {
            this._statusView.serviceInstallationFailed();
            throw err;
        }
    }
}
