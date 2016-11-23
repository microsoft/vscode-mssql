/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as https from 'https';
import * as http from 'http';
import * as stream from 'stream';
import {parse} from 'url';
import {Runtime, getRuntimeDisplayName} from '../models/platform';
import {getProxyAgent} from './proxy';
import * as path from 'path';
import {IConfig, ILogger} from './interfaces';

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
                private _logger: ILogger) {
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

    private download(urlString: string, proxy?: string, strictSSL?: boolean): Promise<stream.Readable> {
        let url = parse(urlString);

        const agent = getProxyAgent(url, proxy, strictSSL);

        let client = url.protocol === 'http:' ? http : https;
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

        return new Promise<stream.Readable>((resolve, reject) => {
            process.on('uncaughtException', function (err): void {
                // When server DNS address is not valid the http client doesn't return any error code,
                // So the promise never returns any reject or resolve. The only way to fix it was to handle the process exception
                // and check for that specific error message
                if (err !== undefined && err.message !== undefined && (<string>err.message).lastIndexOf('getaddrinfo') >= 0) {
                    reject(err);
                }
            });
            return client.get(options, res => {
                // handle redirection
                if (res.statusCode === 302) {
                    return this.download(res.headers.location).then(result => {
                        return resolve(result);
                    });
                } else if (res.statusCode !== 200) {
                    return reject(Error(`Download failed with code ${res.statusCode}.`));
                }

                return resolve(res);
            });
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
    public go(platform: Runtime): Promise<boolean> {
        const proxy = <string>this._config.getWorkspaceConfig('http.proxy');
        const strictSSL = this._config.getWorkspaceConfig('http.proxyStrictSSL', true);

        return new Promise<boolean>((resolve, reject) => {
            const fileName = this.getDownloadFileName( platform);
            const installDirectory = this.getInstallDirectory(platform);

            this._logger.logDebug(`Installing sql tools service to ${installDirectory}`);
            const urlString = this.getGetDownloadUrl(fileName);

            this._logger.logDebug(`Attempting to download ${urlString}`);

            return this.download(urlString, proxy, strictSSL)
                .then(inStream => {
                    tmp.file((err, tmpPath, fd, cleanupCallback) => {
                        if (err) {
                            return reject(err);
                        }

                        this._logger.logDebug(`Downloading to ${tmpPath}...`);

                        const outStream = fs.createWriteStream(undefined, { fd: fd });

                        outStream.once('error', outStreamErr => reject(outStreamErr));
                        inStream.once('error', inStreamErr => reject(inStreamErr));

                        outStream.once('finish', () => {
                            // At this point, the asset has finished downloading.

                            this._logger.logDebug('Download complete!');
                            this._logger.logDebug('Decompressing...');

                            return decompress(tmpPath, installDirectory)
                                .then(files => {
                                    this._logger.logDebug(`Done! ${files.length} files unpacked.\n`);
                                    return resolve(true);
                                })
                                .catch(decompressErr => {
                                    this._logger.logDebug(`[ERROR] ${err}`);
                                    return reject(decompressErr);
                                });
                        });

                        inStream.pipe(outStream);
                    });
                })
                .catch(err => {
                    this._logger.logDebug(`[ERROR] ${err}`);
                    reject(err);
                });
        }).then(res => {
            return res;
        });
    }
}

