/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TreeNodeInfo } from "./treeNodeInfo";
import { ObjectExplorerTask } from "../objectExplorerTask";

export class ObjectExplorerLoadingNode extends vscode.TreeItem {
    public static readonly nodeType = "ObjectExplorerLoading";
    public readonly parentNode: TreeNodeInfo;
    public readonly taskId?: string;

    constructor(parentNode: TreeNodeInfo, label: string, task?: ObjectExplorerTask) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.parentNode = parentNode;
        this.taskId = task?.id;
        this.iconPath = new vscode.ThemeIcon("loading~spin");
        this.contextValue = this.convertToContextValue({
            type: ObjectExplorerLoadingNode.nodeType,
            filterable: false,
            hasFilters: false,
            cancelable: Boolean(task),
        });
    }

    private convertToContextValue(context: Record<string, string | boolean>): string {
        return Object.keys(context)
            .map((key) => `${key}=${context[key]}`)
            .join(",");
    }
}
