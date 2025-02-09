/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { ColorThemeKind } from "../reactviews/common/vscodeWebviewProvider";

export interface SchemaCompareWebViewState {
    defaultDeploymentOptionsResult: mssql.SchemaCompareOptionsResult;
    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
    targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
    schemaCompareResult: mssql.SchemaCompareResult;
    generateScriptResultStatus: mssql.ResultStatus;
    publishDatabaseChangesResultStatus: mssql.ResultStatus;
    schemaComparePublishProjectResult: mssql.SchemaComparePublishProjectResult;
    schemaCompareIncludeExcludeResult: mssql.SchemaCompareIncludeExcludeResult;
    schemaCompareOpenScmpResult: mssql.SchemaCompareOpenScmpResult;
    saveScmpResultStatus: mssql.ResultStatus;
    cancelResultStatus: mssql.ResultStatus;
}

export interface SchemaCompareReducers {
    compare: {
        operationId: string;
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
        taskExecutionMode: mssql.TaskExecutionMode;
        deploymentOptions: mssql.DeploymentOptions;
    };

    generateScript: {
        operationId: string;
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    publishDatabaseChanges: {
        operationId: string;
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    publishProjectChanges: {
        operationId: string;
        targetProjectPath: string;
        targetFolderStructure: mssql.ExtractTarget;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    getDefaultOptions: {};

    includeExcludeNode: {
        operationId: string;
        diffEntry: mssql.DiffEntry;
        includeRequest: boolean;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    openScmp: {
        filePath: string;
    };

    saveScmp: {
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
        taskExecutionMode: mssql.TaskExecutionMode;
        deploymentOptions: mssql.DeploymentOptions;
        scmpFilePath: string;
        excludedSourceObjects: mssql.SchemaCompareObjectId[];
        excludedTargetObjects: mssql.SchemaCompareObjectId[];
    };

    cancel: {
        operationId: string;
    };
}

export interface SchemaCompareContextProps {
    state: SchemaCompareWebViewState;
    themeKind: ColorThemeKind;

    compare: (
        operationId: string,
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: mssql.TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
    ) => void;

    generateScript: (
        operationId: string,
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    publishDatabaseChanges: (
        operationId: string,
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    publishProjectChanges: (
        operationId: string,
        targetProjectPath: string,
        targetFolderStructure: mssql.ExtractTarget,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    getDefaultOptions: () => void;

    includeExcludeNode: (
        operationId: string,
        diffEntry: mssql.DiffEntry,
        includeRequest: boolean,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    openScmp: (filePath: string) => void;

    saveScmp: (
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: mssql.TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
        scmpFilePath: string,
        excludedSourceObjects: mssql.SchemaCompareObjectId[],
        excludedTargetObjects: mssql.SchemaCompareObjectId[],
    ) => void;

    cancel: (operationId: string) => void;
}
