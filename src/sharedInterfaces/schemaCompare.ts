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
    schemaCompare: {
        operationId: string;
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
        taskExecutionMode: mssql.TaskExecutionMode;
        deploymentOptions: mssql.DeploymentOptions;
    };

    schemaCompareGenerateScript: {
        operationId: string;
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    schemaComparePublishDatabaseChanges: {
        operationId: string;
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    schemaComparePublishProjectChanges: {
        operationId: string;
        targetProjectPath: string;
        targetFolderStructure: mssql.ExtractTarget;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    schemaCompareGetDefaultOptions: {};

    schemaCompareIncludeExcludeNode: {
        operationId: string;
        diffEntry: mssql.DiffEntry;
        includeRequest: boolean;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    schemaCompareOpenScmp: {
        filePath: string;
    };

    schemaCompareSaveScmp: {
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
        taskExecutionMode: mssql.TaskExecutionMode;
        deploymentOptions: mssql.DeploymentOptions;
        scmpFilePath: string;
        excludedSourceObjects: mssql.SchemaCompareObjectId[];
        excludedTargetObjects: mssql.SchemaCompareObjectId[];
    };

    schemaCompareCancel: {
        operationId: string;
    };
}

export interface SchemaCompareContextProps {
    state: SchemaCompareWebViewState;
    themeKind: ColorThemeKind;

    schemaCompare: (
        operationId: string,
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: mssql.TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
    ) => void;

    schemaCompareGenerateScript: (
        operationId: string,
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    schemaComparePublishDatabaseChanges: (
        operationId: string,
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    schemaComparePublishProjectChanges: (
        operationId: string,
        targetProjectPath: string,
        targetFolderStructure: mssql.ExtractTarget,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    schemaCompareGetDefaultOptions: () => void;

    schemaCompareIncludeExcludeNode: (
        operationId: string,
        diffEntry: mssql.DiffEntry,
        includeRequest: boolean,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    schemaCompareOpenScmp: (filePath: string) => void;

    schemaCompareSaveScmp: (
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: mssql.TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
        scmpFilePath: string,
        excludedSourceObjects: mssql.SchemaCompareObjectId[],
        excludedTargetObjects: mssql.SchemaCompareObjectId[],
    ) => void;

    schemaCompareCancel: (operationId: string) => void;
}
