/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { isQueryStudioEnabled } from "../../queryStudio/queryStudioFeatureGate";

export function isSpatialResultsEnabled(): boolean {
    return (
        isQueryStudioEnabled() &&
        vscode.workspace.getConfiguration("mssql").get<boolean>("queryStudio.spatial.enabled") ===
            true
    );
}
