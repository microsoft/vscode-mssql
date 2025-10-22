/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { getSqlServerContainerVersions, dockerLogger } from "../deployment/dockerUtils";
import { FormItemOptions } from "../sharedInterfaces/form";
import { getErrorMessage } from "../utils/utils";

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
): Promise<(mssql.GetProjectPropertiesResult & { targetVersion?: string }) | undefined> {
    try {
        if (!projectFilePath) {
            return undefined;
        }
        const result = await sqlProjectsService.getProjectProperties(projectFilePath as string);
        if (!result?.success) {
            return undefined;
        }
        const version = await getProjectTargetVersion(sqlProjectsService, projectFilePath);
        return {
            ...result,
            targetVersion: version,
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

        // Determine minimum year based on target version
        let minYear = 2017; // Default to SQL Server 2017
        if (targetVersion) {
            const versionNum = parseInt(targetVersion, 10);
            // Find the corresponding year, or default to 2017 if not found
            minYear = DSP_VERSION_TO_YEAR.get(versionNum) ?? 2017;
        }

        // Filter deployment versions based on target version
        const filteredVersions = deploymentVersions.filter((option) => {
            const year = parseInt(option.displayName.match(/\d{4}/)?.[0] || "0", 10);
            return year >= minYear;
        });

        return filteredVersions;
    } catch (e) {
        dockerLogger.appendLine(`Error filtering SQL Server container tags: ${getErrorMessage(e)}`);
        return [];
    }
}
