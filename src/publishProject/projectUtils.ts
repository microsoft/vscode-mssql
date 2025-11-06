/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import * as path from "path";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { promises as fs } from "fs";
import { DOMParser } from "@xmldom/xmldom";
import { getSqlServerContainerVersions, dockerLogger } from "../deployment/dockerUtils";
import { FormItemOptions } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";
import { ProjectPropertiesResult } from "../sharedInterfaces/publishDialog";

/**
 * Checks if preview features are enabled in VS Code settings for SQL Database Projects.
 * @returns true if preview features are enabled, false otherwise
 */
export function isPreviewFeaturesEnabled(): boolean {
    return (
        vscode.workspace
            .getConfiguration(constants.DBProjectConfigurationKey)
            .get<boolean>(constants.enableSqlProjPreviewFeaturesKey) ?? false
    );
}

/**
 * Target platforms for a SQL project - these are user-facing display names shown in the VS Code UI.
 * The corresponding internal version numbers used by DacFx are defined in targetPlatformToVersion map.
 * Maps Dacfx Microsoft.Data.Tools.Schema.SchemaModel.SqlPlatformNames to vscode display names.
 */
export const enum SqlTargetPlatform {
    sqlServer2012 = "SQL Server 2012",
    sqlServer2014 = "SQL Server 2014",
    sqlServer2016 = "SQL Server 2016",
    sqlServer2017 = "SQL Server 2017",
    sqlServer2019 = "SQL Server 2019",
    sqlServer2022 = "SQL Server 2022",
    sqlServer2025 = "SQL Server 2025",
    sqlAzure = "Azure SQL Database",
    sqlDW = "Azure Synapse SQL Pool",
    sqlDwServerless = "Azure Synapse Serverless SQL Pool",
    sqlDwUnified = "Synapse Data Warehouse in Microsoft Fabric",
    sqlDbFabric = "SQL database in Fabric (preview)",
}

/**
 * SQL target platforms Map to their corresponding version numbers
 * Note: the values here must match values from Microsoft.Data.Tools.Schema.SchemaModel.SqlPlatformNames
 */
export const targetPlatformToVersion: Map<string, string> = new Map<string, string>([
    [SqlTargetPlatform.sqlServer2012, "110"],
    [SqlTargetPlatform.sqlServer2014, "120"],
    [SqlTargetPlatform.sqlServer2016, "130"],
    [SqlTargetPlatform.sqlServer2017, "140"],
    [SqlTargetPlatform.sqlServer2019, "150"],
    [SqlTargetPlatform.sqlServer2022, "160"],
    [SqlTargetPlatform.sqlServer2025, "170"],
    [SqlTargetPlatform.sqlAzure, "AzureV12"],
    [SqlTargetPlatform.sqlDW, "Dw"],
    [SqlTargetPlatform.sqlDwServerless, "Serverless"],
    [SqlTargetPlatform.sqlDwUnified, "DwUnified"],
    [SqlTargetPlatform.sqlDbFabric, "DbFabric"],
]);

/**
 * Maps DSP version numbers to SQL Server release years.
 * Add new versions here as they become available.
 */
const DSP_VERSION_TO_YEAR: Map<number, number> = new Map([
    [170, 2025], // SQL Server 2025
    [160, 2022], // SQL Server 2022
    [150, 2019], // SQL Server 2019
    [140, 2017], // SQL Server 2017
    [130, 2016], // SQL Server 2016
    [120, 2014], // SQL Server 2014
    [110, 2012], // SQL Server 2012
]);

/**
 * Get project properties from the tools service and extract the target platform version portion
 * of the DatabaseSchemaProvider (e.g. 130, 150, 160, AzureV12, AzureDw, etc.).
 * @param sqlProjectsService - The SQL Projects Service instance to use for retrieving project properties
 * @param projectFilePath - The absolute path to the .sqlproj file
 * @returns The target version string (e.g. "150", "AzureV12"), or undefined if it cannot be determined or the service call fails
 */
export async function getProjectTargetVersion(
    sqlProjectsService: SqlProjectsService | mssql.ISqlProjectsService,
    projectFilePath: string,
): Promise<string | undefined> {
    try {
        if (!projectFilePath) {
            return undefined;
        }
        const result = await sqlProjectsService.getProjectProperties(projectFilePath);
        if (!result?.success) {
            return undefined;
        }
        const dsp = result.databaseSchemaProvider;
        if (!dsp || !dsp.startsWith(constants.DSP_PREFIX) || !dsp.endsWith(constants.DSP_SUFFIX)) {
            return undefined;
        }
        const version = dsp.substring(
            constants.DSP_PREFIX.length,
            dsp.length - constants.DSP_SUFFIX.length,
        );
        // Basic sanity check: version should be non-empty and alphanumeric-ish
        if (!version || /[^A-Za-z0-9]/.test(version)) {
            return undefined;
        }
        return version;
    } catch {
        return undefined; // swallow errors to keep publish dialog resilient
    }
}

/**
 * Reads full project properties and augments with extracted targetVersion.
 * @param sqlProjectsService - The SQL Projects Service instance to use for retrieving project properties
 * @param projectFilePath - The absolute path to the .sqlproj file
 * @returns The project properties with an additional targetVersion field, or undefined if retrieval fails
 */
export async function readProjectProperties(
    sqlProjectsService: SqlProjectsService | mssql.ISqlProjectsService,
    projectFilePath: string,
): Promise<ProjectPropertiesResult | undefined> {
    try {
        if (!projectFilePath) {
            return undefined;
        }
        const result = await sqlProjectsService.getProjectProperties(projectFilePath as string);
        if (!result?.success) {
            return undefined;
        }
        const version = await getProjectTargetVersion(sqlProjectsService, projectFilePath);

        // Calculate DACPAC output path
        const projectDir = path.dirname(projectFilePath);
        const projectName = path.basename(projectFilePath, path.extname(projectFilePath));
        const outputPath = path.isAbsolute(result.outputPath)
            ? result.outputPath
            : path.join(projectDir, result.outputPath);
        const dacpacOutputPath = path.join(
            outputPath,
            `${projectName}${constants.DacpacExtension}`,
        );

        return {
            ...result,
            targetVersion: version,
            projectFilePath: projectFilePath,
            dacpacOutputPath: dacpacOutputPath,
        };
    } catch {
        return undefined;
    }
}

/**
 * Gets the appropriate server name display string based on the target version.
 * @param target - The target version string (e.g. "AzureV12", "150")
 * @returns "Azure SQL server" for Azure SQL Database, "SQL server" for all other targets
 */
export function getPublishServerName(target: string) {
    return target === targetPlatformToVersion.get(SqlTargetPlatform.sqlAzure)
        ? constants.AzureSqlServerName
        : constants.SqlServerName;
}

/**
 * Validates the SQL Server port number.
 * @param port - The port number to validate
 * @returns true if the port is a whole number between 1 and 65535, false otherwise
 */
export function validateSqlServerPortNumber(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= constants.MAX_PORT_NUMBER;
}

/**
 * Retrieves and filters SQL Server container tags based on project target version.
 * Used by Publish Project dialog to provide granular tag selection.
 *
 * This follows the same filtering logic as ADS (Azure Data Studio):
 * - If target version is known: filter to show versions >= target version year
 * - If target version is unknown: fallback to max available version year (like ADS)
 *
 * @param targetVersion - The SQL Server version (e.g., "160" for SQL Server 2022)
 * @returns Sorted array of tags filtered by version from deployment UI versions
 */
export async function getSqlServerContainerTagsForTargetVersion(
    targetVersion?: string,
): Promise<FormItemOptions[]> {
    try {
        // Get the deployment UI versions first
        const deploymentVersions = await getSqlServerContainerVersions();
        if (!deploymentVersions || deploymentVersions.length === 0) {
            return [];
        }

        const yearToOptionMap = new Map<number, FormItemOptions>();
        for (const option of deploymentVersions) {
            const year = parseInt(option.value);
            if (!isNaN(year)) {
                yearToOptionMap.set(year, option);
            }
        }

        if (yearToOptionMap.size === 0) {
            return deploymentVersions;
        }

        const availableYears = Array.from(yearToOptionMap.keys());
        const maxYear = Math.max(...availableYears);

        // Determine minimum year based on target version
        let minYear: number = maxYear;
        if (targetVersion) {
            const versionNum = parseInt(targetVersion);
            const mappedYear = DSP_VERSION_TO_YEAR.get(versionNum);
            minYear = mappedYear ?? maxYear;
        }

        // Filter the image tags that are >= minYear
        const filteredVersions: FormItemOptions[] = [];
        for (const [year, option] of yearToOptionMap.entries()) {
            if (year >= minYear) {
                filteredVersions.push(option);
            }
        }

        return filteredVersions;
    } catch (e) {
        dockerLogger.error(`Error filtering SQL Server container tags: ${getErrorMessage(e)}`);
        return [];
    }
}

/**
 * Read SQLCMD variables from publish profile text
 * @param profileText Publish profile XML text
 * @returns Object with SQLCMD variable names as keys and values
 */
export function readSqlCmdVariables(profileText: string): { [key: string]: string } {
    const sqlCmdVariables: { [key: string]: string } = {};

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(profileText, "application/xml");

        // Get all SqlCmdVariable elements
        const sqlCmdVarElements = xmlDoc.documentElement.getElementsByTagName("SqlCmdVariable");

        for (let i = 0; i < sqlCmdVarElements.length; i++) {
            const sqlCmdVar = sqlCmdVarElements[i];
            const varName = sqlCmdVar.getAttribute("Include");

            if (varName) {
                // Look for Value first (preferred for publish profiles), then DefaultValue
                let varValue = "";
                const valueElements = sqlCmdVar.getElementsByTagName("Value");
                const defaultValueElements = sqlCmdVar.getElementsByTagName("DefaultValue");

                if (valueElements.length > 0 && valueElements[0].firstChild) {
                    varValue = valueElements[0].firstChild.nodeValue || "";
                } else if (defaultValueElements.length > 0 && defaultValueElements[0].firstChild) {
                    varValue = defaultValueElements[0].firstChild.nodeValue || "";
                }

                sqlCmdVariables[varName] = varValue;
            }
        }
    } catch (error) {
        console.warn("Failed to parse SQLCMD variables from XML:", error);
    }

    return sqlCmdVariables;
}

/**
 * Read connection string from publish profile text
 * @param profileText Publish profile XML text
 * @returns Connection string and server name
 */
export function readConnectionString(profileText: string): {
    connectionString: string;
    server: string;
} {
    // Parse TargetConnectionString
    const connStrMatch = profileText.match(
        /<TargetConnectionString>(.*?)<\/TargetConnectionString>/s,
    );
    const connectionString = connStrMatch ? connStrMatch[1].trim() : "";

    // Extract server name from connection string
    const server = extractServerFromConnectionString(connectionString);

    return { connectionString, server };
}

/**
 * Extracts the server name from a SQL Server connection string
 */
export function extractServerFromConnectionString(connectionString: string): string {
    if (!connectionString) {
        return "";
    }

    // Match "Data Source=serverName" or "Server=serverName" (case-insensitive)
    // TODO: currently returning the whole connection string, need to revisit with server|database connection task
    const match = connectionString.match(/(?:Data Source|Server)=([^;]+)/i);
    return match ? match[1].trim() : "";
}

/**
 * Parses a publish profile XML file to extract database name, connection string, SQLCMD variables, and deployment options
 * Uses regex parsing for XML fields and DacFx service getOptionsFromProfile() for deployment options
 * @param profilePath Path to the publish profile XML file
 * @param dacFxService DacFx service instance for getting deployment options from profile
 */
export async function parsePublishProfileXml(
    profilePath: string,
    dacFxService?: mssql.IDacFxService,
): Promise<{
    databaseName: string;
    serverName: string;
    connectionString: string;
    sqlCmdVariables: { [key: string]: string };
    deploymentOptions?: mssql.DeploymentOptions;
}> {
    try {
        const profileText = await fs.readFile(profilePath, "utf-8");

        // Read target database name
        // if there is more than one TargetDatabaseName nodes, SSDT uses the name in the last one so we'll do the same here
        let databaseName = "";
        const dbNameMatches = profileText.matchAll(
            /<TargetDatabaseName>(.*?)<\/TargetDatabaseName>/g,
        );
        const dbNameArray = Array.from(dbNameMatches);
        if (dbNameArray.length > 0) {
            databaseName = dbNameArray[dbNameArray.length - 1][1];
        }

        // Read connection string using readConnectionString function
        const connectionInfo = readConnectionString(profileText);
        const connectionString = connectionInfo.connectionString;
        const serverName = connectionInfo.server;

        // Get all SQLCMD variables using readSqlCmdVariables function
        const sqlCmdVariables = readSqlCmdVariables(profileText);

        // Get deployment options from DacFx service using getOptionsFromProfile
        let deploymentOptions: mssql.DeploymentOptions | undefined = undefined;
        if (dacFxService) {
            try {
                const optionsResult = await dacFxService.getOptionsFromProfile(profilePath);
                if (optionsResult.success && optionsResult.deploymentOptions) {
                    deploymentOptions = optionsResult.deploymentOptions;
                }
            } catch (error) {
                console.warn("Failed to load deployment options from profile:", error);
            }
        }

        return { databaseName, serverName, connectionString, sqlCmdVariables, deploymentOptions };
    } catch (error) {
        throw new Error(`Failed to parse publish profile: ${error}`);
    }
}
