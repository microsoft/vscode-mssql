/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as https from 'https';
import * as http from 'http';
import * as stream from 'stream';
import {parse, Url} from 'url';
import {Runtime, getRuntimeDisplayName} from '../models/platform';
import {getProxyAgent} from './proxy';
import * as path from 'path';
import {IConfig, IStatusView} from './interfaces';
import  {ILogger} from '../models/interfaces';
import Constants = require('../models/constants');

let tmp = require('tmp');
let fs = require('fs');
let fse = require('fs-extra');
const decompress = require('decompress');

tmp.setGracefulCleanup();

/*
* Service Download Provider class which handles downloading the SQL Tools service.
*/
export default class ServiceDownloadProvider {

    constructor(private _config: IConfig,
                private _logger: ILogger,
                private _statusView: IStatusView) {
    }

   /**
    * Returns the download url for given platfotm
    */
    public getDownloadFileName(platform: Runtime): string {
        let fileNamesJson = this._config.getSqlToolsConfigValue('downloadFileNames');
        let fileName = fileNamesJson[platform.toString()];

        if (fileName === undefined) {
            if (process.platform === 'linux') {
                throw new Error('Unsupported linux distribution');
            } else {
                throw new Error(`Unsupported platform: ${process.platform}`);
            }
        }

        return fileName;
    }

    private setStatusUpdate(downloadPercentage: number): void {
        this._statusView.updateServiceDownloadingProgress(downloadPercentage);
    }

    private getHttpClientOptions(url: Url, proxy?: string, strictSSL?: boolean): any {
        const agent = getProxyAgent(url, proxy, strictSSL);

        let options: http.RequestOptions = {
            host: url.hostname,
            path: url.path,
            agent: agent,
            port: +url.port
        };

        if (url.protocol === 'https:') {
            let httpsOptions: https.RequestOptions = {
                    host: url.hostname,
                    path: url.path,
                    agent: agent,
                    port: +url.port
            };
            options = httpsOptions;
        }

        return options;
    }

    private download(urlString: string, proxy?: string, strictSSL?: boolean): Promise<stream.Readable> {
        let url = parse(urlString);
        let options = this.getHttpClientOptions(url, proxy, strictSSL);
        let client = url.protocol === 'http:' ? http : https;

        return new Promise<stream.Readable>((resolve, reject) => {

            let request = client.request(options, response => {
                // handle redirection
                if (response.statusCode === 302 || response.statusCode === 301) {
                    return this.download(response.headers.location, proxy, strictSSL).then(result => {
                        return resolve(result);
                    });
                } else if (response.statusCode !== 200) {
                    return reject(Error(`Download failed with code ${response.statusCode}.`));
                }

                this.handleHttpResponseEvents(response);
                response.on('end', () => {
                    resolve();
                });

                response.on('error', err => {
                    reject(`Reponse error: ${err.code || 'NONE'}`);
                });

                return resolve(response);
            });

            request.on('error', error => {
                reject(`Request error: ${error.code || 'NONE'}`);
            });

            // Execute the request
            request.end();
        });
    }

    private handleHttpResponseEvents(response: http.IncomingMessage): void {
            // Downloading - hook up events
            let packageSize = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;
            let downloadPercentage = 0;
            let dots = 0;

            this._logger.append(`(${Math.ceil(packageSize / 1024)} KB) `);
            response.on('data', data => {
                    downloadedBytes += data.length;

                    // Update status bar item with percentage
                    let newPercentage = Math.ceil(100 * (downloadedBytes / packageSize));
                    if (newPercentage !== downloadPercentage) {
                        this.setStatusUpdate(downloadPercentage);
                        downloadPercentage = newPercentage;
                    }

                    // Update dots after package name in output console
                    let newDots = Math.ceil(downloadPercentage / 5);
                    if (newDots > dots) {
                        this._logger.append('.'.repeat(newDots - dots));
                        dots = newDots;
                    }
            });
    }

   /**
    * Returns SQL tools service installed folder.
    */
    public getInstallDirectory(platform: Runtime): string {

        let basePath = this.getInstallDirectoryRoot();
        let versionFromConfig = this._config.getSqlToolsPackageVersion();
        basePath = basePath.replace('{#version#}', versionFromConfig);
        basePath = basePath.replace('{#platform#}', getRuntimeDisplayName(platform));
        fse.mkdirsSync(basePath);
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
            basePath = path.join(__dirname, '../../' + installDirFromConfig);
        }
        return basePath;
    }

    private getGetDownloadUrl(fileName: string): string {
        let baseDownloadUrl = this._config.getSqlToolsServiceDownloadUrl();
        let version = this._config.getSqlToolsPackageVersion();
        baseDownloadUrl = baseDownloadUrl.replace('{#version#}', version);
        baseDownloadUrl = baseDownloadUrl.replace('{#fileName#}', fileName);
        return baseDownloadUrl;
    }

   /**
    * Downloads the SQL tools service and decompress it in the install folder.
    */
    public InstallSQLToolsService(platform: Runtime): Promise<boolean> {
        const proxy = <string>this._config.getWorkspaceConfig('http.proxy');
        const strictSSL = this._config.getWorkspaceConfig('http.proxyStrictSSL', true);

        return new Promise<boolean>((resolve, reject) => {
            const fileName = this.getDownloadFileName( platform);
            const installDirectory = this.getInstallDirectory(platform);

            this._logger.appendLine(`${Constants.serviceInstallingTo} ${installDirectory}.`);
            const urlString = this.getGetDownloadUrl(fileName);

            this._logger.appendLine(`${Constants.serviceDownloading} ${urlString}`);

            return this.download(urlString, proxy, strictSSL)
                .then(inStream => {
                    this.install(inStream, installDirectory).then ( installed => {
                        resolve(installed);
                    }).catch(installError => {
                        reject(installError);
                    });
                })
                .catch(err => {
                    this._logger.appendLine(`[ERROR] ${err}`);
                    reject(err);
                });
        }).then(res => {
            return res;
        });
    }

    private install(inStream: stream.Readable, installDirectory: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            tmp.file((err, tmpPath, fd, cleanupCallback) => {
                if (err) {
                    reject(err);
                }

                this._logger.logDebug(`Downloading to ${tmpPath}...`);

                const outStream = fs.createWriteStream(undefined, { fd: fd });

                outStream.once('error', outStreamErr => reject(outStreamErr));
                inStream.once('error', inStreamErr => reject(inStreamErr));

                outStream.once('finish', () => {
                    // At this point, the asset has finished downloading.

                    this._logger.appendLine(' Done!');
                    this._logger.appendLine('Installing ...');
                    this._statusView.installingService();

                    return decompress(tmpPath, installDirectory)
                        .then(files => {
                            this._logger.appendLine(`Done! ${files.length} files unpacked.\n`);
                            this._statusView.serviceInstalled();
                            resolve(true);
                        })
                        .catch(decompressErr => {
                            this._logger.appendLine(`[ERROR] ${err}`);
                            reject(decompressErr);
                        });
                });

                inStream.pipe(outStream);
            });
        });
    }
}



