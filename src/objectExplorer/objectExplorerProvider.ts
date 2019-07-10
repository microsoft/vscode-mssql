/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import { NodeInfo } from '../models/contracts/objectExplorer/nodeInfo';
import { ObjectExplorerService } from './objectExplorerService';

export class TreeNodeInfo extends vscode.TreeItem {

    private _nodePath: string;
    private _nodeStatus: string;
    private _nodeType: string;

    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        nodePath: string,
        nodeStatus: string,
        nodeType: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this._nodePath = nodePath;
        this._nodeStatus = nodeStatus;
        this._nodeType = nodeType;
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
}


export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {

    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private objectExplorerService: ObjectExplorerService;

    constructor(connectionManager: ConnectionManager) {
        this.objectExplorerService = new ObjectExplorerService(connectionManager, this);
    }

    refresh(nodeInfo?: NodeInfo): void {
        this._onDidChangeTreeData.fire(nodeInfo);
    }

    getTreeItem(node: NodeInfo): TreeNodeInfo {
        const treeNodeInfo = new TreeNodeInfo(node.label,
            node.nodeType, vscode.TreeItemCollapsibleState.Collapsed,
            node.nodePath, node.nodeStatus, node.nodeType);
        return treeNodeInfo;
    }

    async getChildren(element?: NodeInfo): Promise<vscode.TreeItem[]> {
        const children = await this.objectExplorerService.getChildren(element);
        if (children) {
            const childrenItems = children.map((child) => {
                return this.getTreeItem(child);
            });
            return Promise.resolve(childrenItems);
        }
    }
}
