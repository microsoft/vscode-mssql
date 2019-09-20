/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as LocalizedConstants from '../constants/localizedConstants';

export class AddConnectionTreeNode extends vscode.TreeItem {

    constructor() {
        super('Add Connection', vscode.TreeItemCollapsibleState.None);
        this.command = {
            title: 'add connection',
            command: 'extension.addObjectExplorer'
        }
    }
}
