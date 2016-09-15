/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as path from 'path';
import * as Utils from '../models/utils';
import {Platform, getCurrentPlatform} from '../models/platform';
import ServiceDownloadProvider from './download';
import StatusView from '../views/statusView';
import Config from  '../configurations/config';
let fs = require('fs-extra-promise');

/*
* Service Provider class finds the SQL tools service executable file or downloads it if doesn't exist.
*/
export default class ServerProvider {

    constructor(private _downloadProvider?: ServiceDownloadProvider,
                private _config?: Config,
                private _statusView?: StatusView) {
                    if (!this._config) {
                        this._config = new Config();
                    }
                    if (!this._downloadProvider) {
                        this._downloadProvider = new ServiceDownloadProvider(this._config);
                    }
                    if (!this._statusView) {
                        this._statusView = new StatusView();
                    }
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
    public getServerPath(): Promise<string> {

        // Attempt to find launch file path first from options, and then from the default install location.
        // If SQL tools service can't be found, download it.

        const installDirectory = this._downloadProvider.getInstallDirectory();

        return new Promise<string>((resolve, reject) => {
            return this.findServerPath(installDirectory).then(result => {
                if (result === undefined) {
                    return this.downloadServerFiles().then ( downloadResult => {
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

    private downloadServerFiles(): Promise<string> {
        const platform = getCurrentPlatform();
        if (platform === Platform.Unknown) {
            throw new Error('Invalid Platform');
        }

        const installDirectory = this._downloadProvider.getInstallDirectory();
        let currentFileUrl = Utils.getActiveTextEditorUri();
        this._statusView.installingService(currentFileUrl);
        return this._downloadProvider.go(platform).then( _ => {
            return this.findServerPath(installDirectory).then ( result => {
                 this._statusView.serviceInstalled(currentFileUrl);
                 return result;
            });

        });
    }
}
