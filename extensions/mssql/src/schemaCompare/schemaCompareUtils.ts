/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { DOMParser, Element as XmlElement, XMLSerializer } from "@xmldom/xmldom";
import { uuid } from "../utils/utils";
import {
    SchemaCompareEndpointType,
    SchemaCompareIncludeExcludeAllParams,
    SchemaCompareIncludeExcludeNodeParams,
    SchemaCompareReducers,
    TaskExecutionMode,
} from "../sharedInterfaces/schemaCompare";
import * as locConstants from "../constants/locConstants";
import { ILogger } from "../sharedInterfaces/logger";
/**
 * A constant string representing the command to publish schema compare changes
 * for SQL database projects.
 *
 * This command is used to trigger the publishing of project changes in the
 * schema compare feature of the SQL Database Projects extension.
 */
export const sqlDatabaseProjectsPublishChanges =
    "sqlDatabaseProjects.schemaComparePublishProjectChanges";
const sqlDatabaseProjectsExtensionId = "ms-mssql.sql-database-projects-vscode";

export interface ScmpProjectEndpointDetails {
    projectGuid?: string;
    projectName: string;
    projectFilePath: string;
    targetScripts: string[];
    dataSchemaProvider: string;
}

/**
 * Upgrades the project endpoints written by classic SSDT Schema Compare. Those endpoints only
 * persist a project GUID and name; portable DacFx requires the project path, scripts, and DSP.
 */
export function upgradeLegacyScmpProjectEndpoints(
    content: string,
    projects: ScmpProjectEndpointDetails[],
): { content: string; changed: boolean } {
    const document = new DOMParser().parseFromString(content, "application/xml");
    const providers = Array.from(document.getElementsByTagName("ProjectBasedModelProvider"));
    let changed = false;

    const directChildText = (element: XmlElement, name: string): string | undefined => {
        for (let index = 0; index < element.childNodes.length; index++) {
            const child = element.childNodes.item(index);
            if (child?.nodeType === 1 && child.nodeName === name) {
                return child.textContent?.trim();
            }
        }
        return undefined;
    };
    const normalizeGuid = (value: string | undefined): string | undefined =>
        value?.replace(/[{}]/g, "").toLowerCase();

    for (const provider of providers) {
        if (directChildText(provider, "ProjectFilePath")) {
            continue;
        }

        const projectGuid = normalizeGuid(directChildText(provider, "ProjectGuid"));
        const projectName = directChildText(provider, "Name") ?? "unknown project";
        let matches = projectGuid
            ? projects.filter((project) => normalizeGuid(project.projectGuid) === projectGuid)
            : [];
        if (matches.length === 0) {
            matches = projects.filter(
                (project) => project.projectName.toLowerCase() === projectName.toLowerCase(),
            );
        }

        if (matches.length !== 1) {
            throw new Error(
                matches.length === 0
                    ? locConstants.SchemaCompare.classicScmpProjectNotFound(projectName)
                    : locConstants.SchemaCompare.classicScmpProjectAmbiguous(projectName),
            );
        }

        const match = matches[0];
        const append = (name: string, value: string) => {
            const element = document.createElement(name);
            element.appendChild(document.createTextNode(value));
            provider.appendChild(element);
        };
        append("ProjectFilePath", match.projectFilePath);
        append("TargetScripts", `[${match.targetScripts.join(",")}]`);
        append("Dsp", match.dataSchemaProvider);
        append("FolderStructure", "SchemaObjectType");
        changed = true;
    }

    return {
        content: changed ? new XMLSerializer().serializeToString(document) : content,
        changed,
    };
}

async function prepareScmpForPortableDacFx(filePath: string): Promise<{
    filePath: string;
    cleanup?: () => Promise<void>;
}> {
    const content = await fs.readFile(filePath, "utf8");
    if (!content.includes("<ProjectBasedModelProvider") || !content.includes("<ProjectGuid")) {
        return { filePath };
    }

    const extension = vscode.extensions.getExtension(sqlDatabaseProjectsExtensionId);
    if (!extension) {
        throw new Error(locConstants.SchemaCompare.classicScmpSqlProjectsRequired);
    }
    const projectApi = (await extension.activate()) as {
        getProjectScriptFiles(projectFilePath: string): Promise<string[]>;
        getProjectDatabaseSchemaProvider(projectFilePath: string): Promise<string>;
    };
    const projectUris = await vscode.workspace.findFiles(
        "**/*.sqlproj",
        "**/{node_modules,.git,bin,obj}/**",
    );
    const projects = await Promise.all(
        projectUris.map(async (uri): Promise<ScmpProjectEndpointDetails> => {
            const projectContent = await fs.readFile(uri.fsPath, "utf8");
            const projectDocument = new DOMParser().parseFromString(
                projectContent,
                "application/xml",
            );
            const projectGuid = projectDocument
                .getElementsByTagName("ProjectGuid")
                .item(0)
                ?.textContent?.trim();
            return {
                projectGuid,
                projectName: path.parse(uri.fsPath).name,
                projectFilePath: uri.fsPath,
                targetScripts: await projectApi.getProjectScriptFiles(uri.fsPath),
                dataSchemaProvider: await projectApi.getProjectDatabaseSchemaProvider(uri.fsPath),
            };
        }),
    );
    const upgraded = upgradeLegacyScmpProjectEndpoints(content, projects);
    if (!upgraded.changed) {
        return { filePath };
    }

    const temporaryPath = path.join(os.tmpdir(), `vscode-mssql-${uuid()}.scmp`);
    await fs.writeFile(temporaryPath, upgraded.content, "utf8");
    return {
        filePath: temporaryPath,
        cleanup: async () => {
            await fs.unlink(temporaryPath).catch(() => undefined);
        },
    };
}

/**
 * Generates a unique operation ID.
 *
 * @returns A new GUID representing the operation ID.
 */
export function generateOperationId(): string {
    return uuid();
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
    } catch {
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
 * @param logger - ILogger instance for diagnostic logging.
 * @returns A promise that resolves to the result status of the script generation operation.
 */
export async function generateScript(
    operationId: string,
    taskExecutionMode: TaskExecutionMode,
    payload: SchemaCompareReducers["generateScript"],
    schemaCompareService: mssql.ISchemaCompareService,
    logger?: ILogger,
): Promise<mssql.ResultStatus> {
    logger?.debug(
        `[schemaCompareUtils] generateScript called - operationId: ${operationId}, taskExecutionMode: ${taskExecutionMode} - OperationId: ${operationId}`,
    );
    logger?.debug(
        `[schemaCompareUtils] Payload - hasTargetServerName: ${!!payload?.targetServerName}, hasTargetDatabaseName: ${!!payload?.targetDatabaseName} - OperationId: ${operationId}`,
    );
    logger?.debug(
        `[schemaCompareUtils] Calling schemaCompareService.generateScript - OperationId: ${operationId}`,
    );

    const result = await schemaCompareService.generateScript(
        operationId,
        payload.targetServerName,
        payload.targetDatabaseName,
        taskExecutionMode,
    );

    logger?.debug(
        `[schemaCompareUtils] schemaCompareService.generateScript returned - success: ${result?.success}, hasErrorMessage: ${!!result?.errorMessage} - OperationId: ${operationId}`,
    );

    if (result) {
        logger?.debug(
            `[schemaCompareUtils] Result object type: ${typeof result}, keys: ${Object.keys(result).join(", ")} - OperationId: ${operationId}`,
        );
        logger?.debug(
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

    logger?.debug(`[schemaCompareUtils] Returning result - OperationId: ${operationId}`);
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
): Promise<mssql.SchemaComparePublishProjectResult> {
    // SQL Projects owns the .sqlproj and must add or remove explicit Build entries after
    // DacFx changes the files. Calling the Schema Compare service directly bypasses that work.
    return (await vscode.commands.executeCommand<mssql.SchemaComparePublishProjectResult>(
        sqlDatabaseProjectsPublishChanges,
        operationId,
        payload.targetProjectPath,
        payload.targetFolderStructure,
    )) as mssql.SchemaComparePublishProjectResult;
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
    payload: SchemaCompareIncludeExcludeNodeParams,
    schemaCompareService: mssql.ISchemaCompareService,
    logger?: ILogger,
): Promise<mssql.SchemaCompareIncludeExcludeResult> {
    logger?.trace(
        `[schemaCompareUtils] includeExcludeNode called - operationId: ${operationId}, includeRequest: ${payload.includeRequest}, diffEntry type: ${payload.diffEntry?.name}`,
    );
    logger?.debug(
        `[schemaCompareUtils] Diff entry ID: ${payload.id}, taskExecutionMode: ${taskExecutionMode}`,
    );

    const startTime = Date.now();
    const result = await schemaCompareService.includeExcludeNode(
        operationId,
        payload.diffEntry,
        payload.includeRequest,
        taskExecutionMode,
    );

    const elapsed = Date.now() - startTime;
    logger?.trace(
        `[schemaCompareUtils] includeExcludeNode service returned after ${elapsed}ms - success: ${result?.success}`,
    );

    if (result) {
        logger?.trace(
            `[schemaCompareUtils] Affected dependencies: ${result.affectedDependencies?.length || 0}, Blocking dependencies: ${result.blockingDependencies?.length || 0}`,
        );

        if (result.errorMessage) {
            logger?.error(`[schemaCompareUtils] Error message: ${result.errorMessage}`);
        }
    } else {
        logger?.warn(`[schemaCompareUtils] includeExcludeNode returned null or undefined`);
    }

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
    payload: SchemaCompareIncludeExcludeAllParams,
    schemaCompareService: mssql.ISchemaCompareService,
    logger?: ILogger,
): Promise<mssql.SchemaCompareIncludeExcludeAllResult> {
    logger?.debug(
        `[schemaCompareUtils] includeExcludeAllNodes called - operationId: ${operationId}, includeRequest: ${payload.includeRequest}`,
    );
    logger?.debug(`[schemaCompareUtils] taskExecutionMode: ${taskExecutionMode}`);

    const startTime = Date.now();
    logger?.debug(`[schemaCompareUtils] Calling schemaCompareService.includeExcludeAllNodes`);

    const result = await schemaCompareService.includeExcludeAllNodes(
        operationId,
        payload.includeRequest,
        taskExecutionMode,
    );

    const elapsed = Date.now() - startTime;
    logger?.debug(
        `[schemaCompareUtils] includeExcludeAllNodes service returned after ${elapsed}ms - success: ${result?.success}`,
    );

    if (result) {
        logger?.debug(
            `[schemaCompareUtils] Result differences count: ${result.allIncludedOrExcludedDifferences?.length || 0}`,
        );

        if (result.errorMessage) {
            logger?.error(`[schemaCompareUtils] Error message: ${result.errorMessage}`);
        }

        // Check for potential recursion issues based on elapsed time
        if (elapsed > 30000) {
            // More than 30 seconds
            logger?.warn(
                `[schemaCompareUtils] includeExcludeAllNodes took unusually long (${elapsed}ms), possible performance issue`,
            );
        }
    } else {
        logger?.warn(`[schemaCompareUtils] includeExcludeAllNodes returned null or undefined`);
    }

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
    logger?: ILogger,
): Promise<mssql.SchemaCompareOpenScmpResult> {
    logger?.debug(
        `[schemaCompareUtils] openScmp called with file path length: ${filePath?.length || 0}`,
    );
    logger?.debug(`[schemaCompareUtils] Calling schemaCompareService.openScmp`);

    const preparedScmp = await prepareScmpForPortableDacFx(filePath);
    let result: mssql.SchemaCompareOpenScmpResult;
    try {
        result = await schemaCompareService.openScmp(preparedScmp.filePath);
    } finally {
        await preparedScmp.cleanup?.();
    }

    logger?.debug(
        `[schemaCompareUtils] openScmp service returned - success: ${result?.success}, hasErrorMessage: ${!!result?.errorMessage}`,
    );

    if (result) {
        logger?.debug(
            `[schemaCompareUtils] Result has sourceEndpointInfo: ${!!result.sourceEndpointInfo}, targetEndpointInfo: ${!!result.targetEndpointInfo}`,
        );

        if (result.sourceEndpointInfo) {
            logger?.debug(
                `[schemaCompareUtils] Source endpoint type: ${result.sourceEndpointInfo.endpointType}`,
            );
        }

        if (result.targetEndpointInfo) {
            logger?.debug(
                `[schemaCompareUtils] Target endpoint type: ${result.targetEndpointInfo.endpointType}`,
            );
        }

        if (result.errorMessage) {
            logger?.error(`[schemaCompareUtils] Error message: ${result.errorMessage}`);
        }
    } else {
        logger?.warn(`[schemaCompareUtils] openScmp returned null or undefined result`);
    }

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
