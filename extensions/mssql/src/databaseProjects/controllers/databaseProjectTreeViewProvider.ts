/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { BaseProjectTreeItem } from "../models/tree/baseTreeItem";
import { ProjectRootTreeItem } from "../models/tree/projectTreeItem";
import { Project } from "../models/project";

/**
 * Tree view for database projects
 */
export class SqlDatabaseProjectTreeViewProvider
    implements vscode.TreeDataProvider<BaseProjectTreeItem>
{
    private _onDidChangeTreeData: vscode.EventEmitter<BaseProjectTreeItem | undefined> =
        new vscode.EventEmitter<BaseProjectTreeItem | undefined>();
    private treeView: vscode.TreeView<BaseProjectTreeItem> | undefined;
    readonly onDidChangeTreeData: vscode.Event<BaseProjectTreeItem | undefined> =
        this._onDidChangeTreeData.event;

    private roots: BaseProjectTreeItem[] = [];
    private parents = new Map<BaseProjectTreeItem, BaseProjectTreeItem>();

    constructor() {
        this.initialize();
    }

    private initialize() {
        this.roots = [];
    }

    public notifyTreeDataChanged() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: BaseProjectTreeItem): vscode.TreeItem {
        return element.treeItem;
    }

    public getChildren(element?: BaseProjectTreeItem): BaseProjectTreeItem[] {
        if (element === undefined) {
            return this.roots;
        }

        return element.children;
    }

    public getParent(element: BaseProjectTreeItem): BaseProjectTreeItem | undefined {
        return this.parents.get(element);
    }

    public findItem(item: vscode.Uri): BaseProjectTreeItem | undefined {
        const itemUri = item.toString();
        const pending = [...this.roots];

        while (pending.length > 0) {
            const candidate = pending.pop()!;
            const fileSystemUri = (
                candidate as BaseProjectTreeItem & {
                    fileSystemUri?: vscode.Uri;
                }
            ).fileSystemUri;
            if (fileSystemUri?.toString() === itemUri) {
                return candidate;
            }
            pending.push(...candidate.children);
        }

        return undefined;
    }

    /**
     * Constructs a new set of root nodes from a list of Projects
     * @param projects List of Projects
     */
    public load(projects: Project[]) {
        let newRoots: BaseProjectTreeItem[] = [];

        for (const proj of projects) {
            newRoots.push(new ProjectRootTreeItem(proj));
        }

        this.roots = newRoots;
        this.parents.clear();
        for (const root of this.roots) {
            this.indexParents(root);
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    private indexParents(parent: BaseProjectTreeItem): void {
        for (const child of parent.children) {
            this.parents.set(child, parent);
            this.indexParents(child);
        }
    }

    public setTreeView(value: vscode.TreeView<BaseProjectTreeItem>) {
        if (this.treeView) {
            throw new Error("TreeView should not be set multiple times.");
        }

        this.treeView = value;
    }
}
