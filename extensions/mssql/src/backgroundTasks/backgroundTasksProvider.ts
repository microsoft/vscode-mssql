/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { BackgroundTaskNode, EmptyBackgroundTaskNode } from "./backgroundTaskNode";
import { BackgroundTasksService } from "./backgroundTasksService";

export type BackgroundTasksTreeNode = BackgroundTaskNode | EmptyBackgroundTaskNode;

export class BackgroundTasksProvider implements vscode.TreeDataProvider<BackgroundTasksTreeNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        BackgroundTasksTreeNode | undefined
    >();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly _backgroundTasksService: BackgroundTasksService;
    public treeView: vscode.TreeView<BackgroundTasksTreeNode> | undefined;

    constructor(backgroundTasksService?: BackgroundTasksService) {
        this._backgroundTasksService =
            backgroundTasksService ??
            new BackgroundTasksService(
                () => this.refresh(),
                undefined,
                () => this.revealTreeView(),
            );
    }

    public get backgroundTasksService(): BackgroundTasksService {
        return this._backgroundTasksService;
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: BackgroundTasksTreeNode): vscode.TreeItem {
        return element;
    }

    public getChildren(_element?: BackgroundTasksTreeNode): BackgroundTasksTreeNode[] {
        const tasks = this._backgroundTasksService.tasks;
        if (tasks.length === 0) {
            return [new EmptyBackgroundTaskNode()];
        }

        return tasks.map((task) => new BackgroundTaskNode(task));
    }

    public async openTask(taskId: string): Promise<void> {
        await this._backgroundTasksService.openTask(taskId);
    }

    public async cancelTask(taskId: string): Promise<void> {
        await this._backgroundTasksService.cancelTask(taskId);
    }

    public clearFinished(): void {
        this._backgroundTasksService.clearFinished();
    }

    private revealTreeView(): void {
        if (this.treeView) {
            void vscode.commands.executeCommand(`${Constants.backgroundTasks}.focus`);
            void this.treeView.reveal(this.getChildren()[0], {
                focus: false,
                select: false,
            });
        }
    }
}
