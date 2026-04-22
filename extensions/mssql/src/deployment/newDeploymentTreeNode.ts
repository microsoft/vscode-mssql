/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

export class NewDeploymentTreeNode extends vscode.TreeItem {
    constructor(parent?: vscode.TreeItem) {
        super(LocalizedConstants.newDeployment, vscode.TreeItemCollapsibleState.None);
        this.command = {
            title: LocalizedConstants.newDeployment,
            command: Constants.cmdDeployNewDatabase,
            arguments: parent ? [parent] : undefined,
        };
        this.iconPath = {
            light: ObjectExplorerUtils.iconPath("add_light"),
            dark: ObjectExplorerUtils.iconPath("add_dark"),
        };
    }
}
