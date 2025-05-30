/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeNodeInfo } from "./treeNodeInfo";

import * as vscodeMssql from "vscode-mssql";
import { TreeItemCollapsibleState } from "vscode";
import { IConnectionProfile } from "../../models/interfaces";

export const serverGroupNodeType = "ServerGroup";

/**
 * Represents a server group node in the Object Explorer.
 * This class extends the TreeNodeInfo class and adds functionality specific to server groups.
 * It contains a list of child nodes and methods to manage them.
 */
export class ServerGroupNodeInfo extends TreeNodeInfo {
    public children: TreeNodeInfo[];

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
    }

    /**
     * Adds a child node to the server group.
     * @param child The child node to add.
     */
    public addChild(child: TreeNodeInfo): void {
        // Insert alphabetically based on label
        const index = this.children.findIndex(
            (c) => c.label.toString().localeCompare(child.label.toString()) > 0,
        );
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

export function serverGroupContextValue(): vscodeMssql.TreeNodeContextValue {
    return {
        type: serverGroupNodeType,
        filterable: false,
        hasFilters: false,
        subType: "",
    };
}
