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

export { ConfigurationTarget };
import { ConnectionProfile } from "../models/connectionProfile";
import { getConnectionDisplayName } from "../models/connectionInfo";
import { Deferred } from "../protocol";
import { Logger } from "../models/logger";

export type ConfigTarget = ConfigurationTarget.Global | ConfigurationTarget.Workspace;

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {
    /**
     * Get all connection groups from both user and workspace settings.
     */
    public getAllConnectionGroups(): IConnectionGroup[] {
        const userGroups = this.getGroupsFromSettings(ConfigurationTarget.Global);
        const workspaceGroups = this.getGroupsFromSettings(ConfigurationTarget.Workspace);
        return [...userGroups, ...workspaceGroups];
    }
    protected _logger: Logger;
    public initialized: Deferred<void> = new Deferred<void>();

    /** The name of the root connection group. */
    static readonly RootGroupName: string = "ROOT";
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

    public getUserConnectionsGroup(): IConnectionGroup | undefined {
        const rootGroup = this.getRootGroup();
        if (!rootGroup) return undefined;
        const groups = this.getGroupsFromSettings();
        return groups.find((g) => g.name === "User Connections" && g.parentId === rootGroup.id);
    }

    public getWorkspaceConnectionsGroup(): IConnectionGroup | undefined {
        const rootGroup = this.getRootGroup();
        if (!rootGroup) return undefined;
        const groups = this.getAllConnectionGroups();
        return groups.find(
            (g) => g.name === "Workspace Connections" && g.parentId === rootGroup.id,
        );
    }

    public getUserConnectionsGroupId(): string | undefined {
        const group = this.getUserConnectionsGroup();
        return group?.id;
    }

    public getWorkspaceConnectionsGroupId(): string | undefined {
        const group = this.getWorkspaceConnectionsGroup();
        return group?.id;
    }

    private async initialize(): Promise<void> {
        // Ensure workspace arrays exist
        await this.ensureWorkspaceArraysInitialized();
        await this.assignConnectionGroupMissingIds();
        await this.assignConnectionMissingIds();

        this.initialized.resolve();
    }

    private async ensureWorkspaceArraysInitialized(): Promise<void> {
        const workspaceGroups = this.getGroupsFromSettings(ConfigurationTarget.Workspace);
        const workspaceConnections = this.getConnectionsFromSettings(ConfigurationTarget.Workspace);
        let changed = false;
        if (!workspaceGroups || workspaceGroups.length === 0) {
            await this._vscodeWrapper.setConfiguration(
                Constants.extensionName,
                Constants.connectionGroupsArrayName,
                [],
                ConfigurationTarget.Workspace,
            );
            changed = true;
        }
        if (!workspaceConnections || workspaceConnections.length === 0) {
            await this._vscodeWrapper.setConfiguration(
                Constants.extensionName,
                Constants.connectionsArrayName,
                [],
                ConfigurationTarget.Workspace,
            );
            changed = true;
        }
        if (changed) {
            this._logger.logDebug("Initialized workspace arrays for connections and groups.");
        }
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
        // Merge user and workspace groups for group existence check
        const userGroups = this.getGroupsFromSettings(ConfigurationTarget.Global);
        const workspaceGroups = this.getGroupsFromSettings(ConfigurationTarget.Workspace);
        const allGroups = [...userGroups, ...workspaceGroups];
        const groupIds = new Set<string>(allGroups.map((g) => g.id));
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

    public async addConnection(
        profile: IConnectionProfile,
        target: ConfigTarget = ConfigurationTarget.Global,
    ): Promise<void> {
        this.populateMissingConnectionIds(profile);

        // If the group is Workspace Connections, always use workspace settings
        const workspaceGroupId = this.getWorkspaceConnectionsGroupId();
        if (profile.groupId === workspaceGroupId) {
            target = ConfigurationTarget.Workspace;
        }

        let profiles = this.getConnectionsFromSettings(target);

        // Remove the profile if already set
        profiles = profiles.filter((value) => !Utils.isSameProfile(value, profile));
        profiles.push(profile);

        return await this.writeConnectionsToSettings(profiles, target);
    }
    /**
     * Remove an existing connection from the connection config if it exists.
     * @returns true if the connection was removed, false if the connection wasn't found.
     */
    public async removeConnection(profile: IConnectionProfile): Promise<boolean> {
        // Determine if this is a workspace connection
        let target = ConfigurationTarget.Global;
        if (profile.scope === "workspace") {
            target = ConfigurationTarget.Workspace;
        }
        let profiles = this.getConnectionsFromSettings(target);

        const found = this.removeConnectionHelper(profile, profiles);
        if (found) {
            await this.writeConnectionsToSettings(profiles, target);
        }
        return found;
    }

    public async updateConnection(updatedProfile: IConnectionProfile): Promise<void> {
        return this.updateConnectionWithTarget(updatedProfile, ConfigurationTarget.Global);
    }

    public async updateConnectionWithTarget(
        updatedProfile: IConnectionProfile,
        target: ConfigTarget,
    ): Promise<void> {
        // If the group is Workspace Connections, always use workspace settings
        const workspaceGroupId = this.getWorkspaceConnectionsGroupId();
        if (updatedProfile.groupId === workspaceGroupId) {
            target = ConfigurationTarget.Workspace;
        }
        const profiles = this.getConnectionsFromSettings(target);
        const index = profiles.findIndex((p) => p.id === updatedProfile.id);
        if (index === -1) {
            throw new Error(`Connection with ID ${updatedProfile.id} not found`);
        }
        profiles[index] = updatedProfile;
        await this.writeConnectionsToSettings(profiles, target);
    }

    //#endregion

    //#region Connection Groups

    public getRootGroup(): IConnectionGroup | undefined {
        let groups: IConnectionGroup[] = this.getGroupsFromSettings();
        groups = groups.filter((group) => group.name === ConnectionConfig.RootGroupName);

        if (groups.length === 0) {
            this._logger.error(
                `No root connection group found. This should have been fixed at initialization.`,
            );
            return undefined;
        } else if (groups.length > 1) {
            const message = `Multiple connection groups with name "${ConnectionConfig.RootGroupName}" found.  Returning the first one: ${groups[0].id}. Delete or rename the others, then restart the extension.`;
            this._logger.error(message);
            this._vscodeWrapper.showErrorMessage(message);
        }

        return groups[0];
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
        // Search both user and workspace groups for the given ID
        const userGroups = this.getGroupsFromSettings(ConfigurationTarget.Global);
        const workspaceGroups = this.getGroupsFromSettings(ConfigurationTarget.Workspace);
        const allGroups = [...userGroups, ...workspaceGroups];
        return allGroups.find((g) => g.id === id);
    }

    public addGroup(group: IConnectionGroup): Promise<void> {
        if (!group.id) {
            group.id = Utils.generateGuid();
        }

        // If this is Workspace Connections or a child, use workspace settings
        const workspaceGroupId = this.getWorkspaceConnectionsGroupId();
        let target: ConfigTarget = ConfigurationTarget.Global;
        if (group.parentId === workspaceGroupId || group.id === workspaceGroupId) {
            target = ConfigurationTarget.Workspace;
        }

        if (!group.parentId) {
            // If target is workspace, parent should be Workspace Connections group
            if (target === ConfigurationTarget.Workspace) {
                group.parentId = this.getWorkspaceConnectionsGroupId();
            } else {
                group.parentId = this.getUserConnectionsGroupId();
            }
        }

        const groups = this.getGroupsFromSettings(target);
        groups.push(group);
        return this.writeConnectionGroupsToSettingsWithTarget(groups, target);
    }

    /**
     * Remove a connection group and handle its contents.
     * @param id The ID of the group to remove
     * @param deleteContents If true, delete all connections and subgroups in this group.
     *                      If false, move immediate child connections and groups to root, preserving their hierarchies.
     * @returns true if the group was removed, false if the group wasn't found.
     */
    public async removeGroup(
        id: string,
        contentAction: "delete" | "move" = "delete",
    ): Promise<boolean> {
        // Get all connections and groups from both user and workspace
        const userConnections = this.getConnectionsFromSettings(ConfigurationTarget.Global);
        const workspaceConnections = this.getConnectionsFromSettings(ConfigurationTarget.Workspace);
        const groups = this.getAllConnectionGroups();
        const rootGroup = this.getRootGroup();

        if (!rootGroup) {
            throw new Error("Root group not found when removing group");
        }

        // Find all subgroup IDs recursively for the delete case
        const getAllSubgroupIds = (groupId: string): Set<string> => {
            const subgroupIds = new Set<string>();
            subgroupIds.add(groupId);
            for (const group of groups) {
                if (group.parentId === groupId) {
                    const childSubgroups = getAllSubgroupIds(group.id);
                    childSubgroups.forEach((id) => subgroupIds.add(id));
                }
            }
            return subgroupIds;
        };

        let connectionModified = false;
        let remainingUserConnections: IConnectionProfile[] = userConnections.slice();
        let remainingWorkspaceConnections: IConnectionProfile[] = workspaceConnections.slice();
        let remainingUserGroups: IConnectionGroup[] = this.getGroupsFromSettings(
            ConfigurationTarget.Global,
        ).slice();
        let remainingWorkspaceGroups: IConnectionGroup[] = this.getGroupsFromSettings(
            ConfigurationTarget.Workspace,
        ).slice();

        if (contentAction === "delete") {
            // Get all nested subgroups to remove
            const groupsToRemove = getAllSubgroupIds(id);

            // Remove all connections in the groups being removed
            remainingUserConnections = remainingUserConnections.filter((conn) => {
                if (groupsToRemove.has(conn.groupId)) {
                    this._logger.verbose(
                        `Removing user connection '${conn.id}' because its group '${conn.groupId}' was removed`,
                    );
                    connectionModified = true;
                    return false;
                }
                return true;
            });
            remainingWorkspaceConnections = remainingWorkspaceConnections.filter((conn) => {
                if (groupsToRemove.has(conn.groupId)) {
                    this._logger.verbose(
                        `Removing workspace connection '${conn.id}' because its group '${conn.groupId}' was removed`,
                    );
                    connectionModified = true;
                    return false;
                }
                return true;
            });

            // Remove all groups that were marked for removal
            remainingUserGroups = remainingUserGroups.filter((g) => !groupsToRemove.has(g.id));
            remainingWorkspaceGroups = remainingWorkspaceGroups.filter(
                (g) => !groupsToRemove.has(g.id),
            );
        } else {
            // Move immediate child connections and groups to User Connections group
            const userGroupId = this.getUserConnectionsGroupId();
            remainingUserConnections = remainingUserConnections.map((conn) => {
                if (conn.groupId === id) {
                    this._logger.verbose(
                        `Moving user connection '${conn.id}' to User Connections group because its immediate parent group '${id}' was removed`,
                    );
                    connectionModified = true;
                    return { ...conn, groupId: userGroupId };
                }
                return conn;
            });
            remainingWorkspaceConnections = remainingWorkspaceConnections.map((conn) => {
                if (conn.groupId === id) {
                    this._logger.verbose(
                        `Moving workspace connection '${conn.id}' to User Connections group because its immediate parent group '${id}' was removed`,
                    );
                    connectionModified = true;
                    return { ...conn, groupId: userGroupId };
                }
                return conn;
            });

            // First remove the target group
            remainingUserGroups = remainingUserGroups.filter((g) => g.id !== id);
            remainingWorkspaceGroups = remainingWorkspaceGroups.filter((g) => g.id !== id);

            // Then reparent immediate children to User Connections group
            remainingUserGroups = remainingUserGroups.map((g) => {
                if (g.parentId === id) {
                    this._logger.verbose(
                        `Moving user group '${g.id}' to User Connections group because its immediate parent group '${id}' was removed`,
                    );
                    return { ...g, parentId: userGroupId };
                }
                return g;
            });
            remainingWorkspaceGroups = remainingWorkspaceGroups.map((g) => {
                if (g.parentId === id) {
                    this._logger.verbose(
                        `Moving workspace group '${g.id}' to User Connections group because its immediate parent group '${id}' was removed`,
                    );
                    return { ...g, parentId: userGroupId };
                }
                return g;
            });
        }

        // If no group was removed, return false
        const originalUserGroups = this.getGroupsFromSettings(ConfigurationTarget.Global);
        const originalWorkspaceGroups = this.getGroupsFromSettings(ConfigurationTarget.Workspace);
        if (
            remainingUserGroups.length === originalUserGroups.length &&
            remainingWorkspaceGroups.length === originalWorkspaceGroups.length
        ) {
            this._logger.error(`Connection group with ID '${id}' not found when removing.`);
            return false;
        }

        // Write updated connections and groups to correct settings
        if (connectionModified) {
            await this.writeConnectionsToSettings(
                remainingUserConnections,
                ConfigurationTarget.Global,
            );
            await this.writeConnectionsToSettings(
                remainingWorkspaceConnections,
                ConfigurationTarget.Workspace,
            );
        }

        await this.writeConnectionGroupsToSettings(remainingUserGroups);
        await this.writeConnectionGroupsToSettingsWithTarget(
            remainingWorkspaceGroups,
            ConfigurationTarget.Workspace,
        );
        return true;
    }

    public async updateGroup(updatedGroup: IConnectionGroup): Promise<void> {
        return this.updateGroupWithTarget(updatedGroup, ConfigurationTarget.Global);
    }

    public async updateGroupWithTarget(
        updatedGroup: IConnectionGroup,
        target: ConfigTarget,
    ): Promise<void> {
        // If this is Workspace Connections or a child, use workspace settings
        const workspaceGroupId = this.getWorkspaceConnectionsGroupId();
        if (updatedGroup.parentId === workspaceGroupId || updatedGroup.id === workspaceGroupId) {
            target = ConfigurationTarget.Workspace;
        }
        const groups = this.getGroupsFromSettings(target);
        const index = groups.findIndex((g) => g.id === updatedGroup.id);
        if (index === -1) {
            throw Error(`Connection group with ID ${updatedGroup.id} not found when updating`);
        } else {
            groups[index] = updatedGroup;
        }

        return await this.writeConnectionGroupsToSettingsWithTarget(groups, target);
    }

    //#endregion

    //#region Shared/Helpers

    private removeConnectionHelper(
        toRemove: IConnectionProfile,
        profiles: IConnectionProfile[],
    ): boolean {
        let found = false;
        for (let i = profiles.length - 1; i >= 0; i--) {
            if (Utils.isSameProfile(profiles[i], toRemove)) {
                profiles.splice(i, 1);
                found = true;
            }
        }
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
            const userGroupId = this.getUserConnectionsGroupId();
            if (userGroupId) {
                profile.groupId = userGroupId;
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
        // User groups and connections
        const userGroups: IConnectionGroup[] = this.getGroupsFromSettings(
            ConfigurationTarget.Global,
        );
        let userConnections: IConnectionProfile[] = this.getConnectionsFromSettings(
            ConfigurationTarget.Global,
        );
        // Workspace groups and connections
        const workspaceGroups: IConnectionGroup[] = this.getGroupsFromSettings(
            ConfigurationTarget.Workspace,
        );
        let workspaceConnections: IConnectionProfile[] = this.getConnectionsFromSettings(
            ConfigurationTarget.Workspace,
        );

        // ensure ROOT group exists in user settings
        let rootGroup = userGroups.find((g) => g.name === ConnectionConfig.RootGroupName);
        if (!rootGroup) {
            rootGroup = {
                name: ConnectionConfig.RootGroupName,
                id: Utils.generateGuid(),
            };
            userGroups.push(rootGroup);
            madeChanges = true;
            this._logger.logDebug(`Adding missing ROOT group to user connection groups`);
        }

        // Ensure User Connections group exists in user settings
        let userConnectionsGroup = userGroups.find(
            (g) => g.name === "User Connections" && g.parentId === rootGroup.id,
        );
        if (!userConnectionsGroup) {
            userConnectionsGroup = {
                name: "User Connections",
                id: Utils.generateGuid(),
                parentId: rootGroup.id,
            };
            userGroups.push(userConnectionsGroup);
            madeChanges = true;
            this._logger.logDebug(`Created 'User Connections' group under ROOT`);
        }

        // Ensure Workspace Connections group exists in workspace settings, parented to ROOT (user)
        let workspaceConnectionsGroup = workspaceGroups.find(
            (g) => g.name === "Workspace Connections" && g.parentId === rootGroup.id,
        );
        if (!workspaceConnectionsGroup) {
            workspaceConnectionsGroup = {
                name: "Workspace Connections",
                id: Utils.generateGuid(),
                parentId: rootGroup.id,
            };
            workspaceGroups.push(workspaceConnectionsGroup);
            madeChanges = true;
            this._logger.logDebug(`Created 'Workspace Connections' group under ROOT (user)`);
        }

        // Reparent all workspace groups directly under ROOT to Workspace Connections group
        for (const group of workspaceGroups) {
            if (group.parentId === rootGroup.id && group.id !== workspaceConnectionsGroup.id) {
                group.parentId = workspaceConnectionsGroup.id;
                madeChanges = true;
                this._logger.logDebug(
                    `Reparented workspace group '${group.name}' to 'Workspace Connections'`,
                );
            }
        }

        // Reparent any existing USER connections that are still directly under ROOT (legacy <Default>) to User Connections group
        for (const conn of userConnections) {
            if (!conn.groupId || conn.groupId === rootGroup.id) {
                conn.groupId = userConnectionsGroup.id;
                madeChanges = true;
                this._logger.logDebug(
                    `Reparented legacy user connection '${getConnectionDisplayName(conn)}' from ROOT to 'User Connections'`,
                );
            }
        }

        // Reparent all workspace connections directly under ROOT to Workspace Connections group
        for (const conn of workspaceConnections) {
            if (!conn.groupId || conn.groupId === rootGroup.id) {
                conn.groupId = workspaceConnectionsGroup.id;
                madeChanges = true;
                this._logger.logDebug(
                    `Reparented workspace connection '${getConnectionDisplayName(conn)}' to 'Workspace Connections'`,
                );
            }
        }

        // Save changes to settings
        if (madeChanges) {
            this._logger.logDebug(`Writing updated user groups and connections to user settings.`);
            await this.writeConnectionGroupsToSettings(userGroups);
            await this.writeConnectionsToSettings(userConnections);
            this._logger.logDebug(
                `Writing updated workspace groups and connections to workspace settings.`,
            );
            await this.writeConnectionGroupsToSettingsWithTarget(
                workspaceGroups,
                ConfigurationTarget.Workspace,
            );
            await this.writeConnectionsToSettings(
                workspaceConnections,
                ConfigurationTarget.Workspace,
            );
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
        const groups = this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            configLocation,
        );
        // Ensure scope is set for legacy groups
        const expectedScope =
            configLocation === ConfigurationTarget.Workspace ? "workspace" : "user";
        let changed = false;
        for (const group of groups) {
            if (!group.scope) {
                group.scope = expectedScope;
                changed = true;
            }
        }
        // If any legacy group was updated, write back
        if (changed) {
            if (configLocation === ConfigurationTarget.Workspace) {
                void this.writeConnectionGroupsToSettingsWithTarget(
                    groups,
                    ConfigurationTarget.Workspace,
                );
            } else {
                void this.writeConnectionGroupsToSettings(groups);
            }
        }
        return groups;
    }

    /**
     * Replace existing profiles in the user settings with a new set of profiles.
     * @param profiles the set of profiles to insert into the settings file.
     */
    private async writeConnectionsToSettings(
        profiles: IConnectionProfile[],
        target: ConfigTarget = ConfigurationTarget.Global,
    ): Promise<void> {
        // Ensure scope is set before writing
        const expectedScope = target === ConfigurationTarget.Workspace ? "workspace" : "user";
        for (const conn of profiles) {
            conn.scope = conn.scope || expectedScope;
        }
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionsArrayName,
            profiles,
            target,
        );
    }

    private async writeConnectionGroupsToSettings(connGroups: IConnectionGroup[]): Promise<void> {
        return this.writeConnectionGroupsToSettingsWithTarget(
            connGroups,
            ConfigurationTarget.Global,
        );
    }

    private async writeConnectionGroupsToSettingsWithTarget(
        connGroups: IConnectionGroup[],
        target: ConfigTarget,
    ): Promise<void> {
        // Ensure scope is set before writing
        const expectedScope = target === ConfigurationTarget.Workspace ? "workspace" : "user";
        for (const group of connGroups) {
            group.scope = group.scope || expectedScope;
        }
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionGroupsArrayName,
            connGroups,
            target,
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
