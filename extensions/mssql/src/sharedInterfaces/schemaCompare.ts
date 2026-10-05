/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SchemaCompareEndpointInfo,
    DiffEntry,
    DeploymentOptions,
    ResultStatus,
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

export type SchemaCompareLayout = "classic" | "simplified";
export type SchemaCompareGroupBy = "none" | "type" | "action" | "schema";

export interface SchemaCompareServer {
    profileName: string;
    server: string;
    database?: string;
}

/**
 * Lightweight description of the current comparison result. The full difference list is
 * kept on the extension host and fetched by the webview with
 * {@link SchemaCompareGetDifferencesRequest} so state updates stay small.
 */
export interface SchemaCompareResultSummary {
    /** Identifies one comparison run; every difference request is validated against it. */
    comparisonId: number;
    areEqual: boolean;
    differenceCount: number;
}

export interface SchemaCompareWebViewState {
    layout: SchemaCompareLayout;
    groupBy: SchemaCompareGroupBy;
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
    schemaCompareResult?: SchemaCompareResultSummary;
    publishDatabaseChangesResultStatus: ResultStatus;
    schemaComparePublishProjectResult: SchemaComparePublishProjectResult;
    schemaCompareIncludeExcludeResult: SchemaCompareIncludeExcludeResult;
    schemaCompareOpenScmpResult: SchemaCompareOpenScmpResult;
    saveScmpResultStatus: ResultStatus;
    cancelResultStatus: ResultStatus;
}

export interface SchemaCompareReducers {
    setLayout: { layout: SchemaCompareLayout };
    setGroupBy: { groupBy: SchemaCompareGroupBy };

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
    isDifferencesLoading: boolean;
    loadingDifferenceDetailIds: ReadonlySet<number>;
    pendingDifferenceIds: ReadonlySet<number>;
    isIncludeExcludeAllInProgress: boolean;
    isScriptGenerationInProgress: boolean;
    /** True while any request that depends on the current comparison is in flight. */
    isOperationInProgress: boolean;

    setLayout: (layout: SchemaCompareLayout) => void;
    setGroupBy: (groupBy: SchemaCompareGroupBy) => void;

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

    generateScript: (
        targetServerName: string,
        targetDatabaseName: string,
    ) => Promise<SchemaCompareGenerateScriptResponse>;

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

    loadDifferenceDetails: (id: number) => Promise<void>;

    openScmp: () => void;

    saveScmp: () => void;

    cancel: () => void;
}

export type SchemaCompareIncludeExcludeRejectionReason =
    | "blockingDependencies"
    | "notExcludable"
    | "differenceNotFound"
    | "serviceError"
    | "staleComparison";

export interface SchemaCompareDifferenceUpdate {
    id: number;
    included: boolean;
}

export interface SchemaCompareBlockingDependency {
    id?: number;
    name: string;
}

export interface SchemaCompareGetDifferencesWebviewParams {
    comparisonId: number;
}

export interface SchemaCompareGetDifferencesWebviewResponse {
    success: boolean;
    comparisonId: number;
    differences: DiffEntry[];
    errorMessage?: string;
}

export namespace SchemaCompareGetDifferencesRequest {
    export const type = new RequestType<
        SchemaCompareGetDifferencesWebviewParams,
        SchemaCompareGetDifferencesWebviewResponse,
        void
    >("schemaCompare/getDifferencesWebview");
}

export interface SchemaCompareIncludeExcludeNodeParams {
    comparisonId: number;
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

export interface SchemaCompareGetDifferenceDetailsWebviewParams {
    comparisonId: number;
    id: number;
}

export interface SchemaCompareGetDifferenceDetailsWebviewResponse {
    success: boolean;
    difference?: DiffEntry;
    errorMessage?: string;
}

export namespace SchemaCompareGetDifferenceDetailsRequest {
    export const type = new RequestType<
        SchemaCompareGetDifferenceDetailsWebviewParams,
        SchemaCompareGetDifferenceDetailsWebviewResponse,
        void
    >("schemaCompare/getDifferenceDetailsWebview");
}

export interface SchemaCompareGenerateScriptParams {
    comparisonId: number;
    targetServerName: string;
    targetDatabaseName: string;
}

export interface SchemaCompareGenerateScriptResponse {
    success: boolean;
    errorMessage?: string;
}

export namespace SchemaCompareGenerateScriptRequest {
    export const type = new RequestType<
        SchemaCompareGenerateScriptParams,
        SchemaCompareGenerateScriptResponse,
        void
    >("schemaCompare/generateScriptWebview");
}

export interface SchemaCompareIncludeExcludeAllParams {
    comparisonId: number;
    includeRequest: boolean;
}

export interface SchemaCompareIncludeExcludeAllResponse {
    success: boolean;
    updates: SchemaCompareDifferenceUpdate[];
    errorMessage?: string;
}

export namespace SchemaCompareIncludeExcludeAllRequest {
    export const type = new RequestType<
        SchemaCompareIncludeExcludeAllParams,
        SchemaCompareIncludeExcludeAllResponse,
        void
    >("schemaCompare/includeExcludeAllWebview");
}
