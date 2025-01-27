/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";

export interface SchemaCompareWebViewState {
    defaultDeploymentOptions: mssql.DeploymentOptions;
    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
    targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
}

export interface SchemaCompareReducers {}
