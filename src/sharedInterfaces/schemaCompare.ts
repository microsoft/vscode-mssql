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
    endpointsSwitched: boolean;
    sourceEndpointInfo: SchemaCompareEndpointInfo;
    targetEndpointInfo: SchemaCompareEndpointInfo;
    scmpSourceExcludes: SchemaCompareObjectId[];
    scmpTargetExcludes: SchemaCompareObjectId[];
    originalSourceExcludes: Map<string, DiffEntry>;
    originalTargetExcludes: Map<string, DiffEntry>;
    sourceTargetSwitched: boolean;
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

    switchEndpoints: {
        newSourceEndpointInfo: SchemaCompareEndpointInfo;
        newTargetEndpointInfo: SchemaCompareEndpointInfo;
    };

    compare: {
        sourceEndpointInfo: SchemaCompareEndpointInfo;
        targetEndpointInfo: SchemaCompareEndpointInfo;
        deploymentOptions: DeploymentOptions;
    };

    generateScript: {
        targetServerName: string;
        targetDatabaseName: string;
    };

    publishChanges: {
        targetServerName: string;
        targetDatabaseName: string;
    };

    publishDatabaseChanges: {
        targetServerName: string;
        targetDatabaseName: string;
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

    openScmp: {};

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

    switchEndpoints: (
        newSourceEndpointInfo: SchemaCompareEndpointInfo,
        newTargetEndpointInfo: SchemaCompareEndpointInfo,
    ) => void;

    compare: (
        sourceEndpointInfo: SchemaCompareEndpointInfo,
        targetEndpointInfo: SchemaCompareEndpointInfo,
        deploymentOptions: DeploymentOptions,
    ) => void;

    generateScript: (
        targetServerName: string,
        targetDatabaseName: string,
    ) => void;

    publishChanges: (
        targetServerName: string,
        targetDatabaseName: string,
    ) => void;

    publishDatabaseChanges: (
        targetServerName: string,
        targetDatabaseName: string,
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

    openScmp: () => void;

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
