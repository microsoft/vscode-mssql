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
    private _isRichExperienceEnabled: boolean = true;

    constructor(isRichExperienceEnabled: boolean) {
        this._isRichExperienceEnabled = isRichExperienceEnabled;
    }

    public getTreeItem(node: vscode.TreeItem): vscode.TreeItem {
        return node;
    }

    public async getChildren(): Promise<vscode.TreeItem[]> {
        if (!this._isRichExperienceEnabled) return [new AddConnectionTreeNode()];
        return [new AddConnectionTreeNode(), new AddLocalContainerConnectionTreeNode()];
    }
}
