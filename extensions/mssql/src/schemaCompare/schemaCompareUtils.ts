/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import {
    SchemaCompareEndpointType,
    SchemaCompareReducers,
    TaskExecutionMode,
} from "../sharedInterfaces/schemaCompare";
import { generateGuid } from "../models/utils";
import * as locConstants from "../constants/locConstants";
import { Logger } from "../models/logger";
/**
 * A constant string representing the command to publish schema compare changes
 * for SQL database projects.
 *
 * This command is used to trigger the publishing of project changes in the
 * schema compare feature of the SQL Database Projects extension.
 */
export const sqlDatabaseProjectsPublishChanges =
    "sqlDatabaseProjects.schemaComparePublishProjectChanges";

/**
 * Generates a unique operation ID.
 *
 * @returns {string} A new GUID representing the operation ID.
 */
export function generateOperationId(): string {
    return generateGuid();
}

/**
 * Gets the starting file path for an open dialog.
 *
 * This function determines the initial file path to be used when opening a file dialog.
 * If the provided file path exists, it will be used as the starting path. Otherwise,
 * the root path will be used.
 *
 * @param filePath - The file path to check.
 * @returns A promise that resolves to the starting file path.
 */
export async function getStartingPathForOpenDialog(filePath?: string): Promise<string> {
    const rootPath = getRootPath();

    const startingFilePath = filePath && (await fileExists(filePath)) ? filePath : rootPath;

    return startingFilePath;
}

/**
 * Retrieves a file path from the user using a file dialog.
 *
 * @param payload - The payload containing the endpoint and file type information.
 * @returns A promise that resolves to the selected file path or undefined if no file was selected.
 */
export async function showOpenDialog(
    startingFilePath: string,
    filters: { [name: string]: string[] },
): Promise<string | undefined> {
    const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(startingFilePath),
        openLabel: locConstants.SchemaCompare.Open,
        filters: filters,
    });

    if (!fileUris || fileUris.length === 0) {
        return undefined;
    }

    const fileUri = fileUris[0];
    return fileUri.fsPath;
}

export async function showOpenDialogForDacpacOrSqlProj(
    filePath: string,
    filters: { [name: string]: string[] },
): Promise<string | undefined> {
    const startingFilePath = await getStartingPathForOpenDialog(filePath);

    const selectedFilePath = await showOpenDialog(startingFilePath, filters);

    return selectedFilePath;
}

export async function showOpenDialogForScmp(): Promise<string | undefined> {
    const startingFilePath = await getStartingPathForOpenDialog();

    const fileDialogFilters = {
        "scmp Files": ["scmp"],
    };

    const selectedFilePath = await showOpenDialog(startingFilePath, fileDialogFilters);

    return selectedFilePath;
}

export async function showSaveDialogForScmp(): Promise<string | undefined> {
    const startingFilePath = await getStartingPathForOpenDialog();

    const selectedSavePath = await showSaveDialog(startingFilePath);

    return selectedSavePath;
}

export async function showSaveDialog(startingFilePath: string): Promise<string | undefined> {
    const filePath = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(startingFilePath),
        saveLabel: locConstants.SchemaCompare.Save,
        filters: {
            "scmp Files": ["scmp"],
        },
    });

    if (!filePath) {
        return undefined;
    }

    return filePath.fsPath;
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
    taskExecutionMode: TaskExecutionMode,
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
 * @param logger - Logger instance for diagnostic logging.
 * @returns A promise that resolves to the result status of the script generation operation.
 */
export async function generateScript(
    operationId: string,
    taskExecutionMode: TaskExecutionMode,
    payload: SchemaCompareReducers["generateScript"],
    schemaCompareService: mssql.ISchemaCompareService,
    logger?: Logger,
): Promise<mssql.ResultStatus> {
    logger?.info(
        `[schemaCompareUtils] generateScript called - operationId: ${operationId}, taskExecutionMode: ${taskExecutionMode} - OperationId: ${operationId}`,
    );
    logger?.info(
        `[schemaCompareUtils] Payload - hasTargetServerName: ${!!payload?.targetServerName}, hasTargetDatabaseName: ${!!payload?.targetDatabaseName} - OperationId: ${operationId}`,
    );
    logger?.verbose(
        `[schemaCompareUtils] Calling schemaCompareService.generateScript - OperationId: ${operationId}`,
    );

    const result = await schemaCompareService.generateScript(
        operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        taskExecutionMode,
    );

    logger?.info(
        `[schemaCompareUtils] schemaCompareService.generateScript returned - success: ${result?.success}, hasErrorMessage: ${!!result?.errorMessage} - OperationId: ${operationId}`,
    );

    if (result) {
        logger?.info(
            `[schemaCompareUtils] Result object type: ${typeof result}, keys: ${Object.keys(result).join(", ")} - OperationId: ${operationId}`,
        );
        logger?.verbose(
            `[schemaCompareUtils] Full result JSON: ${JSON.stringify(result)} - OperationId: ${operationId}`,
        );
    } else {
        logger?.warn(
            `[schemaCompareUtils] Result is null or undefined - OperationId: ${operationId}`,
        );
    }

    if (result?.errorMessage) {
        logger?.error(
            `[schemaCompareUtils] Result contains error: ${result.errorMessage} - OperationId: ${operationId}`,
        );
    }

    logger?.info(`[schemaCompareUtils] Returning result - OperationId: ${operationId}`);
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
    taskExecutionMode: TaskExecutionMode,
    payload: SchemaCompareReducers["publishChanges"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.publishDatabaseChanges(
        operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        taskExecutionMode,
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
    // Extract the directory path from the project file path
    // The service expects a directory path, and not a file path.
    const projectDirectoryPath = path.dirname(payload.targetProjectPath);

    const result = await schemaCompareService.publishProjectChanges(
        operationId,
        projectDirectoryPath,
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
    const result = await schemaCompareService.schemaCompareGetDefaultOptions();

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
    taskExecutionMode: TaskExecutionMode,
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
 * Includes or excludes a node in the schema comparison.
 *
 * @param operationId - The ID of the schema comparison operation.
 * @param taskExecutionMode - The mode of task execution.
 * @param payload - The payload containing the details for including or excluding the node.
 * @param schemaCompareService - The service used to perform the include/exclude operation.
 * @returns A promise that resolves to the result of the include/exclude operation.
 */
export async function includeExcludeAllNodes(
    operationId: string,
    taskExecutionMode: TaskExecutionMode,
    payload: SchemaCompareReducers["includeExcludeAllNodes"],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareIncludeExcludeAllResult> {
    const result = await schemaCompareService.includeExcludeAllNodes(
        operationId,
        payload.includeRequest,
        taskExecutionMode,
    );

    return result;
}

/**
 * Opens a schema compare (.scmp) file and returns the result.
 *
 * @param filePath - The path to the .scmp file to be opened.
 * @param schemaCompareService - The service used to open the .scmp file.
 * @returns A promise that resolves to the result of opening the .scmp file.
 */
export async function openScmp(
    filePath: string,
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.SchemaCompareOpenScmpResult> {
    const result = await schemaCompareService.openScmp(filePath);

    return result;
}

/**
 * Saves the schema compare (.scmp) file with the provided parameters.
 *
 * @param sourceEndpointInfo - Information about the source endpoint.
 * @param targetEndpointInfo - Information about the target endpoint.
 * @param taskExecutionMode - The mode in which the task is executed.
 * @param deploymentOptions - Options for the deployment.
 * @param scmpFilePath - The file path where the .scmp file will be saved.
 * @param excludedSourceObjects - List of source objects to be excluded.
 * @param excludedTargetObjects - List of target objects to be excluded.
 * @param schemaCompareService - The schema compare service used to save the .scmp file.
 * @returns A promise that resolves to the result status of the save operation.
 */
export async function saveScmp(
    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
    targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
    taskExecutionMode: TaskExecutionMode,
    deploymentOptions: mssql.DeploymentOptions,
    scmpFilePath: string,
    excludedSourceObjects: mssql.SchemaCompareObjectId[],
    excludedTargetObjects: mssql.SchemaCompareObjectId[],
    schemaCompareService: mssql.ISchemaCompareService,
): Promise<mssql.ResultStatus> {
    const result = await schemaCompareService.saveScmp(
        sourceEndpointInfo,
        targetEndpointInfo,
        taskExecutionMode,
        deploymentOptions,
        scmpFilePath,
        excludedSourceObjects,
        excludedTargetObjects,
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

/**
 * Returns a string representation of the given SchemaCompareEndpointType.
 *
 * @param endpointType - The type of the schema compare endpoint.
 * @returns A string representing the schema compare endpoint type.
 *          Possible values are "Database", "Dacpac", "Project", or "Unknown: {endpointType}".
 */
export function getSchemaCompareEndpointTypeString(
    endpointType: SchemaCompareEndpointType,
): string {
    switch (endpointType) {
        case SchemaCompareEndpointType.Database:
            return "Database";
        case SchemaCompareEndpointType.Dacpac:
            return "Dacpac";
        case SchemaCompareEndpointType.Project:
            return "Project";
        default:
            return `Unknown: ${endpointType}`;
    }
}
