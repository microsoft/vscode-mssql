/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VscodeWrapper from "../controllers/vscodeWrapper";
import { IConnectionGroup } from "../models/interfaces";
import { ConnectionConfigBase } from "./connectionConfigBase";
import * as Constants from "../constants/constants";
import * as Utils from "../models/utils";

export class ConnectionGroupManager extends ConnectionConfigBase {
    /** The name of the root connection group. */
    public readonly RootGroupName: string = "ROOT";

    private static _instance: ConnectionGroupManager;

    public constructor(_vscodeWrapper?: VscodeWrapper) {
        super("ConnectionGroupManager", _vscodeWrapper);

        void this.assignMissingIds();
    }

    public static getInstance(vscodeWrapper?: VscodeWrapper): ConnectionGroupManager {
        if (!ConnectionGroupManager._instance) {
            ConnectionGroupManager._instance = new ConnectionGroupManager(vscodeWrapper);
        }
        return ConnectionGroupManager._instance;
    }

    protected async assignMissingIds(): Promise<void> {
        let madeChanges = false;
        const groups: IConnectionGroup[] = this.getGroups();

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

        this.initialized.resolve();
    }

    public getGroups(global: boolean = true): IConnectionGroup[] {
        return this.getArrayFromSettings<IConnectionGroup>(
            Constants.connectionGroupsArrayName,
            global,
        );
    }

    /**
     * Retrieves a connection group by its ID.
     * @param id The ID of the connection group to retrieve.
     * @returns The connection group with the specified ID, or `undefined` if not found.
     */
    public getGroupById(id: string, global: boolean = true): IConnectionGroup | undefined {
        const connGroups = this.getGroups(global);
        return connGroups.find((g) => g.id === id);
    }

    public getRootGroup(): IConnectionGroup | undefined {
        const groups: IConnectionGroup[] = this.getGroups();
        return groups.find((group) => group.name === this.RootGroupName);
    }

    public addConnectionGroup(newGroup: IConnectionGroup): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public updateConnectionGroup(updatedGroup: IConnectionGroup): Promise<void> {
        throw new Error("Method not implemented.");
    }

    private async writeConnectionGroupsToSettings(connGroups: IConnectionGroup[]): Promise<void> {
        await this._vscodeWrapper.setConfiguration(
            Constants.extensionName,
            Constants.connectionGroupsArrayName,
            connGroups,
        );
    }
}
