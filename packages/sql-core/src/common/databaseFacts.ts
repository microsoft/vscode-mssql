/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo, isFabricWarehouseFamily } from "./platform";
import { sessionPreamble } from "./session";
import { classifySqlError } from "./sqlErrors";
import { SqlReadOptions, SqlReader, readNumber, readString, toRecords } from "./sqlReader";

/** The size and tier of a database, for a header such as "General Purpose · 8 vCores". */
export interface DatabaseFacts {
    /**
     * SQL Server: `SERVERPROPERTY('Edition')`, for example "Developer Edition (64-bit)". Azure SQL
     * Database, SQL database in Fabric, and Synapse dedicated pools: the service tier from
     * `DATABASEPROPERTYEX`, for example "GeneralPurpose". Azure SQL Managed Instance: the SKU,
     * for example "GeneralPurpose".
     */
    readonly edition?: string;
    /**
     * `DATABASEPROPERTYEX(DB_NAME(), 'ServiceObjective')`, for example "GP_Gen5_8", "S2", or
     * "DW100c". Azure SQL Database, SQL database in Fabric, and Synapse dedicated pools.
     */
    readonly serviceObjective?: string;
    /**
     * Azure SQL Database, SQL database in Fabric, and Azure SQL Managed Instance. Absent for the
     * DTU tiers that get less than one vCore (Basic, S0, S1), where `cpu_limit` is 0.
     */
    readonly vCores?: number;
    /** SQL Server: the logical CPUs that the instance sees. */
    readonly logicalCpus?: number;
}

const editionQuery = `SELECT
    CONVERT(nvarchar(128), SERVERPROPERTY('Edition')) AS server_edition,
    CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Edition')) AS database_edition,
    CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'ServiceObjective')) AS service_objective;`;

/** Needs VIEW SERVER STATE, or VIEW SERVER PERFORMANCE STATE in SQL Server 2022 and later. */
const sqlServerCpuQuery = `SELECT cpu_count FROM sys.dm_os_sys_info;`;

/** Needs VIEW DATABASE STATE. */
const databaseVCoresQuery = `SELECT cpu_limit
FROM sys.dm_user_db_resource_governance
WHERE database_id = DB_ID();`;

const managedInstanceSkuQuery = `SELECT TOP (1) sku, virtual_core_count
FROM master.sys.server_resource_stats
ORDER BY end_time DESC;`;

/**
 * Reads the tier and size of the database. The values that need a permission the principal does
 * not have, or that the platform does not have, are left out. Fabric Data Warehouse, the SQL
 * analytics endpoint, and Synapse serverless pools have no tier or size, so nothing is read.
 */
export async function readDatabaseFacts(
    reader: SqlReader,
    info: PlatformInfo,
    options?: SqlReadOptions,
): Promise<DatabaseFacts> {
    if (
        isFabricWarehouseFamily(info) ||
        info.platform === "synapseServerless" ||
        info.platform === "unknown"
    ) {
        return {};
    }
    const read = async (sql: string) => {
        const [resultSet] = await reader.read(`${sessionPreamble(info, "read")}\n${sql}`, options);
        return toRecords(resultSet)[0];
    };
    /** Reads a value that can be denied or missing. */
    const readOptional = async (sql: string) => {
        try {
            return await read(sql);
        } catch (error) {
            const kind = classifySqlError(error);
            if (kind === "permission" || kind === "unsupported") {
                return undefined;
            }
            throw error;
        }
    };

    const editions = await read(editionQuery);
    const serverEdition = editions && readString(editions, "server_edition");
    const databaseEdition = editions && readString(editions, "database_edition");
    const serviceObjective = editions && readString(editions, "service_objective");

    switch (info.platform) {
        case "sqlServer": {
            const cpu = await readOptional(sqlServerCpuQuery);
            return withValues({
                edition: serverEdition,
                logicalCpus: positive(cpu && readNumber(cpu, "cpu_count")),
            });
        }
        case "azureSqlManagedInstance": {
            const sku = await readOptional(managedInstanceSkuQuery);
            return withValues({
                edition: sku && readString(sku, "sku"),
                vCores: positive(sku && readNumber(sku, "virtual_core_count")),
            });
        }
        case "azureSqlDatabase":
        case "fabricSqlDatabase": {
            const governance = await readOptional(databaseVCoresQuery);
            return withValues({
                edition: databaseEdition,
                serviceObjective,
                vCores: positive(governance && readNumber(governance, "cpu_limit")),
            });
        }
        default:
            return withValues({ edition: databaseEdition, serviceObjective });
    }
}

/** A core count, or undefined when it is not above 0. */
function positive(count: number | undefined): number | undefined {
    return count !== undefined && count > 0 ? count : undefined;
}

/** Leaves out the values that are undefined or empty. */
function withValues(facts: {
    [K in keyof DatabaseFacts]: DatabaseFacts[K] | undefined;
}): DatabaseFacts {
    return Object.fromEntries(
        Object.entries(facts).filter(([, value]) => value !== undefined && value !== ""),
    ) as DatabaseFacts;
}
