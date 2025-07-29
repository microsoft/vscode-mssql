/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeNodeInfo } from "./treeNodeInfo";
import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import { ConnectionProfile } from "../../models/connectionProfile";
import { ObjectExplorerUtils } from "../objectExplorerUtils";
import * as ConnInfo from "../../models/connectionInfo";
import { NodeInfo } from "../../models/contracts/objectExplorer/nodeInfo";
import { disconnectedDockerContainer, dockerContainer } from "../../constants/constants";

// Constants for node types and icon names
export const SERVER_NODE_DISCONNECTED = "disconnectedServer";
export const DATABASE_SUBTYPE = "Database";
export const SERVER_NODE_CONNECTED = "Server";
export const ICON_SERVER_DISCONNECTED = "Server_red";
export const ICON_SERVER_CONNECTED = "Server_green";
export const ICON_DATABASE_DISCONNECTED = "Database_red";
export const ICON_DATABASE_CONNECTED = "Database_green";
export const ICON_DOCKER_SERVER_DISCONNECTED = "DockerContainer_red";
export const ICON_DOCKER_SERVER_CONNECTED = "DockerContainer_green";

const createDisconnectedNodeContextValue = (
    connectionProfile: ConnectionProfile,
): vscodeMssql.TreeNodeContextValue => {
    let nodeSubType = connectionProfile.database ? DATABASE_SUBTYPE : undefined;
    if (connectionProfile.containerName) nodeSubType = disconnectedDockerContainer;
    return {
        type: SERVER_NODE_DISCONNECTED,
        filterable: false,
        hasFilters: false,
        subType: nodeSubType,
    };
};

export class ConnectionNode extends TreeNodeInfo {
    constructor(connectionProfile: ConnectionProfile, parentNode?: TreeNodeInfo) {
        const displayName = ConnInfo.getConnectionDisplayName(connectionProfile);
        super(
            displayName,
            createDisconnectedNodeContextValue(connectionProfile),
            vscode.TreeItemCollapsibleState.Collapsed,
            parentNode?.nodePath ?? "" + connectionProfile.id,
            undefined,
            SERVER_NODE_DISCONNECTED,
            undefined,
            connectionProfile,
            parentNode,
            undefined,
            undefined,
        );
        if (connectionProfile.containerName) {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_DOCKER_SERVER_DISCONNECTED);
        } else if (connectionProfile.database) {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_DATABASE_DISCONNECTED);
        } else {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_SERVER_DISCONNECTED);
        }
    }

    protected override generateId(): string {
        return `${this.connectionProfile.id}_${Date.now()}`;
    }

    /**
     * Updates the node to represent a connected state
     */
    public updateToConnectedState(options: {
        nodeInfo: NodeInfo;
        sessionId: string;
        parentNode: TreeNodeInfo;
        connectionProfile: ConnectionProfile;
    }) {
        const { nodeInfo, sessionId, parentNode, connectionProfile } = options;
        this.context = {
            type: SERVER_NODE_CONNECTED,
            filterable: nodeInfo.filterableProperties?.length > 0,
            hasFilters: false,
            subType: connectionProfile.containerName
                ? dockerContainer
                : connectionProfile.database
                  ? DATABASE_SUBTYPE
                  : "",
        };
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.nodePath = nodeInfo.nodePath;
        this.nodeStatus = nodeInfo.nodeStatus;
        this.nodeType = SERVER_NODE_CONNECTED;
        this.sessionId = sessionId;
        this.updateConnectionProfile(connectionProfile);
        this.parentNode = parentNode;
        this.filterableProperties = nodeInfo.filterableProperties;
        this.updateMetadata(nodeInfo.metadata);

        // Update the icon based on connection type
        if (connectionProfile.containerName) {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_DOCKER_SERVER_CONNECTED);
        } else if (connectionProfile.database) {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_DATABASE_CONNECTED);
        } else {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_SERVER_CONNECTED);
        }
    }

    /**
     * Updates the node to represent a disconnected state
     */
    public updateToDisconnectedState() {
        this.context = createDisconnectedNodeContextValue(this.connectionProfile);
        this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        this.nodePath = undefined;
        this.nodeStatus = undefined;
        this.nodeType = SERVER_NODE_DISCONNECTED;
        this.sessionId = undefined;
        this.parentNode = undefined;
        this.filterableProperties = undefined;

        // Clear password if not saved
        if (!this.connectionProfile.savePassword) {
            const profileCopy = this.connectionProfile;
            profileCopy.password = "";
            this.updateConnectionProfile(profileCopy);
        }

        // Update icon based on connection type
        if (this.connectionProfile.database) {
            this.iconPath = ObjectExplorerUtils.iconPath(ICON_DATABASE_DISCONNECTED);
        } else {
            let iconName = ICON_SERVER_DISCONNECTED;
            if (this.connectionProfile.containerName) iconName = ICON_DOCKER_SERVER_DISCONNECTED;
            this.iconPath = ObjectExplorerUtils.iconPath(iconName);
        }
    }
}
