/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

import * as Constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as Utils from '../models/utils';
import { IConnectionProfile } from '../models/interfaces';
import { IConnectionConfig } from './iconnectionconfig';
import VscodeWrapper from '../controllers/vscodeWrapper';

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {

    /**
     * Constructor.
     */
    public constructor(private _vscodeWrapper?: VscodeWrapper) {

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

        let profiles = this.getProfilesFromSettings();

        // Remove the profile if already set
        profiles = profiles.filter(value => !Utils.isSameProfile(value, profile));
        profiles.push(profile);

        return this.writeProfilesToSettings(profiles);
    }

    /**
     * Get a list of all connections in the connection config. Connections returned
     * are sorted first by whether they were found in the user/workspace settings,
     * and next alphabetically by profile/server name.
     */
    public getConnections(getWorkspaceConnections: boolean): IConnectionProfile[] {
        let profiles: IConnectionProfile[] = [];
        let compareProfileFunc = (a, b) => {
            // Sort by profile name if available, otherwise fall back to server name or connection string
            let nameA = a.profileName ? a.profileName : (a.server ? a.server : a.connectionString);
            let nameB = b.profileName ? b.profileName : (b.server ? b.server : b.connectionString);
            return nameA.localeCompare(nameB);
        };

        // Read from user settings
        let userProfiles = this.getProfilesFromSettings();

        userProfiles.sort(compareProfileFunc);
        profiles = profiles.concat(userProfiles);

        if (getWorkspaceConnections) {
            // Read from workspace settings
            let workspaceProfiles = this.getProfilesFromSettings(false);
            workspaceProfiles.sort(compareProfileFunc);
            profiles = profiles.concat(workspaceProfiles);
        }

        if (profiles.length > 0) {
            profiles = profiles.filter(conn => {
                // filter any connection missing a connection string and server name or the sample that's shown by default
                return conn.connectionString || !!(conn.server) && conn.server !== LocalizedConstants.SampleServerName;
            });
        }

        return profiles;
    }

    /**
     * Remove an existing connection from the connection config.
     */
    public removeConnection(profile: IConnectionProfile): Promise<boolean> {

        let profiles = this.getProfilesFromSettings();

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
            this.writeProfilesToSettings(profiles).then(() => {
                resolve(found);
            }).catch(err => {
                reject(err);
            });
        });
    }

    /**
     * Get all profiles from the settings.
     * This is public for testing only.
     * @param global When `true` profiles come from user settings, otherwise from workspace settings
     * @returns the set of connection profiles found in the settings.
     */
    public getProfilesFromSettings(global: boolean = true): IConnectionProfile[] {
        let configuration = this._vscodeWrapper.getConfiguration(Constants.extensionName);
        let profiles: IConnectionProfile[] = [];

        let configValue = configuration.inspect<IConnectionProfile[]>(Constants.connectionsArrayName);
        if (global) {
            profiles = configValue.globalValue;
        } else {
            profiles = configValue.workspaceValue;
        }

        if (profiles === undefined) {
            profiles = [];
        }

        return profiles;
    }

    /**
     * Replace existing profiles in the user settings with a new set of profiles.
     * @param profiles the set of profiles to insert into the settings file.
     */
    private writeProfilesToSettings(profiles: IConnectionProfile[]): Promise<void> {
        // Save the file
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self._vscodeWrapper.getConfiguration(Constants.extensionName).update(Constants.connectionsArrayName, profiles, true).then(() => {
                resolve();
            }, err => {
                reject(err);
            });
        });
    }
}
