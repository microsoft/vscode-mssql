/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WorkspaceTreeItem, IExtension as IDataWorkspaceExtension } from "dataworkspace";
import { DataWorkspaceExtension } from "./common/dataWorkspaceExtension";

import { WorkspaceTreeDataProvider } from "./common/workspaceTreeDataProvider";
import { browseForProject } from "./dialogs/browseForProject";
import { createNewProjectWithQuickpick } from "./dialogs/newProjectQuickpick";
import { WorkspaceService } from "./services/workspaceService";
import { DataWorkspace as locConstants } from "../constants/locConstants";

/**
 * Registers the Projects view, its commands and the project provider registry, and returns the
 * API that project-providing extensions use to interact with them.
 */
export function registerDataWorkspace(context: vscode.ExtensionContext): IDataWorkspaceExtension {
    const workspaceService = new WorkspaceService();
    const workspaceTreeDataProvider = new WorkspaceTreeDataProvider(workspaceService);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await workspaceTreeDataProvider.refresh();
        }),
        vscode.extensions.onDidChange(() => {
            workspaceService.updateIfProjectProviderAvailable();
        }),
    );

    const requireProjectProvider = async (): Promise<boolean> => {
        // Activate project-providing extensions so their project types are registered.
        await workspaceService.ensureProviderExtensionLoaded(undefined, true);

        if (!workspaceService.isProjectProviderAvailable) {
            void vscode.window.showErrorMessage(locConstants.noProjectProvidingExtensionsInstalled);
            return false;
        }
        return true;
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("projects.new", async () => {
            if (!(await requireProjectProvider())) {
                return;
            }
            await createNewProjectWithQuickpick(workspaceService);
        }),
        vscode.commands.registerCommand("projects.openExisting", async () => {
            if (!(await requireProjectProvider())) {
                return;
            }
            const projectFileUri = await browseForProject(workspaceService);
            if (!projectFileUri) {
                return;
            }
            await workspaceService.addProjectsToWorkspace([projectFileUri]);
        }),
        vscode.commands.registerCommand("dataworkspace.refresh", async () => {
            await workspaceTreeDataProvider.refresh();
        }),
        vscode.commands.registerCommand("dataworkspace.close", () =>
            vscode.commands.executeCommand("workbench.action.closeFolder"),
        ),
        vscode.commands.registerCommand(
            "projects.removeProject",
            async (treeItem: WorkspaceTreeItem) => {
                await workspaceService.removeProject(
                    vscode.Uri.file(treeItem.element.project.projectFilePath),
                );
            },
        ),
    );

    return new DataWorkspaceExtension(workspaceService);
}
