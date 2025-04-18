/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ExtractTarget,
    TaskExecutionMode,
    SchemaCompareEndpointInfo,
    DiffEntry,
    DeploymentOptions,
    ResultStatus,
    SchemaCompareResult,
    SchemaComparePublishProjectResult,
    SchemaCompareOptionsResult,
    SchemaCompareIncludeExcludeResult,
    SchemaCompareObjectId,
    SchemaCompareOpenScmpResult,
    IConnectionInfo,
} from "vscode-mssql";
import { ColorThemeKind } from "./webview";

export const enum SchemaUpdateAction {
    Delete = 0,
    Change = 1,
    Add = 2,
}

export const enum SchemaCompareEndpointType {
    Database = 0,
    Dacpac = 1,
    Project = 2,
    // must be kept in-sync with SchemaCompareEndpointType in SQL Tools Service
    // located at \src\Microsoft.SqlTools.ServiceLayer\SchemaCompare\Contracts\SchemaCompareRequest.cs
}

export interface ISchemaCompareConnectionProfile extends IConnectionInfo {
    profileName?: string;
}

export interface SchemaCompareWebViewState {
    isSqlProjectExtensionInstalled: boolean;
    isComparisonInProgress: boolean;
    isIncludeExcludeAllOperationInProgress: boolean;
    activeServers: { [connectionUri: string]: { profileName: string; server: string } };
    databases: string[];
    defaultDeploymentOptionsResult: SchemaCompareOptionsResult;
    auxiliaryEndpointInfo: SchemaCompareEndpointInfo;
    intermediaryOptionsResult: SchemaCompareOptionsResult;
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
    isSqlProjectExtensionInstalled: {};

    listActiveServers: {};

    listDatabasesForActiveServer: { connectionUri: string };

    openAddNewConnectionDialog: {};

    selectFile: {
        endpoint: SchemaCompareEndpointInfo;
        endpointType: "source" | "target";
        fileType: "dacpac" | "sqlproj";
    };

    confirmSelectedSchema: {
        endpointType: "source" | "target";
        folderStructure: string;
    };

    confirmSelectedDatabase: {
        endpointType: "source" | "target";
        serverConnectionUri: string;
        databaseName: string;
    };

    setIntermediarySchemaOptions: {};

    intermediaryGeneralOptionsChanged: { key: string };

    intermediaryIncludeObjectTypesOptionsChanged: { key: string };

    resetSchemaOptions: {};

    confirmSchemaOptions: { optionsChanged: boolean };

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

    resetOptions: {};

    includeExcludeNode: {
        id: number;
        diffEntry: DiffEntry;
        includeRequest: boolean;
    };

    includeExcludeAllNodes: {
        includeRequest: boolean;
    };

    openScmp: {};

    saveScmp: {};

    cancel: {};
}

export interface SchemaCompareContextProps {
    state: SchemaCompareWebViewState;
    themeKind: ColorThemeKind;

    isSqlProjectExtensionInstalled: () => void;

    listActiveServers: () => void;

    listDatabasesForActiveServer: (connectionUri: string) => void;

    openAddNewConnectionDialog: () => void;

    selectFile: (
        endpoint: SchemaCompareEndpointInfo,
        endpointType: "source" | "target",
        fileType: "dacpac" | "sqlproj",
    ) => void;

    confirmSelectedSchema: (endpointType: "source" | "target", folderStructure: string) => void;

    confirmSelectedDatabase: (
        endpointType: "source" | "target",
        serverConnectionUri: string,
        databaseName: string,
    ) => void;

    setIntermediarySchemaOptions: () => void;

    intermediaryGeneralOptionsChanged: (key: string) => void;

    intermediaryIncludeObjectTypesOptionsChanged: (key: string) => void;

    confirmSchemaOptions: (optionsChanged: boolean) => void;

    switchEndpoints: (
        newSourceEndpointInfo: SchemaCompareEndpointInfo,
        newTargetEndpointInfo: SchemaCompareEndpointInfo,
    ) => void;

    compare: (
        sourceEndpointInfo: SchemaCompareEndpointInfo,
        targetEndpointInfo: SchemaCompareEndpointInfo,
        deploymentOptions: DeploymentOptions,
    ) => void;

    generateScript: (targetServerName: string, targetDatabaseName: string) => void;

    publishChanges: (targetServerName: string, targetDatabaseName: string) => void;

    publishDatabaseChanges: (targetServerName: string, targetDatabaseName: string) => void;

    publishProjectChanges: (
        targetProjectPath: string,
        targetFolderStructure: ExtractTarget,
        taskExecutionMode: TaskExecutionMode,
    ) => void;

    resetOptions: () => void;

    includeExcludeNode: (id: number, diffEntry: DiffEntry, includeRequest: boolean) => void;

    includeExcludeAllNodes: (includeRequest: boolean) => void;

    openScmp: () => void;

    saveScmp: () => void;

    cancel: () => void;
}
