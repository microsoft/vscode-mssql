/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import ConnectionManager from "../controllers/connectionManager";
import {
    CreateSessionCompleteNotification,
    SessionCreatedParameters,
    CreateSessionRequest,
    CreateSessionResponse,
} from "../models/contracts/objectExplorer/createSessionRequest";
import { NotificationHandler } from "vscode-languageclient";
import {
    ExpandRequest,
    ExpandParams,
    ExpandCompleteNotification,
    ExpandResponse,
} from "../models/contracts/objectExplorer/expandNodeRequest";
import { ObjectExplorerProvider } from "./objectExplorerProvider";
import { TreeItemCollapsibleState } from "vscode";
import {
    RefreshRequest,
    RefreshParams,
} from "../models/contracts/objectExplorer/refreshSessionRequest";
import {
    CloseSessionRequest,
    CloseSessionParams,
    CloseSessionResponse,
} from "../models/contracts/objectExplorer/closeSessionRequest";
import { TreeNodeInfo } from "./treeNodeInfo";
import { AuthenticationTypes, IConnectionProfile } from "../models/interfaces";
import * as LocalizedConstants from "../constants/locConstants";
import { AddConnectionTreeNode } from "./addConnectionTreeNode";
import { AccountSignInTreeNode } from "./accountSignInTreeNode";
import { ConnectTreeNode, TreeNodeType } from "./connectTreeNode";
import { Deferred } from "../protocol";
import * as Constants from "../constants/constants";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import * as Utils from "../models/utils";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { ConnectionProfile } from "../models/connectionProfile";
import providerSettings from "../azure/providerSettings";
import { IConnectionInfo, TreeNodeContextValue } from "vscode-mssql";
import { sendActionEvent } from "../telemetry/telemetry";
import { IAccount } from "../models/contracts/azure";
import * as AzureConstants from "../azure/constants";
import * as ConnInfo from "../models/connectionInfo";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    GetSessionIdRequest,
    GetSessionIdResponse,
} from "../models/contracts/objectExplorer/getSessionIdRequest";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";

function getParentNode(node: TreeNodeType): TreeNodeInfo {
    node = node.parentNode;
    if (!(node instanceof TreeNodeInfo)) {
        vscode.window.showErrorMessage(LocalizedConstants.nodeErrorMessage);
        throw new Error(`Parent node was not TreeNodeInfo.`);
    }
    return node;
}

export class ObjectExplorerService {
    private _client: SqlToolsServiceClient;
    private _logger: Logger;
    private _currentNode: TreeNodeInfo;
    private _treeNodeToChildrenMap: Map<vscode.TreeItem, vscode.TreeItem[]>;
    private _sessionIdToNodeLabelMap: Map<string, string>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;
    private _sessionIdToConnectionProfileMap: Map<string, IConnectionProfile>;
    private _expandParamsToTreeNodeInfoMap: Map<ExpandParams, TreeNodeInfo>;

    // Deferred promise maps
    private _sessionIdToPromiseMap: Map<string, Deferred<vscode.TreeItem>>;
    private _expandParamsToPromiseMap: Map<ExpandParams, Deferred<TreeNodeInfo[]>>;

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        private _connectionManager: ConnectionManager,
        private _objectExplorerProvider: ObjectExplorerProvider,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._client = this._connectionManager.client;

        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ObjectExplorerService");

        this._treeNodeToChildrenMap = new Map<vscode.TreeItem, vscode.TreeItem[]>();
        this._rootTreeNodeArray = new Array<TreeNodeInfo>();
        this._sessionIdToConnectionProfileMap = new Map<string, IConnectionProfile>();
        this._sessionIdToNodeLabelMap = new Map<string, string>();
        this._sessionIdToPromiseMap = new Map<string, Deferred<vscode.TreeItem>>();
        this._expandParamsToPromiseMap = new Map<ExpandParams, Deferred<TreeNodeInfo[]>>();
        this._expandParamsToTreeNodeInfoMap = new Map<ExpandParams, TreeNodeInfo>();

        this._client.onNotification(
            CreateSessionCompleteNotification.type,
            this.handleSessionCreatedNotification(),
        );
        this._client.onNotification(
            ExpandCompleteNotification.type,
            this.handleExpandSessionNotification(),
        );
    }

    private handleSessionCreatedNotification(): NotificationHandler<SessionCreatedParameters> {
        const self = this;
        const handler = async (result: SessionCreatedParameters) => {
            if (self._currentNode instanceof ConnectTreeNode) {
                self.currentNode = getParentNode(self.currentNode);
            }
            if (result.success) {
                let nodeLabel =
                    this._sessionIdToNodeLabelMap.get(result.sessionId) ??
                    ConnInfo.getConnectionDisplayName(self._currentNode.connectionInfo);
                // if no node label, check if it has a name in saved profiles
                // in case this call came from new query
                // let savedConnections =
                // this._connectionManager.connectionStore.readAllConnections();
                let nodeConnection = this._sessionIdToConnectionProfileMap.get(result.sessionId);

                // set connection and other things
                let node: TreeNodeInfo;

                if (self._currentNode && self._currentNode.sessionId === result.sessionId) {
                    node = TreeNodeInfo.fromNodeInfo(
                        result.rootNode,
                        result.sessionId,
                        undefined,
                        self._currentNode.connectionInfo,
                        nodeLabel,
                        Constants.serverLabel,
                    );
                } else {
                    node = TreeNodeInfo.fromNodeInfo(
                        result.rootNode,
                        result.sessionId,
                        undefined,
                        nodeConnection,
                        nodeLabel,
                        Constants.serverLabel,
                    );
                }
                // make a connection if not connected already
                const nodeUri = this.getNodeIdentifier(node);
                if (
                    !this._connectionManager.isConnected(nodeUri) &&
                    !this._connectionManager.isConnecting(nodeUri)
                ) {
                    const profile = <IConnectionProfile>node.connectionInfo;
                    await this._connectionManager.connect(nodeUri, profile);
                }

                self.updateNode(node);
                self._objectExplorerProvider.objectExplorerExists = true;
                const promise = self._sessionIdToPromiseMap.get(result.sessionId);
                // remove the sign in node once the session is created
                if (self._treeNodeToChildrenMap.has(node)) {
                    self._treeNodeToChildrenMap.delete(node);
                }
                return promise?.resolve(node);
            } else {
                // create session failure
                if (self._currentNode?.connectionInfo?.password) {
                    const profile = this._currentNode.connectionInfo;
                    profile.password = "";
                    this._currentNode.updateConnectionInfo(profile);
                }
                let error = LocalizedConstants.connectErrorLabel;
                let errorNumber: number;
                if (result.errorNumber) {
                    errorNumber = result.errorNumber;
                }
                if (result.errorMessage) {
                    error += `: ${result.errorMessage}`;
                }

                if (errorNumber === Constants.errorSSLCertificateValidationFailed) {
                    void self._connectionManager.showInstructionTextAsWarning(
                        self._currentNode.connectionInfo,
                        async (updatedProfile) => {
                            void self.reconnectProfile(self._currentNode, updatedProfile);
                        },
                    );
                } else if (ObjectExplorerUtils.isFirewallError(result.errorNumber)) {
                    // handle session failure because of firewall issue
                    let handleFirewallResult =
                        await self._connectionManager.firewallService.handleFirewallRule(
                            Constants.errorFirewallRule,
                            result.errorMessage,
                        );
                    if (handleFirewallResult.result && handleFirewallResult.ipAddress) {
                        const nodeUri = this.getNodeIdentifier(self.currentNode);
                        const profile = <IConnectionProfile>self._currentNode.connectionInfo;
                        self.updateNode(self._currentNode);
                        void self._connectionManager.connectionUI.handleFirewallError(
                            nodeUri,
                            profile,
                            handleFirewallResult.ipAddress,
                        );
                    }
                } else if (
                    self._currentNode.connectionInfo.authenticationType === Constants.azureMfa &&
                    self.needsAccountRefresh(result, self._currentNode.connectionInfo.user)
                ) {
                    let profile = self._currentNode.connectionInfo;
                    let account = this._connectionManager.accountStore.getAccount(
                        profile.accountId,
                    );
                    await this.refreshAccount(account, profile);
                    // Do not await when performing reconnect to allow
                    // OE node to expand after connection is established.
                    void this.reconnectProfile(self._currentNode, profile);
                } else {
                    self._connectionManager.vscodeWrapper.showErrorMessage(error);
                }
                const promise = self._sessionIdToPromiseMap.get(result.sessionId);

                if (promise) {
                    return promise.resolve(undefined);
                }
            }
        };
        return handler;
    }

    private async reconnectProfile(node: TreeNodeInfo, profile: IConnectionInfo): Promise<void> {
        node.updateConnectionInfo(profile);
        this.updateNode(node);
        let fileUri = this.getNodeIdentifier(node);
        if (
            await this._connectionManager.connectionStore.saveProfile(profile as IConnectionProfile)
        ) {
            const res = await this._connectionManager.connect(fileUri, profile);
            if (await this._connectionManager.handleConnectionResult(res, fileUri, profile)) {
                void this.refreshNode(node);
            }
        } else {
            this._connectionManager.vscodeWrapper.showErrorMessage(
                LocalizedConstants.msgPromptProfileUpdateFailed,
            );
        }
    }

    private needsAccountRefresh(result: SessionCreatedParameters, username: string): boolean {
        let email = username?.includes(" - ")
            ? username.substring(username.indexOf("-") + 2)
            : username;
        return (
            result.errorMessage.includes(AzureConstants.AADSTS70043) ||
            result.errorMessage.includes(AzureConstants.AADSTS50173) ||
            result.errorMessage.includes(AzureConstants.AADSTS50020) ||
            result.errorMessage.includes(AzureConstants.mdsUserAccountNotReceived) ||
            result.errorMessage.includes(
                Utils.formatString(AzureConstants.mdsUserAccountNotFound, email),
            )
        );
    }

    private getParentFromExpandParams(params: ExpandParams): TreeNodeInfo | undefined {
        for (let key of this._expandParamsToTreeNodeInfoMap.keys()) {
            if (key.sessionId === params.sessionId && key.nodePath === params.nodePath) {
                return this._expandParamsToTreeNodeInfoMap.get(key);
            }
        }
        return undefined;
    }

    /**
     * Handler for async response from SQL Tools Service.
     * Public only for testing
     */
    public handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
        const self = this;
        const handler = (result: ExpandResponse) => {
            if (!result) {
                return undefined;
            }

            if (result.nodes && !result.errorMessage) {
                // successfully received children from SQL Tools Service
                const credentials = self._sessionIdToConnectionProfileMap.get(result.sessionId);
                const expandParams: ExpandParams = {
                    sessionId: result.sessionId,
                    nodePath: result.nodePath,
                };
                const parentNode = self.getParentFromExpandParams(expandParams);
                const children = result.nodes.map((node) =>
                    TreeNodeInfo.fromNodeInfo(node, result.sessionId, parentNode, credentials),
                );
                self._treeNodeToChildrenMap.set(parentNode, children);
                sendActionEvent(
                    TelemetryViews.ObjectExplorer,
                    TelemetryActions.ExpandNode,
                    {
                        nodeType: parentNode?.context?.subType ?? "",
                        isErrored: (!!result.errorMessage).toString(),
                    },
                    {
                        nodeCount: result?.nodes.length ?? 0,
                    },
                );
                for (let key of self._expandParamsToPromiseMap.keys()) {
                    if (
                        key.sessionId === expandParams.sessionId &&
                        key.nodePath === expandParams.nodePath
                    ) {
                        let promise = self._expandParamsToPromiseMap.get(key);
                        promise.resolve(children);
                        self._expandParamsToPromiseMap.delete(key);
                        self._expandParamsToTreeNodeInfoMap.delete(key);
                        return;
                    }
                }
            } else {
                // failure to expand node; display error

                if (result.errorMessage) {
                    self._connectionManager.vscodeWrapper.showErrorMessage(result.errorMessage);
                }

                const expandParams: ExpandParams = {
                    sessionId: result.sessionId,
                    nodePath: result.nodePath,
                };
                const parentNode = self.getParentFromExpandParams(expandParams);

                const errorNode = ObjectExplorerUtils.createErrorTreeItem(result.errorMessage);

                self._treeNodeToChildrenMap.set(parentNode, [errorNode]);

                for (let key of self._expandParamsToPromiseMap.keys()) {
                    if (
                        key.sessionId === expandParams.sessionId &&
                        key.nodePath === expandParams.nodePath
                    ) {
                        let promise = self._expandParamsToPromiseMap.get(key);
                        promise.resolve([errorNode as TreeNodeInfo]);
                        self._expandParamsToPromiseMap.delete(key);
                        self._expandParamsToTreeNodeInfoMap.delete(key);
                        return;
                    }
                }
            }
        };
        return handler;
    }

    public async expandNode(
        node: TreeNodeInfo,
        sessionId: string,
        promise: Deferred<TreeNodeInfo[]>,
    ): Promise<boolean | undefined> {
        const expandParams: ExpandParams = {
            sessionId: sessionId,
            nodePath: node.nodePath,
            filters: node.filters,
        };
        this._expandParamsToPromiseMap.set(expandParams, promise);
        this._expandParamsToTreeNodeInfoMap.set(expandParams, node);
        const response: boolean = await this._connectionManager.client.sendRequest(
            ExpandRequest.type,
            expandParams,
        );
        if (response) {
            return response;
        } else {
            await this._connectionManager.vscodeWrapper.showErrorMessage(
                LocalizedConstants.msgUnableToExpand,
            );
            this._expandParamsToPromiseMap.delete(expandParams);
            this._expandParamsToTreeNodeInfoMap.delete(expandParams);
            promise.resolve(undefined);
            return undefined;
        }
    }

    public updateNode(node: TreeNodeType): void {
        if (node instanceof ConnectTreeNode) {
            node = getParentNode(node);
        }
        for (let rootTreeNode of this._rootTreeNodeArray) {
            if (
                Utils.isSameConnectionInfo(node.connectionInfo, rootTreeNode.connectionInfo) &&
                rootTreeNode.label === node.label
            ) {
                const index = this._rootTreeNodeArray.indexOf(rootTreeNode);
                delete this._rootTreeNodeArray[index];
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
    private cleanNodeChildren(node: vscode.TreeItem): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            let stack = this._treeNodeToChildrenMap.get(node);
            while (stack.length > 0) {
                let child = stack.pop();
                if (this._treeNodeToChildrenMap.has(child)) {
                    stack.concat(this._treeNodeToChildrenMap.get(child));
                }
                this._treeNodeToChildrenMap.delete(child);
            }
            this._treeNodeToChildrenMap.delete(node);
        }
    }

    /**
     * Sort the array based on server names
     * Public only for testing purposes
     * @param array array that needs to be sorted
     */
    public sortByServerName(array: TreeNodeInfo[]): TreeNodeInfo[] {
        const sortedNodeArray = array.sort((a, b) => {
            const labelA = typeof a.label === "string" ? a.label : a.label.label;
            const labelB = typeof b.label === "string" ? b.label : b.label.label;
            return labelA.toLowerCase().localeCompare(labelB.toLowerCase());
        });
        return sortedNodeArray;
    }

    /**
     * Get nodes from saved connections
     */
    private async getSavedConnectionNodes(): Promise<TreeNodeInfo[]> {
        const result: TreeNodeInfo[] = [];

        let savedConnections = await this._connectionManager.connectionStore.readAllConnections();
        for (const conn of savedConnections) {
            let nodeLabel =
                ConnInfo.getSimpleConnectionDisplayName(conn) === conn.server
                    ? ConnInfo.getConnectionDisplayName(conn)
                    : ConnInfo.getSimpleConnectionDisplayName(conn);

            const connectionDetails = ConnectionCredentials.createConnectionDetails(conn);

            const response: CreateSessionResponse =
                await this._connectionManager.client.sendRequest(
                    GetSessionIdRequest.type,
                    connectionDetails,
                );

            this._sessionIdToNodeLabelMap.set(response.sessionId, nodeLabel);
            let node = new TreeNodeInfo(
                nodeLabel,
                ObjectExplorerService.disconnectedNodeContextValue,
                TreeItemCollapsibleState.Collapsed,
                undefined,
                undefined,
                Constants.disconnectedServerNodeType,
                undefined,
                conn,
                undefined,
                undefined,
            );
            result.push(node);
        }

        return result;
    }

    private static get disconnectedNodeContextValue(): TreeNodeContextValue {
        return {
            type: Constants.disconnectedServerNodeType,
            filterable: false,
            hasFilters: false,
            subType: "",
        };
    }

    /**
     * Clean up expansion promises for a node
     * @param node The selected node
     */
    private cleanExpansionPromise(node: TreeNodeInfo): void {
        for (const key of this._expandParamsToPromiseMap.keys()) {
            if (key.sessionId === node.sessionId && key.nodePath === node.nodePath) {
                this._expandParamsToPromiseMap.delete(key);
                this._expandParamsToTreeNodeInfoMap.delete(key);
            }
        }
    }

    /**
     * Helper to show the Add Connection node; only displayed when there are no saved connections
     */
    private getAddConnectionNode(): AddConnectionTreeNode[] {
        this._rootTreeNodeArray = [];
        this._objectExplorerProvider.objectExplorerExists = true;
        return [new AddConnectionTreeNode()];
    }

    /**
     * Handles a generic OE create session failure by creating a
     * sign in node
     */
    private createSignInNode(element: TreeNodeInfo): AccountSignInTreeNode[] {
        const signInNode = new AccountSignInTreeNode(element);
        this._treeNodeToChildrenMap.set(element, [signInNode]);
        return [signInNode];
    }

    async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        if (element) {
            this._logger.logDebug(`Getting children for node '${element.nodePath}'`);

            // set current node for very first expansion of disconnected node
            if (this._currentNode !== element) {
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
                        if (children.length === 0) {
                            return [ObjectExplorerUtils.createNoItemsTreeItem()];
                        }
                        return children;
                    } else {
                        return undefined;
                    }
                } else {
                    const sessionPromise = new Deferred<TreeNodeInfo>();
                    const sessionId = await this.createSession(
                        sessionPromise,
                        element.connectionInfo,
                    );
                    // if the session was not created, show the sign in node
                    if (!sessionId) {
                        return this.createSignInNode(element);
                    }

                    const node = await sessionPromise;

                    // If the session was created but the connected node was not created, show sign in node
                    if (!node) {
                        return this.createSignInNode(element);
                    } else {
                        this._objectExplorerProvider.refresh(undefined);
                    }
                }
            }
        } else {
            this._logger.logDebug("Getting root OE nodes");

            // retrieve saved connections first when opening object explorer for the first time
            let savedConnections =
                await this._connectionManager.connectionStore.readAllConnections();

            // if there are no saved connections, show the add connection node
            if (savedConnections.length === 0) {
                this._logger.logDebug(
                    "No saved connections found; displaying 'Add Connection' node",
                );
                return this.getAddConnectionNode();
            }

            // if OE doesn't exist the first time, then build the nodes off of saved connections
            if (!this._objectExplorerProvider.objectExplorerExists) {
                // if there are actually saved connections
                this._rootTreeNodeArray = await this.getSavedConnectionNodes();
                this._logger.logDebug(
                    `No current OE; created OE root with ${this._rootTreeNodeArray.length}`,
                );
                this._objectExplorerProvider.objectExplorerExists = true;
                return this.sortByServerName(this._rootTreeNodeArray);
            } else {
                this._logger.logDebug(
                    `Returning cached OE root nodes (${this._rootTreeNodeArray.length})`,
                );
                // otherwise returned the cached nodes
                return this.sortByServerName(this._rootTreeNodeArray);
            }
        }
    }

    /**
     * Create an OE session for the given connection credentials
     * otherwise prompt the user to select a connection to make an
     * OE out of
     * @param connectionProfile Connection Credentials for a node
     */
    public async createSession(
        promise: Deferred<vscode.TreeItem | undefined>,
        connectionCredentials?: IConnectionInfo,
        _context?: vscode.ExtensionContext,
    ): Promise<string> {
        if (!connectionCredentials) {
            const connectionUI = this._connectionManager.connectionUI;
            connectionCredentials = await connectionUI.createAndSaveProfile();
            sendActionEvent(
                TelemetryViews.ObjectExplorer,
                TelemetryActions.CreateConnection,
                undefined,
                undefined,
                connectionCredentials as IConnectionProfile,
                this._connectionManager.getServerInfo(connectionCredentials),
            );
        }

        if (connectionCredentials) {
            const connectionProfile = connectionCredentials as IConnectionProfile;

            if (!connectionProfile.id) {
                connectionProfile.id = Utils.generateGuid();
            }

            // connection string based credential
            if (connectionProfile.connectionString) {
                if ((connectionProfile as IConnectionProfile).savePassword) {
                    // look up connection string
                    let connectionString =
                        await this._connectionManager.connectionStore.lookupPassword(
                            connectionProfile,
                            true,
                        );
                    connectionProfile.connectionString = connectionString;
                }
            } else {
                if (ConnectionCredentials.isPasswordBasedCredential(connectionProfile)) {
                    // show password prompt if SQL Login and password isn't saved
                    let password = connectionProfile.password;
                    if (Utils.isEmpty(password)) {
                        // if password isn't saved
                        if (!(connectionProfile as IConnectionProfile).savePassword) {
                            // prompt for password
                            password =
                                await this._connectionManager.connectionUI.promptForPassword();
                            if (!password) {
                                promise.resolve(undefined);
                                return undefined;
                            }
                        } else {
                            // look up saved password
                            password =
                                await this._connectionManager.connectionStore.lookupPassword(
                                    connectionProfile,
                                );
                            if (connectionProfile.authenticationType !== Constants.azureMfa) {
                                connectionProfile.azureAccountToken = undefined;
                            }
                        }
                        connectionProfile.password = password;
                    }
                } else if (
                    connectionProfile.authenticationType ===
                    Utils.authTypeToString(AuthenticationTypes.Integrated)
                ) {
                    connectionProfile.azureAccountToken = undefined;
                } else if (connectionProfile.authenticationType === Constants.azureMfa) {
                    let azureController = this._connectionManager.azureController;
                    let account = this._connectionManager.accountStore.getAccount(
                        connectionProfile.accountId,
                    );
                    let needsRefresh = false;
                    if (!account) {
                        needsRefresh = true;
                    } else if (azureController.isSqlAuthProviderEnabled()) {
                        connectionProfile.user = account.displayInfo.displayName;
                        connectionProfile.email = account.displayInfo.email;
                        // Update profile after updating user/email
                        await this._connectionManager.connectionUI.saveProfile(
                            connectionProfile as IConnectionProfile,
                        );
                        if (!azureController.isAccountInCache(account)) {
                            needsRefresh = true;
                        }
                    }
                    if (
                        !connectionProfile.azureAccountToken &&
                        (!azureController.isSqlAuthProviderEnabled() || needsRefresh)
                    ) {
                        void this.refreshAccount(account, connectionProfile);
                    }
                }
            }
            const connectionDetails =
                ConnectionCredentials.createConnectionDetails(connectionProfile);

            const sessionIdResponse: GetSessionIdResponse =
                await this._connectionManager.client.sendRequest(
                    GetSessionIdRequest.type,
                    connectionDetails,
                );

            const nodeLabel =
                (connectionProfile as IConnectionProfile).profileName ??
                ConnInfo.getConnectionDisplayName(connectionProfile);

            this._sessionIdToNodeLabelMap.set(sessionIdResponse.sessionId, nodeLabel);

            const response: CreateSessionResponse =
                await this._connectionManager.client.sendRequest(
                    CreateSessionRequest.type,
                    connectionDetails,
                );
            if (response) {
                this._sessionIdToConnectionProfileMap.set(response.sessionId, connectionProfile);
                this._sessionIdToPromiseMap.set(response.sessionId, promise);
                return response.sessionId;
            } else {
                this._client.logger.error("No response received for session creation request");
            }
        } else {
            this._client.logger.error(
                "Connection could not be made, as credentials not available.",
            );
            // no connection was made
            promise.resolve(undefined);
            return undefined;
        }
    }

    private async refreshAccount(
        account: IAccount,
        connectionCredentials: ConnectionCredentials,
    ): Promise<void> {
        let azureController = this._connectionManager.azureController;
        let profile = new ConnectionProfile(connectionCredentials);
        let azureAccountToken = await azureController.refreshAccessToken(
            account,
            this._connectionManager.accountStore,
            connectionCredentials.tenantId,
            providerSettings.resources.databaseResource,
        );
        if (!azureAccountToken) {
            this._client.logger.verbose(
                "Access token could not be refreshed for connection profile.",
            );
            let errorMessage = LocalizedConstants.msgAccountRefreshFailed;
            await this._connectionManager.vscodeWrapper
                .showErrorMessage(errorMessage, LocalizedConstants.refreshTokenLabel)
                .then(async (result) => {
                    if (result === LocalizedConstants.refreshTokenLabel) {
                        let updatedProfile = await azureController.populateAccountProperties(
                            profile,
                            this._connectionManager.accountStore,
                            providerSettings.resources.databaseResource,
                        );
                        connectionCredentials.azureAccountToken = updatedProfile.azureAccountToken;
                        connectionCredentials.expiresOn = updatedProfile.expiresOn;
                    } else {
                        this._client.logger.error("Credentials not refreshed by user.");
                        return undefined;
                    }
                });
        } else {
            connectionCredentials.azureAccountToken = azureAccountToken.token;
            connectionCredentials.expiresOn = azureAccountToken.expiresOn;
        }
    }
    public getConnectionCredentials(sessionId: string): IConnectionInfo {
        if (this._sessionIdToConnectionProfileMap.has(sessionId)) {
            return this._sessionIdToConnectionProfileMap.get(sessionId);
        }
        return undefined;
    }

    public async removeObjectExplorerNode(
        node: TreeNodeInfo,
        isDisconnect: boolean = false,
    ): Promise<void> {
        await this.closeSession(node);
        const nodeUri = this.getNodeIdentifier(node);
        await this._connectionManager.disconnect(nodeUri);
        if (!isDisconnect) {
            const index = this._rootTreeNodeArray.indexOf(node, 0);
            if (index > -1) {
                this._rootTreeNodeArray.splice(index, 1);
            }
        } else {
            node.nodeType = Constants.disconnectedServerNodeType;
            node.context = ObjectExplorerService.disconnectedNodeContextValue;
            node.sessionId = undefined;
            if (!(node.connectionInfo as IConnectionProfile).savePassword) {
                const profile = node.connectionInfo;
                profile.password = "";
                node.updateConnectionInfo(profile);
            }
            const label = typeof node.label === "string" ? node.label : node.label.label;
            // make a new node to show disconnected behavior
            let disconnectedNode = new TreeNodeInfo(
                label,
                ObjectExplorerService.disconnectedNodeContextValue,
                node.collapsibleState,
                node.nodePath,
                node.nodeStatus,
                Constants.disconnectedServerNodeType,
                undefined,
                node.connectionInfo,
                node.parentNode,
                undefined,
            );

            this.updateNode(disconnectedNode);
            this._currentNode = disconnectedNode;
            this._treeNodeToChildrenMap.set(this._currentNode, [
                new ConnectTreeNode(this._currentNode),
            ]);
        }

        const connectionDetails = ConnectionCredentials.createConnectionDetails(
            node.connectionInfo,
        );

        const sessionIdResponse: GetSessionIdResponse =
            await this._connectionManager.client.sendRequest(
                GetSessionIdRequest.type,
                connectionDetails,
            );

        this._sessionIdToNodeLabelMap.delete(sessionIdResponse.sessionId);
        this.cleanNodeChildren(node);
        sendActionEvent(
            TelemetryViews.ObjectExplorer,
            isDisconnect ? TelemetryActions.RemoveConnection : TelemetryActions.Disconnect,
            {
                nodeType: node.nodeType,
            },
            undefined,
            node.connectionInfo as IConnectionProfile,
            this._connectionManager.getServerInfo(node.connectionInfo),
        );
    }

    public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
        for (let conn of connections) {
            for (let node of this._rootTreeNodeArray) {
                if (Utils.isSameConnectionInfo(node.connectionInfo, conn)) {
                    await this.removeObjectExplorerNode(node);
                }
            }
        }
    }

    public async refreshNode(node: TreeNodeInfo): Promise<void> {
        const refreshParams: RefreshParams = {
            sessionId: node.sessionId,
            nodePath: node.nodePath,
            filters: node.filters,
        };
        let response = await this._connectionManager.client.sendRequest(
            RefreshRequest.type,
            refreshParams,
        );
        this._expandParamsToTreeNodeInfoMap.set(refreshParams, node);
        if (response) {
            this._treeNodeToChildrenMap.delete(node);
        }

        sendActionEvent(
            TelemetryViews.ObjectExplorer,
            TelemetryActions.Refresh,
            {
                nodeType: node.nodeType,
            },
            undefined,
            node.connectionInfo as IConnectionProfile,
            this._connectionManager.getServerInfo(node.connectionInfo),
        );
        return this._objectExplorerProvider.refresh(node);
    }

    public signInNodeServer(node: TreeNodeInfo): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            this._treeNodeToChildrenMap.delete(node);
        }
    }

    public addDisconnectedNode(connectionCredentials: IConnectionInfo): void {
        const label = (connectionCredentials as IConnectionProfile).profileName
            ? (connectionCredentials as IConnectionProfile).profileName
            : ConnInfo.getConnectionDisplayName(connectionCredentials);
        const node = new TreeNodeInfo(
            label,
            ObjectExplorerService.disconnectedNodeContextValue,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            Constants.disconnectedServerNodeType,
            undefined,
            connectionCredentials,
            undefined,
            undefined,
        );
        this.updateNode(node);
    }

    /**
     * Sends a close session request
     * @param node
     */
    public async closeSession(node: TreeNodeInfo): Promise<void> {
        if (!node.sessionId) {
            return;
        }

        const closeSessionParams: CloseSessionParams = {
            sessionId: node.sessionId,
        };
        const response: CloseSessionResponse = await this._connectionManager.client.sendRequest(
            CloseSessionRequest.type,
            closeSessionParams,
        );

        if (response && response.success) {
            if (response.sessionId !== node.sessionId) {
                this._client.logger.error("Session ID mismatch in closeSession() response");
            }

            this._sessionIdToConnectionProfileMap.delete(node.sessionId);
            this._sessionIdToPromiseMap.delete(node.sessionId);

            const nodeUri = this.getNodeIdentifier(node);
            await this._connectionManager.disconnect(nodeUri);
            this.cleanNodeChildren(node);

            return;
        }
    }

    private getNodeIdentifier(node: TreeNodeInfo): string {
        if (node.sessionId) {
            return node.sessionId;
        } else {
            this._client.logger.error("Node does not have a session ID");
            return ObjectExplorerUtils.getNodeUri(node); // TODO: can this removed entirely?  ideally, every node has a session ID associated with it
        }
    }

    public deleteChildren(node: TreeNodeInfo): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            this._treeNodeToChildrenMap.delete(node);
        }
    }

    //#region Getters and Setters

    public get currentNode(): TreeNodeInfo {
        return this._currentNode;
    }

    public get rootTreeNodeArray(): TreeNodeInfo[] {
        return this._rootTreeNodeArray;
    }

    public get rootNodeConnections(): IConnectionInfo[] {
        const connections = this._rootTreeNodeArray.map((node) => node.connectionInfo);
        return connections;
    }

    public set currentNode(node: TreeNodeInfo) {
        this._currentNode = node;
    }

    //#endregion
}
