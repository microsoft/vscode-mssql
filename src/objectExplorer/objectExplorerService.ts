/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import ConnectionManager from '../controllers/connectionManager';
import { CreateSessionCompleteNotification, SessionCreatedParameters, CreateSessionRequest, CreateSessionResponse } from '../models/contracts/objectExplorer/createSessionRequest';
import { NotificationHandler } from 'vscode-languageclient';
import { ExpandRequest, ExpandParams, ExpandCompleteNotification, ExpandResponse } from '../models/contracts/objectExplorer/expandNodeRequest';
import { ObjectExplorerProvider } from './objectExplorerProvider';
import { TreeItemCollapsibleState } from 'vscode';
import { RefreshRequest, RefreshParams } from '../models/contracts/objectExplorer/refreshSessionRequest';
import { CloseSessionRequest, CloseSessionParams, CloseSessionResponse } from '../models/contracts/objectExplorer/closeSessionRequest';
import { TreeNodeInfo } from './treeNodeInfo';
import { AuthenticationTypes, IConnectionProfile } from '../models/interfaces';
import * as LocalizedConstants from '../constants/localizedConstants';
import { AddConnectionTreeNode } from './addConnectionTreeNode';
import { AccountSignInTreeNode } from './accountSignInTreeNode';
import { ConnectTreeNode, TreeNodeType } from './connectTreeNode';
import { Deferred } from '../protocol';
import * as Constants from '../constants/constants';
import { ObjectExplorerUtils } from './objectExplorerUtils';
import * as Utils from '../models/utils';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ConnectionProfile } from '../models/connectionProfile';
import providerSettings from '../azure/providerSettings';
import { IConnectionInfo } from 'vscode-mssql';

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
	private _currentNode: TreeNodeInfo;
	private _treeNodeToChildrenMap: Map<vscode.TreeItem, vscode.TreeItem[]>;
	private _nodePathToNodeLabelMap: Map<string, string>;
	private _rootTreeNodeArray: Array<TreeNodeInfo>;
	private _sessionIdToConnectionCredentialsMap: Map<string, IConnectionInfo>;
	private _expandParamsToTreeNodeInfoMap: Map<ExpandParams, TreeNodeInfo>;

	// Deferred promise maps
	private _sessionIdToPromiseMap: Map<string, Deferred<vscode.TreeItem>>;
	private _expandParamsToPromiseMap: Map<ExpandParams, Deferred<TreeNodeInfo[]>>;

	constructor(private _connectionManager: ConnectionManager,
		private _objectExplorerProvider: ObjectExplorerProvider) {
		this._client = this._connectionManager.client;
		this._treeNodeToChildrenMap = new Map<vscode.TreeItem, vscode.TreeItem[]>();
		this._rootTreeNodeArray = new Array<TreeNodeInfo>();
		this._sessionIdToConnectionCredentialsMap = new Map<string, IConnectionInfo>();
		this._nodePathToNodeLabelMap = new Map<string, string>();
		this._sessionIdToPromiseMap = new Map<string, Deferred<vscode.TreeItem>>();
		this._expandParamsToPromiseMap = new Map<ExpandParams, Deferred<TreeNodeInfo[]>>();
		this._expandParamsToTreeNodeInfoMap = new Map<ExpandParams, TreeNodeInfo>();

		this._client.onNotification(CreateSessionCompleteNotification.type,
			this.handleSessionCreatedNotification());
		this._client.onNotification(ExpandCompleteNotification.type,
			this.handleExpandSessionNotification());
	}

	private handleSessionCreatedNotification(): NotificationHandler<SessionCreatedParameters> {
		const self = this;
		const handler = async (result: SessionCreatedParameters) => {
			if (self._currentNode instanceof ConnectTreeNode) {
				self.currentNode = getParentNode(self.currentNode);
			}
			if (result.success) {
				let nodeLabel = this._nodePathToNodeLabelMap.get(result.rootNode.nodePath);
				// if no node label, check if it has a name in saved profiles
				// in case this call came from new query
				let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
				let nodeConnection = this._sessionIdToConnectionCredentialsMap.get(result.sessionId);
				for (let connection of savedConnections) {
					if (Utils.isSameConnection(connection.connectionCreds, nodeConnection)) {
						// if it's not the defaul label
						if (connection.label !== connection.connectionCreds.server) {
							nodeLabel = connection.label;
						}
						break;
					}
				}
				// set connection and other things
				let node: TreeNodeInfo;

				if (self._currentNode && (self._currentNode.sessionId === result.sessionId)) {
					nodeLabel = !nodeLabel ? self.createNodeLabel(self._currentNode.connectionInfo) : nodeLabel;
					node = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId,
						undefined, self._currentNode.connectionInfo, nodeLabel, Constants.serverLabel);
				} else {
					nodeLabel = !nodeLabel ? self.createNodeLabel(nodeConnection) : nodeLabel;
					node = TreeNodeInfo.fromNodeInfo(result.rootNode, result.sessionId,
						undefined, nodeConnection, nodeLabel, Constants.serverLabel);
				}
				// make a connection if not connected already
				const nodeUri = ObjectExplorerUtils.getNodeUri(node);
				if (!this._connectionManager.isConnected(nodeUri) &&
					!this._connectionManager.isConnecting(nodeUri)) {
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
					self._currentNode.connectionInfo.password = '';
				}
				let error = LocalizedConstants.connectErrorLabel;
				let errorNumber: number;
				if (result.errorNumber) {
					errorNumber = result.errorNumber;
				}
				if (result.errorMessage) {
					error += ` : ${result.errorMessage}`;
				}

				if (errorNumber === Constants.errorSSLCertificateValidationFailed) {
					self._connectionManager.showInstructionTextAsWarning(self._currentNode.connectionInfo,
						async updatedProfile => {
							self.currentNode.connectionInfo = updatedProfile;
							self.updateNode(self._currentNode);
							let fileUri = ObjectExplorerUtils.getNodeUri(self._currentNode);
							if (await self._connectionManager.connectionStore.saveProfile(updatedProfile as IConnectionProfile)) {
								const res = await self._connectionManager.connect(fileUri, updatedProfile);
								if (await self._connectionManager.handleConnectionResult(res, fileUri, updatedProfile)) {
									self.refreshNode(self._currentNode);
								}
							} else {
								self._connectionManager.vscodeWrapper.showErrorMessage(LocalizedConstants.msgPromptProfileUpdateFailed);
							}
						});
				} else {
					self._connectionManager.vscodeWrapper.showErrorMessage(error);
				}
				const promise = self._sessionIdToPromiseMap.get(result.sessionId);

				// handle session failure because of firewall issue
				if (ObjectExplorerUtils.isFirewallError(result.errorMessage)) {
					let handleFirewallResult = await self._connectionManager.firewallService.handleFirewallRule
						(Constants.errorFirewallRule, result.errorMessage);
					if (handleFirewallResult.result && handleFirewallResult.ipAddress) {
						const nodeUri = ObjectExplorerUtils.getNodeUri(self._currentNode);
						const profile = <IConnectionProfile>self._currentNode.connectionInfo;
						self.updateNode(self._currentNode);
						self._connectionManager.connectionUI.handleFirewallError(nodeUri, profile, handleFirewallResult.ipAddress);
					}
				}
				if (promise) {
					return promise.resolve(undefined);
				}
			}
		};
		return handler;
	}

	private getParentFromExpandParams(params: ExpandParams): TreeNodeInfo | undefined {
		for (let key of this._expandParamsToTreeNodeInfoMap.keys()) {
			if (key.sessionId === params.sessionId &&
				key.nodePath === params.nodePath) {
				return this._expandParamsToTreeNodeInfoMap.get(key);
			}
		}
		return undefined;
	}

	private handleExpandSessionNotification(): NotificationHandler<ExpandResponse> {
		const self = this;
		const handler = (result: ExpandResponse) => {
			if (result && result.nodes) {
				const credentials = self._sessionIdToConnectionCredentialsMap.get(result.sessionId);
				const expandParams: ExpandParams = {
					sessionId: result.sessionId,
					nodePath: result.nodePath
				};
				const parentNode = self.getParentFromExpandParams(expandParams);
				const children = result.nodes.map(node => TreeNodeInfo.fromNodeInfo(node, result.sessionId,
					parentNode, credentials));
				self._treeNodeToChildrenMap.set(parentNode, children);
				for (let key of self._expandParamsToPromiseMap.keys()) {
					if (key.sessionId === expandParams.sessionId &&
						key.nodePath === expandParams.nodePath) {
						let promise = self._expandParamsToPromiseMap.get(key);
						promise.resolve(children);
						self._expandParamsToPromiseMap.delete(key);
						self._expandParamsToTreeNodeInfoMap.delete(key);
						return;
					}
				}
			}
		};
		return handler;
	}

	public async expandNode(node: TreeNodeInfo, sessionId: string, promise: Deferred<TreeNodeInfo[]>): Promise<boolean | undefined> {
		const expandParams: ExpandParams = {
			sessionId: sessionId,
			nodePath: node.nodePath
		};
		this._expandParamsToPromiseMap.set(expandParams, promise);
		this._expandParamsToTreeNodeInfoMap.set(expandParams, node);
		const response: boolean = await this._connectionManager.client.sendRequest(ExpandRequest.type, expandParams);
		if (response) {
			return response;
		} else {
			await this._connectionManager.vscodeWrapper.showErrorMessage(LocalizedConstants.msgUnableToExpand);
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
			if (Utils.isSameConnection(node.connectionInfo, rootTreeNode.connectionInfo) &&
				rootTreeNode.label === node.label) {
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
			const labelA = typeof a.label === 'string' ? a.label : a.label.label;
			const labelB = typeof b.label === 'string' ? b.label : b.label.label;
			return (labelA).toLowerCase().localeCompare(labelB.toLowerCase());

		});
		return sortedNodeArray;
	}

	/**
	 * Get nodes from saved connections
	 */
	private getSavedConnections(): void {
		let savedConnections = this._connectionManager.connectionStore.loadAllConnections();
		for (const conn of savedConnections) {
			let nodeLabel = conn.label === conn.connectionCreds.server ?
				this.createNodeLabel(conn.connectionCreds) : conn.label;
			this._nodePathToNodeLabelMap.set(conn.connectionCreds.server, nodeLabel);
			let node = new TreeNodeInfo(nodeLabel,
				Constants.disconnectedServerLabel,
				TreeItemCollapsibleState.Collapsed,
				undefined, undefined, Constants.disconnectedServerLabel,
				undefined, conn.connectionCreds, undefined);
			this._rootTreeNodeArray.push(node);
		}
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
				this._expandParamsToTreeNodeInfoMap.delete(key);
			}
		}
	}

	/**
	 * Helper to show the Add Connection node
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

	/**
	 * Handles a connection error after an OE session is
	 * sucessfully created by creating a connect node
	 */
	private createConnectTreeNode(element: TreeNodeInfo): ConnectTreeNode[] {
		const connectNode = new ConnectTreeNode(element);
		this._treeNodeToChildrenMap.set(element, [connectNode]);
		return [connectNode];
	}

	async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
		if (element) {
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
						return children;
					} else {
						return undefined;
					}
				} else {
					// start node session
					let promise = new Deferred<TreeNodeInfo>();
					const sessionId = await this.createSession(promise, element.connectionInfo);
					if (sessionId) {
						let node = await promise;
						// if the server was found but connection failed
						if (!node) {
							let profile = element.connectionInfo as IConnectionProfile;
							let password = await this._connectionManager.connectionStore.lookupPassword(profile);
							if (password) {
								return this.createSignInNode(element);
							} else {
								return this.createConnectTreeNode(element);
							}
						}
					} else {
						// If node create session failed (server wasn't found)
						return this.createSignInNode(element);
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
			// if there are no saved connections
			// show the add connection node
			if (savedConnections.length === 0) {
				return this.getAddConnectionNode();
			}
			// if OE doesn't exist the first time
			// then build the nodes off of saved connections
			if (!this._objectExplorerProvider.objectExplorerExists) {
				// if there are actually saved connections
				this._rootTreeNodeArray = [];
				this.getSavedConnections();
				this._objectExplorerProvider.objectExplorerExists = true;
				return this.sortByServerName(this._rootTreeNodeArray);
			} else {
				// otherwise returned the cached nodes
				return this.sortByServerName(this._rootTreeNodeArray);
			}
		}
	}

	/**
	 * Create an OE session for the given connection credentials
	 * otherwise prompt the user to select a connection to make an
	 * OE out of
	 * @param connectionCredentials Connection Credentials for a node
	 */
	public async createSession(promise: Deferred<vscode.TreeItem | undefined>, connectionCredentials?: IConnectionInfo,
		context?: vscode.ExtensionContext): Promise<string> {
		if (!connectionCredentials) {
			const connectionUI = this._connectionManager.connectionUI;
			connectionCredentials = await connectionUI.createAndSaveProfile();
		}
		if (connectionCredentials) {
			// connection string based credential
			if (connectionCredentials.connectionString) {
				if ((connectionCredentials as IConnectionProfile).savePassword) {
					// look up connection string
					let connectionString = await this._connectionManager.connectionStore.lookupPassword(connectionCredentials, true);
					connectionCredentials.connectionString = connectionString;
				}
			} else {
				if (ConnectionCredentials.isPasswordBasedCredential(connectionCredentials)) {
					// show password prompt if SQL Login and password isn't saved
					let password = connectionCredentials.password;
					if (Utils.isEmpty(password)) {
						// if password isn't saved
						if (!(<IConnectionProfile>connectionCredentials).savePassword) {
							// prompt for password
							password = await this._connectionManager.connectionUI.promptForPassword();
							if (!password) {
								promise.resolve(undefined);
								return undefined;
							}
						} else {
							// look up saved password
							password = await this._connectionManager.connectionStore.lookupPassword(connectionCredentials);
							if (connectionCredentials.authenticationType !== Constants.azureMfa) {
								connectionCredentials.azureAccountToken = undefined;
							}
						}
						connectionCredentials.password = password;
					}
				} else if (connectionCredentials.authenticationType === Utils.authTypeToString(AuthenticationTypes.Integrated)) {
					connectionCredentials.azureAccountToken = undefined;
				} else if (connectionCredentials.authenticationType === Constants.azureMfa) {
					let azureController = this._connectionManager.azureController;
					let account = this._connectionManager.accountStore.getAccount(connectionCredentials.accountId);
					let profile = new ConnectionProfile(connectionCredentials);
					if (azureController.isSqlAuthProviderEnabled()) {
						this._client.logger.verbose('SQL Authentication provider is enabled for Azure MFA connections, skipping token acquiry in extension.');
						connectionCredentials.user = account.displayInfo.displayName;
						connectionCredentials.email = account.displayInfo.email;
					} else if (!connectionCredentials.azureAccountToken) {
						let azureAccountToken = await azureController.refreshAccessToken(
							account, this._connectionManager.accountStore, connectionCredentials.tenantId, providerSettings.resources.databaseResource);
						if (!azureAccountToken) {
							this._client.logger.verbose('Access token could not be refreshed for connection profile.');
							let errorMessage = LocalizedConstants.msgAccountRefreshFailed;
							await this._connectionManager.vscodeWrapper.showErrorMessage(
								errorMessage, LocalizedConstants.refreshTokenLabel).then(async result => {
									if (result === LocalizedConstants.refreshTokenLabel) {
										let updatedProfile = await azureController.populateAccountProperties(
											profile, this._connectionManager.accountStore, providerSettings.resources.databaseResource);
										connectionCredentials.azureAccountToken = updatedProfile.azureAccountToken;
										connectionCredentials.expiresOn = updatedProfile.expiresOn;
									} else {
										this._client.logger.error('Credentials not refreshed by user.');
										return undefined;
									}
								});
						} else {
							connectionCredentials.azureAccountToken = azureAccountToken.token;
							connectionCredentials.expiresOn = azureAccountToken.expiresOn;
						}
					}
				}
			}
			const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCredentials);
			const response: CreateSessionResponse = await this._connectionManager.client.sendRequest(CreateSessionRequest.type, connectionDetails);
			if (response) {
				this._sessionIdToConnectionCredentialsMap.set(response.sessionId, connectionCredentials);
				this._sessionIdToPromiseMap.set(response.sessionId, promise);
				return response.sessionId;
			} else {
				this._client.logger.error('No response received for session creation request');
			}
		} else {
			this._client.logger.error('Connection could not be made, as credentials not available.');
			// no connection was made
			promise.resolve(undefined);
			return undefined;
		}
	}

	public getConnectionCredentials(sessionId: string): IConnectionInfo {
		if (this._sessionIdToConnectionCredentialsMap.has(sessionId)) {
			return this._sessionIdToConnectionCredentialsMap.get(sessionId);
		}
		return undefined;
	}

	public async removeObjectExplorerNode(node: TreeNodeInfo, isDisconnect: boolean = false): Promise<void> {
		await this.closeSession(node);
		const nodeUri = ObjectExplorerUtils.getNodeUri(node);
		await this._connectionManager.disconnect(nodeUri);
		if (!isDisconnect) {
			const index = this._rootTreeNodeArray.indexOf(node, 0);
			if (index > -1) {
				this._rootTreeNodeArray.splice(index, 1);
			}

		} else {
			node.nodeType = Constants.disconnectedServerLabel;
			node.contextValue = Constants.disconnectedServerLabel;
			node.sessionId = undefined;
			if (!(<IConnectionProfile>node.connectionInfo).savePassword) {
				node.connectionInfo.password = '';
			}
			const label = typeof node.label === 'string' ? node.label : node.label.label;
			// make a new node to show disconnected behavior
			let disconnectedNode = new TreeNodeInfo(label, Constants.disconnectedServerLabel,
				node.collapsibleState, node.nodePath, node.nodeStatus, Constants.disconnectedServerLabel,
				undefined, node.connectionInfo, node.parentNode);

			this.updateNode(disconnectedNode);
			this._currentNode = disconnectedNode;
			this._treeNodeToChildrenMap.set(this._currentNode, [new ConnectTreeNode(this._currentNode)]);
		}
		this._nodePathToNodeLabelMap.delete(node.nodePath);
		this.cleanNodeChildren(node);
	}

	public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
		for (let conn of connections) {
			for (let node of this._rootTreeNodeArray) {
				if (Utils.isSameConnection(node.connectionInfo, conn)) {
					await this.removeObjectExplorerNode(node);
				}
			}
		}
	}

	public async refreshNode(node: TreeNodeInfo): Promise<void> {
		const refreshParams: RefreshParams = {
			sessionId: node.sessionId,
			nodePath: node.nodePath
		};
		let response = await this._connectionManager.client.sendRequest(RefreshRequest.type, refreshParams);
		if (response) {
			this._treeNodeToChildrenMap.delete(node);
		}
		return this._objectExplorerProvider.refresh(node);
	}

	public signInNodeServer(node: TreeNodeInfo): void {
		if (this._treeNodeToChildrenMap.has(node)) {
			this._treeNodeToChildrenMap.delete(node);
		}
	}

	public addDisconnectedNode(connectionCredentials: IConnectionInfo): void {
		const label = (<IConnectionProfile>connectionCredentials).profileName ?
			(<IConnectionProfile>connectionCredentials).profileName :
			this.createNodeLabel(connectionCredentials);
		const node = new TreeNodeInfo(label, Constants.disconnectedServerLabel,
			vscode.TreeItemCollapsibleState.Collapsed, undefined, undefined,
			Constants.disconnectedServerLabel, undefined, connectionCredentials,
			undefined);
		this.updateNode(node);
	}

	private createNodeLabel(credentials: IConnectionInfo): string {
		let database = credentials.database;
		const server = credentials.server;
		const authType = credentials.authenticationType;
		let userOrAuthType = authType;
		if (authType === Constants.sqlAuthentication) {
			userOrAuthType = credentials.user;
		}
		if (authType === Constants.azureMfa) {
			userOrAuthType = credentials.email;
		}
		if (!database || database === '') {
			database = LocalizedConstants.defaultDatabaseLabel;
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
			const response: CloseSessionResponse = await this._connectionManager.client.sendRequest(CloseSessionRequest.type,
				closeSessionParams);
			if (response && response.success) {
				this._sessionIdToConnectionCredentialsMap.delete(response.sessionId);
				if (this._sessionIdToPromiseMap.has(node.sessionId)) {
					this._sessionIdToPromiseMap.delete(node.sessionId);
				}
				const nodeUri = ObjectExplorerUtils.getNodeUri(node);
				await this._connectionManager.disconnect(nodeUri);
				this.cleanNodeChildren(node);
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

	public get rootNodeConnections(): IConnectionInfo[] {
		const connections = this._rootTreeNodeArray.map(node => node.connectionInfo);
		return connections;
	}

	/**
	 * Setters
	 */
	public set currentNode(node: TreeNodeInfo) {
		this._currentNode = node;
	}
}
