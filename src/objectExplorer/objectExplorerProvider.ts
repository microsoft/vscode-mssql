/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import { NodeInfo } from '../models/contracts/objectExplorer/nodeInfo';
import { ObjectExplorerService } from './objectExplorerService';
import { ConnectionCredentials } from '../models/connectionCredentials';

export class TreeNodeInfo extends vscode.TreeItem {

    private _nodePath: string;
    private _nodeStatus: string;
    private _nodeType: string;
    private _nodeSubType: string;
    private _isLeaf: boolean;
    private _errorMessage: string;
    private _sessionId: string;

    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        nodePath: string,
        nodeStatus: string,
        nodeType: string,
        sessionId: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this._nodePath = nodePath;
        this._nodeStatus = nodeStatus;
        this._nodeType = nodeType;
        this._sessionId = sessionId;
    }

    public static fromNodeInfo(nodeInfo: NodeInfo, sessionId: string): TreeNodeInfo {
        const treeNodeInfo = new TreeNodeInfo(nodeInfo.label, nodeInfo.nodeType,
            vscode.TreeItemCollapsibleState.Collapsed, nodeInfo.nodePath, nodeInfo.nodeStatus,
            nodeInfo.nodeType, sessionId);
        return treeNodeInfo;
    }

    /** Getters */
    public get nodePath(): string {
        return this._nodePath;
    }

    public get nodeStatus(): string {
        return this._nodeStatus;
    }

    public get nodeType(): string {
        return this._nodeType;
    }

    public get sessionId(): string {
        return this._sessionId;
    }

    public get nodeSubType(): string {
        return this._nodeSubType;
    }

    public get isLeaf(): boolean {
        return this._isLeaf;
    }

    public get errorMessage(): string {
        return this._errorMessage;
    }

    /** Setters */
    public set nodePath(value: string) {
        this._nodePath = value;
    }

    public set nodeStatus(value: string) {
        this._nodeStatus = value;
    }

    public set nodeType(value: string) {
        this._nodeType = value;
    }

    public set nodeSubType(value: string) {
        this._nodeSubType = value;
    }

    public set isLeaf(value: boolean) {
        this._isLeaf = value;
    }

    public set errorMessage(value: string) {
        this._errorMessage = value;
    }

    public set sessionId(value: string) {
        this._sessionId = value;
    }
}

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

    getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const children = this._objectExplorerService.getChildren(element);
        if (children) {
            return Promise.resolve(children);
        }
    }

    async createSession(): Promise<string> {
        return await this._objectExplorerService.createSession();
    }

    public getConnectionCredentials(sessionId: string): ConnectionCredentials {
        return this._objectExplorerService.getConnectionCredentials(sessionId);
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
}
