/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { BackgroundTaskNode, EmptyBackgroundTaskNode } from "./backgroundTaskNode";
import { BackgroundTasksService, isBackgroundTaskCompleted } from "./backgroundTasksService";

export type BackgroundTasksTreeNode = BackgroundTaskNode | EmptyBackgroundTaskNode;

const ACTIVE_TASK_REFRESH_INTERVAL_MS = 1000;

export class BackgroundTasksProvider
    implements vscode.TreeDataProvider<BackgroundTasksTreeNode>, vscode.Disposable
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        BackgroundTasksTreeNode | undefined
    >();
    private readonly _emptyBackgroundTaskNode = new EmptyBackgroundTaskNode();
    private readonly _taskNodes = new Map<string, BackgroundTaskNode>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly _backgroundTasksService: BackgroundTasksService;
    private readonly _activeTaskRefreshInterval: ReturnType<typeof setInterval>;
    public treeView: vscode.TreeView<BackgroundTasksTreeNode> | undefined;

    constructor(maxFinishedTasks?: number) {
        this._backgroundTasksService = new BackgroundTasksService(
            () => this.refresh(),
            maxFinishedTasks,
            () => this.revealTreeView(),
        );

        this._activeTaskRefreshInterval = setInterval(() => {
            if (
                this._backgroundTasksService.tasks.some(
                    (task) => !isBackgroundTaskCompleted(task.state),
                )
            ) {
                this.refresh();
            }
        }, ACTIVE_TASK_REFRESH_INTERVAL_MS);
        this._activeTaskRefreshInterval.unref?.();
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
            this._taskNodes.clear();
            return [this._emptyBackgroundTaskNode];
        }

        const taskIds = new Set(tasks.map((task) => task.id));
        for (const taskId of this._taskNodes.keys()) {
            if (!taskIds.has(taskId)) {
                this._taskNodes.delete(taskId);
            }
        }

        return tasks.map((task) => {
            let node = this._taskNodes.get(task.id);
            if (!node) {
                node = new BackgroundTaskNode(task);
                this._taskNodes.set(task.id, node);
            } else {
                node.update(task);
            }

            return node;
        });
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

    public dispose(): void {
        clearInterval(this._activeTaskRefreshInterval);
        this._taskNodes.clear();
        this._onDidChangeTreeData.dispose();
    }

    private revealTreeView(): void {
        void this.showAndRevealTreeView();
    }

    private async showAndRevealTreeView(): Promise<void> {
        if (this.treeView) {
            await vscode.commands.executeCommand(Constants.cmdOpenObjectExplorerCommand);
            await vscode.commands.executeCommand(`${Constants.backgroundTasks}.focus`);

            const firstNode = this.getChildren()[0];
            if (firstNode instanceof EmptyBackgroundTaskNode) {
                return;
            }

            await this.treeView.reveal(firstNode, {
                focus: false,
                select: false,
            });
        }
    }
}
