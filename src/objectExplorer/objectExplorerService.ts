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
import {
    ExpandRequest,
    ExpandParams,
    ExpandCompleteNotification,
    ExpandResponse,
} from "../models/contracts/objectExplorer/expandNodeRequest";
import { ObjectExplorerProvider } from "./objectExplorerProvider";
import { RefreshRequest } from "../models/contracts/objectExplorer/refreshSessionRequest";
import {
    CloseSessionRequest,
    CloseSessionParams,
    CloseSessionResponse,
} from "../models/contracts/objectExplorer/closeSessionRequest";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { AuthenticationTypes, IConnectionProfile } from "../models/interfaces";
import * as LocalizedConstants from "../constants/locConstants";
import { AddConnectionTreeNode } from "./nodes/addConnectionTreeNode";
import { AccountSignInTreeNode } from "./nodes/accountSignInTreeNode";
import { ConnectTreeNode, TreeNodeType } from "./nodes/connectTreeNode";
import { Deferred } from "../protocol";
import * as Constants from "../constants/constants";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import * as Utils from "../models/utils";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { ConnectionProfile } from "../models/connectionProfile";
import providerSettings from "../azure/providerSettings";
import { IConnectionInfo } from "vscode-mssql";
import { sendActionEvent } from "../telemetry/telemetry";
import { IAccount } from "../models/contracts/azure";
import * as AzureConstants from "../azure/constants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    GetSessionIdRequest,
    GetSessionIdResponse,
} from "../models/contracts/objectExplorer/getSessionIdRequest";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ExpandErrorNode } from "./nodes/expandErrorNode";
import { NoItemsNode } from "./nodes/noItemNode";
import { ConnectionNode } from "./nodes/connectionNode";

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

    // Flat map of tree nodes to their children
    // This is used to cache the children of a node so that we don't have to re-query them every time
    // we expand a node. The key is the node and the value is the array of children.
    private _treeNodeToChildrenMap: Map<vscode.TreeItem, vscode.TreeItem[]>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;

    // Deferred promise maps
    private _pendingSessionCreations: Map<string, Deferred<SessionCreatedParameters>> = new Map<
        string,
        Deferred<SessionCreatedParameters>
    >();
    private _pendingExpands: Map<string, Deferred<ExpandResponse>> = new Map<
        string,
        Deferred<ExpandResponse>
    >();

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

        this._client.onNotification(CreateSessionCompleteNotification.type, (e) =>
            this.handleSessionCreatedNotification(e),
        );
        this._client.onNotification(ExpandCompleteNotification.type, (e) =>
            this.handleExpandNodeNotification(e),
        );
    }

    public handleSessionCreatedNotification(result: SessionCreatedParameters): void {
        const promise = this._pendingSessionCreations.get(result.sessionId);
        if (promise) {
            promise.resolve(result);
        } else {
            this._logger.logDebug(
                `Session created notification received for sessionId ${result.sessionId} but no promise found.`,
            );
        }
    }

    public handleExpandNodeNotification(result: ExpandResponse): void {
        const promise = this._pendingExpands.get(`${result.sessionId}${result.nodePath}`);
        if (promise) {
            promise.resolve(result);
        } else {
            this._logger.logDebug(
                `Expand node notification received for sessionId ${result.sessionId} but no promise found.`,
            );
        }
    }

    private async reconnectProfile(node: TreeNodeInfo, profile: IConnectionProfile): Promise<void> {
        node.updateConnectionProfile(profile);
        this.cleanNodeChildren(node);
        this._objectExplorerProvider.refresh(node);
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

    public async expandNode(
        node: TreeNodeInfo,
        sessionId: string,
        promise: Deferred<vscode.TreeItem[]>,
    ): Promise<boolean | undefined> {
        try {
            const expandParams: ExpandParams = {
                sessionId: sessionId,
                nodePath: node.nodePath,
                filters: node.filters,
            };
            const expandResponse = new Deferred<ExpandResponse>();
            this._pendingExpands.set(`${sessionId}${node.nodePath}`, expandResponse);

            let response: boolean;
            if (node.shouldRefresh) {
                response = await this._connectionManager.client.sendRequest(
                    RefreshRequest.type,
                    expandParams,
                );
            } else {
                response = await this._connectionManager.client.sendRequest(
                    ExpandRequest.type,
                    expandParams,
                );
            }

            if (response) {
                const result = await expandResponse;
                if (!result) {
                    return undefined;
                }

                if (result.nodes && !result.errorMessage) {
                    // successfully received children from SQL Tools Service
                    const children = result.nodes.map((n) =>
                        TreeNodeInfo.fromNodeInfo(
                            n,
                            result.sessionId,
                            node,
                            node.connectionProfile,
                        ),
                    );
                    this._treeNodeToChildrenMap.set(node, children);
                    sendActionEvent(
                        TelemetryViews.ObjectExplorer,
                        TelemetryActions.ExpandNode,
                        {
                            nodeType: node?.context?.subType ?? "",
                            isErrored: (!!result.errorMessage).toString(),
                        },
                        {
                            nodeCount: result?.nodes.length ?? 0,
                        },
                    );

                    promise.resolve(children);
                } else {
                    // failure to expand node; display error

                    if (result.errorMessage) {
                        this._connectionManager.vscodeWrapper.showErrorMessage(result.errorMessage);
                    }

                    const errorNode = new ExpandErrorNode(node, result.errorMessage);

                    this._treeNodeToChildrenMap.set(node, [errorNode]);
                    promise.resolve([errorNode]);
                }
                return response;
            } else {
                await this._connectionManager.vscodeWrapper.showErrorMessage(
                    LocalizedConstants.msgUnableToExpand,
                );
                promise.resolve(undefined);
                return undefined;
            }
        } finally {
            node.shouldRefresh = false;
        }
    }

    public updateNode(node: TreeNodeType): void {
        if (node instanceof ConnectTreeNode) {
            node = getParentNode(node);
        }
        for (let rootTreeNode of this._rootTreeNodeArray) {
            if (
                Utils.isSameConnectionInfo(
                    node.connectionProfile,
                    rootTreeNode.connectionProfile,
                ) &&
                rootTreeNode.label === node.label
            ) {
                rootTreeNode.sessionId = node.sessionId;
                rootTreeNode.nodePath = node.nodePath;
                rootTreeNode.nodeStatus = node.nodeStatus;
                rootTreeNode.collapsibleState = node.collapsibleState;
                rootTreeNode.context = node.context;
                rootTreeNode.nodeType = node.nodeType;
                rootTreeNode.iconPath = node.iconPath;
                rootTreeNode.updateConnectionProfile(node.connectionProfile);

                // delete this._rootTreeNodeArray[index];
                // this._rootTreeNodeArray[index] = node;
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
            const connectionNode = new ConnectionNode(conn);
            result.push(connectionNode);
        }

        return result;
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

    // Main method that routes to the appropriate handler
    async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        if (element) {
            return this.getNodeChildren(element);
        } else {
            return this.getRootNodes();
        }
    }

    // Handle getting root nodes
    async getRootNodes(): Promise<vscode.TreeItem[]> {
        this._logger.logDebug("Getting root OE nodes");

        // retrieve saved connections first when opening object explorer for the first time
        let savedConnections = await this._connectionManager.connectionStore.readAllConnections();

        // if there are no saved connections, show the add connection node
        if (savedConnections.length === 0) {
            this._logger.logDebug("No saved connections found; displaying 'Add Connection' node");
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

    // Handle getting children for a specific node
    async getNodeChildren(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        this._logger.logDebug(`Getting children for node '${element.id}'`);

        // set current node for very first expansion of disconnected node
        if (this._currentNode !== element) {
            this._currentNode = element;
        }

        // Clean up children if the node is marked for refresh
        if (element.shouldRefresh) {
            this.cleanNodeChildren(element);
        } else {
            // If the node has cached children already, return them
            if (this._treeNodeToChildrenMap.has(element)) {
                return this._treeNodeToChildrenMap.get(element);
            }
        }

        return this.getOrCreateNodeChildrenWithSession(element);
    }

    // Handle session management and node expansion
    async getOrCreateNodeChildrenWithSession(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        // If we already have a session ID, use it for expansion
        if (element.sessionId) {
            return this.expandExistingNode(element);
        } else {
            // Otherwise create a new session
            return this.createSessionAndExpandNode(element);
        }
    }

    // Expand a node that already has a session
    async expandExistingNode(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        // node expansion
        const promise = new Deferred<TreeNodeInfo[]>();
        await this.expandNode(element, element.sessionId, promise);
        const children = await promise;

        if (children) {
            // clean expand session promise
            if (children.length === 0) {
                return [new NoItemsNode(element)];
            }
            return children;
        } else {
            return undefined;
        }
    }

    // Create a session and expand a node
    async createSessionAndExpandNode(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const sessionResult = await this.createSession(element.connectionProfile);

        // if the session was not created, show the sign in node
        if (!sessionResult?.sessionId) {
            return this.createSignInNode(element);
        }

        // If the session was created but the connected node was not created, show sign in node
        if (!sessionResult.connectionNode) {
            return this.createSignInNode(element);
        } else {
            const children = this.expandExistingNode(element);
            setTimeout(() => this._objectExplorerProvider.refresh(element), 0);
            return children;
        }
    }

    /**
     * Create an OE session for the given connection credentials
     * otherwise prompt the user to select a connection to make an
     * OE out of
     * @param connectionProfile Connection Credentials for a node
     */
    public async createSession(connectionInfo?: IConnectionInfo): Promise<{
        sessionId: string | undefined;
        connectionNode: ConnectionNode | undefined;
    }> {
        const connectionProfile = await this.prepareConnectionProfile(connectionInfo);

        if (!connectionProfile) {
            this._logger.error("Connection could not be made, as credentials not available.");
            return undefined;
        }

        const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionProfile);

        const sessionIdResponse: GetSessionIdResponse =
            await this._connectionManager.client.sendRequest(
                GetSessionIdRequest.type,
                connectionDetails,
            );

        const sessionCreatedResponse: Deferred<SessionCreatedParameters> =
            new Deferred<SessionCreatedParameters>();

        this._pendingSessionCreations.set(sessionIdResponse.sessionId, sessionCreatedResponse);

        const createSessionResponse: CreateSessionResponse =
            await this._connectionManager.client.sendRequest(
                CreateSessionRequest.type,
                connectionDetails,
            );

        if (createSessionResponse) {
            const sessionCreationResult = await sessionCreatedResponse;
            if (sessionCreationResult.success) {
                return this.handleSessionCreationSuccess(sessionCreationResult, connectionProfile);
            } else {
                await this.handleSessionCreationFailure(sessionCreationResult, connectionProfile);
                return undefined;
            }
        } else {
            this._client.logger.error("No response received for session creation request");
            return undefined;
        }
    }

    private async prepareConnectionProfile(
        connectionInfo?: IConnectionInfo,
    ): Promise<IConnectionProfile> {
        let connectionProfile: IConnectionProfile = connectionInfo as IConnectionProfile;
        if (!connectionProfile) {
            const connectionUI = this._connectionManager.connectionUI;
            connectionProfile = await connectionUI.createAndSaveProfile();
            sendActionEvent(
                TelemetryViews.ObjectExplorer,
                TelemetryActions.CreateConnection,
                undefined,
                undefined,
                connectionInfo as IConnectionProfile,
                this._connectionManager.getServerInfo(connectionInfo),
            );
        }

        if (!connectionProfile) {
            this._logger.error("Connection could not be made, as credentials not available.");
            return undefined;
        }

        if (!connectionProfile.id) {
            this._logger.verbose("Connection profile ID is not set, generating a new one.");
            connectionProfile.id = Utils.generateGuid();
        }

        if (connectionProfile.connectionString) {
            if (connectionProfile.savePassword) {
                // look up connection string
                let connectionString = await this._connectionManager.connectionStore.lookupPassword(
                    connectionProfile,
                    true,
                );
                connectionProfile.connectionString = connectionString;
                return connectionProfile;
            } else {
                this._logger.error("Cannot find connection string in cred store.");
                return undefined;
            }
        }

        if (ConnectionCredentials.isPasswordBasedCredential(connectionProfile)) {
            this._logger.verbose("Password based profile detected.");
            // show password prompt if SQL Login and password isn't saved
            let password = connectionProfile.password;
            if (Utils.isEmpty(password)) {
                this._logger.verbose("Password is empty. Getting password from user.");

                if (connectionProfile.savePassword) {
                    this._logger.verbose("Password is saved. Looking up password in cred store.");
                    password =
                        await this._connectionManager.connectionStore.lookupPassword(
                            connectionProfile,
                        );
                }

                if (!password) {
                    password = await this._connectionManager.connectionUI.promptForPassword();
                    if (!password) {
                        this._logger.error("Password not provided by user.");
                        return undefined;
                    }
                }

                if (connectionProfile.authenticationType !== Constants.azureMfa) {
                    connectionProfile.azureAccountToken = undefined;
                }
                connectionProfile.password = password;
            }
            return connectionProfile;
        }

        if (
            connectionProfile.authenticationType ===
            Utils.authTypeToString(AuthenticationTypes.Integrated)
        ) {
            connectionProfile.azureAccountToken = undefined;
            return connectionProfile;
        }

        if (connectionProfile.authenticationType === Constants.azureMfa) {
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

            return connectionProfile;
        }

        return connectionProfile;
    }

    private async handleSessionCreationSuccess(
        successResponse: SessionCreatedParameters,
        connectionProfile: IConnectionProfile,
    ) {
        if (!successResponse.success) {
            this._logger.error("Success methods should not be called on failure");
            return;
        }

        let connectionNode = this._rootTreeNodeArray.find((node) =>
            Utils.isSameConnectionInfo(node.connectionProfile, connectionProfile),
        ) as ConnectionNode;

        let isNewConnection = false;
        if (!connectionNode) {
            isNewConnection = true;
            connectionNode = new ConnectionNode(connectionProfile);
            this._rootTreeNodeArray.push(connectionNode);
        }

        connectionNode.updateToConnectedState({
            nodeInfo: successResponse.rootNode,
            sessionId: successResponse.sessionId,
            parentNode: undefined,
            connectionProfile: connectionProfile,
        });

        // make a connection if not connected already
        const nodeUri = this.getNodeIdentifier(connectionNode);
        if (
            !this._connectionManager.isConnected(nodeUri) &&
            !this._connectionManager.isConnecting(nodeUri)
        ) {
            await this._connectionManager.connect(nodeUri, connectionNode.connectionProfile);
        }
        if (isNewConnection) {
            this.addConnectionNodeAtRightPosition(connectionNode);
        }
        this._objectExplorerProvider.objectExplorerExists = true;
        // remove the sign in node once the session is created
        if (this._treeNodeToChildrenMap.has(connectionNode)) {
            this._treeNodeToChildrenMap.delete(connectionNode);
        }

        return {
            sessionId: successResponse.sessionId,
            connectionNode: this._rootTreeNodeArray.find((node) =>
                Utils.isSameConnectionInfo(node.connectionProfile, connectionProfile),
            ) as ConnectionNode,
        };
    }

    private async handleSessionCreationFailure(
        failureResponse: SessionCreatedParameters,
        connectionProfile: IConnectionProfile,
    ): Promise<{
        fixedConnectionProfile: IConnectionProfile;
        shouldReconnect: boolean;
        errorMessage: string;
    }> {
        let error = LocalizedConstants.connectErrorLabel;
        let errorNumber: number;
        if (failureResponse.errorNumber) {
            errorNumber = failureResponse.errorNumber;
        }
        if (failureResponse.errorMessage) {
            error += `: ${failureResponse.errorMessage}`;
        }
        if (errorNumber === Constants.errorSSLCertificateValidationFailed) {
            this._logger.error("Session creation failed with SSL certificate validation error");
            await new Promise((resolve) => {
                void this._connectionManager.showInstructionTextAsWarning(
                    connectionProfile,
                    async (updatedProfile) => {
                        resolve();
                    },
                );
            });
            void this._connectionManager.showInstructionTextAsWarning(
                connectionProfile,
                async (updatedProfile) => {
                    void this.reconnectProfile(this._currentNode, updatedProfile);
                },
            );
        } else if (ObjectExplorerUtils.isFirewallError(failureResponse.errorNumber)) {
            this._logger.error("Session creation failed with firewall error");
            // handle session failure because of firewall issue
            let handleFirewallResult =
                await this._connectionManager.firewallService.handleFirewallRule(
                    Constants.errorFirewallRule,
                    failureResponse.errorMessage,
                );
            if (handleFirewallResult.result && handleFirewallResult.ipAddress) {
                const isFirewallAdded =
                    await this._connectionManager.connectionUI.handleFirewallError(
                        ObjectExplorerUtils.getNodeUriFromProfile(connectionProfile),
                        connectionProfile,
                        handleFirewallResult.ipAddress,
                    );
                if (isFirewallAdded) {
                    void this.reconnectProfile(this._currentNode, connectionProfile);
                }
            }
        } else if (
            connectionProfile.authenticationType === Constants.azureMfa &&
            this.needsAccountRefresh(failureResponse, connectionProfile.user)
        ) {
            let account = this._connectionManager.accountStore.getAccount(
                connectionProfile.accountId,
            );
            await this.refreshAccount(account, connectionProfile);
            // Do not await when performing reconnect to allow
            // OE node to expand after connection is established.
            void this.reconnectProfile(this._currentNode, connectionProfile);
        } else {
            // If not a known error, show the error message
            this._logger.error("Session creation failed with unknown error", errorNumber);
            this._connectionManager.vscodeWrapper.showErrorMessage(error);
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

    public async removeObjectExplorerNode(
        node: ConnectionNode,
        isDisconnect: boolean = false,
    ): Promise<void> {
        await this.closeSession(node);
        const nodeUri = this.getNodeIdentifier(node);
        await this._connectionManager.disconnect(nodeUri);
        this.cleanNodeChildren(node);
        if (!isDisconnect) {
            const index = this._rootTreeNodeArray.indexOf(node, 0);
            if (index > -1) {
                this._rootTreeNodeArray.splice(index, 1);
            }
        } else {
            node.updateToDisconnectedState();
            this._treeNodeToChildrenMap.set(node, [new ConnectTreeNode(node)]);
            this._objectExplorerProvider.refresh(node);
        }
        sendActionEvent(
            TelemetryViews.ObjectExplorer,
            isDisconnect ? TelemetryActions.RemoveConnection : TelemetryActions.Disconnect,
            {
                nodeType: node.nodeType,
            },
            undefined,
            node.connectionProfile as IConnectionProfile,
            this._connectionManager.getServerInfo(node.connectionProfile),
        );
    }

    public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
        for (let conn of connections) {
            for (let node of this._rootTreeNodeArray) {
                if (Utils.isSameConnectionInfo(node.connectionProfile, conn)) {
                    await this.removeObjectExplorerNode(node as ConnectionNode);
                }
            }
        }
    }

    public signInNodeServer(node: TreeNodeInfo): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            this._treeNodeToChildrenMap.delete(node);
        }
    }

    public addDisconnectedNode(connectionCredentials: IConnectionProfile): void {
        const connectionNode = new ConnectionNode(connectionCredentials);
        this.addConnectionNodeAtRightPosition(connectionNode);
    }

    public addConnectionNodeAtRightPosition(connectionNode: ConnectionNode): void {
        // Find the right position to insert the node
        const index = this._rootTreeNodeArray.findIndex(
            (node) => (node.label as string).localeCompare(connectionNode.label as string) > 0,
        );
        if (index === -1) {
            this._rootTreeNodeArray.push(connectionNode);
        } else {
            this._rootTreeNodeArray.splice(index, 0, connectionNode);
        }
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

    public get rootTreeNodeArray(): TreeNodeInfo[] {
        return this._rootTreeNodeArray;
    }

    public get rootNodeConnections(): IConnectionInfo[] {
        const connections = this._rootTreeNodeArray.map((node) => node.connectionProfile);
        return connections;
    }

    //#endregion
}
