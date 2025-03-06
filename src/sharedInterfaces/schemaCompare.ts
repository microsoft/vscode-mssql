/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum SchemaUpdateAction {
    Delete = 0,
    Change = 1,
    Add = 2,
}

import {
    ExtractTarget,
    TaskExecutionMode,
    // ISchemaCompareService,
    // SchemaCompareEndpointType,
    // SchemaCompareConnectionInfo,
    SchemaCompareEndpointInfo,
    // SchemaUpdateAction,
    // SchemaDifferenceType,
    DiffEntry,
    // SchemaCompareParams,
    DeploymentOptions,
    ResultStatus,
    SchemaCompareResult,
    // SchemaCompareGenerateScriptParams,
    SchemaComparePublishProjectResult,
    // SchemaCompareGetOptionsParams,
    SchemaCompareOptionsResult,
    // SchemaCompareNodeParams,
    SchemaCompareIncludeExcludeResult,
    SchemaCompareObjectId,
    // SchemaCompareOpenScmpParams,
    SchemaCompareOpenScmpResult,
    // SchemaCompareSaveScmpParams,
    // SchemaCompareCancelParams,
} from "vscode-mssql";
import { ColorThemeKind } from "../reactviews/common/vscodeWebviewProvider";

export interface SchemaCompareWebViewState {
    defaultDeploymentOptionsResult: SchemaCompareOptionsResult;
    auxiliaryEndpointInfo: SchemaCompareEndpointInfo;
    sourceEndpointInfo: SchemaCompareEndpointInfo;
    targetEndpointInfo: SchemaCompareEndpointInfo;
    schemaCompareResult: SchemaCompareResult;
    generateScriptResultStatus: ResultStatus;
    publishDatabaseChangesResultStatus: ResultStatus;
    schemaComparePublishProjectResult: SchemaComparePublishProjectResult;
    schemaCompareIncludeExcludeResult: SchemaCompareIncludeExcludeResult;
    schemaCompareOpenScmpResult: SchemaCompareOpenScmpResult;
    saveScmpResultStatus: ResultStatus;
    cancelResultStatus: ResultStatus;
}

export interface SchemaCompareReducers {
    selectFile: {
        endpoint: SchemaCompareEndpointInfo;
        endpointType: "source" | "target";
        fileType: "dacpac" | "sqlproj";
    };

    confirmSelectedSchema: {
        endpointType: "source" | "target";
    };

    compare: {
        sourceEndpointInfo: SchemaCompareEndpointInfo;
        targetEndpointInfo: SchemaCompareEndpointInfo;
        deploymentOptions: DeploymentOptions;
    };

    generateScript: {
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: TaskExecutionMode;
    };

    publishDatabaseChanges: {
        targetServerName: string;
        targetDatabaseName: string;
        taskExecutionMode: TaskExecutionMode;
    };

    publishProjectChanges: {
        targetProjectPath: string;
        targetFolderStructure: ExtractTarget;
        taskExecutionMode: TaskExecutionMode;
    };

    getDefaultOptions: {};

    includeExcludeNode: {
        id: number;
        diffEntry: DiffEntry;
        includeRequest: boolean;
    };

    openScmp: {
        filePath: string;
    };

    saveScmp: {
        sourceEndpointInfo: SchemaCompareEndpointInfo;
        targetEndpointInfo: SchemaCompareEndpointInfo;
        taskExecutionMode: TaskExecutionMode;
        deploymentOptions: DeploymentOptions;
        scmpFilePath: string;
        excludedSourceObjects: SchemaCompareObjectId[];
        excludedTargetObjects: SchemaCompareObjectId[];
    };

    cancel: {};
}

export interface SchemaCompareContextProps {
    state: SchemaCompareWebViewState;
    themeKind: ColorThemeKind;

    selectFile: (
        endpoint: SchemaCompareEndpointInfo,
        endpointType: "source" | "target",
        fileType: "dacpac" | "sqlproj",
    ) => void;

    confirmSelectedSchema: (endpointType: "source" | "target") => void;

    compare: (
        sourceEndpointInfo: SchemaCompareEndpointInfo,
        targetEndpointInfo: SchemaCompareEndpointInfo,
        deploymentOptions: DeploymentOptions,
    ) => void;

    generateScript: (
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: TaskExecutionMode,
    ) => void;

    publishDatabaseChanges: (
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: TaskExecutionMode,
    ) => void;

    publishProjectChanges: (
        targetProjectPath: string,
        targetFolderStructure: ExtractTarget,
        taskExecutionMode: TaskExecutionMode,
    ) => void;

    getDefaultOptions: () => void;

    includeExcludeNode: (
        id: number,
        diffEntry: DiffEntry,
        includeRequest: boolean,
    ) => void;

    openScmp: (filePath: string) => void;

    saveScmp: (
        sourceEndpointInfo: SchemaCompareEndpointInfo,
        targetEndpointInfo: SchemaCompareEndpointInfo,
        taskExecutionMode: TaskExecutionMode,
        deploymentOptions: DeploymentOptions,
        scmpFilePath: string,
        excludedSourceObjects: SchemaCompareObjectId[],
        excludedTargetObjects: SchemaCompareObjectId[],
    ) => void;

    cancel: () => void;
}
