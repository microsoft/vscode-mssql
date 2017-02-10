/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import fs = require('fs');
import os = require('os');
import * as Constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as Utils from '../models/utils';
import { IConnectionProfile } from '../models/interfaces';
import { IConnectionConfig } from './iconnectionconfig';
import VscodeWrapper from '../controllers/vscodeWrapper';

const commentJson = require('comment-json');

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
     * Add a new connection to the connection config.
     */
    public addConnection(profile: IConnectionProfile): Promise<void> {
        let parsedSettingsFile = this.readAndParseSettingsFile(ConnectionConfig.configFilePath);

        // No op if the settings file could not be parsed; we don't want to overwrite the corrupt file
        if (!parsedSettingsFile) {
            return Promise.reject(Utils.formatString(LocalizedConstants.msgErrorReadingConfigFile, ConnectionConfig.configFilePath));
        }

        let profiles = this.getProfilesFromParsedSettingsFile(parsedSettingsFile);

        // Remove the profile if already set
        profiles = profiles.filter(value => !Utils.isSameProfile(value, profile));
        profiles.push(profile);

        return this.writeProfilesToSettingsFile(parsedSettingsFile, profiles);
    }

    /**
     * Get a list of all connections in the connection config. Connections returned
     * are sorted first by whether they were found in the user/workspace settings,
     * and next alphabetically by profile/server name.
     */
    public getConnections(getWorkspaceConnections: boolean): IConnectionProfile[] {
        let profiles = [];
        let compareProfileFunc = (a, b) => {
            // Sort by profile name if available, otherwise fall back to server name
            let nameA = a.profileName ? a.profileName : a.server;
            let nameB = b.profileName ? b.profileName : b.server;
            return nameA.localeCompare(nameB);
        };

        // Read from user settings
        let parsedSettingsFile = this.readAndParseSettingsFile(ConnectionConfig.configFilePath);
        let userProfiles = this.getProfilesFromParsedSettingsFile(parsedSettingsFile);
        userProfiles.sort(compareProfileFunc);
        profiles = profiles.concat(userProfiles);

        if (getWorkspaceConnections) {
            // Read from workspace settings
            parsedSettingsFile = this.readAndParseSettingsFile(this.workspaceSettingsFilePath);
            let workspaceProfiles = this.getProfilesFromParsedSettingsFile(parsedSettingsFile);
            workspaceProfiles.sort(compareProfileFunc);
            profiles = profiles.concat(workspaceProfiles);
        }

        if (profiles.length > 0) {
            profiles = profiles.filter(conn => {
                // filter any connection missing a server name or the sample that's shown by default
                return !!(conn.server) && conn.server !== LocalizedConstants.SampleServerName;
            });
        }

        return profiles;
    }

    /**
     * Remove an existing connection from the connection config.
     */
    public removeConnection(profile: IConnectionProfile): Promise<boolean> {
        let parsedSettingsFile = this.readAndParseSettingsFile(ConnectionConfig.configFilePath);

        // No op if the settings file could not be parsed; we don't want to overwrite the corrupt file
        if (!parsedSettingsFile) {
            return Promise.resolve(false);
        }

        let profiles = this.getProfilesFromParsedSettingsFile(parsedSettingsFile);

        // Remove the profile if already set
        let found: boolean = false;
        profiles = profiles.filter(value => {
            if (Utils.isSameProfile(value, profile)) {
                // remove just this profile
                found = true;
                return false;
            } else {
                return true;
            }
        });

        return new Promise<boolean>((resolve, reject) => {
            this.writeProfilesToSettingsFile(parsedSettingsFile, profiles).then(() => {
                resolve(found);
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
            // On Windows, settings are located in %APPDATA%\Code\User\
            return process.env['APPDATA'] + '\\Code\\User\\';
        } else if (os.platform() === 'darwin') {
            // On OSX, settings are located in $HOME/Library/Application Support/Code/User/
            return process.env['HOME'] + '/Library/Application Support/Code/User/';
        } else {
            // On Linux, settings are located in $HOME/.config/Code/User/
            return process.env['HOME'] + '/.config/Code/User/';
        }
    }

    /**
     * Get the path of the file containing workspace settings.
     */
    private get workspaceSettingsFilePath(): string {
        let workspacePath = this.vscodeWrapper.workspaceRootPath;
        const vscodeSettingsDir = '.vscode';

        let dirSeparator = '/';
        if (os.platform() === 'win32') {
            dirSeparator = '\\';
        }

        if (workspacePath) {
            return this.vscodeWrapper.workspaceRootPath + dirSeparator +
                vscodeSettingsDir + dirSeparator +
                Constants.connectionConfigFilename;
        } else {
            return undefined;
        }
    }

    /**
     * Get the full path of the connection config filename.
     */
    private static get configFilePath(): string {
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

    /**
     * Parse the vscode settings file into an object, preserving comments.
     * This is public for testing only.
     * @param filename the name of the file to read from
     * @returns undefined if the settings file could not be read, or an empty object if the file did not exist/was empty
     */
    public readAndParseSettingsFile(filename: string): any {
        if (!filename) {
            return undefined;
        }
        try {
            let fileBuffer: Buffer = this._fs.readFileSync(filename);
            if (fileBuffer) {
                let fileContents: string = fileBuffer.toString();
                if (!Utils.isEmpty(fileContents)) {
                    try {
                        let fileObject: any = commentJson.parse(fileContents);
                        return fileObject;
                    } catch (e) { // Error parsing JSON
                        this.vscodeWrapper.showErrorMessage(Utils.formatString(LocalizedConstants.msgErrorReadingConfigFile, filename));
                    }
                } else {
                    return {};
                }
            }
        } catch (e) { // Error reading the file
            if (e.code !== 'ENOENT') { // Ignore error if the file doesn't exist
                this.vscodeWrapper.showErrorMessage(Utils.formatString(LocalizedConstants.msgErrorReadingConfigFile, filename));
            } else {
                return {};
            }
        }

        return undefined;
    }

    /**
     * Get all profiles from the parsed settings file.
     * This is public for testing only.
     * @param parsedSettingsFile an object representing the parsed contents of the settings file.
     * @returns the set of connection profiles found in the parsed settings file.
     */
    public getProfilesFromParsedSettingsFile(parsedSettingsFile: any): IConnectionProfile[] {
        let profiles: IConnectionProfile[] = [];

        // Find the profiles object in the parsed settings file
        if (parsedSettingsFile && parsedSettingsFile.hasOwnProperty(Constants.connectionsArrayName)) {
            profiles = parsedSettingsFile[Constants.connectionsArrayName];
        }

        return profiles;
    }

    /**
     * Replace existing profiles in the settings file with a new set of profiles.
     * @param parsedSettingsFile an object representing the parsed contents of the settings file.
     * @param profiles the set of profiles to insert into the settings file.
     */
    private writeProfilesToSettingsFile(parsedSettingsFile: any, profiles: IConnectionProfile[]): Promise<void> {
        // Insert the new set of profiles
        parsedSettingsFile[Constants.connectionsArrayName] = profiles;

        // Save the file
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self.createConfigFileDirectory().then(() => {
                // Format the file using 4 spaces as indentation
                self._fs.writeFile(ConnectionConfig.configFilePath, commentJson.stringify(parsedSettingsFile, undefined, 4), err => {
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
}
