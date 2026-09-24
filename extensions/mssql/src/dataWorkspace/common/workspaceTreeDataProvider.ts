/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { IWorkspaceService } from "./interfaces";

import { WorkspaceTreeItem } from "dataworkspace";
import { TelemetryReporter } from "./telemetry";
import { getErrorMessage } from "./utils";
import Logger from "./logger";
import { DataWorkspace as locConstants } from "../../constants/locConstants";

/**
 * Tree data provider for the workspace main view
 */
export class WorkspaceTreeDataProvider
    implements
        vscode.TreeDataProvider<WorkspaceTreeItem>,
        vscode.TreeDragAndDropController<WorkspaceTreeItem>
{
    dropMimeTypes = ["application/vnd.code.tree.workspacetreedataprovider"];
    dragMimeTypes = ["application/vnd.code.tree.workspacetreedataprovider"];

    private readonly _treeView: vscode.TreeView<WorkspaceTreeItem>;
    private _rootItems: WorkspaceTreeItem[] = [];
    private _wrappedItems = new WeakMap<object, WorkspaceTreeItem>();

    constructor(private _workspaceService: IWorkspaceService) {
        this._workspaceService.onDidWorkspaceProjectsChange(() => {
            return this.refresh();
        });

        this._treeView = vscode.window.createTreeView("dataworkspace.views.main", {
            canSelectMany: false,
            treeDataProvider: this,
            dragAndDropController: this,
        });
    }

    private _onDidChangeTreeData:
        | vscode.EventEmitter<void | WorkspaceTreeItem | null | undefined>
        | undefined = new vscode.EventEmitter<WorkspaceTreeItem | undefined | void>();
    readonly onDidChangeTreeData?:
        | vscode.Event<void | WorkspaceTreeItem | null | undefined>
        | undefined = this._onDidChangeTreeData?.event;

    async refresh(): Promise<void> {
        Logger.log(`Refreshing projects tree`);
        await this._workspaceService.getProjectsInWorkspace(undefined, true);
        this._rootItems = [];
        this._wrappedItems = new WeakMap<object, WorkspaceTreeItem>();
        this._onDidChangeTreeData?.fire();
    }

    getTreeItem(element: WorkspaceTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.treeDataProvider.getTreeItem(element.element);
    }

    async getChildren(element?: WorkspaceTreeItem | undefined): Promise<WorkspaceTreeItem[]> {
        if (element) {
            const items = await element.treeDataProvider.getChildren(element.element);
            return items ? items.map((item) => this.wrapItem(element.treeDataProvider, item)) : [];
        } else {
            // if the element is undefined return the project tree items
            Logger.log(`Calling getProjectsInWorkspace() from getChildren()`);
            const projects = await this._workspaceService.getProjectsInWorkspace(undefined, false);
            await vscode.commands.executeCommand(
                "setContext",
                "isProjectsViewEmpty",
                projects.length === 0,
            );
            const unknownProjects: string[] = [];
            const treeItems: WorkspaceTreeItem[] = [];

            const typeMetric: Record<string, number> = {};

            let errorMessages: { project: vscode.Uri; errorMessage: string }[] = [];
            for (const project of projects) {
                try {
                    const projectProvider =
                        await this._workspaceService.getProjectProvider(project);

                    this.incrementProjectTypeMetric(typeMetric, project);

                    if (projectProvider === undefined) {
                        unknownProjects.push(project.path);
                        continue;
                    }
                    const treeDataProvider =
                        await projectProvider.getProjectTreeDataProvider(project);
                    if (treeDataProvider.onDidChangeTreeData) {
                        treeDataProvider.onDidChangeTreeData((e: any) => {
                            this._onDidChangeTreeData?.fire(e);
                        });
                    }
                    const children = await treeDataProvider.getChildren(element);
                    children?.forEach((child) => {
                        treeItems.push(this.wrapItem(treeDataProvider, child));
                    });
                } catch (e) {
                    errorMessages.push({ project: project, errorMessage: getErrorMessage(e) });
                    console.error(e.message);
                }
            }

            if (errorMessages.length > 0) {
                for (let error of errorMessages) {
                    void vscode.window.showErrorMessage(
                        locConstants.projectFailedToLoad(
                            path.basename(error.project.fsPath),
                            error.errorMessage + (error.errorMessage.endsWith(".") ? "" : "."),
                        ),
                    );
                }
            }

            TelemetryReporter.sendMetricsEvent(typeMetric, "OpenWorkspaceProjectTypes");
            TelemetryReporter.sendMetricsEvent(
                {
                    handled: projects.length - unknownProjects.length,
                    unhandled: unknownProjects.length,
                },
                "OpenWorkspaceProjectsHandled",
            );

            if (unknownProjects.length > 0) {
                void vscode.window.showErrorMessage(
                    locConstants.UnknownProjectsError(unknownProjects),
                );
            }

            this._rootItems = treeItems;
            return treeItems;
        }
    }

    async getParent(element: WorkspaceTreeItem): Promise<WorkspaceTreeItem | undefined> {
        const parent = await element.treeDataProvider.getParent?.(element.element);
        return parent ? this.wrapItem(element.treeDataProvider, parent) : undefined;
    }

    /** Reveals an item even when its ancestor folders have not been expanded. */
    async revealProjectItem(projectFile: vscode.Uri, item: vscode.Uri): Promise<boolean> {
        await vscode.commands.executeCommand("dataworkspace.views.main.focus");

        if (this._rootItems.length === 0) {
            await this.getChildren();
        }

        const projectRoot = this._rootItems.find(
            (root) => root.element.projectFileUri?.fsPath === projectFile.fsPath,
        );
        const projectTreeDataProvider = projectRoot?.treeDataProvider as
            | (vscode.TreeDataProvider<any> & {
                  findItem?(item: vscode.Uri): vscode.ProviderResult<any>;
              })
            | undefined;
        const projectItem = await projectTreeDataProvider?.findItem?.(item);

        if (!projectTreeDataProvider || !projectItem) {
            return false;
        }

        await this._treeView.reveal(this.wrapItem(projectTreeDataProvider, projectItem), {
            select: true,
            focus: true,
            expand: true,
        });
        return true;
    }

    private wrapItem(
        treeDataProvider: vscode.TreeDataProvider<any>,
        element: any,
    ): WorkspaceTreeItem {
        if (typeof element === "object" && element !== null) {
            const existing = this._wrappedItems.get(element);
            if (existing) {
                return existing;
            }

            const wrapped = { treeDataProvider, element };
            this._wrappedItems.set(element, wrapped);
            return wrapped;
        }

        return { treeDataProvider, element };
    }

    private incrementProjectTypeMetric(typeMetric: Record<string, number>, projectUri: vscode.Uri) {
        const ext = path.extname(projectUri.fsPath);

        if (!typeMetric.hasOwnProperty(ext)) {
            typeMetric[ext] = 0;
        }

        typeMetric[ext]++;
    }

    handleDrag(
        treeItems: readonly WorkspaceTreeItem[],
        dataTransfer: vscode.DataTransfer,
    ): void | Thenable<void> {
        // Don't do anything if trying to drag the project node since it isn't supported. Because canSelectMany is set to false for WorkspaceTreeDataProvider,
        // treeItems will only contain one treeItem, so we only need to check the first one in the list.
        const relativePath = treeItems[0].element?.relativeProjectUri?.fsPath?.substring(1); // remove leading slash
        const projBaseName = path.basename(
            treeItems[0].element?.projectFileUri?.fsPath,
            path.extname(treeItems[0].element?.projectFileUri?.fsPath),
        );
        if (relativePath === projBaseName) {
            return;
        }

        dataTransfer.set(
            "application/vnd.code.tree.WorkspaceTreeDataProvider",
            new vscode.DataTransferItem(treeItems.map((t) => t.element)),
        );
    }

    async handleDrop(
        target: WorkspaceTreeItem | undefined,
        sources: vscode.DataTransfer,
    ): Promise<void> {
        if (!target) {
            return;
        }

        const transferItem = sources.get("application/vnd.code.tree.WorkspaceTreeDataProvider");

        // Only support moving one file at a time
        // canSelectMany is set to false for the WorkspaceTreeDataProvider, so this condition should never be true
        if (transferItem?.value.length > 1) {
            void vscode.window.showErrorMessage(locConstants.onlyMovingOneFileIsSupported);
            return;
        }

        const projectUri = transferItem?.value[0].projectFileUri;
        if (!projectUri) {
            return;
        }

        const projectProvider = await this._workspaceService.getProjectProvider(projectUri);
        if (!projectProvider) {
            return;
        }

        if (!projectProvider?.supportsDragAndDrop || !projectProvider.moveFile) {
            void vscode.window.showErrorMessage(locConstants.dragAndDropNotSupported);
            return;
        }

        // Move the file
        await projectProvider!.moveFile(projectUri, transferItem?.value[0], target);
        void this.refresh();
    }
}
