/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
} from "../sharedInterfaces/schemaCompare";

/**
 * Compares the schema between the source and target endpoints.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the comparison parameters.
 * @param schemaCompareService - The service used to perform the schema comparison.
 * @returns A promise that resolves to the result of the schema comparison.
 */
export async function compare(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["compare"],
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

/**
 * Generates a deploy script for the schema comparison operation.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing parameters for generating the script.
 * @param schemaCompareService - The service used to perform schema comparison operations.
 * @returns A promise that resolves to the result status of the script generation operation.
 */
export async function generateScript(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["generateScript"],
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

/**
 * Publishes the database changes script using the provided schema compare service.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the details required to publish the database changes.
 * @param schemaCompareService - The service used to perform schema compare operations.
 * @returns A promise that resolves to the result status of the publish operation.
 */
export async function publishDatabaseChanges(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["publishDatabaseChanges"],
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

/**
 * Publishes the changes script from a schema compare operation to a database project.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the details required to publish the project changes.
 * @param schemaCompareService - The service used to perform schema compare operations.
 * @returns A promise that resolves to the result of the publish project changes operation.
 */
export async function publishProjectChanges(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["publishProjectChanges"],
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

/**
 * Retrieves the default schema compare options from the provided schema compare service.
 *
 * @param schemaCompareService - The service used to get the default schema compare options.
 * @returns A promise that resolves to the default schema compare options result.
 */
export async function getDefaultOptions(
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareOptionsResult> {
    const result = await schemaCompareService.getDefaultOptions();

    return result;
}

/**
 * Includes or excludes a node in the schema comparison.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the details for including or excluding the node.
 * @param schemaCompareService - The service used to perform the include/exclude operation.
 * @returns A promise that resolves to the result of the include/exclude operation.
 */
export async function includeExcludeNode(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["includeExcludeNode"],
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

/**
 * Opens a schema compare (.scmp) file and returns the result.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the file path of the .scmp file to open.
 * @param schemaCompareService - The service used to open the .scmp file.
 * @returns A promise that resolves to the result of opening the .scmp file.
 */
export async function openScmp(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["openScmp"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareOpenScmpResult> {
    const result = await schemaCompareService.openScmp(payload.filePath);

    return result;
}

/**
 * Saves the schema compare (.scmp) file using the provided state and payload.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the necessary information to save the .scmp file.
 * @param schemaCompareService - The service used to perform schema compare operations.
 * @returns A promise that resolves to the result status of the save operation.
 */
export async function saveScmp(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["saveScmp"],
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

/**
 * Cancels an ongoing schema comparison operation.
 *
 * @param state - The current state of the Schema Compare web view.
 * @param payload - The payload containing the operation ID to cancel.
 * @param schemaCompareService - The service used to perform schema comparison operations.
 * @returns A promise that resolves to the result status of the cancel operation.
 */
export async function cancel(
    state: SchemaCompareWebViewState,
    payload: SchemaCompareReducers["cancel"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.cancel(payload.operationId);

    return result;
}
