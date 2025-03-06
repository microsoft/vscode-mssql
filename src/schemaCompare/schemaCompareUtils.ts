/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as os from "os";
import { promises as fs } from "fs";
import { SchemaCompareReducers } from "../sharedInterfaces/schemaCompare";
import { generateGuid } from "../models/utils";

/**
 * Generates a unique operation ID.
 *
 * @returns {string} A new GUID representing the operation ID.
 */
export function generateOperationId(): string {
    return generateGuid();
}

/**
 * Retrieves a file path from the user using a file dialog.
 *
 * @param payload - The payload containing the endpoint and file type information.
 * @returns A promise that resolves to the selected file path or undefined if no file was selected.
 */
export async function openFileDialog(
    payload: SchemaCompareReducers["selectFile"],
): Promise<string> {
    const rootPath = getRootPath();
    const defaultUri =
        payload.endpoint &&
        payload.endpoint.packageFilePath &&
        (await fileExists(payload.endpoint.packageFilePath))
            ? payload.endpoint.packageFilePath
            : rootPath;

    const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(defaultUri),
        openLabel: "Open",
        filters: {
            Files: [payload.fileType],
        },
    });

    if (!fileUris || fileUris.length === 0) {
        return undefined;
    }

    const fileUri = fileUris[0];
    return fileUri.fsPath;
}

function getRootPath(): string {
    return vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : os.homedir();
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Compares the schema between the source and target endpoints.
 *
 * @param operationId - The ID of the schema comparison operation.
 * @param taskExecutionMode - The mode of task execution.
 * @param payload - The payload containing the comparison parameters.
 * @param schemaCompareService - The service used to perform the schema comparison.
 * @returns A promise that resolves to the result of the schema comparison.
 */
export async function compare(
    operationId: string,
    taskExecutionMode: mssql.TaskExecutionMode,
    payload: SchemaCompareReducers["compare"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareResult> {
    const result = await schemaCompareService.compare(
        operationId,
        payload.sourceEndpointInfo,
        payload.targetEndpointInfo,
        taskExecutionMode,
        payload.deploymentOptions,
    );

    return result;
}

/**
 * Generates a deploy script for the schema comparison operation.
 *
 * @param operationId - The ID of the schema comparison operation.
 * @param payload - The payload containing parameters for generating the script.
 * @param schemaCompareService - The service used to perform schema comparison operations.
 * @returns A promise that resolves to the result status of the script generation operation.
 */
export async function generateScript(
    operationId: string,
    payload: SchemaCompareReducers["generateScript"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.generateScript(
        operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        payload.taskExecutionMode,
    );

    return result;
}

/**
 * Publishes the database changes script using the provided schema compare service.
 *
 * @param operationId - The ID of the schema comparison operation.
 * @param payload - The payload containing the details required to publish the database changes.
 * @param schemaCompareService - The service used to perform schema compare operations.
 * @returns A promise that resolves to the result status of the publish operation.
 */
export async function publishDatabaseChanges(
    operationId: string,
    payload: SchemaCompareReducers["publishDatabaseChanges"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.publishDatabaseChanges(
        operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        payload.taskExecutionMode,
    );

    return result;
}

/**
 * Publishes the changes script from a schema compare operation to a database project.
 *
 * @param operationId - The ID of the schema comparison operation.
 * @param payload - The payload containing the details required to publish the project changes.
 * @param schemaCompareService - The service used to perform schema compare operations.
 * @returns A promise that resolves to the result of the publish project changes operation.
 */
export async function publishProjectChanges(
    operationId: string,
    payload: SchemaCompareReducers["publishProjectChanges"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaComparePublishProjectResult> {
    const result = await schemaCompareService.publishProjectChanges(
        operationId,
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
 * @param operationId - The ID of the schema comparison operation.
 * @param taskExecutionMode - The mode of task execution.
 * @param payload - The payload containing the details for including or excluding the node.
 * @param schemaCompareService - The service used to perform the include/exclude operation.
 * @returns A promise that resolves to the result of the include/exclude operation.
 */
export async function includeExcludeNode(
    operationId: string,
    taskExecutionMode: mssql.TaskExecutionMode,
    payload: SchemaCompareReducers["includeExcludeNode"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareIncludeExcludeResult> {
    const result = await schemaCompareService.includeExcludeNode(
        operationId,
        payload.diffEntry,
        payload.includeRequest,
        taskExecutionMode,
    );

    return result;
}

/**
 * Opens a schema compare (.scmp) file and returns the result.
 *
 * @param payload - The payload containing the file path of the .scmp file to open.
 * @param schemaCompareService - The service used to open the .scmp file.
 * @returns A promise that resolves to the result of opening the .scmp file.
 */
export async function openScmp(
    payload: SchemaCompareReducers["openScmp"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareOpenScmpResult> {
    const result = await schemaCompareService.openScmp(payload.filePath);

    return result;
}

/**
 * Saves the schema compare (.scmp) file using the provided state and payload.
 *
 * @param payload - The payload containing the necessary information to save the .scmp file.
 * @param schemaCompareService - The service used to perform schema compare operations.
 * @returns A promise that resolves to the result status of the save operation.
 */
export async function saveScmp(
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
 * @param operationId - The ID of the schema comparison operation to cancel.
 * @param schemaCompareService - The service used to perform schema comparison operations.
 * @returns A promise that resolves to the result status of the cancel operation.
 */
export async function cancel(
    operationId: string,
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.cancel(operationId);

    return result;
}
