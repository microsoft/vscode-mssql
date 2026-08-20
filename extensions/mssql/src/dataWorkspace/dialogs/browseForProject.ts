/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IWorkspaceService } from "../common/interfaces";
import { defaultProjectSaveLocation } from "../common/projectLocationHelper";
import { DataWorkspace as locConstants } from "../../constants/locConstants";

/**
 * Opens a file dialog to browse for an existing project file.
 * @param workspaceService The workspace service to get available project types
 * @returns The selected project file URI, or undefined if cancelled
 */
export async function browseForProject(
    workspaceService: IWorkspaceService,
): Promise<vscode.Uri | undefined> {
    const filters: { [name: string]: string[] } = {};
    const projectTypes = await workspaceService.getAllProjectTypes();
    filters[locConstants.AllProjectTypes] = [
        ...new Set(projectTypes.map((type) => type.projectFileExtension)),
    ];
    projectTypes.forEach((type) => {
        filters[type.displayName] = [type.projectFileExtension];
    });

    const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: locConstants.SelectProjectFileActionName,
        filters: filters,
        defaultUri: defaultProjectSaveLocation(),
    });

    return fileUris?.[0];
}
