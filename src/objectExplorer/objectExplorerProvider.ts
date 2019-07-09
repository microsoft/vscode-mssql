/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import ConnectionManager from '../controllers/connectionManager';
import { NodeInfo } from '../models/contracts/objectExplorer/nodeInfo';
import { ObjectExplorerService } from './objectExplorerService';

export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {

    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<any | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    private objectExplorerService: ObjectExplorerService;

    constructor(connectionManager: ConnectionManager) {
        this.objectExplorerService = new ObjectExplorerService(connectionManager, this);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: NodeInfo): vscode.TreeItem {
        const item: vscode.TreeItem = {
            label: node.label,
            contextValue: node.nodeType,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
        return item;
    }

    async getChildren(element?: NodeInfo): Promise<vscode.TreeItem[]> {
        const children = await this.objectExplorerService.getChildren(element);
        if (children) {
            const childrenItems = children.map(child => this.getTreeItem(child));
            return Promise.resolve(childrenItems);
        }
    }
}
