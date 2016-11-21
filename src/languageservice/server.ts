/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as path from 'path';
import {Runtime, PlatformInformation} from '../models/platform';
import ServiceDownloadProvider from './download';
import {IConfig, IStatusView, IExtensionWrapper} from './interfaces';
let fs = require('fs-extra-promise');


/*
* Service Provider class finds the SQL tools service executable file or downloads it if doesn't exist.
*/
export default class ServerProvider {

    constructor(private _downloadProvider: ServiceDownloadProvider,
                private _config: IConfig,
                private _statusView: IStatusView,
                private _vsCodeExtention: IExtensionWrapper) {
    }

    /**
     * Given a file path, returns the path to the SQL Tools service file.
     */
    public findServerPath(filePath: string): Promise<string> {
        return fs.lstatAsync(filePath).then(stats => {
            // If a file path was passed, assume its the launch file.
            if (stats.isFile()) {
                return filePath;
            }

            // Otherwise, search the specified folder.
            let candidate: string;

            if (this._config !== undefined) {
                let executableFiles: string[] = this._config.getSqlToolsExecutableFiles();
                executableFiles.forEach(element => {
                    let executableFile = path.join(filePath, element);
                    if (candidate === undefined && fs.existsSync(executableFile)) {
                        candidate = executableFile;
                        return candidate;
                    }
                });
            }

            return candidate;
        });
    }

    /**
     * Download the SQL tools service if doesn't exist and returns the file path.
     */
    public getServerPath(runtime?: Runtime): Promise<string> {

        if (runtime === undefined) {
            return PlatformInformation.GetCurrent().then( currentPlatform => {
                return this.getServerPathForPlatform(currentPlatform.runtimeId);
            });
        } else {
            return this.getServerPathForPlatform(runtime);
        }

    }

    private getServerPathForPlatform(runtime: Runtime): Promise<string> {
        // Attempt to find launch file path first from options, and then from the default install location.
        // If SQL tools service can't be found, download it.

        const installDirectory = this._downloadProvider.getInstallDirectory(runtime);

        return new Promise<string>((resolve, reject) => {
            return this.findServerPath(installDirectory).then(result => {
                if (result === undefined) {
                    return this.downloadServerFiles(runtime).then ( downloadResult => {
                        resolve(downloadResult);
                    });
                } else {
                  return resolve(result);
                }
            }).catch(err => {
                    return reject(err);
                });
        }).catch(err => {
           throw err;
        });
    }

    private downloadServerFiles(runtime: Runtime): Promise<string> {
        const installDirectory = this._downloadProvider.getInstallDirectory(runtime);
        let currentFileUrl = this._vsCodeExtention.getActiveTextEditorUri();
        this._statusView.installingService(currentFileUrl);
        return this._downloadProvider.go(runtime).then( _ => {
            return this.findServerPath(installDirectory).then ( result => {
                 this._statusView.serviceInstalled(currentFileUrl);
                 return result;
            });

        }).catch(err => {
            this._statusView.serviceInstallationFailed(currentFileUrl);
            throw err;
        });
    }
}
