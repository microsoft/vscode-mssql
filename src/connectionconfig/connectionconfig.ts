/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Utils from "../models/utils";
import { IConnectionGroup, IConnectionProfile } from "../models/interfaces";
import { IConnectionConfig } from "./iconnectionconfig";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { Deferred } from "../protocol";
import { ConnectionProfile } from "../models/connectionProfile";

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {
    initialized: Deferred<void> = new Deferred<void>();

    RootGroupName: string = "ROOT";

    /**
     * Constructor.
     */
    public constructor(private _vscodeWrapper?: VscodeWrapper) {
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
        void this.assignMissingIds();
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(value: VscodeWrapper) {
        this._vscodeWrapper = value;
    }

    private async assignMissingIds(): Promise<void> {
        // Connection groups
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();

        // ensure each group has an id
        groups.forEach((group) => {
            if (!group.id) {
                group.id = Utils.generateGuid();
            }
        });

        // ensure ROOT group exists
        let rootGroup = groups.find(
            (group) => group.name === this.RootGroupName,
        );
        if (!rootGroup) {
            rootGroup = {
                name: this.RootGroupName,
                id: Utils.generateGuid(),
            };
            groups.push(rootGroup);
        }

        // Clean up connection profiles
        const profiles: IConnectionProfile[] = this.getProfilesFromSettings();

        profiles.forEach((profile) => {
            // ensure each profile has an id
            ConnectionProfile.addIdIfMissing(profile);

            // ensure each profile is in a group
            if (!profile.groupId) {
                profile.groupId = rootGroup.id;
            }
        });

        // Save the changes to settings
        await this.writeConnectionGroupsToSettings(groups);
        await this.writeProfilesToSettings(profiles);

        this.initialized.resolve();
    }

    /**
     * Add a new connection to the connection config.
     */
    public async addConnection(profile: IConnectionProfile): Promise<void> {
        let profiles = this.getProfilesFromSettings();

        // Remove the profile if already set
        profiles = profiles.filter(
            (value) => !Utils.isSameProfile(value, profile),
        );
        profiles.push(profile);

        return await this.writeProfilesToSettings(profiles);
    }

    /**
     * Get a list of all connections in the connection config. Connections returned
     * are sorted first by whether they were found in the user/workspace settings,
     * and next alphabetically by profile/server name.
     */
    public getConnections(
        getWorkspaceConnections: boolean,
    ): IConnectionProfile[] {
        let profiles: IConnectionProfile[] = [];

        // Read from user settings
        let userProfiles = this.getProfilesFromSettings();

        userProfiles.sort(this.compareConnectionProfile);
        profiles = profiles.concat(userProfiles);

        if (getWorkspaceConnections) {
            // Read from workspace settings
            let workspaceProfiles = this.getProfilesFromSettings(false);
            workspaceProfiles.sort(this.compareConnectionProfile);
            profiles = profiles.concat(workspaceProfiles);
        }

        if (profiles.length > 0) {
            profiles = profiles.filter((conn) => {
                // filter any connection missing a connection string and server name or the sample that's shown by default
                return (
                    conn.connectionString ||
                    (!!conn.server &&
                        conn.server !== LocalizedConstants.SampleServerName)
                );
            });
        }

        return profiles;
    }

    /**
     * Remove an existing connection from the connection config.
     */
    public async removeConnection(
        profile: IConnectionProfile,
    ): Promise<boolean> {
        let profiles = this.getProfilesFromSettings();

        // Remove the profile if already set
        let found = false;
        profiles = profiles.filter((value) => {
            if (Utils.isSameProfile(value, profile)) {
                // remove just this profile
                found = true;
                return false;
            } else {
                return true;
            }
        });

        await this.writeProfilesToSettings(profiles);
        return found;
    }

    /**
     * Get all profiles from the settings.
     * This is public for testing only.
     * @param global When `true` profiles come from user settings, otherwise from workspace settings.  Default is `true`.
     * @returns the set of connection profiles found in the settings.
     */
    public getProfilesFromSettings(
        global: boolean = true,
    ): IConnectionProfile[] {
        return this.getArrayFromSettings<IConnectionProfile>(
            Constants.connectionsArrayName,
            global,
        );
    }

    public getGroupsFromSettings(global: boolean = true): IConnectionGroup[] {
        return this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            global,
        );
    }

    private getArrayFromSettings<T>(
        configSection: string,
        global: boolean = true,
    ): T[] {
        let configuration = this._vscodeWrapper.getConfiguration(
            Constants.extensionName,
            this._vscodeWrapper.activeTextEditorUri,
        );

        let configValue = configuration.inspect<T[]>(configSection);
        if (global) {
            // only return the global values if that's what's requested
            return configValue.globalValue || [];
        } else {
            // otherwise, return the combination of the workspace and workspace folder values
            return (configValue.workspaceValue || []).concat(
                configValue.workspaceFolderValue || [],
            );
        }
    }

    /**
     * Replace existing profiles in the user settings with a new set of profiles.
     * @param profiles the set of profiles to insert into the settings file.
     */
    private async writeProfilesToSettings(
        profiles: IConnectionProfile[],
    ): Promise<void> {
        // Save the file
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionsArrayName,
            profiles,
        );
    }

    /**
     * Replace existing connection groups in the user settings with a new set of connection groups.
     * @param connGroups the set of connection groups to insert into the settings file.
     */
    private async writeConnectionGroupsToSettings(
        connGroups: IConnectionGroup[],
    ): Promise<void> {
        // Save the file
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionGroupsArrayName,
            connGroups,
        );
    }

    /** Compare function for sorting by profile name if available, otherwise fall back to server name or connection string */
    private compareConnectionProfile(
        connA: IConnectionProfile,
        connB: IConnectionProfile,
    ): number {
        const nameA = connA.profileName
            ? connA.profileName
            : connA.server
              ? connA.server
              : connA.connectionString;
        const nameB = connB.profileName
            ? connB.profileName
            : connB.server
              ? connB.server
              : connB.connectionString;

        return nameA.localeCompare(nameB);
    }
}
