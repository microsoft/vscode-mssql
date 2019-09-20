/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
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
import { IConnectionCredentials } from '../models/interfaces';
import LocalizedConstants = require('../constants/localizedConstants');
import { AddConnectionTreeNode } from './addConnectionTreeNode';
import * as Utils from '../models/utils';

export class ObjectExplorerService {

    private _client: SqlToolsServiceClient;
    private _currentNode: TreeNodeInfo;
    private _treeNodeToChildrenMap: Map<TreeNodeInfo, TreeNodeInfo[]>;
    private _nodePathToNodeLabelMap: Map<string, string>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;
    private _sessionIdToConnectionCredentialsMap: Map<string, ConnectionCredentials>;

    private _sessionCreatedEmitter: vscode.EventEmitter<TreeNodeInfo> =
        new vscode.EventEmitter<TreeNodeInfo>();
    private readonly _sessionCreatedEvent: vscode.Event<TreeNodeInfo> =
        this._sessionCreatedEmitter.event;

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
                // set connection and other things
                if (self._currentNode) {
                    self._currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId,
                        self._currentNode, self._currentNode.connectionCredentials, nodeLabel ? nodeLabel : result.rootNode.nodePath);
                } else {
                    const credentials = this._sessionIdToConnectionCredentialsMap.get(result.sessionId);
                    self._currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId,
                        self._currentNode, credentials, nodeLabel ? nodeLabel : result.rootNode.nodePath);
                }
                self.updateNode(self._currentNode);
                self._objectExplorerProvider.objectExplorerExists = true;
                // return self._objectExplorerProvider.refresh(undefined);
                // return self.getChildren(self._currentNode);
                return self._objectExplorerProvider.refresh(undefined);
            } else {
                // failure
                self._currentNode.collapsibleState = TreeItemCollapsibleState.Collapsed;
                self.updateNode(self._currentNode);
                self._currentNode = undefined;
                let error = LocalizedConstants.connectErrorLabel;
                if (result.errorMessage) {
                    error += ` : ${result.errorMessage}`;
                }
                self._connectionManager.vscodeWrapper.showErrorMessage(error);
                // self._sessionCreatedEmitter.fire(undefined);
                return self._objectExplorerProvider.refresh(undefined);
            }

        };
        return handler;
    }

    private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (result && result.nodes) {
                // same here
                const children = result.nodes.map(node => TreeNodeInfo.fromNodeInfo(node, self._currentNode.sessionId,
                    self._currentNode, self._currentNode.connectionCredentials));
                self._currentNode.collapsibleState = TreeItemCollapsibleState.Expanded;
                self._treeNodeToChildrenMap.set(self._currentNode, children);
                return self._objectExplorerProvider.refresh(undefined);
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

    private updateNode(node: TreeNodeInfo): void {
        for (let rootTreeNode of this._rootTreeNodeArray) {
            if (rootTreeNode.connectionCredentials === node.connectionCredentials &&
                rootTreeNode.label === node.label) {
                    const index = this._rootTreeNodeArray.indexOf(rootTreeNode);
                    this._rootTreeNodeArray[index] = node;
                    return;
            }
        }
        this._rootTreeNodeArray.push(node);
    }

    async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        if (element) {
            if (element !== this._currentNode) {
                this._currentNode = element;
            }
            // get cached children
            if (this._treeNodeToChildrenMap.get(this._currentNode)) {
                return this._treeNodeToChildrenMap.get(this._currentNode);
            } else {
                // check if session exists
                if (element.sessionId) {
                    // node expansion
                    this.expandNode(element, element.sessionId);
                } else {
                    // start node session
                    if (!this._objectExplorerProvider.isRefresh) {
                        this.createSession(element.connectionCredentials);
                        return;
                    }
                }
            }
        } else {
            // retrieve saved connections first when opening object explorer
            // for the first time
            let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
            if (!this._objectExplorerProvider.objectExplorerExists ||
                savedConnections.length !== this._rootTreeNodeArray.length) {
                this._rootTreeNodeArray = [];
                savedConnections.forEach((conn) => {
                    let connectionCredentials = conn.connectionCreds;
                    this._nodePathToNodeLabelMap.set(conn.connectionCreds.server, conn.label);
                    let node = new TreeNodeInfo(conn.label, 'Server', TreeItemCollapsibleState.Collapsed,
                            undefined, undefined, 'Server', undefined, connectionCredentials, undefined);
                    this._rootTreeNodeArray.push(node);
                });
                this._objectExplorerProvider.objectExplorerExists = true;
                this._objectExplorerProvider.refresh(undefined);
                return;
            } else {
                if (this._rootTreeNodeArray.length > 0) {
                    return this._rootTreeNodeArray;
                } else {
                    return [new AddConnectionTreeNode()];
                }
            }

        }
    }

    /**
     * Create an OE session for the given connection credentials
     * otherwise prompt the user to select a connection to make an
     * OE out of
     * @param connectionCredentials Connection Credentials for a node
     */
    public async createSession(connectionCredentials?: IConnectionCredentials): Promise<void> {
        if (!connectionCredentials) {
            const connectionUI = this._connectionManager.connectionUI;
            connectionCredentials = await connectionUI.showConnections();
        }
        if (connectionCredentials) {
            // show password prompt if SQL Login and password isn't saved
            const shouldPromptForPassword = ConnectionCredentials.shouldPromptForPassword(connectionCredentials);
            if (shouldPromptForPassword) {
                let password = await this._connectionManager.connectionUI.promptForPassword();
                connectionCredentials.password = password;
            }
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCredentials);
            // handle SQL Login with no passwords
            const response = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
            if (response) {
                this._sessionIdToConnectionCredentialsMap.set(response.sessionId, connectionCredentials);
            }
            return;
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
        if (node.sessionId) {
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
        return;
    }

    /** Getters */
    public get currentNode(): TreeNodeInfo {
        return this._currentNode;
    }

    public get rootTreeNodeArray(): TreeNodeInfo[] {
        return this._rootTreeNodeArray;
    }
}
