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
import { IConnectionProfile } from "../../models/interfaces";
import * as Constants from "../../constants/constants";
import { getDefaultConnection } from "../../models/connectionInfo";

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

        // Tooltip logic: show all non-default properties except those in the label (database, user, server)
        const connectionTooltip = this.getConnectionTooltip(connectionProfile);
        if (connectionTooltip) {
            this.tooltip = connectionTooltip;
        }
    }

    private getConnectionTooltip(connectionProfile: IConnectionProfile): string | undefined {
        // Properties to exclude
        const exclude = [
            "database",
            "user",
            "server",
            "profileName",
            "id",
            "groupId",
            "profileSource",
            "savePassword",
            "emptyPasswordInput",
            "azureAuthType",
            "password",
        ];
        // Default values for comparison
        const connectionNodeDefaults: Partial<IConnectionProfile> = getDefaultConnection();

        const defaultValues = {
            encrypt: (connectionNodeDefaults as any).encrypt,
            trustServerCertificate: (connectionNodeDefaults as any).trustServerCertificate,
            persistSecurityInfo: (connectionNodeDefaults as any).persistSecurityInfo,
            azureAuthType: (connectionNodeDefaults as any).azureAuthType,
            multipleActiveResultSets: (connectionNodeDefaults as any).multipleActiveResultSets,
            connectTimeout: (connectionNodeDefaults as any).connectTimeout,
            commandTimeout: (connectionNodeDefaults as any).commandTimeout,
            applicationName: (connectionNodeDefaults as any).applicationName,
            savePassword: (connectionNodeDefaults as any).savePassword,
            emptyPasswordInput: (connectionNodeDefaults as any).emptyPasswordInput,
            profileSource: (connectionNodeDefaults as any).profileSource,
            authenticationType: (connectionNodeDefaults as any).authenticationType,
            applicationIntent: (connectionNodeDefaults as any).applicationIntent,
        };

        let props: string[] = [];

        //handle auth types properly, if auth type is integrated or azureMfa don't show user in tooltip
        if (
            connectionProfile.authenticationType === Constants.integratedauth ||
            connectionProfile.authenticationType === Constants.azureMfa
        ) {
            exclude.push("user");
        }

        // if connection has a profile name, don't exclude server, user and database from tooltip
        if (connectionProfile.profileName) {
            exclude.splice(exclude.indexOf("server"), 1);
            exclude.splice(exclude.indexOf("user"), 1);
            exclude.splice(exclude.indexOf("database"), 1);
        }

        Object.keys(connectionProfile).forEach((key) => {
            const value = (connectionProfile as any)[key];
            if (exclude.includes(key)) {
                return;
            }
            if (!value || value === "") {
                return;
            }

            if (key in defaultValues && value === defaultValues[key]) {
                return;
            }

            props.push(`${key}: ${value}`);
        });

        return props.length > 0 ? props.join("\n") : undefined;
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
