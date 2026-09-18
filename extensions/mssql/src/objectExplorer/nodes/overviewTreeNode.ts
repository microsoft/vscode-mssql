/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { Overview } from "../../constants/locConstants";
import { OverviewOpenSource } from "../../sharedInterfaces/overview";

/** Opens the Overview page from the root of the Connections view. */
export class OverviewTreeNode extends vscode.TreeItem {
    constructor() {
        super(Overview.OverviewTreeNodeLabel, vscode.TreeItemCollapsibleState.None);
        this.description = Overview.OverviewTreeNodeDescription;
        this.tooltip = Overview.OverviewTreeNodeDescription;
        this.contextValue = "overview";
        this.command = {
            title: Overview.OverviewTreeNodeLabel,
            command: Constants.cmdOpenOverview,
            arguments: [{ source: OverviewOpenSource.TreeNode }],
        };
        this.iconPath = new vscode.ThemeIcon("rocket");
    }
}
