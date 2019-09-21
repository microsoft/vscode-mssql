/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import { ObjectExplorerService } from './objectExplorerService';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { TreeNodeInfo } from './treeNodeInfo';

export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {

    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private _objectExplorerExists: boolean;
    private _objectExplorerService: ObjectExplorerService;
    public isRefresh: boolean = true;

    constructor(connectionManager: ConnectionManager) {
        this._objectExplorerService = new ObjectExplorerService(connectionManager, this);
    }

    refresh(nodeInfo?: TreeNodeInfo): void {
        this.isRefresh = nodeInfo ? true : false;
        this._onDidChangeTreeData.fire(nodeInfo);
    }

    getTreeItem(node: TreeNodeInfo): TreeNodeInfo {
        return node;
    }

    async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        // ask for password here maybe?
        const children = await this._objectExplorerService.getChildren(element);
        if (children) {
            return children;
        }
    }

    async createSession(): Promise<void> {
        return this._objectExplorerService.createSession();
    }

    public getConnectionCredentials(sessionId: string): ConnectionCredentials {
        if (sessionId) {
            return this._objectExplorerService.getConnectionCredentials(sessionId);
        }
        return undefined;
    }

    public removeObjectExplorerNode(node: TreeNodeInfo): Promise<void> {
        return this._objectExplorerService.removeObjectExplorerNode(node);
    }

    public refreshNode(node: TreeNodeInfo): Promise<boolean> {
        return this._objectExplorerService.refreshNode(node);
    }

    /** Getters */
    public get currentNode(): TreeNodeInfo {
        return this._objectExplorerService.currentNode;
    }

    public get objectExplorerExists(): boolean {
        return this._objectExplorerExists;
    }

    /** Setters */
    public set objectExplorerExists(value: boolean) {
        this._objectExplorerExists = value;
    }

    /* Only for testing purposes */
    public set objectExplorerService(value: ObjectExplorerService) {
        this._objectExplorerService = value;
    }
}
