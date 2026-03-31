/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { Runtime } from "../models/platform";
import ServiceDownloadProvider from "./serviceDownloadProvider";
import { IStatusView } from "./interfaces";
import * as fs from "fs/promises";

/*
 * Service Provider class finds the SQL tools service executable file or downloads it if doesn't exist.
 */
export default class ServerProvider {
    constructor(
        private _downloadProvider: ServiceDownloadProvider,
        private _statusView: IStatusView,
    ) {}

    /**
     * Finds the service executable file in the given folder path. Returns the file path if found, or undefined if not found.
     * @param folderPath The folder path to look for the service executable file.
     * @param runtime The runtime for which to find the service executable file, used to determine the expected file name.
     * @param filePrefix The prefix of the service executable file name, used to construct the expected file name based on the runtime.
     * @returns The file path of the service executable if found, or undefined if not found.
     */
    public async tryGetExecutablePathInFolder(
        folderPath: string,
        runtime: Runtime,
        filePrefix: string,
    ): Promise<string | undefined> {
        let fileName;
        if (runtime === Runtime.Portable) {
            fileName = `${filePrefix}.dll`;
        } else if (runtime === Runtime.Windows_64 || runtime === Runtime.Windows_ARM64) {
            fileName = `${filePrefix}.exe`;
        } else {
            fileName = filePrefix;
        }
        const resolvedPath = path.join(folderPath, fileName);
        const stats = await fs.stat(resolvedPath).catch(() => undefined);
        if (!stats?.isFile()) {
            return undefined;
        }
        return resolvedPath;
    }

    /**
     * Finds the service folder for the given runtime. Returns the folder path if found, or undefined if not found.
     * @param runtime The runtime for which to find the service folder, used to determine the expected folder name.
     * @returns The folder path of the service if found, or undefined if not found.
     */
    public async tryGetServerInstallFolder(runtime: Runtime): Promise<string | undefined> {
        return await this._downloadProvider.tryGetInstallDirectory(runtime);
    }

    /**
     * Downloads the service and returns the path of the installed service if it exists
     */
    public async downloadAndGetServerInstallFolder(runtime: Runtime): Promise<string> {
        const installDirectory = await this._downloadProvider.getOrCreateInstallDirectory(runtime);
        try {
            await this._downloadProvider.downloadAndInstallService(runtime);
            return installDirectory;
        } catch (err) {
            this._statusView.serviceInstallationFailed();
            throw err;
        }
    }
}
