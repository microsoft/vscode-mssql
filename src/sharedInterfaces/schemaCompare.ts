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
    filePath: string;
}

export interface SchemaCompareReducers {
    getFilePath: {
        endpoint: mssql.SchemaCompareEndpointInfo;
        fileType: string;
    };

    compare: {
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
        taskExecutionMode: mssql.TaskExecutionMode;
        deploymentOptions: mssql.DeploymentOptions;
    };

    generateScript: {
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    publishDatabaseChanges: {
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    publishProjectChanges: {
        targetProjectPath: string;
        targetFolderStructure: mssql.ExtractTarget;
        taskExecutionMode: mssql.TaskExecutionMode;
    };

    getDefaultOptions: {};

    includeExcludeNode: {
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

    cancel: {};
}

export interface SelectSourceDrawer {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export interface SchemaCompareContextProps {
    state: SchemaCompareWebViewState;
    themeKind: ColorThemeKind;
    selectSourceDrawer: SelectSourceDrawer;

    getFilePath: (
        endpointInfo: mssql.SchemaCompareEndpointInfo,
        fileType: string,
    ) => void;

    compare: (
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: mssql.TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
    ) => void;

    generateScript: (
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    publishDatabaseChanges: (
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    publishProjectChanges: (
        targetProjectPath: string,
        targetFolderStructure: mssql.ExtractTarget,
        taskExecutionMode: mssql.TaskExecutionMode,
    ) => void;

    getDefaultOptions: () => void;

    includeExcludeNode: (
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

    cancel: () => void;
}
