/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import { TreeNodeInfo } from "./treeNodeInfo";
import * as ConnInfo from "../../models/connectionInfo";
import { NodeInfo } from "../../models/contracts/objectExplorer/nodeInfo";
import { ObjectExplorerUtils } from "../objectExplorerUtils";
import { IConnectionProfile } from "../../models/interfaces";
import { ObjectExplorerConstants } from "../objectExplorerConstants";

const getDisconnectedNodeContextValue = (
    connectionInfo: vscodeMssql.IConnectionInfo,
): vscodeMssql.TreeNodeContextValue => {
    return {
        type: ObjectExplorerConstants.disconnectedServerNodeType,
        filterable: false,
        hasFilters: false,
        subType: connectionInfo.database ? ObjectExplorerConstants.databaseNodeType : undefined,
    };
};

/**
 * Class representing a connection node in OE tree. Provided helper methods to handle connection/disconnection events.
 */
export class ConnectionNode extends TreeNodeInfo {
    constructor(connectionInfo: IConnectionProfile) {
        const label =
            ConnInfo.getSimpleConnectionDisplayName(connectionInfo) === connectionInfo.server
                ? ConnInfo.getConnectionDisplayName(connectionInfo)
                : ConnInfo.getSimpleConnectionDisplayName(connectionInfo);

        super(
            label,
            getDisconnectedNodeContextValue(connectionInfo),
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            ObjectExplorerConstants.disconnectedServerNodeType,
            undefined,
            connectionInfo,
            undefined,
            undefined,
        );
        if (connectionInfo.database) {
            this.iconPath = ObjectExplorerUtils.iconPath(
                ObjectExplorerConstants.disconnectedDatabaseIcon,
            );
        }
    }

    public onConnected(
        nodeInfo: NodeInfo,
        sessionId: string,
        parentNode: TreeNodeInfo,
        connectionInfo: IConnectionProfile,
        label: string,
    ) {
        this.label = label;
        this.context = {
            type: ObjectExplorerConstants.serverNodeType,
            filterable: nodeInfo.filterableProperties?.length > 0,
            hasFilters: false,
            subType: connectionInfo.database ? ObjectExplorerConstants.databaseNodeType : "",
        };
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        this.nodePath = nodeInfo.nodePath;
        this.nodeStatus = nodeInfo.nodeStatus;
        this.nodeType = ObjectExplorerConstants.serverNodeType;
        this.sessionId = sessionId;
        this.updateConnectionInfo(connectionInfo);
        this.parentNode = parentNode;
        this.filterableProperties = nodeInfo.filterableProperties;
        this.updateMetadata(nodeInfo.metadata);

        if (connectionInfo.database) {
            this.iconPath = ObjectExplorerUtils.iconPath(
                ObjectExplorerConstants.connectedDatabaseIcon,
            );
        } else {
            this.iconPath = ObjectExplorerUtils.iconPath(ObjectExplorerConstants.serverNodeType);
        }
    }

    public onDisconnected() {
        this.label = ConnInfo.getSimpleConnectionDisplayName(this.connectionInfo);
        this.context = getDisconnectedNodeContextValue(this.connectionInfo);
        this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        this.nodePath = undefined;
        this.nodeStatus = undefined;
        this.nodeType = ObjectExplorerConstants.disconnectedServerNodeType;
        this.sessionId = undefined;
        this.parentNode = undefined;
        this.filterableProperties = undefined;
        if (!(this.connectionInfo as IConnectionProfile).savePassword) {
            const profile = this.connectionInfo;
            profile.password = "";
            this.updateConnectionInfo(profile);
        }
        if (this.connectionInfo.database) {
            this.iconPath = ObjectExplorerUtils.iconPath(
                ObjectExplorerConstants.connectedDatabaseIcon,
            );
        } else {
            this.iconPath = ObjectExplorerUtils.iconPath(ObjectExplorerConstants.serverNodeType);
        }
    }
}
