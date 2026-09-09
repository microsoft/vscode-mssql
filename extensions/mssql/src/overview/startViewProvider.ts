/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { newDeployment, Overview } from "../constants/locConstants";
import { IconUtils } from "../utils/iconUtils";

/** Definition of one row in the Start view. */
interface StartViewEntry {
    label: string;
    description: string;
    /** Command run when the row is selected. */
    command: string;
    icon: vscode.TreeItem["iconPath"];
    /** Value matched by `view/item/context` clauses. */
    contextValue: string;
}

/** A selectable row in the Start view. */
export class StartViewNode extends vscode.TreeItem {
    constructor(entry: StartViewEntry) {
        super(entry.label, vscode.TreeItemCollapsibleState.None);
        this.description = entry.description;
        this.tooltip = entry.description;
        this.contextValue = entry.contextValue;
        this.iconPath = entry.icon;
        this.command = { title: entry.label, command: entry.command };
    }
}

/**
 * Backs the Start view that sits above Connections in the SQL Server container. The rows are
 * static shortcuts into extension pages, so the tree never changes and needs no refresh event.
 */
export class StartViewProvider implements vscode.TreeDataProvider<StartViewNode> {
    private getEntries(): StartViewEntry[] {
        return [
            {
                label: Overview.OverviewTreeNodeLabel,
                description: Overview.OverviewTreeNodeDescription,
                command: Constants.cmdOpenOverview,
                contextValue: "overview",
                icon: {
                    light: IconUtils.getIcon("applicationQuickStart_light.svg"),
                    dark: IconUtils.getIcon("applicationQuickStart_dark.svg"),
                },
            },
            {
                label: newDeployment,
                description: Overview.DeploymentTreeNodeDescription,
                command: Constants.cmdDeployNewDatabase,
                contextValue: "newDeployment",
                icon: {
                    light: IconUtils.getIcon("newContainer_light.svg"),
                    dark: IconUtils.getIcon("newContainer_dark.svg"),
                },
            },
            {
                label: Overview.ShortcutsTreeNodeLabel,
                description: Overview.ShortcutsTreeNodeDescription,
                command: Constants.cmdOpenShortcutsConfiguration,
                contextValue: "shortcutsConfiguration",
                icon: new vscode.ThemeIcon("keyboard"),
            },
        ];
    }

    public getTreeItem(element: StartViewNode): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: StartViewNode): StartViewNode[] {
        return element ? [] : this.getEntries().map((entry) => new StartViewNode(entry));
    }

    public getParent(): undefined {
        return undefined;
    }
}
