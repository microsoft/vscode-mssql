/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataWorkspace as locConstants } from "../../constants/locConstants";

export const BrowseEllipsisWithIcon = `$(folder) ${locConstants.BrowseEllipsis}`;
export const WorkspaceFileExtension = ".code-workspace";
export const DefaultInputWidth = "400px";
export const DefaultButtonWidth = "80px";
export const DataWorkspaceOutputChannel = "Data Workspace";

// Workspace settings for saving new projects
export const ProjectConfigurationKey = "projects";
export const ProjectSaveLocationKey = "defaultProjectSaveLocation";

export namespace cssStyles {
    export const title = { "font-size": "18px", "font-weight": "600" };
    export const tableHeader = {
        "text-align": "left",
        "font-weight": "500",
        "font-size": "13px",
        "user-select": "text",
    };
    export const tableRow = {
        "border-top": "solid 1px #ccc",
        "border-bottom": "solid 1px #ccc",
        "border-left": "none",
        "border-right": "none",
    };
}
