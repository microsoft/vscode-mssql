/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import fs = require('fs');
import os = require('os');
import * as Constants from '../models/constants';
import * as Utils from '../models/utils';
import { IConnectionCredentials, IConnectionProfile } from '../models/interfaces';
import { IConnectionConfig } from './iconnectionconfig';
import VscodeWrapper from '../controllers/vscodeWrapper';

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {

    /**
     * Constructor.
     */
    public constructor(private _fs?: any, private _vscodeWrapper?: VscodeWrapper) {
        if (!this._fs) {
            this._fs = fs;
        }
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(value: VscodeWrapper) {
        this._vscodeWrapper = value;
    }

    /**
     * Read connection profiles stored in connection json file, if it exists.
     */
    public readConnectionsFromConfigFile(): IConnectionProfile[] {
        let profiles: IConnectionProfile[] = [];

        try {
            let fileBuffer: Buffer = this._fs.readFileSync(ConnectionConfig.configFilePath);
            if (fileBuffer) {
                let fileContents: string = fileBuffer.toString();
                if (!Utils.isEmpty(fileContents)) {
                    try {
                        let json: any = JSON.parse(fileContents);
                        if (json && json.hasOwnProperty(Constants.connectionsArrayName)) {
                            profiles = json[Constants.connectionsArrayName];
                        } else {
                            this.vscodeWrapper.showErrorMessage(Utils.formatString(Constants.msgErrorReadingConfigFile, ConnectionConfig.configFilePath));
                        }
                    } catch (e) { // Error parsing JSON
                        this.vscodeWrapper.showErrorMessage(Utils.formatString(Constants.msgErrorReadingConfigFile, ConnectionConfig.configFilePath));
                    }
                }
            }
        } catch (e) { // Error reading the file
            if (e.code !== 'ENOENT') { // Ignore error if the file doesn't exist
                this.vscodeWrapper.showErrorMessage(Utils.formatString(Constants.msgErrorReadingConfigFile, ConnectionConfig.configFilePath));
            }
        }

        return profiles;
    }

    /**
     * Write connection profiles to the configuration json file.
     */
    public writeConnectionsToConfigFile(connections: IConnectionCredentials[]): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self.createConfigFileDirectory().then(() => {
                let connectionsObject = {};
                connectionsObject[Constants.connectionsArrayName] = connections;

                // Format the file using 4 spaces as indentation
                self._fs.writeFile(ConnectionConfig.configFilePath, JSON.stringify(connectionsObject, undefined, 4), err => {
                    if (err) {
                        reject(err);
                    }
                    resolve();
                });
            }).catch(err => {
                reject(err);
            });
        });
    }

    /**
     * Get the directory containing the connection config file.
     */
    private static get configFileDirectory(): string {
        if (os.platform() === 'win32') {
            // On Windows, we store connection configurations in %APPDATA%\<extension name>\
            return process.env['APPDATA'] + '\\' + Constants.extensionName + '\\';
        } else {
            // On OSX/Linux, we store connection configurations in ~/.config/<extension name>/
            return process.env['HOME'] + '/.config/' + Constants.extensionName + '/';
        }
    }

    /**
     * Get the full path of the connection config filename.
     */
    public static get configFilePath(): string {
        return this.configFileDirectory + Constants.connectionConfigFilename;
    }
    /**
     * Public for testing purposes.
     */
    public createConfigFileDirectory(): Promise<void> {
        const self = this;
        const configFileDir: string = ConnectionConfig.configFileDirectory;
        return new Promise<void>((resolve, reject) => {
            self._fs.mkdir(configFileDir, err => {
                // If the directory already exists, ignore the error
                if (err && err.code !== 'EEXIST') {
                    reject(err);
                }
                resolve();
            });
        });
    }
}
