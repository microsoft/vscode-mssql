/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import SqlToolsServiceClient from '../languageservice/serviceclient';
import ConnectionManager from '../controllers/connectionManager';
import { CreateSessionCompleteNotification, SessionCreatedParameters, CreateSessionRequest } from '../models/contracts/objectExplorer/createSessionRequest';
import { NotificationHandler } from 'vscode-languageclient';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ExpandRequest, ExpandParams, ExpandCompleteNotification, ExpandResponse } from '../models/contracts/objectExplorer/expandNodeRequest';
import { ObjectExplorerProvider } from './objectExplorerProvider';
import { TreeItemCollapsibleState } from 'vscode';
import { RefreshRequest, RefreshParams } from '../models/contracts/objectExplorer/refreshSessionRequest';
import { CloseSessionRequest, CloseSessionParams } from '../models/contracts/objectExplorer/closeSessionRequest';
import { TreeNodeInfo } from './treeNodeInfo';
import { ConnectionProfile } from '../models/connectionProfile';

export class ObjectExplorerService {

    private _client: SqlToolsServiceClient;
    private _currentNode: TreeNodeInfo;
    private _treeNodeToChildrenMap: Map<TreeNodeInfo, TreeNodeInfo[]>;
    private _nodePathToNodeLabelMap: Map<string, string>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;
    private _sessionIdToConnectionCredentialsMap: Map<string, ConnectionCredentials>;

    constructor(private _connectionManager: ConnectionManager,
                private _objectExplorerProvider: ObjectExplorerProvider) {
        this._connectionManager = _connectionManager;
        this._client = this._connectionManager.client;
        this._treeNodeToChildrenMap = new Map<TreeNodeInfo, TreeNodeInfo[]>();
        this._rootTreeNodeArray = new Array<TreeNodeInfo>();
        this._sessionIdToConnectionCredentialsMap = new Map<string, ConnectionCredentials>();
        this._nodePathToNodeLabelMap = new Map<string, string>();
        this._client.onNotification(CreateSessionCompleteNotification.type,
            this.handleSessionCreatedNotification());
        this._client.onNotification(ExpandCompleteNotification.type,
            this.handleExpandSessionNotification());
    }

    private handleSessionCreatedNotification(): NotificationHandler<SessionCreatedParameters> {
        const self = this;
        const handler = (result: SessionCreatedParameters) => {
            if (result.success) {
                let nodeLabel = this._nodePathToNodeLabelMap.get(result.rootNode.nodePath);
                self._currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId, self.currentNode, nodeLabel);
                self._rootTreeNodeArray.push(self.currentNode);
                self._objectExplorerProvider.objectExplorerExists = true;
                return self._objectExplorerProvider.refresh(undefined);
            }
        };
        return handler;
    }

    private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (result && result.nodes) {
                const children = result.nodes.map(node => TreeNodeInfo.fromNodeInfo(node, self.currentNode.sessionId, self.currentNode));
                self._currentNode.collapsibleState = TreeItemCollapsibleState.Expanded;
                self._treeNodeToChildrenMap.set(self.currentNode, children);
                return self._objectExplorerProvider.refresh(self.currentNode);
            }
        };
        return handler;
    }

    private async expandNode(node: TreeNodeInfo, sessionId: string): Promise<boolean> {
        const expandParams: ExpandParams = {
            sessionId: sessionId,
            nodePath: node.nodePath
        };
        const response = await this._connectionManager.client.sendRequest(ExpandRequest.type, expandParams);
        return response;
    }

    async getChildren(element?: TreeNodeInfo): Promise<TreeNodeInfo[]> {
        if (element) {
            if (element !== this.currentNode) {
                this._currentNode = element;
            }
            if (this._treeNodeToChildrenMap.get(this._currentNode)) {
                return this._treeNodeToChildrenMap.get(this._currentNode);
            } else {
                // expansion
                await this.expandNode(element, element.sessionId);
                return [];
            }
        } else {
            // retrieve saved connections first when opening object explorer
            // for the first time
            if (!this._objectExplorerProvider.objectExplorerExists) {
                let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
                savedConnections.forEach(async (conn) => {
                    let connectionCredentials = conn.connectionCreds;
                    this._nodePathToNodeLabelMap.set(conn.connectionCreds.server, conn.label);
                    if (connectionCredentials) {
                        const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCredentials);
                        const response = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
                        this._sessionIdToConnectionCredentialsMap.set(response.sessionId, connectionCredentials);
                    }
                });
                return;
            }
            if (this._rootTreeNodeArray.length === 0) {
                this.createSession();
                return [];
            } else {
                return this._rootTreeNodeArray;
            }
        }
    }

    public async createSession(): Promise<string> {
        const connectionUI = this._connectionManager.connectionUI;
        const connectionCreds = await connectionUI.showConnections();
        if (connectionCreds) {
            this._nodePathToNodeLabelMap.set(connectionCreds.server, (<ConnectionProfile>connectionCreds).profileName);
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCreds);
            const response = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
            this._sessionIdToConnectionCredentialsMap.set(response.sessionId, connectionCreds);
            return response.sessionId;
        }
    }

    public getConnectionCredentials(sessionId: string): ConnectionCredentials {
        if (this._sessionIdToConnectionCredentialsMap.has(sessionId)) {
            return this._sessionIdToConnectionCredentialsMap.get(sessionId);
        }
        return undefined;
    }

    public async removeObjectExplorerNode(node: TreeNodeInfo): Promise<void> {
        await this.closeSession(node);
        const index = this._rootTreeNodeArray.indexOf(node, 0);
        if (index > -1) {
            this._rootTreeNodeArray.splice(index, 1);
        }
        this._currentNode = undefined;
        const nodeUri = node.nodePath + '_' + node.label;
        this._connectionManager.disconnect(nodeUri);
        await this._objectExplorerProvider.refresh(undefined);
    }

    public async refreshNode(node: TreeNodeInfo): Promise<boolean> {
        const refreshParams: RefreshParams = {
            sessionId: node.sessionId,
            nodePath: node.nodePath
        };
        const response = await this._connectionManager.client.sendRequest(RefreshRequest.type, refreshParams);
        return response;
    }

    private async closeSession(node: TreeNodeInfo): Promise<void> {
        const closeSessionParams: CloseSessionParams = {
            sessionId: node.sessionId
        };
        const response = await this._connectionManager.client.sendRequest(CloseSessionRequest.type,
            closeSessionParams);
        if (response && response.success) {
            this._sessionIdToConnectionCredentialsMap.delete(response.sessionId);
            node.sessionId = undefined;
            this._currentNode = node;
            this._treeNodeToChildrenMap.set(this._currentNode, undefined);
            this._currentNode.collapsibleState = TreeItemCollapsibleState.Collapsed;
        }
    }

    /** Getters */
    public get currentNode(): TreeNodeInfo {
        return this._currentNode;
    }
}
