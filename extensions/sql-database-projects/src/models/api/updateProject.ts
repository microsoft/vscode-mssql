/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssqlVscode from "vscode-mssql";

export interface UpdateProjectDataModel {
    sourceEndpointInfo: mssqlVscode.SchemaCompareEndpointInfo;
    targetEndpointInfo: mssqlVscode.SchemaCompareEndpointInfo;
    action: UpdateProjectAction;
}

export const enum UpdateProjectAction {
    Compare = 0,
    Update = 1,
}
