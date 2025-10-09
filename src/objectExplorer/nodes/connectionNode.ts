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

    /**
     * Generates a tooltip for the connection profile; it should include:
     * [<profileName>] # note: no tag
     * Server: <serverName>
     * Database: <db name>
     * Auth: <username or type>
     * [Port: <port>]
     * [SQL Container Name: <container name>]
     * [SQL Container Version: <version>]
     * [Application intent: <intent>]
     * [Connection timeout: <timeout>]
     * [Command timeout: <timeout>]
     * [Always encrypted: <enabled/disabled>]
     * [Replication: <enabled/disabled>]
     * @param connectionProfile The connection profile to generate the tooltip for
     * @returns the tooltip string or undefined if no properties to show
     */
    private getConnectionTooltip(connectionProfile: IConnectionProfile): string | undefined {
        const excludedLabelKeys = ["profileName"];
        // Default values for comparison
        const connectionNodeDefaults: Partial<IConnectionProfile> = getDefaultConnection();

        const defaultValues = {
            profileName: (connectionNodeDefaults as any).profileName,
            server: (connectionNodeDefaults as any).server,
            database: (connectionNodeDefaults as any).database,
            authenticationType: (connectionNodeDefaults as any).authenticationType,
            user: (connectionNodeDefaults as any).user,
            port: (connectionNodeDefaults as any).port,
            containerName: (connectionNodeDefaults as any).containerName,
            containerVersion: (connectionNodeDefaults as any).containerVersion,
            applicationIntent: (connectionNodeDefaults as any).applicationIntent,
            connectionTimeout: (connectionNodeDefaults as any).connectionTimeout,
            commandTimeout: (connectionNodeDefaults as any).commandTimeout,
            alwaysEncrypted: (connectionNodeDefaults as any).alwaysEncrypted,
            replication: (connectionNodeDefaults as any).replication,
        };

        let props: { key: string; value: string; label: string }[] = [
            { key: "profileName", value: "", label: "Profile Name" },
            { key: "server", value: "", label: "Server" },
            { key: "database", value: "", label: "Database" },
            { key: "authenticationType", value: "", label: "Authentication Type" },
            { key: "user", value: "", label: "User" },
            { key: "port", value: "", label: "Port" },
            { key: "containerName", value: "", label: "SQL Container Name" },
            { key: "version", value: "", label: "SQL Container Version" },
            { key: "applicationIntent", value: "", label: "Application Intent" },
            { key: "connectionTimeout", value: "", label: "Connection Timeout" },
            { key: "commandTimeout", value: "", label: "Command Timeout" },
            { key: "alwaysEncrypted", value: "", label: "Always Encrypted" },
            { key: "replication", value: "", label: "Replication" },
        ];

        //handle auth types properly
        if (
            connectionProfile.authenticationType === Constants.azureMfa ||
            connectionProfile.authenticationType === Constants.integratedauth
        ) {
            // If auth type is not SQL Login, remove user property
            const userIndex = props.findIndex((p) => p.key === "user");
            if (userIndex !== -1) {
                props.splice(userIndex, 1);
            }
        }

        Object.keys(connectionProfile).forEach((key) => {
            const value = (connectionProfile as any)[key];
            if (!value || value === "") {
                return;
            }

            if (key in defaultValues && value === defaultValues[key]) {
                return;
            }

            if (props.map((p) => p.key).find((k) => k === key)) {
                const prop = props.find((p) => p.key === key);
                if (prop) {
                    if (value === Constants.azureMfa || value === Constants.integratedauth) {
                        // Show authentication type as "Azure MFA" or "Windows Authentication"
                        const authTypeValueLabel =
                            connectionProfile.authenticationType === Constants.azureMfa
                                ? vscode.l10n.t("Azure MFA")
                                : vscode.l10n.t("Windows Authentication");
                        prop.value = authTypeValueLabel;
                    } else {
                        prop.value = value;
                    }
                }
            }
        });

        let lines = props.map((p) => {
            if (p.value) {
                if (excludedLabelKeys.find((k) => k === p.key)) {
                    return `${p.value}`;
                } else {
                    if (p.label) {
                        const localizedLabel = vscode.l10n.t(p.label);
                        return `${localizedLabel}: ${p.value}`;
                    } else {
                        return `${p.label}: ${p.value}`;
                    }
                }
            } else {
                return undefined;
            }
        });
        lines = lines.filter((line): line is string => line !== undefined);
        return lines.length > 0 ? lines.join("\n") : undefined;
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
