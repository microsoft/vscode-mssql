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
import { Logger } from "../models/logger";
import { getConnectionDisplayName } from "../models/connectionInfo";

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {
    private _logger: Logger;
    private _hasDisplayedMissingIdError: boolean = false;

    public initialized: Deferred<void> = new Deferred<void>();
    public readonly RootGroupName: string = "ROOT";

    /**
     * Constructor.
     */
    public constructor(private _vscodeWrapper?: VscodeWrapper) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ConnectionConfig");

        void this.assignMissingIds();
    }

    private getRootGroup(): IConnectionGroup | undefined {
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();
        return groups.find((group) => group.name === this.RootGroupName);
    }

    private async assignMissingIds(): Promise<void> {
        let madeChanges = false;

        // Connection groups
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();

        // ensure ROOT group exists
        let rootGroup = this.getRootGroup();

        if (!rootGroup) {
            rootGroup = {
                name: this.RootGroupName,
                id: Utils.generateGuid(),
            };

            this._logger.logDebug(`Adding missing ROOT group to connection groups`);
            madeChanges = true;
            groups.push(rootGroup);
        }

        // Clean up connection groups
        for (const group of groups) {
            if (group.id === rootGroup.id) {
                continue;
            }

            // ensure each group has an ID
            if (!group.id) {
                group.id = Utils.generateGuid();
                madeChanges = true;
                this._logger.logDebug(`Adding missing ID to connection group '${group.name}'`);
            }

            // ensure each group is in a group
            if (!group.groupId) {
                group.groupId = rootGroup.id;
                madeChanges = true;
                this._logger.logDebug(`Adding missing parentId to connection '${group.name}'`);
            }
        }

        // Clean up connection profiles
        const profiles: IConnectionProfile[] = this.getProfilesFromSettings();

        for (const profile of profiles) {
            if (this.populateMissingIds(profile)) {
                madeChanges = true;
                this._logger.logDebug(
                    `Adding missing group ID or connection ID to connection '${getConnectionDisplayName(profile)}'`,
                );
            }
        }

        // Save the changes to settings
        if (madeChanges) {
            this._logger.logDebug(
                `Updates made to connection profiles and groups.  Writing all ${groups.length} group(s) and ${profiles.length} profile(s) to settings.`,
            );

            await this.writeConnectionGroupsToSettings(groups);
            await this.writeProfilesToSettings(profiles);
        }

        this.initialized.resolve();
    }

    /**
     * Populate missing connection ID and group ID for a connection profile.
     * @returns true if the profile was modified, false otherwise.
     */
    public populateMissingIds(profile: IConnectionProfile): boolean {
        let modified = false;

        // ensure each profile is in a group
        if (profile.groupId === undefined) {
            const rootGroup = this.getRootGroup();
            if (rootGroup) {
                profile.groupId = rootGroup.id;
                modified = true;
            }
        }

        // ensure each profile has an ID
        if (profile.id === undefined) {
            ConnectionProfile.addIdIfMissing(profile);
            modified = true;
        }

        return modified;
    }

    /**
     * Add a new connection to the connection config.
     */
    public async addConnection(profile: IConnectionProfile): Promise<void> {
        this.populateMissingIds(profile);

        let profiles = this.getProfilesFromSettings();

        // Remove the profile if already set
        profiles = profiles.filter((value) => !Utils.isSameProfile(value, profile));
        profiles.push(profile);

        return await this.writeProfilesToSettings(profiles);
    }

    /**
     * Get a list of all connections in the connection config. Connections returned
     * are sorted first by whether they were found in the user/workspace settings,
     * and next alphabetically by profile/server name.
     */
    public async getConnections(getWorkspaceConnections: boolean): Promise<IConnectionProfile[]> {
        await this.initialized;

        let profiles: IConnectionProfile[] = [];

        // Read from user settings
        let userProfiles = this.getProfilesFromSettings();

        userProfiles.sort(this.compareConnectionProfile);
        profiles = profiles.concat(userProfiles);

        if (getWorkspaceConnections) {
            // Read from workspace settings
            let workspaceProfiles = this.getProfilesFromSettings(false);

            const middingIdConns: IConnectionProfile[] = [];

            workspaceProfiles = workspaceProfiles.filter((profile) => {
                if (!profile.id) {
                    if (!this._hasDisplayedMissingIdError) {
                        middingIdConns.push(profile);
                    }

                    return false;
                }
                return true;
            });

            if (middingIdConns.length > 0) {
                // We don't currently auto-update connections in workspace/workspace folder config,
                // so alert the user if any of those are missing their ID property that they need manual updating.

                this._hasDisplayedMissingIdError = true;
                this._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.Connection.missingConnectionIdsError(
                        middingIdConns.map((c) => getConnectionDisplayName(c)),
                    ),
                );
            }

            workspaceProfiles.sort(this.compareConnectionProfile);
            profiles = profiles.concat(workspaceProfiles);
        }

        if (profiles.length > 0) {
            profiles = profiles.filter((conn) => {
                // filter any connection missing a connection string and server name or the sample that's shown by default
                if (
                    !(
                        conn.connectionString ||
                        (!!conn.server && conn.server !== LocalizedConstants.SampleServerName)
                    )
                ) {
                    this._vscodeWrapper.showErrorMessage(
                        LocalizedConstants.Connection.missingConnectionInformation(conn.id),
                    );

                    return false;
                }
                return true;
            });
        }

        return profiles;
    }

    /**
     * Remove an existing connection from the connection config if it exists.
     * @returns true if the connection was removed, false if the connection wasn't found.
     */
    public async removeConnection(profile: IConnectionProfile): Promise<boolean> {
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
    public getProfilesFromSettings(global: boolean = true): IConnectionProfile[] {
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

    private getArrayFromSettings<T>(configSection: string, global: boolean = true): T[] {
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
    private async writeProfilesToSettings(profiles: IConnectionProfile[]): Promise<void> {
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
    private async writeConnectionGroupsToSettings(connGroups: IConnectionGroup[]): Promise<void> {
        // Save the file
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionGroupsArrayName,
            connGroups,
        );
    }

    /** Compare function for sorting by profile name if available, otherwise fall back to server name or connection string */
    private compareConnectionProfile(connA: IConnectionProfile, connB: IConnectionProfile): number {
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
