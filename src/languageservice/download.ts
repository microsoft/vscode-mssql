/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as https from 'https';
import * as http from 'http';
import * as stream from 'stream';
import {parse} from 'url';
import {Platform} from '../models/platform';
import {getProxyAgent} from './proxy';
import Utils = require('../models/utils');
import Config from  '../configurations/config';
import * as path from 'path';
import { workspace } from 'vscode';

let tmp = require('tmp');
let fs = require('fs');
const decompress = require('decompress');

tmp.setGracefulCleanup();

/*
* Service Download Provider class which handles downloading the SQL Tools service.
*/
export default class ServiceDownloadProvider {

    constructor(private _config: Config) {
        if (!this._config) {
            this._config = new Config();
        }
    }

   /**
    * Returns the download url for given platfotm
    */
    public getDownloadFileName(platform: Platform): string {
        let fileName = 'microsoft.sqltools.servicelayer-';

        switch (platform) {
                case Platform.Windows:
                    fileName += 'win-x64-netcoreapp1.0.zip';
                    break;
                case Platform.OSX:
                    fileName += 'osx-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.CentOS:
                    fileName += 'centos-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.Debian:
                    fileName += 'debian-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.Fedora:
                    fileName += 'fedora-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.OpenSUSE:
                    fileName += 'opensuse-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.RHEL:
                    fileName += 'rhel-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.Ubuntu14:
                    fileName += 'ubuntu14-x64-netcoreapp1.0.tar.gz';
                    break;
                case Platform.Ubuntu16:
                    fileName += 'ubuntu16-x64-netcoreapp1.0.tar.gz';
                    break;
                default:
                    if (process.platform === 'linux') {
                        throw new Error('Unsupported linux distribution');
                    } else {
                        throw new Error('Unsupported platform: ${process.platform}');
                    }
        }

        return fileName;
    }

    private download(urlString: string, proxy?: string, strictSSL?: boolean): Promise<stream.Readable> {
        process.on('uncaughtException', function (err): void {
            console.log(err);
        });

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
            return client.get(options, res => {
                // handle redirection
                if (res.statusCode === 302) {
                    return this.download(res.headers.location);
                } else if (res.statusCode !== 200) {
                    return reject(Error('Download failed with code ${res.statusCode}.'));
                }

                return resolve(res);
            });
        });
    }

   /**
    * Returns SQL tools service installed folder.
    */
    public getInstallDirectory(): string {
        let installDirFromConfig = this._config.getSqlToolsInstallDirectory();
        let versionFromConfig = this._config.getSqlToolsPackageVersion();
        let basePath = path.join(__dirname, installDirFromConfig);
        if (!fs.existsSync(basePath)) {
            fs.mkdirSync(basePath);
        }
        basePath = path.join(basePath, versionFromConfig);
        if (!fs.existsSync(basePath)) {
            fs.mkdirSync(basePath);
        }
        return basePath;
    }

   /**
    * Downloads the SQL tools service and decompress it in the install folder.
    */
    public go(platform: Platform): Promise<boolean> {
        const config = workspace.getConfiguration();
        const proxy = config.get<string>('http.proxy');
        const strictSSL = config.get('http.proxyStrictSSL', true);

        return new Promise<boolean>((resolve, reject) => {
            const fileName = this.getDownloadFileName( platform);
            const installDirectory = this.getInstallDirectory();

            Utils.logDebug('Installing sql tools service to ${installDirectory}');
            let baseDownloadUrl = this._config.getSqlToolsServiceDownloadUrl();
            const urlString = baseDownloadUrl + '/' + fileName;

            Utils.logDebug('Attempting to download ${fileName}');

            return this.download(urlString, proxy, strictSSL)
                .then(inStream => {
                    tmp.file((err, tmpPath, fd, cleanupCallback) => {
                        if (err) {
                            return reject(err);
                        }

                        Utils.logDebug('Downloading to ${tmpPath}...');

                        const outStream = fs.createWriteStream(undefined, { fd: fd });

                        outStream.once('error', outStreamErr => reject(outStreamErr));
                        inStream.once('error', inStreamErr => reject(inStreamErr));

                        outStream.once('finish', () => {
                            // At this point, the asset has finished downloading.

                            Utils.logDebug('Download complete!');
                            Utils.logDebug('Decompressing...');

                            return decompress(tmpPath, installDirectory)
                                .then(files => {
                                    Utils.logDebug('Done! ${files.length} files unpacked.\n');
                                    return resolve(true);
                                })
                                .catch(decompressErr => {
                                    Utils.logDebug('[ERROR] ${err}');
                                    return reject(decompressErr);
                                });
                        });

                        inStream.pipe(outStream);
                    });
                })
                .catch(err => {
                    Utils.logDebug('[ERROR] ${err}');
                    reject(err);
                });
        }).then(res => {
            return res;
        });
    }
}

