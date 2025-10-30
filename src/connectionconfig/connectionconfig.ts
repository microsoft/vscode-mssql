/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
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

export interface ConnectionCreatedEvent {
    connection: IConnectionProfile;
}

export interface ConnectionUpdatedEvent {
    before: IConnectionProfile;
    after: IConnectionProfile;
}

export interface ConnectionRemovedEvent {
    connection: IConnectionProfile;
}

export interface ConnectionGroupCreatedEvent {
    group: IConnectionGroup;
}

export interface ConnectionGroupUpdatedEvent {
    before: IConnectionGroup;
    after: IConnectionGroup;
}

export interface ConnectionGroupRemovedEvent {
    group: IConnectionGroup;
}

/**
 * Implements connection profile file storage.
 */
export class ConnectionConfig implements IConnectionConfig {
    protected _logger: Logger;
    public initialized: Deferred<void> = new Deferred<void>();

    /** The name of the root connection group. */
    static readonly RootGroupName: string = "ROOT";
    private _hasDisplayedMissingIdError: boolean = false;

    /** Event fired after a connection profile is successfully created. */
    public readonly onConnectionCreated: vscode.Event<ConnectionCreatedEvent>;
    private readonly _onConnectionCreatedEmitter =
        new vscode.EventEmitter<ConnectionCreatedEvent>();

    /** Event fired after a connection profile is successfully updated. */
    public readonly onConnectionUpdated: vscode.Event<ConnectionUpdatedEvent>;
    private readonly _onConnectionUpdatedEmitter =
        new vscode.EventEmitter<ConnectionUpdatedEvent>();

    /** Event fired after a connection profile is successfully removed. */
    public readonly onConnectionRemoved: vscode.Event<ConnectionRemovedEvent>;
    private readonly _onConnectionRemovedEmitter =
        new vscode.EventEmitter<ConnectionRemovedEvent>();

    /** Event fired after a connection group is successfully created. */
    public readonly onConnectionGroupCreated: vscode.Event<ConnectionGroupCreatedEvent>;
    private readonly _onConnectionGroupCreatedEmitter =
        new vscode.EventEmitter<ConnectionGroupCreatedEvent>();

    /** Event fired after a connection group is successfully updated. */
    public readonly onConnectionGroupUpdated: vscode.Event<ConnectionGroupUpdatedEvent>;
    private readonly _onConnectionGroupUpdatedEmitter =
        new vscode.EventEmitter<ConnectionGroupUpdatedEvent>();

    /** Event fired after a connection group is successfully removed. */
    public readonly onConnectionGroupRemoved: vscode.Event<ConnectionGroupRemovedEvent>;
    private readonly _onConnectionGroupRemovedEmitter =
        new vscode.EventEmitter<ConnectionGroupRemovedEvent>();

    /**
     * Constructor
     */
    public constructor(private _vscodeWrapper?: VscodeWrapper) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this.onConnectionCreated = this._onConnectionCreatedEmitter.event;
        this.onConnectionUpdated = this._onConnectionUpdatedEmitter.event;
        this.onConnectionRemoved = this._onConnectionRemovedEmitter.event;
        this.onConnectionGroupCreated = this._onConnectionGroupCreatedEmitter.event;
        this.onConnectionGroupUpdated = this._onConnectionGroupUpdatedEmitter.event;
        this.onConnectionGroupRemoved = this._onConnectionGroupRemovedEmitter.event;

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

        await this.writeConnectionsToSettings(profiles);
        this._onConnectionCreatedEmitter.fire({
            connection: Utils.deepClone(profile),
        });
    }

    /**
     * Remove an existing connection from the connection config if it exists.
     * @returns true if the connection was removed, false if the connection wasn't found.
     */
    public async removeConnection(profile: IConnectionProfile): Promise<boolean> {
        let profiles = await this.getConnections(false /* getWorkspaceConnections */);

        const removedProfiles = this.removeConnectionHelper(profile, profiles);
        if (removedProfiles.length > 0) {
            await this.writeConnectionsToSettings(profiles);
            removedProfiles.forEach((removedProfile) => {
                this._onConnectionRemovedEmitter.fire({
                    connection: removedProfile,
                });
            });
            return true;
        }
        return false;
    }

    public async updateConnection(updatedProfile: IConnectionProfile): Promise<void> {
        const profiles = await this.getConnections(false /* getWorkspaceConnections */);
        const index = profiles.findIndex((p) => p.id === updatedProfile.id);
        if (index === -1) {
            throw new Error(`Connection with ID ${updatedProfile.id} not found`);
        }
        const previousProfile = Utils.deepClone(profiles[index]);
        profiles[index] = updatedProfile;
        await this.writeConnectionsToSettings(profiles);
        this._onConnectionUpdatedEmitter.fire({
            before: previousProfile,
            after: Utils.deepClone(updatedProfile),
        });
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
        const connGroups = this.getGroupsFromSettings(ConfigurationTarget.Global);
        return connGroups.find((g) => g.id === id);
    }

    public async addGroup(group: IConnectionGroup): Promise<void> {
        if (!group.id) {
            group.id = Utils.generateGuid();
        }

        if (!group.parentId) {
            group.parentId = this.getRootGroup().id;
        }

        const groups = this.getGroupsFromSettings();
        groups.push(group);
        await this.writeConnectionGroupsToSettings(groups);
        this._onConnectionGroupCreatedEmitter.fire({
            group: Utils.deepClone(group),
        });
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
        const connections = this.getConnectionsFromSettings();
        const groups = this.getGroupsFromSettings();
        const rootGroup = this.getRootGroup();

        if (!rootGroup) {
            throw new Error("Root group not found when removing group");
        }

        const groupToRemove = groups.find((g) => g.id === id);
        if (!groupToRemove) {
            this._logger.error(`Connection group with ID '${id}' not found when removing.`);
            return false;
        }
        const removedGroupSnapshot = Utils.deepClone(groupToRemove);

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
        this._onConnectionGroupRemovedEmitter.fire({
            group: removedGroupSnapshot,
        });
        return true;
    }

    public async updateGroup(updatedGroup: IConnectionGroup): Promise<void> {
        const groups = this.getGroupsFromSettings();
        const index = groups.findIndex((g) => g.id === updatedGroup.id);
        if (index === -1) {
            throw Error(`Connection group with ID ${updatedGroup.id} not found when updating`);
        }
        const previousGroup = Utils.deepClone(groups[index]);
        groups[index] = updatedGroup;

        await this.writeConnectionGroupsToSettings(groups);
        this._onConnectionGroupUpdatedEmitter.fire({
            before: previousGroup,
            after: Utils.deepClone(updatedGroup),
        });
    }

    //#endregion

    //#region Shared/Helpers

    private removeConnectionHelper(
        toRemove: IConnectionProfile,
        profiles: IConnectionProfile[],
    ): IConnectionProfile[] {
        const removedProfiles: IConnectionProfile[] = [];
        for (let i = profiles.length - 1; i >= 0; i--) {
            if (Utils.isSameProfile(profiles[i], toRemove)) {
                const removedProfile = Utils.deepClone(profiles[i]);
                profiles.splice(i, 1);
                removedProfiles.push(removedProfile);
            }
        }
        return removedProfiles;
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
                name: ConnectionConfig.RootGroupName,
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
