/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { AddConnectionTreeNode } from "../objectExplorer/nodes/addConnectionTreeNode";
import { AddLocalContainerConnectionTreeNode } from "./addLocalContainerConnectionTreeNode";

export class NewConnectionProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<
        any | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    public getTreeItem(node: vscode.TreeItem): vscode.TreeItem {
        return node;
    }

    public async getChildren(): Promise<vscode.TreeItem[]> {
        return [new AddConnectionTreeNode(), new AddLocalContainerConnectionTreeNode()];
    }
}
