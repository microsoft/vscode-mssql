/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WorkspaceTreeDataProvider } from "./common/workspaceTreeDataProvider";
import { WorkspaceService } from "./services/workspaceService";
import { WorkspaceTreeItem, IExtension } from "dataworkspace";
import { DataWorkspaceExtension } from "./common/dataWorkspaceExtension";
import { browseForProject } from "./dialogs/openExistingDialog";
import { IconPathHelper } from "./common/iconHelper";
import { createNewProjectWithQuickpick } from "./dialogs/newProjectQuickpick";
import Logger from "./common/logger";
import { TelemetryReporter } from "./common/telemetry";
import { noProjectProvidingExtensionsInstalled } from "./common/constants";

export async function activate(context: vscode.ExtensionContext): Promise<IExtension> {
  const startTime = new Date().getTime();
  Logger.log(`Starting Data Workspace activate()`);

  const workspaceServiceConstructorStartTime = new Date().getTime();
  const workspaceService = new WorkspaceService();
  Logger.log(
    `WorkspaceService constructor took ${new Date().getTime() - workspaceServiceConstructorStartTime}ms`,
  );

  const workspaceTreeDataProviderStartTime = new Date().getTime();
  const workspaceTreeDataProvider = new WorkspaceTreeDataProvider(workspaceService);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await workspaceTreeDataProvider.refresh();
    }),
  );
  Logger.log(
    `WorkspaceTreeDataProvider constructor took ${new Date().getTime() - workspaceTreeDataProviderStartTime}ms`,
  );

  const dataWorkspaceExtensionStartTime = new Date().getTime();
  const dataWorkspaceExtension = new DataWorkspaceExtension(workspaceService);
  Logger.log(
    `DataWorkspaceExtension constructor took ${new Date().getTime() - dataWorkspaceExtensionStartTime}ms`,
  );

  const registerCommandStartTime = new Date().getTime();
  context.subscriptions.push(
    vscode.commands.registerCommand("projects.new", async () => {
      // Make sure all project providing extensions are activated to be sure the project templates show up
      await workspaceService.ensureProviderExtensionLoaded(undefined, true);

      if (!workspaceService.isProjectProviderAvailable) {
        void vscode.window.showErrorMessage(noProjectProvidingExtensionsInstalled);
        return;
      }

      await createNewProjectWithQuickpick(workspaceService);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("projects.openExisting", async () => {
      // Make sure all project providing extensions are activated so that all supported project types show up in the file filter
      await workspaceService.ensureProviderExtensionLoaded(undefined, true);

      if (!workspaceService.isProjectProviderAvailable) {
        void vscode.window.showErrorMessage(noProjectProvidingExtensionsInstalled);
        return;
      }

      const projectFileUri = await browseForProject(workspaceService);
      if (!projectFileUri) {
        return;
      }
      await workspaceService.addProjectsToWorkspace([projectFileUri]);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dataworkspace.refresh", async () => {
      await workspaceTreeDataProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dataworkspace.close", () => {
      return vscode.commands.executeCommand("workbench.action.closeFolder");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "projects.removeProject",
      async (treeItem: WorkspaceTreeItem) => {
        await workspaceService.removeProject(
          vscode.Uri.file(treeItem.element.project.projectFilePath),
        );
      },
    ),
  );
  Logger.log(`Registering commands took ${new Date().getTime() - registerCommandStartTime}ms`);

  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      workspaceService.updateIfProjectProviderAvailable();
    }),
  );

  const iconPathHelperTime = new Date().getTime();
  IconPathHelper.setExtensionContext(context);
  Logger.log(`IconPathHelper took ${new Date().getTime() - iconPathHelperTime}ms`);

  context.subscriptions.push(TelemetryReporter);
  Logger.log(
    `Finished activating Data Workspace extension. Total time = ${new Date().getTime() - startTime}ms`,
  );
  return Promise.resolve(dataWorkspaceExtension);
}

export function deactivate(): void {}
