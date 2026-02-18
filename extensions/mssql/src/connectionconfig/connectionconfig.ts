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
import { ConnectionProfile } from "../models/connectionProfile";
import { getConnectionDisplayName } from "../models/connectionInfo";
import { Deferred } from "../protocol";
import { Logger } from "../models/logger";
import { ConfigurationTarget } from "vscode";

export type ConfigTarget = ConfigurationTarget.Global | ConfigurationTarget.Workspace;

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {
    protected _logger: Logger;
    public initialized: Deferred<void> = new Deferred<void>();

    /** Root group ID and name */
    static readonly ROOT_GROUP_ID: string = "ROOT";
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
    public async getConnections(): Promise<IConnectionProfile[]> {
        await this.initialized;

        let profiles: IConnectionProfile[] = this.getConnectionsFromSettings();
        profiles.sort(this.compareConnectionProfile);

        if (profiles.length > 0) {
            profiles = profiles.filter((conn) => {
                // filter out any connection missing a connection string and server name or the sample that's shown by default
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

        const profiles = await this.getConnections();
        return profiles.find((profile) => profile.id === id);
    }

    /**
     * Adds or replaces a single connection in the appropriate config target.
     * The config source is inferred when not explicitly provided.
     */
    public async addConnection(profile: IConnectionProfile): Promise<void> {
        this.populateMissingConnectionMetadata(profile);

        let profiles = this.getRawConnectionsFromSettings().filter(
            (conn) => conn.configSource === profile.configSource,
        );

        // Remove the profile if already set
        profiles = profiles.filter((value) => !Utils.isSameProfile(value, profile));
        profiles.push(profile);

        return await this.writeConnectionsToSettings(profiles, profile.configSource);
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
        const groups: IConnectionGroup[] = this.getGroupsFromSettings();
        const rootGroupsById = groups.filter(
            (group) => group.id === ConnectionConfig.ROOT_GROUP_ID,
        );

        if (rootGroupsById.length === 0) {
            this._logger.error(
                `Root group not found in getRootGroup().  This should have been created during initialization.`,
            );
            return undefined;
        } else if (rootGroupsById.length === 1) {
            return rootGroupsById[0];
        } else if (rootGroupsById.length > 1) {
            this._logger.error(
                `Multiple connection groups with ID "${ConnectionConfig.ROOT_GROUP_ID}" found.  Delete or rename all of them, except one in User/Global settings.json, then restart the extension.`,
            );
            this._vscodeWrapper.showErrorMessage(
                LocalizedConstants.Connection.multipleRootGroupsFoundError(
                    ConnectionConfig.ROOT_GROUP_ID,
                ),
            );
            return rootGroupsById[0];
        }
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

    /**
     * Saves a connection group to the requested configuration scope.
     */
    public addGroup(group: IConnectionGroup): Promise<void> {
        if (!group.id) {
            group.id = Utils.generateGuid();
        }

        if (!group.parentId) {
            group.parentId = this.getRootGroup().id;
        }

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
    public populateMissingConnectionMetadata(profile: IConnectionProfile): boolean {
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

        // ensure profile has a config source set
        if (profile.configSource === undefined) {
            profile.configSource = ConfigurationTarget.Global;
            modified = true;
        }

        return modified;
    }

    //#endregion

    //#region Initialization

    private async addOrUpdateRootGroup(): Promise<void> {
        let madeGroupChanges = false;
        let connectionsChanged = false;
        const rawGroups: IConnectionGroup[] = this.getRawGroupsFromSettings();

        let rootGroup =
            rawGroups.find((group) => group.id === ConnectionConfig.ROOT_GROUP_ID) ?? // Modern root group should have expected ID "ROOT"
            rawGroups.find((group) => group.name === ConnectionConfig.ROOT_GROUP_ID); // Legacy root group had name "ROOT" but not ID "ROOT"; this gets upgraded below

        if (!rootGroup) {
            // Root node entirely missing; create it
            rootGroup = {
                name: ConnectionConfig.ROOT_GROUP_ID,
                id: ConnectionConfig.ROOT_GROUP_ID,
                configSource: ConfigurationTarget.Global,
            };

            this._logger.info(`Adding missing ROOT group to connection groups`);
            madeGroupChanges = true;
            rawGroups.push(rootGroup);
        } else if (rootGroup.id !== ConnectionConfig.ROOT_GROUP_ID) {
            // Migrate legacy root group to have the correct ID
            const legacyRootId = rootGroup.id;
            rootGroup.id = ConnectionConfig.ROOT_GROUP_ID;
            madeGroupChanges = true;
            this._logger.info(
                `Updating ROOT group ID from '${legacyRootId}' to '${ConnectionConfig.ROOT_GROUP_ID}'`,
            );

            // Update all groups that referenced the legacy root ID
            for (const group of rawGroups) {
                if (group.id === legacyRootId) {
                    continue;
                }

                if (group.parentId === legacyRootId) {
                    group.parentId = ConnectionConfig.ROOT_GROUP_ID;
                    madeGroupChanges = true;
                    this._logger.verbose(
                        `Updating parentId for group '${group.name}' (${group.id}) to '${ConnectionConfig.ROOT_GROUP_ID}'`,
                    );
                }
            }

            // Update all connections that referenced the legacy root ID
            const rawConnections = this.getRawConnectionsFromSettings();
            for (const profile of rawConnections) {
                if (profile.groupId === legacyRootId) {
                    profile.groupId = ConnectionConfig.ROOT_GROUP_ID;
                    connectionsChanged = true;
                    this._logger.verbose(
                        `Updating groupId for connection '${getConnectionDisplayName(profile)}' to '${ConnectionConfig.ROOT_GROUP_ID}'`,
                    );
                }
            }

            if (connectionsChanged && rawConnections) {
                this._logger.info(
                    `Updates made to connection profiles after ROOT group migration.  Writing all ${rawConnections.length} profile(s) to settings.`,
                );
                await this.writeConnectionsToSettings(rawConnections);
            }
        }

        if (madeGroupChanges) {
            this._logger.info(
                `Updates made to connection groups.  Writing all ${rawGroups.length} group(s) to settings.`,
            );

            await this.writeConnectionGroupsToSettings(rawGroups);
        }
    }

    private async assignConnectionGroupMissingIds(): Promise<void> {
        let madeGroupChanges = false;
        const groups: IConnectionGroup[] = this.getRawGroupsFromSettings();

        // Clean up connection groups
        for (const group of groups) {
            if (group.id === ConnectionConfig.ROOT_GROUP_ID) {
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
                group.parentId = ConnectionConfig.ROOT_GROUP_ID;
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

        // Clean up connection profiles in the user settings only
        const profiles: IConnectionProfile[] = this.getRawConnectionsFromSettings();

        for (const profile of profiles) {
            if (this.populateMissingConnectionMetadata(profile)) {
                madeChanges = true;
                this._logger.logDebug(
                    `Adding missing group ID or connection ID to connection '${getConnectionDisplayName(profile)}' from ${ConfigurationTarget[profile.configSource]}`,
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
    /**
     * Returns connection profiles stored across all config locations, excluding malformed entries.
     */
    public getConnectionsFromSettings(target?: ConfigTarget): IConnectionProfile[] {
        const orderedConnections = this.getRawConnectionsFromSettings();
        const uniqueConnections = this.removeDuplicateConnectionIds(orderedConnections);

        const validGroupIds = new Set<string>(
            this.getGroupsFromSettings().map((group) => group.id),
        );

        const validConnections = this.removeConnectionsWithUnknownGroups(
            uniqueConnections,
            validGroupIds,
        );

        return target
            ? validConnections.filter((connection) => connection.configSource === target)
            : validConnections;
    }

    /**
     * Gets all connections from both global and workspace settings.
     * No processing is done to remove duplicates or invalid entries.

     */
    private getRawConnectionsFromSettings(): IConnectionProfile[] {
        const globalConnections = this.getArrayFromSettings<IConnectionProfile>(
            Constants.connectionsArrayName,
            ConfigurationTarget.Global,
        ).map((profile) => {
            return { ...profile, configSource: ConfigurationTarget.Global as ConfigTarget };
        });

        const workspaceConnections = this.getArrayFromSettings<IConnectionProfile>(
            Constants.connectionsArrayName,
            ConfigurationTarget.Workspace,
        ).map((profile) => {
            return { ...profile, configSource: ConfigurationTarget.Workspace as ConfigTarget };
        });

        return [...globalConnections, ...workspaceConnections];
    }

    /**
     * Returns connection groups stored across all config locations, excluding malformed entries.
     */
    public getGroupsFromSettings(target?: ConfigTarget): IConnectionGroup[] {
        let allGroups = this.getRawGroupsFromSettings();
        allGroups = this.filterInvalidGroups(allGroups);

        return target ? allGroups.filter((group) => group.configSource === target) : allGroups;
    }

    /**
     * Gets all connection groups from both global and workspace settings.
     * No processing is done to remove duplicates or invalid entries.
     */
    private getRawGroupsFromSettings(): IConnectionGroup[] {
        const globalGroups = this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            ConfigurationTarget.Global,
        ).map((group) => {
            return { ...group, configSource: ConfigurationTarget.Global as ConfigTarget };
        });

        const workspaceGroups = this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            ConfigurationTarget.Workspace,
        ).map((group) => {
            return { ...group, configSource: ConfigurationTarget.Workspace as ConfigTarget };
        });

        return [...globalGroups, ...workspaceGroups];
    }

    /**
     * Replace existing profiles in the user settings with a new set of profiles.
     * @param profiles the set of profiles to insert into the settings file.
     */
    /**
     * Persists the provided profiles. When `target` is undefined, this method automatically splits
     * the profiles by config target so that each backing store receives the correct subset.
     */
    private async writeConnectionsToSettings(
        profiles: IConnectionProfile[],
        target?: ConfigTarget,
    ): Promise<void> {
        const groupedProfiles = new Map<ConfigTarget, IConnectionProfile[]>();
        const existingTargets = new Set<ConfigTarget>(
            this.getRawConnectionsFromSettings().map((profile) => profile.configSource),
        );

        // Group profiles for writing by their config source
        for (const profile of profiles) {
            const resolvedConfigSource = this.resolveConnectionConfigSource(profile, profiles); // ensure configSource is set
            profile.configSource = resolvedConfigSource;

            if (!groupedProfiles.has(resolvedConfigSource)) {
                groupedProfiles.set(resolvedConfigSource, []);
            }

            groupedProfiles.get(resolvedConfigSource).push(profile);
        }

        const targetsToUpdate = new Set<ConfigTarget>([
            ...existingTargets,
            ...groupedProfiles.keys(),
        ]);

        // Write to the specified target, or to all targets if none specified
        if (target && groupedProfiles.get(target)) {
            const targetProfiles = groupedProfiles.get(target);
            await this.persistConnectionsForTarget(targetProfiles, target);
        } else {
            for (const configTarget of targetsToUpdate) {
                const targetProfiles = groupedProfiles.get(configTarget) ?? [];
                await this.persistConnectionsForTarget(targetProfiles, configTarget);
            }
        }
    }

    private async persistConnectionsForTarget(
        profiles: IConnectionProfile[],
        target: ConfigTarget,
    ): Promise<void> {
        const cleanedProfiles = profiles.map((profile) => {
            const cleanedProfile = { ...profile };
            delete cleanedProfile.configSource;
            return cleanedProfile;
        });

        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionsArrayName,
            cleanedProfiles,
            target,
        );
    }

    /**
     * Persists the provided groups. Works similarly to {@link writeConnectionsToSettings}.
     */
    private async writeConnectionGroupsToSettings(
        connGroups: IConnectionGroup[],
        target?: ConfigTarget,
    ): Promise<void> {
        if (target) {
            await this.persistGroupsForTarget(connGroups, target);
            return;
        }

        const groupedGroups = new Map<ConfigTarget, IConnectionGroup[]>();
        const existingTargets = new Set<ConfigTarget>(
            this.getRawGroupsFromSettings().map((group) => group.configSource),
        );

        const lookup = connGroups;
        for (const group of connGroups) {
            const resolvedTarget = this.resolveGroupConfigSource(group, lookup);
            group.configSource = resolvedTarget;
            if (!groupedGroups.has(resolvedTarget)) {
                groupedGroups.set(resolvedTarget, []);
            }
            groupedGroups.get(resolvedTarget).push(group);
        }

        const targetsToUpdate = new Set<ConfigTarget>([
            ...existingTargets,
            ...groupedGroups.keys(),
        ]);

        for (const configTarget of targetsToUpdate) {
            const targetGroups = groupedGroups.get(configTarget) ?? [];
            await this.persistGroupsForTarget(targetGroups, configTarget);
        }
    }

    private async persistGroupsForTarget(
        groups: IConnectionGroup[],
        target: ConfigTarget,
    ): Promise<void> {
        const cleanedGroups = groups.map((group) => {
            const cleanedGroup = { ...group };
            delete cleanedGroup.configSource;
            return cleanedGroup;
        });

        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionGroupsArrayName,
            cleanedGroups,
            target,
        );
    }

    /**
     * Attempts to deduce which config target a connection belongs to when the caller hasn't set it.
     * This is required because we read from both user and workspace scopes.
     */
    private resolveConnectionConfigSource(
        profile: IConnectionProfile,
        profilesForLookup?: IConnectionProfile[],
    ): ConfigTarget {
        // If it's already set, use that
        if (profile.configSource !== undefined) {
            return profile.configSource;
        }

        // If it's not set, try to look it up by ID
        const lookup = profilesForLookup ?? this.getRawConnectionsFromSettings();
        if (profile.id) {
            const existing = lookup.find((candidate) => candidate.id === profile.id);
            if (existing) {
                return existing.configSource;
            }
        }

        // Otherwise, default to global
        return ConfigurationTarget.Global;
    }

    /** Attempts to deduce which config target a group belongs to when the caller hasn't set it. */
    private resolveGroupConfigSource(
        group: IConnectionGroup,
        groupsForLookup?: IConnectionGroup[],
    ): ConfigTarget {
        // If it's already set, use that
        if (group.configSource !== undefined) {
            return group.configSource;
        }

        // If it's not set, try to look it up by ID
        const lookup = groupsForLookup ?? this.getRawGroupsFromSettings();
        if (group.id) {
            const existing = lookup.find((candidate) => candidate.id === group.id);
            if (existing) {
                return existing.configSource;
            }
        }

        // Otherwise, default to global
        return ConfigurationTarget.Global;
    }

    /**
     * Filters groups whose parent hierarchy is invalid and notifies the user once per session.
     */
    private filterInvalidGroups(groups: IConnectionGroup[]): IConnectionGroup[] {
        const orderedGroups = [
            ...groups.filter((group) => group.configSource === ConfigurationTarget.Global),
            ...groups.filter((group) => group.configSource !== ConfigurationTarget.Global),
        ];

        const uniqueGroups = this.removeDuplicateGroupIds(orderedGroups);

        return this.removeGroupsWithUnknownParents(uniqueGroups);
    }

    /**
     * Removes groups whose parent ID does not refer to another known group.
     * Emits a warning once per session if any invalid parents are found.
     */
    private removeGroupsWithUnknownParents(groups: IConnectionGroup[]): IConnectionGroup[] {
        const knownGroupIds = new Set<string>([ConnectionConfig.ROOT_GROUP_ID]);
        for (const group of groups) {
            knownGroupIds.add(group.id);
        }

        const invalidGroups: IConnectionGroup[] = [];
        const groupsToKeep: IConnectionGroup[] = [];

        for (const group of groups) {
            const parentId =
                group.id === ConnectionConfig.ROOT_GROUP_ID
                    ? ConnectionConfig.ROOT_GROUP_ID
                    : group.parentId;

            if (parentId && knownGroupIds.has(parentId)) {
                groupsToKeep.push(group);
            } else {
                invalidGroups.push(group);
            }
        }

        if (invalidGroups.length > 0 && !this._hasDisplayedGroupParentWarning) {
            this._hasDisplayedGroupParentWarning = true;
            const orphanedGroupsMessage =
                LocalizedConstants.Connection.orphanedConnectionGroupsWarning(
                    invalidGroups.map((group) => group.name).join(", "),
                );

            void this._vscodeWrapper.showWarningMessage(orphanedGroupsMessage);
        }

        return groupsToKeep;
    }

    /**
     * Removes groups with duplicate IDs, preserving the first occurrence.
     */
    private removeDuplicateGroupIds(groups: IConnectionGroup[]): IConnectionGroup[] {
        const seenIds = new Set<string>();
        const groupsToKeep: IConnectionGroup[] = [];

        for (const group of groups) {
            if (seenIds.has(group.id)) {
                continue;
            }

            seenIds.add(group.id);
            groupsToKeep.push(group);
        }

        return groupsToKeep;
    }

    /**
     * Removes connections whose group IDs aren't known and warns once per session.
     */
    private removeConnectionsWithUnknownGroups(
        connections: IConnectionProfile[],
        knownGroupIds: Set<string>,
    ): IConnectionProfile[] {
        const filteredConnections: IConnectionProfile[] = [];
        const orphanedConnections: IConnectionProfile[] = [];

        for (const connection of connections) {
            if (connection.groupId && knownGroupIds.has(connection.groupId)) {
                filteredConnections.push(connection);
            } else {
                orphanedConnections.push(connection);
            }
        }

        if (orphanedConnections.length > 0 && !this._hasDisplayedOrphanedConnectionWarning) {
            this._hasDisplayedOrphanedConnectionWarning = true;
            const orphanedConnectionsMessage =
                LocalizedConstants.Connection.orphanedConnectionsWarning(
                    orphanedConnections.map((conn) => getConnectionDisplayName(conn)),
                );

            void this._vscodeWrapper.showWarningMessage(orphanedConnectionsMessage);
        }

        return filteredConnections;
    }

    /**
     * Removes duplicate connection IDs, preserving the first occurrence (preferring user/global entries).
     */
    private removeDuplicateConnectionIds(connections: IConnectionProfile[]): IConnectionProfile[] {
        const seenIds = new Set<string>();
        const connectionsToKeep: IConnectionProfile[] = [];

        for (const connection of connections) {
            if (connection.id) {
                if (seenIds.has(connection.id)) {
                    continue;
                }

                seenIds.add(connection.id);
            }

            connectionsToKeep.push(connection);
        }

        return connectionsToKeep;
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
            // otherwise, return the the workspace values
            // TODO: consider addition of workspace folder scope.  Workspace folder scope may have overlap/duplication with workspace scope
            return configValue.workspaceValue || [];
        }
    }

    //#endregion
}
