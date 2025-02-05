/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
} from "../sharedInterfaces/schemaCompare";

export async function compare(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaCompare"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareResult> {
    const result = await schemaCompareService.compare(
        payload.operationId,
        payload.sourceEndpointInfo,
        payload.targetEndpointInfo,
        payload.taskExecutionMode,
        payload.deploymentOptions,
    );

    return result;
}

export async function generateScript(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaCompareGenerateScript"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.generateScript(
        payload.operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        payload.taskExecutionMode,
    );

    return result;
}

export async function publishDatabaseChanges(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaComparePublishDatabaseChanges"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.publishDatabaseChanges(
        payload.operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        payload.taskExecutionMode,
    );

    return result;
}

export async function publishProjectChanges(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaComparePublishProjectChanges"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaComparePublishProjectResult> {
    const result = await schemaCompareService.publishProjectChanges(
        payload.operationId,
        payload.targetProjectPath,
        payload.targetFolderStructure,
        payload.taskExecutionMode,
    );

    return result;
}

export async function includeExcludeNode(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaCompareIncludeExcludeNode"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareIncludeExcludeResult> {
    const result = await schemaCompareService.includeExcludeNode(
        payload.operationId,
        payload.diffEntry,
        payload.includeRequest,
        payload.taskExecutionMode,
    );

    return result;
}

export async function openScmp(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaCompareOpenScmp"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareOpenScmpResult> {
    const result = await schemaCompareService.openScmp(payload.filePath);

    return result;
}

export async function saveScmp(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaCompareSaveScmp"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.saveScmp(
        payload.sourceEndpointInfo,
        payload.targetEndpointInfo,
        payload.taskExecutionMode,
        payload.deploymentOptions,
        payload.scmpFilePath,
        payload.excludedSourceObjects,
        payload.excludedTargetObjects,
    );

    return result;
}

export async function cancel(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["schemaCompareCancel"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.cancel(payload.operationId);

    return result;
}
