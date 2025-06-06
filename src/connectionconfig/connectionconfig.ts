/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Utils from "../models/utils";
import { IConnectionGroup, IConnectionProfile } from "../models/interfaces";
import { IConnectionConfig } from "./iconnectionconfig";
import VscodeWrapper, { ConfigurationTarget } from "../controllers/vscodeWrapper";
import { ConnectionProfile } from "../models/connectionProfile";
import { getConnectionDisplayName } from "../models/connectionInfo";
import { Deferred } from "../protocol";
import { Logger } from "../models/logger";

export type ConfigTarget = ConfigurationTarget.Global | ConfigurationTarget.Workspace;

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {
    protected _logger: Logger;
    public initialized: Deferred<void> = new Deferred<void>();

    /** The name of the root connection group. */
    public readonly RootGroupName: string = "ROOT";
    private _hasDisplayedMissingIdError: boolean = false;

    /**
     * Constructor
     */
    public constructor(private _vscodeWrapper?: VscodeWrapper) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ConnectionConfig");
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.assignConnectionGroupMissingIds();
        await this.assignConnectionMissingIds();

        this.initialized.resolve();
    }

    //#region Connection Profiles

    /**
     * Get a list of all connections in the connection config. Connections returned
     * are sorted first by whether they were found in the user/workspace settings,
     * and next alphabetically by profile/server name.
     */
    public async getConnections(alsoGetFromWorkspace: boolean): Promise<IConnectionProfile[]> {
        await this.initialized;

        let profiles: IConnectionProfile[] = [];

        // Read from user settings
        let userProfiles = this.getConnectionsFromSettings();

        userProfiles.sort(this.compareConnectionProfile);
        profiles = profiles.concat(userProfiles);

        if (alsoGetFromWorkspace) {
            // Read from workspace settings
            let workspaceProfiles = this.getConnectionsFromSettings(ConfigurationTarget.Workspace);

            const missingIdConns: IConnectionProfile[] = [];

            workspaceProfiles = workspaceProfiles.filter((profile) => {
                if (!profile.id) {
                    if (!this._hasDisplayedMissingIdError) {
                        missingIdConns.push(profile);
                    }

                    return false;
                }
                return true;
            });

            if (missingIdConns.length > 0) {
                // We don't currently auto-update connections in workspace/workspace folder config,
                // so alert the user if any of those are missing their ID property that they need manual updating.

                this._hasDisplayedMissingIdError = true;
                this._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.Connection.missingConnectionIdsError(
                        missingIdConns.map((c) => getConnectionDisplayName(c)),
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

        // filter out any connection with a group that isn't defined
        const groupIds = new Set<string>((await this.getGroups()).map((g) => g.id));
        profiles = profiles.filter((p) => {
            if (!groupIds.has(p.groupId)) {
                this._logger.warn(
                    `Connection '${getConnectionDisplayName(p)}' with ID '${p.id}' has a group ID that does not exist (${p.groupId}) so it is being ignored.  Correct its group ID to keep using this connection.`,
                );
                return false;
            } else {
                return true;
            }
        });

        return profiles;
    }

    public async getConnectionById(id: string): Promise<IConnectionProfile | undefined> {
        await this.initialized;

        const profiles = await this.getConnections(true /* getFromWorkspace */);
        return profiles.find((profile) => profile.id === id);
    }

    public async addConnection(profile: IConnectionProfile): Promise<void> {
        this.populateMissingConnectionIds(profile);

        let profiles = await this.getConnections(false /* getWorkspaceConnections */);

        // Remove the profile if already set
        profiles = profiles.filter((value) => !Utils.isSameProfile(value, profile));
        profiles.push(profile);

        return await this.writeConnectionsToSettings(profiles);
    }

    /**
     * Remove an existing connection from the connection config if it exists.
     * @returns true if the connection was removed, false if the connection wasn't found.
     */
    public async removeConnection(profile: IConnectionProfile): Promise<boolean> {
        let profiles = await this.getConnections(false /* getWorkspaceConnections */);

        const found = this.removeConnectionHelper(profile, profiles);

        await this.writeConnectionsToSettings(profiles);
        return found;
    }

    public async updateConnection(updatedProfile: IConnectionProfile): Promise<void> {
        const profiles = await this.getConnections(false /* getWorkspaceConnections */);
        const index = profiles.findIndex((p) => p.id === updatedProfile.id);
        if (index === -1) {
            throw new Error(`Connection with ID ${updatedProfile.id} not found`);
        }
        profiles[index] = updatedProfile;
        await this.writeConnectionsToSettings(profiles);
    }

    //#endregion

    //#region Connection Groups

    public getRootGroup(): IConnectionGroup | undefined {
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();
        return groups.find((group) => group.name === this.RootGroupName);
    }

    public async getGroups(
        location: ConfigTarget = ConfigurationTarget.Global,
    ): Promise<IConnectionGroup[]> {
        await this.initialized;
        return this.getGroupsFromSettings(location);
    }

    /**
     * Retrieves a connection group by its ID.
     * @param id The ID of the connection group to retrieve.
     * @returns The connection group with the specified ID, or `undefined` if not found.
     */
    public getGroupById(id: string): IConnectionGroup | undefined {
        const connGroups = this.getGroupsFromSettings(ConfigurationTarget.Global);
        return connGroups.find((g) => g.id === id);
    }

    public addGroup(group: IConnectionGroup): Promise<void> {
        if (!group.id) {
            group.id = Utils.generateGuid();
        }

        if (!group.parentId) {
            group.parentId = this.getRootGroup().id;
        }

        const groups = this.getGroupsFromSettings();
        groups.push(group);
        return this.writeConnectionGroupsToSettings(groups);
    }

    public async removeGroup(id: string): Promise<void> {
        const connections = this.getConnectionsFromSettings();

        let connectionRemoved = false;

        for (const conn of connections) {
            if (conn.groupId === id) {
                this._logger.verbose(
                    `Removing connection '${conn.id}' because its group '${id}' was removed`,
                );
                connectionRemoved = true;
                this.removeConnectionHelper(conn, connections);
            }
        }

        const groups = this.getGroupsFromSettings();
        const index = groups.findIndex((g) => g.id === id);
        if (index === -1) {
            this._logger.error(`Connection group with ID '${id}' not found when removing.`);
            return Promise.resolve();
        }
        groups.splice(index, 1);

        if (connectionRemoved) {
            await this.writeConnectionsToSettings(connections);
        }

        return this.writeConnectionGroupsToSettings(groups);
    }

    public async updateGroup(updatedGroup: IConnectionGroup): Promise<void> {
        const groups = this.getGroupsFromSettings();
        const index = groups.findIndex((g) => g.id === updatedGroup.id);
        if (index === -1) {
            throw Error(`Connection group with ID ${updatedGroup.id} not found when updating`);
        } else {
            groups[index] = updatedGroup;
        }

        return await this.writeConnectionGroupsToSettings(groups);
    }

    //#endregion

    //#region Shared/Helpers

    private removeConnectionHelper(
        toRemove: IConnectionProfile,
        profiles: IConnectionProfile[],
    ): boolean {
        // Remove the profile if already set
        let found = false;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        profiles = profiles.filter((value) => {
            if (Utils.isSameProfile(value, toRemove)) {
                // remove just this profile
                found = true;
                return false;
            } else {
                return true;
            }
        });
        return found;
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

    /**
     * Populate missing connection ID and group ID for a connection profile.
     * @returns true if the profile was modified, false otherwise.
     */
    public populateMissingConnectionIds(profile: IConnectionProfile): boolean {
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

    //#endregion

    //#region Initialization

    private async assignConnectionGroupMissingIds(): Promise<void> {
        let madeChanges = false;
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();

        // ensure ROOT group exists
        let rootGroup = await this.getRootGroup();

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
            if (!group.parentId) {
                group.parentId = rootGroup.id;
                madeChanges = true;
                this._logger.logDebug(`Adding missing parentId to connection '${group.name}'`);
            }
        }

        // Save the changes to settings
        if (madeChanges) {
            this._logger.logDebug(
                `Updates made to connection groups.  Writing all ${groups.length} group(s) to settings.`,
            );

            await this.writeConnectionGroupsToSettings(groups);
        }
    }

    private async assignConnectionMissingIds(): Promise<void> {
        let madeChanges = false;

        // Clean up connection profiles
        const profiles: IConnectionProfile[] = this.getConnectionsFromSettings();

        for (const profile of profiles) {
            if (this.populateMissingConnectionIds(profile)) {
                madeChanges = true;
                this._logger.logDebug(
                    `Adding missing group ID or connection ID to connection '${getConnectionDisplayName(profile)}'`,
                );
            }
        }

        // Save the changes to settings
        if (madeChanges) {
            this._logger.logDebug(
                `Updates made to connection profiles.  Writing all ${profiles.length} profile(s) to settings.`,
            );

            await this.writeConnectionsToSettings(profiles);
        }
    }

    //#endregion

    //#region Config Read/Write

    /**
     * Get all profiles from the settings.
     * This is public for testing only.
     * @param configLocation When `true` profiles come from user settings, otherwise from workspace settings.  Default is `true`.
     * @returns the set of connection profiles found in the settings.
     */
    public getConnectionsFromSettings(
        configLocation: ConfigTarget = ConfigurationTarget.Global,
    ): IConnectionProfile[] {
        return this.getArrayFromSettings<IConnectionProfile>(
            Constants.connectionsArrayName,
            configLocation,
        );
    }

    public getGroupsFromSettings(
        configLocation: ConfigTarget = ConfigurationTarget.Global,
    ): IConnectionGroup[] {
        return this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            configLocation,
        );
    }

    /**
     * Replace existing profiles in the user settings with a new set of profiles.
     * @param profiles the set of profiles to insert into the settings file.
     */
    private async writeConnectionsToSettings(profiles: IConnectionProfile[]): Promise<void> {
        // Save the file
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionsArrayName,
            profiles,
        );
    }

    private async writeConnectionGroupsToSettings(connGroups: IConnectionGroup[]): Promise<void> {
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionGroupsArrayName,
            connGroups,
        );
    }

    private getArrayFromSettings<T>(
        configSection: string,
        location:
            | ConfigurationTarget.Global
            | ConfigurationTarget.Workspace = ConfigurationTarget.Global,
    ): T[] {
        let configuration = this._vscodeWrapper.getConfiguration(
            Constants.extensionName,
            this._vscodeWrapper.activeTextEditorUri,
        );

        let configValue = configuration.inspect<T[]>(configSection);
        if (location === ConfigurationTarget.Global) {
            // only return the global values if that's what's requested
            return configValue.globalValue || [];
        } else {
            // otherwise, return the combination of the workspace and workspace folder values
            return (configValue.workspaceValue || []).concat(
                configValue.workspaceFolderValue || [],
            );
        }
    }

    //#endregion
}
