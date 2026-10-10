/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlReader, readNumber, readString, toRecords } from "./sqlReader";

export type SqlPlatform =
    | "sqlServer"
    | "azureSqlManagedInstance"
    | "azureSqlDatabase"
    | "fabricSqlDatabase"
    | "synapseDedicated"
    | "synapseServerless"
    | "fabricWarehouse"
    | "fabricSqlAnalyticsEndpoint"
    | "unknown";

export interface PlatformInfo {
    readonly platform: SqlPlatform;
    readonly engineEdition: number;
    /** SQL Server major version, for example 16 for SQL Server 2022. Set only for `sqlServer`. */
    readonly majorVersion?: number;
}

export interface PlatformProbe {
    readonly engineEdition: number;
    readonly productVersion?: string;
    /** `sys.databases.data_lake_log_publishing_desc`. The column exists only in Fabric. */
    readonly dataLakeLogPublishing?: string;
}

/**
 * Reads the values that identify the platform. The batch runs on every supported platform.
 *
 * Fabric Data Warehouse and the SQL analytics endpoint do not support `COL_LENGTH`, so the batch
 * does not check for the Fabric column. It reads the column only for engine edition 11, in dynamic
 * SQL in a TRY block: on Synapse serverless, which has no such column, the read fails and the
 * value stays NULL.
 */
export const platformDetectionQuery = `
SET NOCOUNT ON;
DECLARE @engineEdition int = CONVERT(int, SERVERPROPERTY('EngineEdition'));
DECLARE @dataLakeLogPublishing nvarchar(60) = NULL;
IF @engineEdition = 11
BEGIN
    BEGIN TRY
        EXEC sp_executesql
            N'SELECT @value = data_lake_log_publishing_desc FROM sys.databases WHERE name = DB_NAME();',
            N'@value nvarchar(60) OUTPUT',
            @value = @dataLakeLogPublishing OUTPUT;
    END TRY
    BEGIN CATCH
        SET @dataLakeLogPublishing = NULL;
    END CATCH;
END;
SELECT
    @engineEdition AS engine_edition,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS product_version,
    @dataLakeLogPublishing AS data_lake_log_publishing;
`;

export async function detectPlatform(reader: SqlReader): Promise<PlatformInfo> {
    const [resultSet] = await reader.read(platformDetectionQuery);
    const [record] = toRecords(resultSet);
    if (!record) {
        return { platform: "unknown", engineEdition: 0 };
    }
    return classifyPlatform({
        engineEdition: readNumber(record, "engine_edition") ?? 0,
        productVersion: readString(record, "product_version"),
        dataLakeLogPublishing: readString(record, "data_lake_log_publishing"),
    });
}

/**
 * Maps `SERVERPROPERTY('EngineEdition')` and related values to a platform.
 */
export function classifyPlatform(probe: PlatformProbe): PlatformInfo {
    const engineEdition = probe.engineEdition;
    switch (engineEdition) {
        case 2:
        case 3:
        case 4:
            return {
                platform: "sqlServer",
                engineEdition,
                majorVersion: parseMajorVersion(probe.productVersion),
            };
        case 5:
            return { platform: "azureSqlDatabase", engineEdition };
        case 6:
            return { platform: "synapseDedicated", engineEdition };
        case 8:
            return { platform: "azureSqlManagedInstance", engineEdition };
        case 11:
            // Fabric Warehouse and the SQL analytics endpoint report data lake log publishing.
            // Synapse serverless does not have the column. Confirm on a live serverless pool.
            switch (probe.dataLakeLogPublishing?.toUpperCase()) {
                case "AUTO":
                    return { platform: "fabricWarehouse", engineEdition };
                case "UNSUPPORTED":
                    return { platform: "fabricSqlAnalyticsEndpoint", engineEdition };
                case undefined:
                    return { platform: "synapseServerless", engineEdition };
                default:
                    return { platform: "unknown", engineEdition };
            }
        case 12:
            return { platform: "fabricSqlDatabase", engineEdition };
        default:
            return { platform: "unknown", engineEdition };
    }
}

/**
 * True when the platform has Query Store with runtime statistics for each plan.
 */
export function hasQueryStore(info: PlatformInfo): boolean {
    switch (info.platform) {
        case "sqlServer":
            return (info.majorVersion ?? 0) >= 13;
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        default:
            return false;
    }
}

/**
 * True when Query Store has wait categories and the log and tempdb columns. SQL Server 2016 does
 * not have them.
 */
export function hasQueryStoreWaitsAndLogMetrics(info: PlatformInfo): boolean {
    return hasQueryStore(info) && !(info.platform === "sqlServer" && (info.majorVersion ?? 0) < 14);
}

/**
 * True when Query Store has the custom capture policy (`QUERY_CAPTURE_POLICY` and the
 * `capture_policy_*` columns): SQL Server 2019 and later, and the Azure platforms.
 */
export function hasQueryStoreCapturePolicy(info: PlatformInfo): boolean {
    switch (info.platform) {
        case "sqlServer":
            return (info.majorVersion ?? 0) >= 15;
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        default:
            return false;
    }
}

export function isFabricWarehouseFamily(info: PlatformInfo): boolean {
    return info.platform === "fabricWarehouse" || info.platform === "fabricSqlAnalyticsEndpoint";
}

function parseMajorVersion(productVersion: string | undefined): number | undefined {
    const major = Number(productVersion?.split(".")[0]);
    return Number.isInteger(major) && major > 0 ? major : undefined;
}
