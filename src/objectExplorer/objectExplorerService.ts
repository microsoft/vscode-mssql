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
import { Deferred } from '../protocol';

export class ObjectExplorerService {

    private _client: SqlToolsServiceClient;
    private _currentNode: TreeNodeInfo;
    private _treeNodeToChildrenMap: Map<TreeNodeInfo, TreeNodeInfo[]>;
    private _nodePathToNodeLabelMap: Map<string, string>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;
    private _sessionIdToConnectionCredentialsMap: Map<string, ConnectionCredentials>;

    // Deferred promise maps
    private _sessionIdToPromiseMap: Map<string, Deferred<TreeNodeInfo>>;
    private _expandParamsToPromiseMap: Map<ExpandParams, Deferred<TreeNodeInfo[]>>;

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
        this._sessionIdToPromiseMap = new Map<string, Deferred<TreeNodeInfo>>();
        this._expandParamsToPromiseMap = new Map<ExpandParams, Deferred<TreeNodeInfo[]>>();
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
                    self._currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId, self._currentNode,
                        credentials, nodeLabel ? nodeLabel : result.rootNode.nodePath);
                }
                self.updateNode(self._currentNode);
                self._objectExplorerProvider.objectExplorerExists = true;
                const promise = self._sessionIdToPromiseMap.get(result.sessionId);
                if (promise) {
                    return promise.resolve(self._currentNode);
                } else {
                    return this._objectExplorerProvider.refresh(undefined);
                }
            } else {
                // failure
                self.updateNode(self._currentNode);
                self._currentNode = undefined;
                let error = LocalizedConstants.connectErrorLabel;
                if (result.errorMessage) {
                    error += ` : ${result.errorMessage}`;
                }
                self._connectionManager.vscodeWrapper.showErrorMessage(error);
            }

        };
        return handler;
    }

    private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (result && result.nodes) {
                const children = result.nodes.map(node => TreeNodeInfo.fromNodeInfo(node, self._currentNode.sessionId,
                    self._currentNode, self._currentNode.connectionCredentials));
                self._treeNodeToChildrenMap.set(self._currentNode, children);
                const expandParams: ExpandParams = {
                    sessionId: result.sessionId,
                    nodePath: result.nodePath
                }
                for (let key of self._expandParamsToPromiseMap.keys()) {
                    if (key.sessionId === expandParams.sessionId &&
                        key.nodePath === expandParams.nodePath) {
                        let promise = self._expandParamsToPromiseMap.get(key);
                        return promise.resolve(children);
                    }
                }
            }
        };
        return handler;
    }

    private async expandNode(node: TreeNodeInfo, sessionId: string, promise: Deferred<TreeNodeInfo[]>): Promise<boolean> {
        const expandParams: ExpandParams = {
            sessionId: sessionId,
            nodePath: node.nodePath
        };
        const response = await this._connectionManager.client.sendRequest(ExpandRequest.type, expandParams);
        if (promise) {
            this._expandParamsToPromiseMap.set(expandParams, promise);
        }
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
                    let promise = new Deferred<TreeNodeInfo[]>();
                    this.expandNode(element, element.sessionId, promise);
                    return promise.then((children) => {
                        if (children) {
                            return children;
                        }
                    })
                } else {
                    // start node session
                    let promise = new Deferred<TreeNodeInfo>();
                    this.createSession(element.connectionCredentials, promise);
                    return promise.then((node) => {
                        if (node) {
                            // then expand
                            return this.getChildren(node);
                        }
                    });
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
                return this._rootTreeNodeArray;
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
    public async createSession(connectionCredentials?: IConnectionCredentials, promise?: Deferred<TreeNodeInfo>): Promise<void> {
        if (!connectionCredentials) {
            const connectionUI = this._connectionManager.connectionUI;
            connectionCredentials = await connectionUI.showConnections();
        }
        if (connectionCredentials) {
            // show password prompt if SQL Login and password isn't saved
            const shouldPromptForPassword = ConnectionCredentials.shouldPromptForPassword(connectionCredentials);
            if (shouldPromptForPassword) {
                let password = await this._connectionManager.connectionUI.promptForPassword();
                if (!password) {
                    if (promise) {
                        return promise.reject();
                    }
                }
                connectionCredentials.password = password;
            }
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCredentials);
            const response = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
            if (response) {
                this._sessionIdToConnectionCredentialsMap.set(response.sessionId, connectionCredentials);
                if (promise) {
                    this._sessionIdToPromiseMap.set(response.sessionId, promise);
                    return;
                }
            }
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
        this._treeNodeToChildrenMap.delete(node);
        this._nodePathToNodeLabelMap.delete(node.nodePath);
        this._sessionIdToConnectionCredentialsMap.delete(node.sessionId);
        this._sessionIdToPromiseMap.delete(node.sessionId);
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
