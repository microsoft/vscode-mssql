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
import { ObjectExplorerProvider, TreeNodeInfo } from './objectExplorerProvider';
import { TreeItemCollapsibleState } from 'vscode';

export class ObjectExplorerService {

    private _client: SqlToolsServiceClient;
    private currentNode: TreeNodeInfo;
    private treeNodeToChildrenMap: Map<TreeNodeInfo, TreeNodeInfo[]>;
    private rootTreeNodeArray: Array<TreeNodeInfo>;

    constructor(private _connectionManager: ConnectionManager,
                private _objectExplorerProvider: ObjectExplorerProvider) {
        this._connectionManager = _connectionManager;
        this._client = this._connectionManager.client;
        this.treeNodeToChildrenMap = new Map<TreeNodeInfo, TreeNodeInfo[]>();
        this.rootTreeNodeArray = new Array<TreeNodeInfo>();
        this._client.onNotification(CreateSessionCompleteNotification.type,
            this.handleSessionCreatedNotification());
        this._client.onNotification(ExpandCompleteNotification.type,
            this.handleExpandSessionNotification());
    }

    private handleSessionCreatedNotification(): NotificationHandler<SessionCreatedParameters> {
        const self = this;
        const handler = (result: SessionCreatedParameters) => {
            if (result.success) {
                self.currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId);
                self.rootTreeNodeArray.push(self.currentNode);
                self._objectExplorerProvider.refresh();
            }
        };
        return handler;
    }

    private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (result && result.nodes) {
                const children = result.nodes.map(node => TreeNodeInfo.fromNodeInfo(node, self.currentNode.sessionId));
                self.currentNode.collapsibleState = TreeItemCollapsibleState.Expanded;
                self.treeNodeToChildrenMap.set(self.currentNode, children);
                self._objectExplorerProvider.refresh(self.currentNode);
            }
        };
        return handler;
    }

    async getChildren(element?: TreeNodeInfo): Promise<TreeNodeInfo[]> {
        if (element) {
            if (element !== this.currentNode) {
                this.currentNode = element;
            }
            if (this.treeNodeToChildrenMap.get(element)) {
                return this.treeNodeToChildrenMap.get(element);
            } else {
                await this.expandNode(element, element.sessionId);
                return;
            }
        } else {
            if (this.rootTreeNodeArray.length === 0) {
                await this.createSession();
                return;
            } else {
                return this.rootTreeNodeArray;
            }
        }
    }

    private async createSession(): Promise<string> {
        const connectionUI = this._connectionManager.connectionUI;
        const connectionCreds = await connectionUI.showConnections();
        if (connectionCreds) {
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCreds);
            const reponse = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
            return reponse.sessionId;
        }
    }

    private async expandNode(node: TreeNodeInfo, sessionId: string): Promise<boolean> {
        const expandParams: ExpandParams = {
            sessionId: sessionId,
            nodePath: node.nodePath
        };
        const response = await this._connectionManager.client.sendRequest(ExpandRequest.type, expandParams);
        return response;
    }

}
