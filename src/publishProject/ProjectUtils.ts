/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Utilities specific to the Publish Project dialog (extension host side)

import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import { SqlProjectsService } from "../services/sqlProjectsService";

// Shape returned by sqlProjectsService.getProjectProperties (partial, only fields we use)
export interface ProjectProperties {
    projectGuid?: string;
    configuration?: string;
    outputPath: string;
    databaseSource?: string;
    defaultCollation: string;
    databaseSchemaProvider: string; // DSP
    projectStyle: unknown; // intentionally unknown to avoid heavy imports; cast at use sites
    targetVersion?: string; // extracted (e.g. 160, 150, AzureV12)
}

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

export const targetPlatformToVersion: Map<string, string> = new Map<string, string>([
    // Note: the values here must match values from Microsoft.Data.Tools.Schema.SchemaModel.SqlPlatformNames
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
        const props: ProjectProperties = {
            projectGuid: result.projectGuid,
            configuration: result.configuration,
            outputPath: result.outputPath,
            databaseSource: result.databaseSource,
            defaultCollation: result.defaultCollation,
            databaseSchemaProvider: result.databaseSchemaProvider,
            projectStyle: result.projectStyle,
            targetVersion: version,
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
