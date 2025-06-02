/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeNodeInfo } from "./treeNodeInfo";

import * as vscodeMssql from "vscode-mssql";
import { TreeItemCollapsibleState } from "vscode";
import { IConnectionGroup, IConnectionProfile } from "../../models/interfaces";

export const connectionGroupNodeType = "ConnectionGroup";

/**
 * Represents a server group node in the Object Explorer.
 * This class extends the TreeNodeInfo class and adds functionality specific to server groups.
 * It contains a list of child nodes and methods to manage them.
 */
export class ConnectionGroupNodeInfo extends TreeNodeInfo {
    public children: TreeNodeInfo[];
    private _connectionGroup: IConnectionGroup;

    constructor(
        id: string,
        label: string,
        contextValue: vscodeMssql.TreeNodeContextValue,
        collapsibleState: TreeItemCollapsibleState,
        nodePath: string,
        nodeStatus: string,
        nodeType: string,
        sessionId: string,
        connectionInfo: vscodeMssql.IConnectionInfo,
        parentNode: TreeNodeInfo,
        filterProperties: vscodeMssql.NodeFilterProperty[],
        nodeSubType: string,
        connectionGroup: IConnectionGroup,
        objectMetadata?: vscodeMssql.ObjectMetadata,
        filters?: vscodeMssql.NodeFilter[],
    ) {
        super(
            label,
            contextValue,
            collapsibleState,
            nodePath,
            nodeStatus,
            nodeType,
            sessionId,
            connectionInfo as IConnectionProfile,
            parentNode,
            filterProperties,
            nodeSubType,
            objectMetadata,
            filters,
        );
        this.children = [];
        this.id = id;
        this._connectionGroup = connectionGroup;
    }

    /**
     * Returns a **copy** of the node's connection information.
     *
     * ⚠️ Note: This is a **shallow copy**; modifying the returned object will NOT affect the original connection group.
     * If you want to update the actual connection group stored in the node, use the `updateConnectionGroup` method instead.
     */
    public get connectionGroup(): IConnectionGroup {
        if (!this._connectionGroup) {
            return undefined;
        }
        return {
            ...this._connectionGroup,
        };
    }

    /**
     * Adds a child node to the server group.
     * @param child The child node to add.
     */
    public addChild(child: TreeNodeInfo): void {
        // Insert connection groups first, then other nodes, both alphabetically
        const isChildConnectionGroup = child instanceof ConnectionGroupNodeInfo;

        const index = this.children.findIndex((c) => {
            const isCurrentConnectionGroup = c instanceof ConnectionGroupNodeInfo;

            if (isChildConnectionGroup === isCurrentConnectionGroup) {
                return c.label.toString().localeCompare(child.label.toString()) > 0;
            }

            return isChildConnectionGroup && !isCurrentConnectionGroup;
        });

        if (index === -1) {
            this.children.push(child);
            return;
        }
        this.children.splice(index, 0, child);
    }

    /**
     * Removes a child node from the server group.
     * @param child The child node to remove.
     */
    public removeChild(child: TreeNodeInfo): void {
        const index = this.children.indexOf(child);
        if (index > -1) {
            this.children.splice(index, 1);
        }
    }
}

export function connectionGroupContextValue(): vscodeMssql.TreeNodeContextValue {
    return {
        type: connectionGroupNodeType,
        filterable: false,
        hasFilters: false,
        subType: "",
    };
}
