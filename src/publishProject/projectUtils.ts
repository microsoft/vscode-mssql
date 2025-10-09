/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import * as path from "path";
import * as constants from "../constants/constants";
import { SqlProjectsService } from "../services/sqlProjectsService";
import type { ProjectProperties } from "../sharedInterfaces/publishDialog";
import { promises as fs } from "fs";

/**
 * Target platforms for a sql project
 */
export const enum SqlTargetPlatform {
    sqlServer2012 = "SQL Server 2012",
    sqlServer2014 = "SQL Server 2014",
    sqlServer2016 = "SQL Server 2016",
    sqlServer2017 = "SQL Server 2017",
    sqlServer2019 = "SQL Server 2019",
    sqlServer2022 = "SQL Server 2022",
    sqlAzure = "Azure SQL Database",
    sqlDW = "Azure Synapse SQL Pool",
    sqlEdge = "Azure SQL Edge",
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
    [SqlTargetPlatform.sqlAzure, "AzureV12"],
    [SqlTargetPlatform.sqlDW, "Dw"],
    [SqlTargetPlatform.sqlDwServerless, "Serverless"],
    [SqlTargetPlatform.sqlDwUnified, "DwUnified"],
    [SqlTargetPlatform.sqlDbFabric, "DbFabric"],
]);

/**
 * Get project properties from the tools service and extract the target platform version portion
 * of the DatabaseSchemaProvider (e.g. 130, 150, 160, AzureV12, AzureDw, etc.).
 * Returns undefined if it cannot be determined or the service call fails.
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
 * Returns undefined if retrieval fails.
 */
export async function readProjectProperties(
    sqlProjectsService: SqlProjectsService | mssql.ISqlProjectsService,
    projectFilePath: string,
): Promise<ProjectProperties | undefined> {
    try {
        if (!projectFilePath) {
            return undefined;
        }
        const result = await sqlProjectsService.getProjectProperties(projectFilePath as string);
        if (!result?.success) {
            return undefined;
        }
        const version = await getProjectTargetVersion(sqlProjectsService, projectFilePath);

        // Calculate project name and folder path from the project file path
        const projectName = path.basename(projectFilePath, path.extname(projectFilePath));
        const projectFolderPath = path.dirname(projectFilePath);

        const props: ProjectProperties = {
            projectGuid: result.projectGuid,
            configuration: result.configuration,
            outputPath: result.outputPath,
            databaseSource: result.databaseSource,
            defaultCollation: result.defaultCollation,
            databaseSchemaProvider: result.databaseSchemaProvider,
            projectStyle: result.projectStyle,
            targetVersion: version,
            projectName: projectName,
            projectFolderPath: projectFolderPath,
        };
        return props;
    } catch {
        return undefined;
    }
}

export function getPublishServerName(target: string) {
    return target ===
        targetPlatformToVersion.get("Azure SQL Database" /* SqlTargetPlatform.sqlAzure */)
        ? constants.AzureSqlServerName
        : constants.SqlServerName;
}

/*
 * Validates the SQL Server port number.
 */
export function validateSqlServerPortNumber(port: string | number | undefined): boolean {
    if (port === undefined) {
        return false;
    }
    const str = String(port).trim();
    if (str.length === 0) {
        return false;
    }
    // Must be all digits
    if (!/^[0-9]+$/.test(str)) {
        return false;
    }
    const n = Number(str);
    return n >= 1 && n <= constants.MAX_PORT_NUMBER;
}

/**
 * Returns true if password meets SQL complexity (length 8-128, does not contain login name,
 * and contains at least 3 of 4 categories: upper, lower, digit, symbol).
 */
export function isValidSqlAdminPassword(password: string, userName = "sa"): boolean {
    if (!password) {
        return false;
    }
    const containsUserName = !!userName && password.toUpperCase().includes(userName.toUpperCase());
    if (containsUserName) {
        return false;
    }
    if (password.length < 8 || password.length > 128) {
        return false;
    }
    const hasUpper = /[A-Z]/.test(password) ? 1 : 0;
    const hasLower = /[a-z]/.test(password) ? 1 : 0;
    const hasDigit = /\d/.test(password) ? 1 : 0;
    const hasSymbol = /\W/.test(password) ? 1 : 0;
    return hasUpper + hasLower + hasDigit + hasSymbol >= 3;
}

/**
 * Read SQLCMD variables from publish profile text
 * @param profileText Publish profile XML text
 * @returns Object with SQLCMD variable names as keys and values
 */
export function readSqlCmdVariables(profileText: string): { [key: string]: string } {
    const sqlCmdVariables: { [key: string]: string } = {};
    const sqlCmdVarRegex =
        /<SqlCmdVariable Include="([^"]+)">\s*<Value>(.*?)<\/Value>\s*<\/SqlCmdVariable>/gs;
    let match;
    while ((match = sqlCmdVarRegex.exec(profileText)) !== undefined) {
        if (!match) {
            break;
        }
        const varName = match[1];
        const varValue = match[2];
        sqlCmdVariables[varName] = varValue;
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
