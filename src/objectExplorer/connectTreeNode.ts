/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as Constants from '../constants/constants';
import { TreeNodeInfo } from './treeNodeInfo';

export class ConnectTreeNode extends vscode.TreeItem {

    constructor(
        private _parentNode: TreeNodeInfo
    ) {
        super(LocalizedConstants.msgConnect, vscode.TreeItemCollapsibleState.None);

        this.command = {
            title: LocalizedConstants.msgConnect,
            command: Constants.cmdConnectObjectExplorerNode,
            arguments: [this]
        };
    }

    public get parentNode(): TreeNodeInfo {
        return this._parentNode;
    }
}
