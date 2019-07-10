/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import SqlToolsServiceClient from '../languageservice/serviceclient';
import ConnectionManager from '../controllers/connectionManager';
import { CreateSessionCompleteNotification, SessionCreatedParameters, CreateSessionRequest } from '../models/contracts/objectExplorer/createSessionRequest';
import { NotificationHandler } from 'vscode-languageclient';
import { NodeInfo } from '../models/contracts/objectExplorer/nodeInfo';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ExpandRequest, ExpandParams, ExpandCompleteNotification, ExpandResponse } from '../models/contracts/objectExplorer/expandNodeRequest';
import { ObjectExplorerProvider } from './objectExplorerProvider';

export class ObjectExplorerService {

    private _client: SqlToolsServiceClient;
    private currentRootNode: NodeInfo;
    private currentNode: NodeInfo;
    private sessionId: string;
    private childrenMap: Map<NodeInfo, NodeInfo[]>;

    constructor(private _connectionManager: ConnectionManager,
                private _objectExplorerProvider: ObjectExplorerProvider) {
        this._connectionManager = _connectionManager;
        this._client = this._connectionManager.client;
        this.childrenMap = new Map<NodeInfo, NodeInfo[]>();
        this._client.onNotification(CreateSessionCompleteNotification.type,
            this.handleSessionCreatedNotification());
        this._client.onNotification(ExpandCompleteNotification.type,
            this.handleExpandSessionNotification());
    }

    private handleSessionCreatedNotification(): NotificationHandler<SessionCreatedParameters> {
        const self = this;
        const handler = (result: SessionCreatedParameters) => {
            if (result.success) {
                self.currentRootNode = result.rootNode;
                self.currentNode = result.rootNode;
                self.sessionId = result.sessionId;
                self._objectExplorerProvider.refresh();
            }
        };
        return handler;
    }

    private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (result && result.nodes) {
                self.sessionId = result.sessionId;
                self.childrenMap.set(self.currentNode, result.nodes);
                self._objectExplorerProvider.refresh(self.currentNode);
            }
        };
        return handler;
    }

    async getChildren(element?: NodeInfo): Promise<NodeInfo[]> {
        if (element) {
            this.currentNode = element;
            if (this.childrenMap.get(element)) {
                return this.childrenMap.get(element);
            } else {
                await this.expandNode(element);
                return;
            }
        } else {
            if (!this.currentRootNode) {
                this.sessionId = await this.createSession();
                return;
            } else {
                return [this.currentRootNode];
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

    private async expandNode(node: NodeInfo): Promise<boolean> {
        const expandParams: ExpandParams = {
            sessionId: this.sessionId,
            nodePath: node.nodePath
        };
        const response = await this._connectionManager.client.sendRequest(ExpandRequest.type, expandParams);
        return response;
    }

}
