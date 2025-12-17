/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Utils from "../models/utils";
import { ConfigSource, IConnectionGroup, IConnectionProfile } from "../models/interfaces";
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

    /** Root group ID and name. */
    static readonly RootGroupId: string = "ROOT";
    private _hasDisplayedMissingIdError: boolean = false;
    private _hasDisplayedGroupParentWarning: boolean = false;
    private _hasDisplayedOrphanedConnectionWarning: boolean = false;

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
        await this.addOrUpdateRootGroup();
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
        let userProfiles = this.getConnectionsFromSettings(ConfigurationTarget.Global);

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

    public async addConnection(
        profile: IConnectionProfile,
        configSource: ConfigSource = ConfigurationTarget.Global,
    ): Promise<void> {
        this.populateMissingConnectionIds(profile);

        const target = this.normalizeConfigTarget(configSource);
        profile.configSource = target;

        let profiles = this.getRawConnectionsFromSettings().filter(
            (conn) => conn.configSource === target,
        );

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
        const allProfiles = this.getRawConnectionsFromSettings();
        const target = this.resolveConnectionConfigSource(profile, allProfiles);
        let profiles = allProfiles.filter((conn) => conn.configSource === target);

        const found = this.removeConnectionHelper(profile, profiles);
        if (found) {
            await this.writeConnectionsToSettings(profiles, target);
        }
        return found;
    }

    public async updateConnection(updatedProfile: IConnectionProfile): Promise<void> {
        const allProfiles = this.getRawConnectionsFromSettings();
        const target = this.resolveConnectionConfigSource(updatedProfile, allProfiles);
        const profiles = allProfiles.filter((conn) => conn.configSource === target);
        const index = profiles.findIndex((p) => p.id === updatedProfile.id);
        if (index === -1) {
            throw new Error(`Connection with ID ${updatedProfile.id} not found`);
        }
        updatedProfile.configSource = target;
        profiles[index] = updatedProfile;
        await this.writeConnectionsToSettings(profiles, target);
    }

    //#endregion

    //#region Connection Groups

    public getRootGroup(): IConnectionGroup | undefined {
        const groups: IConnectionGroup[] = this.getRawGroupsFromSettings();
        const rootGroupsById = groups.filter((group) => group.id === ConnectionConfig.RootGroupId);
        if (rootGroupsById.length === 1) {
            return rootGroupsById[0];
        } else if (rootGroupsById.length > 1) {
            const message = `Multiple connection groups with ID "${ConnectionConfig.RootGroupId}" found.  Returning the first one: ${rootGroupsById[0].id}. Delete or rename the others, then restart the extension.`;
            this._logger.error(message);
            this._vscodeWrapper.showErrorMessage(message);
            return rootGroupsById[0];
        }

        const rootGroupsByName = groups.filter(
            (group) => group.name === ConnectionConfig.RootGroupId,
        );

        if (rootGroupsByName.length === 0) {
            this._logger.error(
                `No root connection group found. This should have been fixed at initialization.`,
            );
            return undefined;
        } else if (rootGroupsByName.length > 1) {
            const message = `Multiple connection groups with name "${ConnectionConfig.RootGroupId}" found.  Returning the first one: ${rootGroupsByName[0].id}. Delete or rename the others, then restart the extension.`;
            this._logger.error(message);
            this._vscodeWrapper.showErrorMessage(message);
        }

        return rootGroupsByName[0];
    }

    public async getGroups(location?: ConfigTarget): Promise<IConnectionGroup[]> {
        await this.initialized;
        return location ? this.getGroupsFromSettings(location) : this.getGroupsFromSettings();
    }

    /**
     * Retrieves a connection group by its ID.
     * @param id The ID of the connection group to retrieve.
     * @returns The connection group with the specified ID, or `undefined` if not found.
     */
    public getGroupById(id: string): IConnectionGroup | undefined {
        const connGroups = this.getGroupsFromSettings();
        return connGroups.find((g) => g.id === id);
    }

    public addGroup(
        group: IConnectionGroup,
        configSource: ConfigSource = ConfigurationTarget.Global,
    ): Promise<void> {
        if (!group.id) {
            group.id = Utils.generateGuid();
        }

        if (!group.parentId) {
            group.parentId = this.getRootGroup().id;
        }

        group.configSource = this.normalizeConfigTarget(configSource);

        const groups = this.getRawGroupsFromSettings();
        groups.push(group);
        return this.writeConnectionGroupsToSettings(groups);
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
        const connections = this.getRawConnectionsFromSettings();
        const groups = this.getRawGroupsFromSettings();
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
        let remainingConnections: IConnectionProfile[];
        let remainingGroups: IConnectionGroup[];

        if (contentAction === "delete") {
            // Get all nested subgroups to remove
            const groupsToRemove = getAllSubgroupIds(id);

            // Remove all connections in the groups being removed
            remainingConnections = connections.filter((conn) => {
                if (groupsToRemove.has(conn.groupId)) {
                    this._logger.verbose(
                        `Removing connection '${conn.id}' because its group '${conn.groupId}' was removed`,
                    );
                    connectionModified = true;
                    return false;
                }
                return true;
            });

            // Remove all groups that were marked for removal
            remainingGroups = groups.filter((g) => !groupsToRemove.has(g.id));
        } else {
            // Move immediate child connections to root
            remainingConnections = connections.map((conn) => {
                if (conn.groupId === id) {
                    this._logger.verbose(
                        `Moving connection '${conn.id}' to root group because its immediate parent group '${id}' was removed`,
                    );
                    connectionModified = true;
                    return { ...conn, groupId: rootGroup.id };
                }
                return conn;
            });

            // First remove the target group
            remainingGroups = groups.filter((g) => g.id !== id);

            // Then reparent immediate children to root
            remainingGroups = remainingGroups.map((g) => {
                if (g.parentId === id) {
                    this._logger.verbose(
                        `Moving group '${g.id}' to root group because its immediate parent group '${id}' was removed`,
                    );
                    return { ...g, parentId: rootGroup.id };
                }
                return g;
            });
        }

        if (remainingGroups.length === groups.length) {
            this._logger.error(`Connection group with ID '${id}' not found when removing.`);
            return false;
        }

        if (connectionModified) {
            await this.writeConnectionsToSettings(remainingConnections);
        }

        await this.writeConnectionGroupsToSettings(remainingGroups);
        return true;
    }

    public async updateGroup(updatedGroup: IConnectionGroup): Promise<void> {
        const groups = this.getRawGroupsFromSettings();
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

    private async addOrUpdateRootGroup(): Promise<void> {
        let madeGroupChanges = false;
        let connectionsChanged = false;
        const groups: IConnectionGroup[] = this.getRawGroupsFromSettings();

        let rootGroup =
            groups.find((group) => group.id === ConnectionConfig.RootGroupId) ??
            groups.find((group) => group.name === ConnectionConfig.RootGroupId);

        if (!rootGroup) {
            rootGroup = {
                name: ConnectionConfig.RootGroupId,
                id: ConnectionConfig.RootGroupId,
                configSource: ConfigurationTarget.Global,
            };

            this._logger.info(`Adding missing ROOT group to connection groups`);
            madeGroupChanges = true;
            groups.push(rootGroup);
        } else if (rootGroup.id !== ConnectionConfig.RootGroupId) {
            const legacyRootId = rootGroup.id;
            rootGroup.id = ConnectionConfig.RootGroupId;
            madeGroupChanges = true;
            this._logger.info(
                `Updating ROOT group ID from '${legacyRootId}' to '${ConnectionConfig.RootGroupId}'`,
            );

            for (const group of groups) {
                if (group.id === legacyRootId) {
                    continue;
                }

                if (group.parentId === legacyRootId) {
                    group.parentId = ConnectionConfig.RootGroupId;
                    madeGroupChanges = true;
                    this._logger.verbose(
                        `Updating parentId for group '${group.name}' (${group.id}) to '${ConnectionConfig.RootGroupId}'`,
                    );
                }
            }

            const connections = this.getRawConnectionsFromSettings();
            for (const profile of connections) {
                if (profile.groupId === legacyRootId) {
                    profile.groupId = ConnectionConfig.RootGroupId;
                    connectionsChanged = true;
                    this._logger.verbose(
                        `Updating groupId for connection '${getConnectionDisplayName(profile)}' to '${ConnectionConfig.RootGroupId}'`,
                    );
                }
            }

            if (connectionsChanged && connections) {
                this._logger.info(
                    `Updates made to connection profiles after ROOT group migration.  Writing all ${connections.length} profile(s) to settings.`,
                );
                await this.writeConnectionsToSettings(connections);
            }
        }

        if (madeGroupChanges) {
            this._logger.info(
                `Updates made to connection groups.  Writing all ${groups.length} group(s) to settings.`,
            );

            await this.writeConnectionGroupsToSettings(groups);
        }
    }

    private async assignConnectionGroupMissingIds(): Promise<void> {
        let madeGroupChanges = false;
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();
        const rootGroup = this.getRootGroup();

        if (!rootGroup) {
            this._logger.error(
                "Root group not found when assigning connection group IDs. This should have been handled earlier in initialization.",
            );
            return;
        }

        // Clean up connection groups
        for (const group of groups) {
            if (group.id === rootGroup.id) {
                continue;
            }

            // ensure each group has an ID
            if (!group.id) {
                group.id = Utils.generateGuid();
                madeGroupChanges = true;
                this._logger.logDebug(`Adding missing ID to connection group '${group.name}'`);
            }

            // ensure each group is in a group
            if (!group.parentId) {
                group.parentId = rootGroup.id;
                madeGroupChanges = true;
                this._logger.logDebug(`Adding missing parentId to connection '${group.name}'`);
            }
        }

        // Save the changes to settings
        if (madeGroupChanges) {
            this._logger.logDebug(
                `Updates made to connection groups.  Writing all ${groups.length} group(s) to settings.`,
            );

            await this.writeConnectionGroupsToSettings(groups);
        }
    }

    private async assignConnectionMissingIds(): Promise<void> {
        let madeChanges = false;

        // Clean up connection profiles
        const profiles: IConnectionProfile[] = this.getRawConnectionsFromSettings();

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
     * @param target When set, only connections from that target are returned; otherwise all stored connections are returned.
     */
    public getConnectionsFromSettings(target?: ConfigTarget): IConnectionProfile[] {
        const allConnections = this.getRawConnectionsFromSettings();
        const validGroupIds = new Set<string>(this.getGroupsFromSettings().map((g) => g.id));

        const orphanedConnections: IConnectionProfile[] = [];
        const filteredConnections = allConnections.filter((connection) => {
            if (connection.groupId && !validGroupIds.has(connection.groupId)) {
                orphanedConnections.push(connection);
                return false;
            }
            return true;
        });

        if (orphanedConnections.length > 0 && !this._hasDisplayedOrphanedConnectionWarning) {
            this._hasDisplayedOrphanedConnectionWarning = true;
            void this._vscodeWrapper.showWarningMessage(
                LocalizedConstants.Connection.orphanedConnectionsWarning(
                    orphanedConnections.map((connection) => getConnectionDisplayName(connection)),
                ),
            );
        }

        return target
            ? filteredConnections.filter((connection) => connection.configSource === target)
            : filteredConnections;
    }

    private getRawConnectionsFromSettings(): IConnectionProfile[] {
        const globalConnections = this.getArrayFromSettings<IConnectionProfile>(
            Constants.connectionsArrayName,
            ConfigurationTarget.Global,
        ).map((profile) => {
            return { ...profile, configSource: ConfigurationTarget.Global as ConfigSource };
        });

        const workspaceConnections = this.getArrayFromSettings<IConnectionProfile>(
            Constants.connectionsArrayName,
            ConfigurationTarget.Workspace,
        ).map((profile) => {
            return { ...profile, configSource: ConfigurationTarget.Workspace as ConfigSource };
        });

        return [...globalConnections, ...workspaceConnections];
    }

    public getGroupsFromSettings(target?: ConfigTarget): IConnectionGroup[] {
        const allGroups = this.getRawGroupsFromSettings();
        const knownGroupIds = new Set<string>(allGroups.map((group) => group.id));
        knownGroupIds.add(ConnectionConfig.RootGroupId);

        const orphanedGroups: IConnectionGroup[] = [];
        const filteredGroups = allGroups.filter((group) => {
            if (
                group.id !== ConnectionConfig.RootGroupId &&
                group.parentId &&
                !knownGroupIds.has(group.parentId)
            ) {
                orphanedGroups.push(group);
                return false;
            }
            return true;
        });

        if (orphanedGroups.length > 0 && !this._hasDisplayedGroupParentWarning) {
            this._hasDisplayedGroupParentWarning = true;
            void this._vscodeWrapper.showWarningMessage(
                LocalizedConstants.Connection.orphanedConnectionGroupsWarning(
                    orphanedGroups.map((group) => group.name ?? group.id),
                ),
            );
        }

        return target
            ? filteredGroups.filter((group) => group.configSource === target)
            : filteredGroups;
    }

    private getRawGroupsFromSettings(): IConnectionGroup[] {
        const globalGroups = this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            ConfigurationTarget.Global,
        ).map((group) => {
            return { ...group, configSource: ConfigurationTarget.Global as ConfigSource };
        });

        const workspaceGroups = this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            ConfigurationTarget.Workspace,
        ).map((group) => {
            return { ...group, configSource: ConfigurationTarget.Workspace as ConfigSource };
        });

        return [...globalGroups, ...workspaceGroups];
    }

    /**
     * Replace existing profiles in the user settings with a new set of profiles.
     * @param profiles the set of profiles to insert into the settings file.
     */
    private async writeConnectionsToSettings(
        profiles: IConnectionProfile[],
        target?: ConfigTarget,
    ): Promise<void> {
        const connectionTargets = new Map<ConfigTarget, IConnectionProfile[]>();
        const lookup = target ? undefined : profiles;

        const addProfileToTarget = (
            profile: IConnectionProfile,
            forcedTarget?: ConfigTarget,
        ): void => {
            const resolvedTarget = forcedTarget
                ? this.normalizeConfigTarget(forcedTarget)
                : this.resolveConnectionConfigSource(profile, lookup);
            profile.configSource = resolvedTarget;
            if (!connectionTargets.has(resolvedTarget)) {
                connectionTargets.set(resolvedTarget, []);
            }
            connectionTargets.get(resolvedTarget).push(profile);
        };

        for (const profile of profiles) {
            addProfileToTarget(profile, target);
        }

        for (const [configTarget, targetProfiles] of connectionTargets.entries()) {
            const cleanedProfiles = targetProfiles.map((profile) => {
                const cleanedProfile = { ...profile };
                delete cleanedProfile.configSource;
                return cleanedProfile;
            });

            await this._vscodeWrapper.setConfiguration(
                Constants.extensionName,
                Constants.connectionsArrayName,
                cleanedProfiles,
                configTarget,
            );
        }
    }

    private async writeConnectionGroupsToSettings(
        connGroups: IConnectionGroup[],
        target?: ConfigTarget,
    ): Promise<void> {
        const groupTargets = new Map<ConfigTarget, IConnectionGroup[]>();
        const lookup = target ? undefined : connGroups;

        const addGroupToTarget = (group: IConnectionGroup, forcedTarget?: ConfigTarget): void => {
            const resolvedTarget = forcedTarget
                ? this.normalizeConfigTarget(forcedTarget)
                : this.resolveGroupConfigSource(group, lookup);
            group.configSource = resolvedTarget;
            if (!groupTargets.has(resolvedTarget)) {
                groupTargets.set(resolvedTarget, []);
            }
            groupTargets.get(resolvedTarget).push(group);
        };

        for (const group of connGroups) {
            addGroupToTarget(group, target);
        }

        for (const [configTarget, groups] of groupTargets.entries()) {
            const cleanedGroups = groups.map((group) => {
                const cleanedGroup = { ...group };
                delete cleanedGroup.configSource;
                return cleanedGroup;
            });

            await this._vscodeWrapper.setConfiguration(
                Constants.extensionName,
                Constants.connectionGroupsArrayName,
                cleanedGroups,
                configTarget,
            );
        }
    }

    private normalizeConfigTarget(source?: ConfigSource): ConfigTarget {
        return source === ConfigurationTarget.Workspace
            ? ConfigurationTarget.Workspace
            : ConfigurationTarget.Global;
    }

    private resolveConnectionConfigSource(
        profile: IConnectionProfile,
        profilesForLookup?: IConnectionProfile[],
        fallback: ConfigTarget = ConfigurationTarget.Global,
    ): ConfigTarget {
        if (this.isSupportedConfigTarget(profile.configSource)) {
            return profile.configSource;
        }

        const lookup = profilesForLookup ?? this.getRawConnectionsFromSettings();
        if (profile.id) {
            const existing = lookup.find((conn) => conn.id === profile.id);
            if (existing && this.isSupportedConfigTarget(existing.configSource)) {
                profile.configSource = existing.configSource;
                return existing.configSource;
            }
        }

        profile.configSource = fallback;
        return fallback;
    }

    private resolveGroupConfigSource(
        group: IConnectionGroup,
        groupsForLookup?: IConnectionGroup[],
        fallback: ConfigTarget = ConfigurationTarget.Global,
    ): ConfigTarget {
        if (this.isSupportedConfigTarget(group.configSource)) {
            return group.configSource;
        }

        const lookup = groupsForLookup ?? this.getRawGroupsFromSettings();
        if (group.id) {
            const existing = lookup.find((candidate) => candidate.id === group.id);
            if (existing && this.isSupportedConfigTarget(existing.configSource)) {
                group.configSource = existing.configSource;
                return existing.configSource;
            }
        }

        group.configSource = fallback;
        return fallback;
    }

    private isSupportedConfigTarget(source: ConfigSource | undefined): source is ConfigTarget {
        return source === ConfigurationTarget.Global || source === ConfigurationTarget.Workspace;
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
