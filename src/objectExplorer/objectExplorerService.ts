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
import { AccountSignInTreeNode } from './accountSignInTreeNode';
import { ConnectTreeNode } from './connectTreeNode';
import { Deferred } from '../protocol';
import Constants = require('../constants/constants');
import { ObjectExplorerUtils } from './objectExplorerUtils';

export class ObjectExplorerService {

    private _client: SqlToolsServiceClient;
    private _currentNode: TreeNodeInfo;
    private _treeNodeToChildrenMap: Map<vscode.TreeItem, vscode.TreeItem[]>;
    private _nodePathToNodeLabelMap: Map<string, string>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;
    private _sessionIdToConnectionCredentialsMap: Map<string, ConnectionCredentials>;

    // Deferred promise maps
    private _sessionIdToPromiseMap: Map<string, Deferred<vscode.TreeItem>>;
    private _expandParamsToPromiseMap: Map<ExpandParams, Deferred<TreeNodeInfo[]>>;

    constructor(private _connectionManager: ConnectionManager,
                private _objectExplorerProvider: ObjectExplorerProvider) {
        this._connectionManager = _connectionManager;
        this._client = this._connectionManager.client;
        this._treeNodeToChildrenMap = new Map<vscode.TreeItem, vscode.TreeItem[]>();
        this._rootTreeNodeArray = new Array<TreeNodeInfo>();
        this._sessionIdToConnectionCredentialsMap = new Map<string, ConnectionCredentials>();
        this._nodePathToNodeLabelMap = new Map<string, string>();
        this._sessionIdToPromiseMap = new Map<string, Deferred<vscode.TreeItem>>();
        this._expandParamsToPromiseMap = new Map<ExpandParams, Deferred<TreeNodeInfo[]>>();

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
                // if no node label, check if it has a name in saved profiles
                // in case this call came from new query
                let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
                for (let connection of savedConnections) {
                    if (connection.connectionCreds.server === result.rootNode.nodePath) {
                        nodeLabel = connection.label;
                        break;
                    }
                }
                // set connection and other things
                if (self._currentNode && (self._currentNode.sessionId === result.sessionId)) {
                    nodeLabel = nodeLabel === result.rootNode.nodePath ?
                    self.createNodeLabel(self._currentNode.connectionCredentials) : nodeLabel;
                    self._currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId,
                        undefined, self._currentNode.connectionCredentials, nodeLabel);
                } else {
                    const credentials = this._sessionIdToConnectionCredentialsMap.get(result.sessionId);
                    nodeLabel = nodeLabel === result.rootNode.nodePath ?
                    self.createNodeLabel(credentials) : nodeLabel;
                    self._currentNode = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId,
                        undefined, credentials, nodeLabel);
                }
                self.updateNode(self._currentNode);
                self._objectExplorerProvider.objectExplorerExists = true;
                const promise = self._sessionIdToPromiseMap.get(result.sessionId);
                // remove the sign in node once the session is created
                if (self._treeNodeToChildrenMap.has(self._currentNode)) {
                    self._treeNodeToChildrenMap.delete(self._currentNode);
                }
                return promise.resolve(self._currentNode);
            } else {
                // failure
                self.updateNode(self._currentNode);
                self._currentNode = undefined;
                let error = LocalizedConstants.connectErrorLabel;
                if (result.errorMessage) {
                    error += ` : ${result.errorMessage}`;
                }
                self._connectionManager.vscodeWrapper.showErrorMessage(error);
                const promise = self._sessionIdToPromiseMap.get(result.sessionId);
                if (promise) {
                    return promise.resolve(undefined);
                }
            }
        };
        return handler;
    }

    private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (result && result.nodes) {
                const credentials = self._sessionIdToConnectionCredentialsMap.get(result.sessionId);
                const children = result.nodes.map(node => TreeNodeInfo.fromNodeInfo(node, result.sessionId,
                    self._currentNode, credentials));
                self._treeNodeToChildrenMap.set(self._currentNode, children);
                const expandParams: ExpandParams = {
                    sessionId: result.sessionId,
                    nodePath: result.nodePath
                };
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
        this._expandParamsToPromiseMap.set(expandParams, promise);
        const response = await this._connectionManager.client.sendRequest(ExpandRequest.type, expandParams);
        if (!response) {
            this._expandParamsToPromiseMap.delete(expandParams);
        }
        this._currentNode = node;
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

    /**
     * Clean all children of the node
     * @param node Node to cleanup
     */
    private cleanNodeChildren(node: TreeNodeInfo): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            let children = this._treeNodeToChildrenMap.get(node);
            if (children) {
                children.forEach(child => this._treeNodeToChildrenMap.delete(child));
            }
        }
    }

    /**
     * Sort the array based on server names
     * Public only for testing purposes
     * @param array array that needs to be sorted
     */
    public sortByServerName(array: TreeNodeInfo[]): TreeNodeInfo[] {
        const sortedNodeArray = array.sort((a, b) => {
            return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
        });
        return sortedNodeArray;
    }

    /**
     * Get nodes from saved connections
     */
    private getSavedConnections(): void {
        let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
        savedConnections.forEach((conn) => {
            let nodeLabel = conn.label === conn.connectionCreds.server ?
                this.createNodeLabel(conn.connectionCreds) : conn.label;
            this._nodePathToNodeLabelMap.set(conn.connectionCreds.server, nodeLabel);
            let node = new TreeNodeInfo(nodeLabel,
                Constants.disconnectedServerLabel,
                TreeItemCollapsibleState.Collapsed,
                undefined, undefined, Constants.disconnectedServerLabel,
                undefined, conn.connectionCreds, undefined);
            this._rootTreeNodeArray.push(node);
        });
    }

    /**
     * Clean up expansion promises for a node
     * @param node The selected node
     */
    private cleanExpansionPromise(node: TreeNodeInfo): void {
        for (const key of this._expandParamsToPromiseMap.keys()) {
            if (key.sessionId === node.sessionId &&
                key.nodePath === node.nodePath) {
                this._expandParamsToPromiseMap.delete(key);
            }
        }
    }

    async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        if (element) {
            if (element !== this._currentNode) {
                this._currentNode = element;
            }
            // get cached children
            if (this._treeNodeToChildrenMap.has(element)) {
                return this._treeNodeToChildrenMap.get(element);
            } else {
                // check if session exists
                if (element.sessionId) {
                    // clean created session promise
                    this._sessionIdToPromiseMap.delete(element.sessionId);

                    // node expansion
                    let promise = new Deferred<TreeNodeInfo[]>();
                    await this.expandNode(element, element.sessionId, promise);
                    let children = await promise;
                    if (children) {
                        // clean expand session promise
                        this.cleanExpansionPromise(element);
                        return children;
                    } else {
                        return undefined;
                    }
                } else {
                    // start node session
                    let promise = new Deferred<TreeNodeInfo>();
                    await this.createSession(promise, element.connectionCredentials);
                    let node = await promise;
                    // If node create session failed
                    if (!node) {
                        const signInNode = new AccountSignInTreeNode(element);
                        this._treeNodeToChildrenMap.set(element, [signInNode]);
                        return [signInNode];
                    }
                    // otherwise expand the node by refreshing the root
                    // to add connected context key
                    this._objectExplorerProvider.refresh(undefined);
                }
            }
        } else {
            // retrieve saved connections first when opening object explorer
            // for the first time
            let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
            if ((!this._objectExplorerProvider.objectExplorerExists ||
                savedConnections.length !== this._rootTreeNodeArray.length) &&
                savedConnections.length > 0) {
                this._rootTreeNodeArray = [];
                this.getSavedConnections();
                this._objectExplorerProvider.objectExplorerExists = true;
                return this.sortByServerName(this._rootTreeNodeArray);
            } else {
                if (this._rootTreeNodeArray.length > 0) {
                    return this.sortByServerName(this._rootTreeNodeArray);
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
    public async createSession(promise: Deferred<vscode.TreeItem>, connectionCredentials?: IConnectionCredentials): Promise<void> {
        if (!connectionCredentials) {
            const connectionUI = this._connectionManager.connectionUI;
            connectionCredentials = await connectionUI.showConnections(false);
        }
        if (connectionCredentials) {
            // show password prompt if SQL Login and password isn't saved
            const shouldPromptForPassword = ConnectionCredentials.shouldPromptForPassword(connectionCredentials);
            if (shouldPromptForPassword) {
                // look up saved password
                let password = await this._connectionManager.connectionStore.lookupPassword(connectionCredentials);
                if (!password) {
                    password = await this._connectionManager.connectionUI.promptForPassword();
                    if (!password) {
                        return promise.resolve(undefined);
                    }
                }
                connectionCredentials.password = password;
            }
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCredentials);
            const response = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
            if (response) {
                this._sessionIdToConnectionCredentialsMap.set(response.sessionId, connectionCredentials);
                this._sessionIdToPromiseMap.set(response.sessionId, promise);
                return;
            }
        }
    }

    public getConnectionCredentials(sessionId: string): ConnectionCredentials {
        if (this._sessionIdToConnectionCredentialsMap.has(sessionId)) {
            return this._sessionIdToConnectionCredentialsMap.get(sessionId);
        }
        return undefined;
    }

    public async removeObjectExplorerNode(node: TreeNodeInfo, isDisconnect: boolean = false): Promise<void> {
        await this.closeSession(node);
        if (!isDisconnect) {
            const index = this._rootTreeNodeArray.indexOf(node, 0);
            if (index > -1) {
                this._rootTreeNodeArray.splice(index, 1);
            }
        }
        const nodeUri = ObjectExplorerUtils.getNodeUri(node);
        this._connectionManager.disconnect(nodeUri);
        this._nodePathToNodeLabelMap.delete(node.nodePath);
        this.cleanNodeChildren(node);
        if (isDisconnect) {
            this._treeNodeToChildrenMap.set(this._currentNode, [new ConnectTreeNode(this._currentNode)]);
            return this._objectExplorerProvider.refresh(undefined);
        }
    }

    public async refreshNode(node: TreeNodeInfo): Promise<void> {
        const refreshParams: RefreshParams = {
            sessionId: node.sessionId,
            nodePath: node.nodePath
        };
        await this._connectionManager.client.sendRequest(RefreshRequest.type, refreshParams);
        return this._objectExplorerProvider.refresh(node);
    }

    public signInNodeServer(node: TreeNodeInfo): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            this._treeNodeToChildrenMap.delete(node);
        }
    }

    private createNodeLabel(credentials: IConnectionCredentials): string {
        let database = credentials.database;
        const server = credentials.server;
        const authType = credentials.authenticationType;
        let userOrAuthType = authType;
        if (authType === Constants.sqlAuthentication) {
            userOrAuthType = credentials.user;
        }
        if (!database || database === '') {
            database = Constants.defaultDatabase;
        }
        return `${server}, ${database} (${userOrAuthType})`;
    }

    /**
     * Sends a close session request
     * @param node
     */
    public async closeSession(node: TreeNodeInfo): Promise<void> {
        if (node.sessionId) {
            const closeSessionParams: CloseSessionParams = {
                sessionId: node.sessionId
            };
            const response = await this._connectionManager.client.sendRequest(CloseSessionRequest.type,
                closeSessionParams);
            if (response && response.success) {
                this._sessionIdToConnectionCredentialsMap.delete(response.sessionId);
                if (this._sessionIdToPromiseMap.has(node.sessionId)) {
                    this._sessionIdToPromiseMap.delete(node.sessionId);
                }
                node.nodeType = Constants.disconnectedServerLabel;
                node.contextValue = Constants.disconnectedServerLabel;
                node.sessionId = undefined;
                // make a new node to show disconnected behavior
                let disconnectedNode = new TreeNodeInfo(node.label, Constants.disconnectedServerLabel,
                    node.collapsibleState, node.nodePath, node.nodeStatus, Constants.disconnectedServerLabel,
                    undefined, node.connectionCredentials, node.parentNode);
                this.updateNode(disconnectedNode);
                this._currentNode = disconnectedNode;
                return;
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
