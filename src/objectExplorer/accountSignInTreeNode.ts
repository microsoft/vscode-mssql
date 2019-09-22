/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';
import Constants = require('../constants/constants');
import { TreeNodeInfo } from './treeNodeInfo';

export class AccountSignInTreeNode extends vscode.TreeItem {


    constructor(
        private _parentNode: TreeNodeInfo,
    ) {
        super(LocalizedConstants.msgSignIn, vscode.TreeItemCollapsibleState.None);

        this.command = {
            title: LocalizedConstants.msgSignIn,
            command: Constants.cmdObjectExplorerNodeSignIn,
            arguments: [this]
        };
    }

    public get parentNode(): TreeNodeInfo {
        return this._parentNode;
    }
}
