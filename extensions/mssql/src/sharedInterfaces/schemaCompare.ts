/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
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
} from "vscode-mssql";
import { CoreRPCs } from "./webview";
import {
    ExtractTarget,
    SchemaCompareEndpointType,
    SchemaDifferenceType,
    SchemaUpdateAction,
    TaskExecutionMode,
} from "../enums";
import { FormItemOptions } from "./form";
import { RequestType } from "vscode-jsonrpc";

export {
    ExtractTarget,
    SchemaCompareEndpointType,
    SchemaDifferenceType,
    SchemaUpdateAction,
    TaskExecutionMode,
};

export interface SchemaCompareServer {
    profileName: string;
    server: string;
    database?: string;
}

export interface SchemaCompareWebViewState {
    isSqlProjectExtensionInstalled: boolean;
    isComparisonInProgress: boolean;
    isApplyInProgress: boolean;
    applySucceeded: boolean;
    applyFailed: boolean;
    isEndpointSelectionInProgress?: boolean;
    connections: { [connectionId: string]: SchemaCompareServer };
    databases: FormItemOptions[];
    databaseListConnectionId: string;
    isDatabaseListLoading: boolean;
    databaseListError: string;
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

    listDatabasesForActiveServer: {
        connectionUri: string;
        connectionDatabaseName?: string;
    };

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

    intermediaryGeneralOptionsBulkChanged: { keys: string[]; checked: boolean };

    intermediaryIncludeObjectTypesOptionsChanged: { key: string };

    intermediaryIncludeObjectTypesBulkChanged: { keys: string[]; checked: boolean };

    resetSchemaOptions: {};

    confirmSchemaOptions: { optionsChanged: boolean };

    switchEndpoints: {
        newSourceEndpointInfo: SchemaCompareEndpointInfo;
        newTargetEndpointInfo: SchemaCompareEndpointInfo;
    };

    resetEndpointsSwitched: {};

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

    openScmp: {};

    saveScmp: {};

    cancel: {};
}

export interface SchemaCompareContextProps extends CoreRPCs {
    differences: DiffEntry[];
    pendingDifferenceIds: ReadonlySet<number>;
    isIncludeExcludeAllInProgress: boolean;

    isSqlProjectExtensionInstalled: () => void;

    listActiveServers: () => void;

    listDatabasesForActiveServer: (connectionUri: string, connectionDatabaseName?: string) => void;

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

    intermediaryGeneralOptionsBulkChanged: (keys: string[], checked: boolean) => void;

    intermediaryIncludeObjectTypesOptionsChanged: (key: string) => void;

    intermediaryIncludeObjectTypesBulkChanged: (keys: string[], checked: boolean) => void;

    confirmSchemaOptions: (optionsChanged: boolean) => void;

    switchEndpoints: (
        newSourceEndpointInfo: SchemaCompareEndpointInfo,
        newTargetEndpointInfo: SchemaCompareEndpointInfo,
    ) => void;

    resetEndpointsSwitched: () => void;

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

    includeExcludeNode: (
        id: number,
        diffEntry: DiffEntry,
        includeRequest: boolean,
    ) => Promise<void>;

    includeExcludeAllNodes: (includeRequest: boolean) => Promise<void>;

    openScmp: () => void;

    saveScmp: () => void;

    cancel: () => void;
}

export type SchemaCompareIncludeExcludeRejectionReason =
    | "blockingDependencies"
    | "notExcludable"
    | "differenceNotFound"
    | "serviceError";

export interface SchemaCompareDifferenceUpdate {
    id: number;
    included: boolean;
}

export interface SchemaCompareBlockingDependency {
    id?: number;
    name: string;
}

export interface SchemaCompareIncludeExcludeNodeParams {
    id: number;
    diffEntry: DiffEntry;
    includeRequest: boolean;
}

export interface SchemaCompareIncludeExcludeNodeResponse {
    success: boolean;
    updates: SchemaCompareDifferenceUpdate[];
    blockingDependencies: SchemaCompareBlockingDependency[];
    reason?: SchemaCompareIncludeExcludeRejectionReason;
    errorMessage?: string;
}

export namespace SchemaCompareIncludeExcludeNodeRequest {
    export const type = new RequestType<
        SchemaCompareIncludeExcludeNodeParams,
        SchemaCompareIncludeExcludeNodeResponse,
        void
    >("schemaCompare/includeExcludeNodeWebview");
}

export interface SchemaCompareIncludeExcludeAllParams {
    includeRequest: boolean;
}

export interface SchemaCompareIncludeExcludeAllResponse {
    success: boolean;
    differences: DiffEntry[];
    errorMessage?: string;
}

export namespace SchemaCompareIncludeExcludeAllRequest {
    export const type = new RequestType<
        SchemaCompareIncludeExcludeAllParams,
        SchemaCompareIncludeExcludeAllResponse,
        void
    >("schemaCompare/includeExcludeAllWebview");
}
