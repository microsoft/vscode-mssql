/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { telemetryReporter as TelemetryReporter } from "extension-toolkit/vscode";

export enum TelemetryViews {
    WorkspaceTreePane = "WorkspaceTreePane",
    OpenExistingDialog = "OpenExistingDialog",
    NewProjectDialog = "NewProjectDialog",
    ProviderRegistration = "ProviderRegistration",
}

export enum TelemetryActions {
    ProviderRegistered = "ProviderRegistered",
    ProjectAddedToWorkspace = "ProjectAddedToWorkspace",
    ProjectRemovedFromWorkspace = "ProjectRemovedFromWorkspace",
    OpeningProject = "OpeningProject",
    NewProjectDialogLaunched = "NewProjectDialogLaunched",
    OpenExistingDialogLaunched = "OpenExistingDialogLaunched",
    NewProjectDialogCompleted = "NewProjectDialogCompleted",
    GitClone = "GitClone",
    ProjectsLoaded = "ProjectsLoaded",
}
