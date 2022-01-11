/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import { ObjectExplorerService } from './objectExplorerService';
import { TreeNodeInfo } from './treeNodeInfo';
import { Deferred } from '../protocol';
import { IConnectionInfo } from 'vscode-mssql';

export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {

	private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
	readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

	private _objectExplorerExists: boolean;
	private _objectExplorerService: ObjectExplorerService;

	constructor(connectionManager: ConnectionManager) {
		this._objectExplorerService = new ObjectExplorerService(connectionManager, this);
	}

	refresh(nodeInfo?: TreeNodeInfo): void {
		this._onDidChangeTreeData.fire(nodeInfo);
	}

	getTreeItem(node: TreeNodeInfo): TreeNodeInfo {
		return node;
	}

	async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
		const children = await this._objectExplorerService.getChildren(element);
		if (children) {
			return children;
		}
	}

	async createSession(promise: Deferred<TreeNodeInfo>, connectionCredentials?: IConnectionInfo, context?: vscode.ExtensionContext): Promise<string> {
		return this._objectExplorerService.createSession(promise, connectionCredentials, context);
	}

	public async expandNode(node: TreeNodeInfo, sessionId: string, promise: Deferred<TreeNodeInfo[]>): Promise<boolean> {
		return this._objectExplorerService.expandNode(node, sessionId, promise);
	}

	public getConnectionCredentials(sessionId: string): IConnectionInfo {
		if (sessionId) {
			return this._objectExplorerService.getConnectionCredentials(sessionId);
		}
		return undefined;
	}

	public async removeObjectExplorerNode(node: TreeNodeInfo, isDisconnect: boolean = false): Promise<void> {
		return this._objectExplorerService.removeObjectExplorerNode(node, isDisconnect);
	}

	public async refreshNode(node: TreeNodeInfo): Promise<void> {
		return this._objectExplorerService.refreshNode(node);
	}

	public signInNodeServer(node: TreeNodeInfo): void {
		this._objectExplorerService.signInNodeServer(node);
	}

	public updateNode(node: TreeNodeInfo): void {
		this._objectExplorerService.updateNode(node);
	}

	public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
		await this._objectExplorerService.removeConnectionNodes(connections);
	}

	public addDisconnectedNode(connectionCredentials: IConnectionInfo): void {
		this._objectExplorerService.addDisconnectedNode(connectionCredentials);
	}

	/** Getters */
	public get currentNode(): TreeNodeInfo {
		return this._objectExplorerService.currentNode;
	}

	public get objectExplorerExists(): boolean {
		return this._objectExplorerExists;
	}

	public get rootNodeConnections(): IConnectionInfo[] {
		return this._objectExplorerService.rootNodeConnections;
	}

	/** Setters */
	public set objectExplorerExists(value: boolean) {
		this._objectExplorerExists = value;
	}

	/* Only for testing purposes */
	public set objectExplorerService(value: ObjectExplorerService) {
		this._objectExplorerService = value;
	}

	public set currentNode(node: TreeNodeInfo) {
		this._objectExplorerService.currentNode = node;
	}
}
