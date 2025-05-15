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
import { RefreshRequest } from "../models/contracts/objectExplorer/refreshSessionRequest";
import {
    CloseSessionRequest,
    CloseSessionParams,
    CloseSessionResponse,
} from "../models/contracts/objectExplorer/closeSessionRequest";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import {
    AuthenticationTypes,
    IConnectionProfile,
    IConnectionProfileWithSource,
} from "../models/interfaces";
import * as LocalizedConstants from "../constants/locConstants";
import { AddConnectionTreeNode } from "./nodes/addConnectionTreeNode";
import { AccountSignInTreeNode } from "./nodes/accountSignInTreeNode";
import { ConnectTreeNode } from "./nodes/connectTreeNode";
import { Deferred } from "../protocol";
import * as Constants from "../constants/constants";
import { ObjectExplorerUtils } from "./objectExplorerUtils";
import * as Utils from "../models/utils";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { ConnectionProfile } from "../models/connectionProfile";
import providerSettings from "../azure/providerSettings";
import { IConnectionInfo } from "vscode-mssql";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { IAccount } from "../models/contracts/azure";
import * as AzureConstants from "../azure/constants";
import {
    ActivityObject,
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import {
    GetSessionIdRequest,
    GetSessionIdResponse,
} from "../models/contracts/objectExplorer/getSessionIdRequest";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ExpandErrorNode } from "./nodes/expandErrorNode";
import { NoItemsNode } from "./nodes/noItemNode";
import { ConnectionNode } from "./nodes/connectionNode";

export interface CreateSessionResult {
    sessionId?: string;
    connectionNode?: ConnectionNode;
    shouldRetryOnFailure?: boolean;
}

export class ObjectExplorerService {
    private _client: SqlToolsServiceClient;
    private _logger: Logger;

    /**
     * Flat map of tree nodes to their children
     * This is used to cache the children of a node so that we don't have to re-query them every time
     * we expand a node. The key is the node and the value is the array of children.
     */
    private _treeNodeToChildrenMap: Map<vscode.TreeItem, vscode.TreeItem[]>;
    private _rootTreeNodeArray: Array<TreeNodeInfo>;

    /**
     * Map of pending session creations
     */
    private _pendingSessionCreations: Map<string, Deferred<SessionCreatedParameters>> = new Map<
        string,
        Deferred<SessionCreatedParameters>
    >();
    /**
     * Map of pending expands
     */
    private _pendingExpands: Map<string, Deferred<ExpandResponse>> = new Map<
        string,
        Deferred<ExpandResponse>
    >();

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        private _connectionManager: ConnectionManager,
        private _refreshCallback: (node: TreeNodeInfo) => void,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._client = this._connectionManager.client;

        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ObjectExplorerService");

        this._treeNodeToChildrenMap = new Map<vscode.TreeItem, vscode.TreeItem[]>();

        this._client.onNotification(CreateSessionCompleteNotification.type, (e) =>
            this.handleSessionCreatedNotification(e),
        );
        this._client.onNotification(ExpandCompleteNotification.type, (e) =>
            this.handleExpandNodeNotification(e),
        );
    }

    /**
     * Handles the session created notification from the SQL Tools Service.
     * @param result The result of the session creation request.
     */
    public handleSessionCreatedNotification(result: SessionCreatedParameters): void {
        const promise = this._pendingSessionCreations.get(result.sessionId);
        if (promise) {
            promise.resolve(result);
        } else {
            this._logger.error(
                `Session created notification received for sessionId ${result.sessionId} but no promise found.`,
            );
        }
    }

    /**
     * Handles the expand node notification from the SQL Tools Service.
     * @param result The result of the expand node request.
     */
    public handleExpandNodeNotification(result: ExpandResponse): void {
        const promise = this._pendingExpands.get(`${result.sessionId}${result.nodePath}`);
        if (promise) {
            promise.resolve(result);
        } else {
            this._logger.error(
                `Expand node notification received for sessionId ${result.sessionId} but no promise found.`,
            );
        }
    }

    /**
     * Adds a connection node to the OE tree at the right position based on its label.
     * @param profile The connection profile to reconnect.
     */
    private async reconnectProfile(profile: IConnectionProfile): Promise<void> {
        const node = this.getConnectionNodeFromProfile(profile);
        if (node) {
            node.updateConnectionProfile(profile);
            this.cleanNodeChildren(node);
            this._refreshCallback(node);
        }
    }

    /**
     * Checks if the account needs to be refreshed based on the error message.
     * @param result The result of the session creation.
     * @param username The username of the account.
     * @returns
     */
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

    /**
     * Expands a node in the tree and retrieves its children.
     * @param node The node to expand
     * @param sessionId The session ID to use for the expansion
     * @param promise A deferred promise to resolve with the children of the node
     * @returns A boolean indicating whether the expansion was successful
     */
    public async expandNode(
        node: TreeNodeInfo,
        sessionId: string,
        promise: Deferred<vscode.TreeItem[]>,
    ): Promise<boolean | undefined> {
        const expandActivity = startActivity(
            TelemetryViews.ObjectExplorer,
            TelemetryActions.ExpandNode,
            undefined,
            {
                nodeType: node.nodeType,
                nodeSubType: node.nodeSubType,
                isRefresh: node.shouldRefresh.toString(),
            },
        );
        this._logger.verbose(`Expanding node ${node.label} with session ID ${sessionId}`);
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
                this._logger.verbose(`Refreshing node ${node.label} with session ID ${sessionId}`);
                response = await this._connectionManager.client.sendRequest(
                    RefreshRequest.type,
                    expandParams,
                );
            } else {
                this._logger.verbose(`Expanding node ${node.label} with session ID ${sessionId}`);
                response = await this._connectionManager.client.sendRequest(
                    ExpandRequest.type,
                    expandParams,
                );
            }

            if (response) {
                const result = await expandResponse;
                this._logger.verbose(
                    `Expand node response: ${JSON.stringify(result)} for sessionId ${sessionId}`,
                );
                if (!result) {
                    promise.resolve(undefined);
                    return undefined;
                }

                if (result.nodes && !result.errorMessage) {
                    this._logger.verbose(
                        `Received ${result.nodes.length} children for node ${node.label} for sessionId ${sessionId}`,
                    );
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
                    expandActivity.end(ActivityStatus.Succeeded, undefined, {
                        childrenCount: children.length,
                    });
                    promise.resolve(children);
                } else {
                    // failure to expand node; display error
                    if (result.errorMessage) {
                        this._logger.error(
                            `Expand node failed: ${result.errorMessage} for sessionId ${sessionId}`,
                        );
                        this._vscodeWrapper.showErrorMessage(result.errorMessage);
                    }
                    const errorNode = new ExpandErrorNode(node, result.errorMessage);
                    this._treeNodeToChildrenMap.set(node, [errorNode]);
                    expandActivity.endFailed(new Error(result.errorMessage), false);
                    promise.resolve([errorNode]);
                }
                return response;
            } else {
                this._logger.error(
                    `Expand node failed: Didn't receive a response from SQL Tools Service for sessionId ${sessionId}`,
                );
                await this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgUnableToExpand);
                promise.resolve(undefined);
                return undefined;
            }
        } finally {
            node.shouldRefresh = false;
        }
    }

    /**
     * Clean all children of the node
     * @param node Node to cleanup
     */
    public cleanNodeChildren(node: vscode.TreeItem): void {
        if (this._treeNodeToChildrenMap.has(node)) {
            let stack = this._treeNodeToChildrenMap.get(node);
            while (stack.length > 0) {
                let child = stack.pop();
                if (this._treeNodeToChildrenMap.has(child)) {
                    stack.push(...this._treeNodeToChildrenMap.get(child));
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
        // Remove any connections that have duplicated IDs
        if (savedConnections.length > 0) {
            const uniqueConnections = new Map<string, IConnectionProfileWithSource>();
            for (const conn of savedConnections) {
                if (!uniqueConnections.has(conn.id)) {
                    uniqueConnections.set(conn.id, conn);
                } else {
                    this._logger.verbose(
                        `Duplicate connection ID found: ${conn.id}. Ignoring duplicate connection.`,
                    );
                }
            }
            savedConnections = Array.from(uniqueConnections.values());
        }
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
    public async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        if (element) {
            return this.getNodeChildren(element);
        } else {
            return this.getRootNodes();
        }
    }

    /**
     * Handle getting root node children.
     * @returns The root node children
     */
    private async getRootNodes(): Promise<vscode.TreeItem[]> {
        const getConnectionActivity = startActivity(
            TelemetryViews.ObjectExplorer,
            TelemetryActions.ExpandNode,
            undefined,
            {
                nodeType: "root",
            },
        );
        let savedConnections = await this._connectionManager.connectionStore.readAllConnections();

        // if there are no saved connections, show the add connection node
        if (savedConnections.length === 0) {
            this._logger.verbose("No saved connections found. Showing add connection node.");
            getConnectionActivity.end(ActivityStatus.Succeeded, undefined, {
                childrenCount: 0,
            });
            return this.getAddConnectionNode();
        }

        let result: TreeNodeInfo[] = [];
        if (this._rootTreeNodeArray) {
            this._logger.verbose("Using cached root tree node array.");
            result = this.sortByServerName(this._rootTreeNodeArray);
        } else {
            this._logger.verbose("Reading saved connections from connection store.");
            this._rootTreeNodeArray = await this.getSavedConnectionNodes();
            this._logger.verbose(`Found ${this._rootTreeNodeArray.length} saved connections.`);
            result = this.sortByServerName(this._rootTreeNodeArray);
        }
        getConnectionActivity.end(ActivityStatus.Succeeded, undefined, {
            nodeCount: result.length,
        });
        return result;
    }

    /**
     * Handles getting children for all nodes other than the root node
     * @param element The node to get children for
     * @returns The children of the node
     */
    private async getNodeChildren(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        if (element.shouldRefresh) {
            this.cleanNodeChildren(element);
        } else {
            if (this._treeNodeToChildrenMap.has(element)) {
                return this._treeNodeToChildrenMap.get(element);
            }
        }
        /**
         * If no children are cached, return a temporary loading node to keep the UI responsive
         * and trigger the async call to fetch real children.
         * This node will be replaced once the data is retrieved and the tree is refreshed.
         * Tree expansion is queued, so without this if multiple connections are expanding,
         * one blocked operation can delay the other.
         */
        void this.getOrCreateNodeChildrenWithSession(element);
        const loadingNode = new vscode.TreeItem(
            LocalizedConstants.ObjectExplorer.LoadingNodeLabel,
            vscode.TreeItemCollapsibleState.None,
        );
        loadingNode.iconPath = new vscode.ThemeIcon("loading~spin");
        this._treeNodeToChildrenMap.set(element, [loadingNode]);
        return [loadingNode];
    }

    /**
     * Get or create the children of a node. If the node has a session ID, expand it.
     * If it doesn't, create a new session and expand it.
     * @param element The node to get or create children for
     * @returns The children of the node
     */
    private async getOrCreateNodeChildrenWithSession(element: TreeNodeInfo): Promise<void> {
        if (element.sessionId) {
            await this.expandExistingNode(element);
        } else {
            await this.createSessionAndExpandNode(element);
        }
        this._refreshCallback(element);
    }

    /**
     * Expand a node that already has a session ID.
     * @param element The node to expand
     * @returns The children of the node
     */
    private async expandExistingNode(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const promise = new Deferred<TreeNodeInfo[]>();
        await this.expandNode(element, element.sessionId, promise);
        const children = await promise;

        if (children) {
            if (children.length === 0) {
                const noItemsNode = [new NoItemsNode(element)];
                this._treeNodeToChildrenMap.set(element, noItemsNode);
                return noItemsNode;
            }
            return children;
        } else {
            return undefined;
        }
    }

    /**
     * Create a new session for the given node and expand it.
     * If the session was not created, show the sign in node.
     * If the session was created but the connected node was not created, show the sign in node.
     * Otherwise, expand the existing node.
     * @param element The node to create a session for and expand
     * @returns The children of the node
     */
    private async createSessionAndExpandNode(element: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const sessionResult = await this.createSession(element.connectionProfile);

        if (sessionResult?.shouldRetryOnFailure) {
            setTimeout(() => void this.reconnectProfile(element.connectionProfile), 0);
            return undefined;
        }

        // if the session was not created, show the sign in node
        if (!sessionResult?.sessionId) {
            return this.createSignInNode(element);
        }

        // If the session was created but the connected node was not created, show sign in node
        if (!sessionResult.connectionNode) {
            return this.createSignInNode(element);
        } else {
            const children = this.expandExistingNode(element);
            setTimeout(() => this._refreshCallback(element), 0);
            return children;
        }
    }

    /**
     * Create an OE session for the given connection credentials
     * otherwise prompt the user to create a new connection profile
     * After the session is created, the connection node is added to the tree
     * @param connectionProfile Connection Credentials for a node
     * @returns The session ID and connection node. If undefined, the session was not created.
     */
    public async createSession(
        connectionInfo?: IConnectionInfo,
    ): Promise<CreateSessionResult | undefined> {
        const createSessionActivity = startActivity(
            TelemetryViews.ObjectExplorer,
            TelemetryActions.CreateSession,
            undefined,
            {
                connectionType: connectionInfo?.authenticationType ?? "newConnection",
            },
            undefined,
        );
        const connectionProfile = await this.prepareConnectionProfile(connectionInfo);

        if (!connectionProfile) {
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
                this._logger.verbose(
                    `Session created successfully for with session ID ${sessionCreationResult.sessionId}`,
                );
                this._pendingSessionCreations.delete(sessionIdResponse.sessionId);
                const successResponse = await this.handleSessionCreationSuccess(
                    sessionCreationResult,
                    connectionProfile,
                );
                createSessionActivity.end(ActivityStatus.Succeeded, {
                    connectionType: connectionProfile.authenticationType,
                });
                return successResponse;
            } else {
                this._logger.error(
                    `Session creation failed with error: ${sessionCreationResult.errorMessage}`,
                );
                const shouldReconnect = await this.handleSessionCreationFailure(
                    sessionCreationResult,
                    connectionProfile,
                    createSessionActivity,
                );
                createSessionActivity.endFailed();
                return {
                    sessionId: undefined,
                    connectionNode: undefined,
                    shouldRetryOnFailure: shouldReconnect,
                };
            }
        } else {
            return undefined;
        }
    }

    /**
     * Prepares the connection profile for session creation.
     * @param connectionInfo The connection info to prepare.
     * @returns The prepared connection profile. If undefined, the connection was not prepared properly.
     */
    private async prepareConnectionProfile(
        connectionInfo?: IConnectionInfo,
    ): Promise<IConnectionProfile | undefined> {
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
            return undefined;
        }

        if (!connectionProfile.id) {
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
                return undefined;
            }
        }

        if (ConnectionCredentials.isPasswordBasedCredential(connectionProfile)) {
            // show password prompt if SQL Login and password isn't saved
            let password = connectionProfile.password;
            if (Utils.isEmpty(password)) {
                if (connectionProfile.savePassword) {
                    password =
                        await this._connectionManager.connectionStore.lookupPassword(
                            connectionProfile,
                        );
                }

                if (!password) {
                    password = await this._connectionManager.connectionUI.promptForPassword();
                    if (!password) {
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
                const isAccountCache = await azureController.isAccountInCache(account);
                if (!isAccountCache) {
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

    /**
     * Handles the success of session creation.
     * @param successResponse The response from the session creation request.
     * @param connectionProfile The connection profile used to create the session.
     * @returns The session ID and corresponding connection node. If undefined, the session was not created.
     */
    private async handleSessionCreationSuccess(
        successResponse: SessionCreatedParameters,
        connectionProfile: IConnectionProfile,
    ) {
        if (!successResponse.success) {
            return;
        }

        let connectionNode = this.getConnectionNodeFromProfile(connectionProfile);

        let isNewConnection = false;
        if (!connectionNode) {
            isNewConnection = true;
            connectionNode = new ConnectionNode(connectionProfile);
            this._rootTreeNodeArray.push(connectionNode);
        } else {
            connectionNode.updateConnectionProfile(connectionProfile);
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
        // remove the sign in node once the session is created
        if (this._treeNodeToChildrenMap.has(connectionNode)) {
            this._treeNodeToChildrenMap.delete(connectionNode);
        }

        return {
            sessionId: successResponse.sessionId,
            connectionNode: this.getConnectionNodeFromProfile(connectionProfile),
        };
    }

    /**
     * Handles the failure of session creation.
     * @param failureResponse The response from the session creation request.
     * @param connectionProfile The connection profile used to create the session.
     * @returns True if the session creation should be retried, false otherwise.
     */
    private async handleSessionCreationFailure(
        failureResponse: SessionCreatedParameters,
        connectionProfile: IConnectionProfile,
        telemetryActivty: ActivityObject,
    ): Promise<boolean> {
        let error = LocalizedConstants.StatusBar.connectErrorLabel;
        let errorNumber: number;
        if (failureResponse.errorNumber) {
            telemetryActivty.update(
                {
                    connectionType: connectionProfile.authenticationType,
                },
                {
                    errorNumber: failureResponse.errorNumber,
                },
            );
            errorNumber = failureResponse.errorNumber;
        }
        if (failureResponse.errorMessage) {
            error += `: ${failureResponse.errorMessage}`;
        }
        if (errorNumber === Constants.errorSSLCertificateValidationFailed) {
            this._logger.verbose("Fixing SSL trust server certificate error.");
            const fixedProfile: IConnectionProfile = (await this._connectionManager.handleSSLError(
                undefined,
                connectionProfile,
            )) as IConnectionProfile;
            telemetryActivty.update({
                connectionType: connectionProfile.authenticationType,
                errorHandled: "trustServerCertificate",
                isFixed: fixedProfile ? "true" : "false",
            });
            if (fixedProfile) {
                const connectionNode = this.getConnectionNodeFromProfile(fixedProfile);
                if (connectionNode) {
                    connectionNode.updateConnectionProfile(fixedProfile);
                }
                return true;
            }
        } else if (ObjectExplorerUtils.isFirewallError(failureResponse.errorNumber)) {
            let handleFirewallResult =
                await this._connectionManager.firewallService.handleFirewallRule(
                    Constants.errorFirewallRule,
                    failureResponse.errorMessage,
                );
            if (handleFirewallResult.result && handleFirewallResult.ipAddress) {
                this._logger.verbose(
                    `Firewall rule added for IP address ${handleFirewallResult.ipAddress}`,
                );
                const isFirewallAdded =
                    await this._connectionManager.connectionUI.handleFirewallError(
                        connectionProfile,
                        failureResponse,
                    );
                telemetryActivty.update({
                    connectionType: connectionProfile.authenticationType,
                    errorHandled: "firewallRule",
                    isFixed: isFirewallAdded ? "true" : "false",
                });
                if (isFirewallAdded) {
                    this._logger.verbose(
                        `Firewall rule added for IP address ${handleFirewallResult.ipAddress}`,
                    );
                } else {
                    this._logger.error(
                        `Firewall rule not added for IP address ${handleFirewallResult.ipAddress}`,
                    );
                }
                return isFirewallAdded;
            }
        } else if (
            connectionProfile.authenticationType === Constants.azureMfa &&
            this.needsAccountRefresh(failureResponse, connectionProfile.user)
        ) {
            this._logger.verbose(`Refreshing account token for ${connectionProfile.accountId}}`);
            let account = this._connectionManager.accountStore.getAccount(
                connectionProfile.accountId,
            );

            const tokenAdded = this.refreshAccount(account, connectionProfile);
            telemetryActivty.update({
                connectionType: connectionProfile.authenticationType,
                errorHandled: "refreshAccount",
                isFixed: tokenAdded ? "true" : "false",
            });
            if (!tokenAdded) {
                this._logger.error(`Token refresh failed for ${connectionProfile.accountId}`);
            } else {
                this._logger.verbose(
                    `Token refreshed successfully for ${connectionProfile.accountId}`,
                );
            }
            return tokenAdded;
        } else {
            this._logger.error("Session creation failed: " + error);
            this._vscodeWrapper.showErrorMessage(error);
        }
        return false;
    }

    /**
     * Refreshes the account token for the given connection credentials.
     * @param account The account to refresh.
     * @param connectionCredentials The connection credentials to refresh.
     * @returns True if the refresh was successful, false if it was cancelled or failed.
     */
    private async refreshAccount(
        account: IAccount,
        connectionCredentials: ConnectionCredentials,
    ): Promise<boolean> {
        const refreshTask = async () => {
            let azureController = this._connectionManager.azureController;
            let profile = new ConnectionProfile(connectionCredentials);
            let azureAccountToken = await azureController.refreshAccessToken(
                account,
                this._connectionManager.accountStore,
                connectionCredentials.tenantId,
                providerSettings.resources.databaseResource,
            );
            if (!azureAccountToken) {
                this._logger.verbose("Access token could not be refreshed for connection profile.");
                let errorMessage = LocalizedConstants.msgAccountRefreshFailed;

                const response = await this._vscodeWrapper.showErrorMessage(
                    errorMessage,
                    LocalizedConstants.refreshTokenLabel,
                );

                if (response === LocalizedConstants.refreshTokenLabel) {
                    let updatedProfile = await azureController.populateAccountProperties(
                        profile,
                        this._connectionManager.accountStore,
                        providerSettings.resources.databaseResource,
                    );
                    connectionCredentials.azureAccountToken = updatedProfile.azureAccountToken;
                    connectionCredentials.expiresOn = updatedProfile.expiresOn;
                } else {
                    this._logger.error("Credentials not refreshed by user.");
                    return undefined;
                }
            } else {
                connectionCredentials.azureAccountToken = azureAccountToken.token;
                connectionCredentials.expiresOn = azureAccountToken.expiresOn;
            }
        };

        return await new Promise<boolean>((resolve, reject) => {
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: LocalizedConstants.ObjectExplorer.AzureSignInMessage,
                    cancellable: true,
                },
                async (progress, token) => {
                    token.onCancellationRequested(() => {
                        this._logger.verbose("Azure sign in cancelled by user.");
                        resolve(false);
                    });
                    try {
                        await refreshTask();
                        resolve(true);
                    } catch (error) {
                        this._logger.error("Error refreshing account: " + error);
                        this._vscodeWrapper.showErrorMessage(error.message);
                        resolve(false);
                    }
                },
            );
        });
    }

    /**
     * Removes a node from the OE tree. It will also disconnect the node from the server before removing it.
     * @param node The connection node to remove.
     * @param showUserConfirmationPrompt Whether to show a confirmation prompt to the user before removing the node.
     */
    public async removeNode(
        node: ConnectionNode,
        showUserConfirmationPrompt: boolean = true,
    ): Promise<void> {
        if (showUserConfirmationPrompt) {
            const response = await vscode.window.showInformationMessage(
                LocalizedConstants.ObjectExplorer.NodeDeletionConfirmation(node.label as string),
                {
                    modal: true,
                },
                LocalizedConstants.ObjectExplorer.NodeDeletionConfirmationYes,
                LocalizedConstants.ObjectExplorer.NodeDeletionConfirmationNo,
            );
            if (response !== LocalizedConstants.ObjectExplorer.NodeDeletionConfirmationYes) {
                return;
            }
        }

        await this.disconnectNode(node);
        const index = this._rootTreeNodeArray.indexOf(node, 0);
        if (index > -1) {
            this._rootTreeNodeArray.splice(index, 1);
        }
        this._refreshCallback(undefined); // Refresh tree root.
        await this._connectionManager.connectionStore.removeProfile(node.connectionProfile, false);
    }

    /**
     * Disconnects a connection node and cleans up its cached children.
     * @param node The connection node to disconnect.
     */
    public async disconnectNode(node: ConnectionNode): Promise<void> {
        await this.closeSession(node);
        const nodeUri = this.getNodeIdentifier(node);
        await this._connectionManager.disconnect(nodeUri);
        this.cleanNodeChildren(node);
        node.updateToDisconnectedState();
        this._treeNodeToChildrenMap.set(node, [new ConnectTreeNode(node)]);
    }

    /**
     * Remove multiple connection nodes from the OE tree.
     * @param connections Connection info of the nodes to remove.
     */
    public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
        for (let conn of connections) {
            for (let node of this._rootTreeNodeArray) {
                if (Utils.isSameConnectionInfo(node.connectionProfile, conn)) {
                    await this.removeNode(node as ConnectionNode, false);
                }
            }
        }
    }

    /**
     * Adds a new disconnected node to the OE tree.
     * @param connectionCredentials The connection credentials for the new node.
     */
    public addDisconnectedNode(connectionCredentials: IConnectionProfile): void {
        const connectionNode = new ConnectionNode(connectionCredentials);
        this.addConnectionNodeAtRightPosition(connectionNode);
    }

    /**
     * Adds a connection node to the OE tree at the right position based on its label.
     * @param connectionNode The connection node to add.
     * This will replace any existing node with the same connection profile.
     */
    private addConnectionNodeAtRightPosition(connectionNode: ConnectionNode): void {
        // Remove any existing node with the same connection profile
        const existingNodeIndex = this._rootTreeNodeArray.findIndex((node) =>
            Utils.isSameConnectionInfo(node.connectionProfile, connectionNode.connectionProfile),
        );
        if (existingNodeIndex !== -1) {
            this._rootTreeNodeArray.splice(existingNodeIndex, 1);
        }

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
     * @param node The node to close the session for
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
                this._logger.error("Session ID mismatch in closeSession() response");
            }

            const nodeUri = this.getNodeIdentifier(node);
            await this._connectionManager.disconnect(nodeUri);
            this.cleanNodeChildren(node);

            return;
        }
    }

    /**
     * Gets a unique identifier for the node.
     * @param node The node to get the identifier for
     * @returns The unique identifier for the node.
     * If the node does not have a session ID, it will return the node URI.
     */
    private getNodeIdentifier(node: TreeNodeInfo): string {
        if (node.sessionId) {
            return node.sessionId;
        } else {
            this._logger.error("Node does not have a session ID");
            return ObjectExplorerUtils.getNodeUri(node); // TODO: can this removed entirely?  ideally, every node has a session ID associated with it
        }
    }

    /**
     * Gets the connection node from the profile.
     * @param connectionProfile The connection profile to get the node for
     * @returns The connection node for the profile, or undefined if not found.
     */
    private getConnectionNodeFromProfile(
        connectionProfile: IConnectionProfile,
    ): ConnectionNode | undefined {
        return this._rootTreeNodeArray.find((node) =>
            Utils.isSameConnectionInfo(node.connectionProfile, connectionProfile),
        ) as ConnectionNode;
    }

    public get rootNodeConnections(): IConnectionInfo[] {
        const connections = this._rootTreeNodeArray.map((node) => node.connectionProfile);
        return connections;
    }
}
