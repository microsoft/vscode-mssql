/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * What kind of SQL Server we are talking to, and what it can actually do.
 *
 * The differences that matter here are not cosmetic: Azure SQL Database has no server-scoped
 * DMVs and no SQL Server Agent, Express has no Agent either, and Synapse pools do not expose
 * the execution DMVs at all. Getting this wrong produces object-not-found errors that read as
 * bugs, so every feature is gated on what the server reports rather than on assumption.
 *
 * Engine edition values mirror `DatabaseEngineEdition` in
 * `extensions/mssql/src/databaseProjects/common/enums.ts`, which is the repo's source of truth
 * and is itself kept in sync with vscode-mssql.d.ts.
 */

/** `SERVERPROPERTY('EngineEdition')`. Mirrors DatabaseEngineEdition. */
export const EngineEdition = {
    Unknown: 0,
    /** Personal / Desktop, legacy. */
    Personal: 1,
    /** Standard, Web and Business Intelligence. */
    Standard: 2,
    /** Enterprise, Developer and Evaluation. */
    Enterprise: 3,
    Express: 4,
    /** Azure SQL Database. */
    SqlDatabase: 5,
    /** Azure Synapse Analytics dedicated SQL pool. */
    SqlDataWarehouse: 6,
    /** Azure SQL Stretch Database (retired service, still reported by older servers). */
    SqlStretchDatabase: 7,
    /** Azure SQL Managed Instance. */
    SqlManagedInstance: 8,
    /**
     * Azure SQL Edge. Not present in the repo's DatabaseEngineEdition enum, but a real value
     * SERVERPROPERTY can return, so it is handled rather than falling through to Unknown.
     */
    SqlEdge: 9,
    /** Azure Synapse serverless SQL pool. */
    SqlOnDemand: 11,
    /** SQL database in Microsoft Fabric. */
    SqlDbFabric: 12,
} as const;

/** Platform families that features are gated against. */
export type Platform =
    | "sqlServer"
    | "azureSqlDatabase"
    | "managedInstance"
    | "synapseDedicated"
    | "synapseServerless"
    | "stretchDatabase"
    | "sqlEdge"
    | "fabric"
    | "unknown";

export interface ServerCapabilities {
    readonly platform: Platform;
    readonly engineEditionId?: number;
    /** `SERVERPROPERTY('Edition')`, e.g. "Developer Edition (64-bit)". */
    readonly edition?: string;
    /** Major version, e.g. 16 for SQL Server 2022. */
    readonly majorVersion?: number;
    readonly productVersion?: string;
    readonly database?: string;
    readonly serverName?: string;

    /** SQL Server Agent exists and can own jobs. */
    readonly hasSqlAgent: boolean;
    /** Server-scoped DMVs such as sys.dm_os_wait_stats are visible. */
    readonly hasServerScopedDmvs: boolean;
    /** The execution DMVs (dm_exec_requests, dm_exec_query_stats) behave normally. */
    readonly hasExecutionDmvs: boolean;
    /** Query Store exists here; it may still be switched off for the database. */
    readonly hasQueryStore: boolean;
    /** Where Extended Events sessions live, if anywhere. */
    readonly xeventScope: "server" | "database" | "none";
}

/** Human name for a platform, for messages a user reads. */
export const platformNames: Readonly<Record<Platform, string>> = {
    sqlServer: "SQL Server",
    azureSqlDatabase: "Azure SQL Database",
    managedInstance: "Azure SQL Managed Instance",
    synapseDedicated: "Azure Synapse Analytics dedicated SQL pool",
    synapseServerless: "Azure Synapse Analytics serverless SQL pool",
    stretchDatabase: "Azure SQL Stretch Database",
    sqlEdge: "Azure SQL Edge",
    fabric: "SQL database in Microsoft Fabric",
    unknown: "this server",
};

export function platformFromEngineEdition(engineEditionId: number | undefined): Platform {
    switch (engineEditionId) {
        case EngineEdition.Personal:
        case EngineEdition.Standard:
        case EngineEdition.Enterprise:
        case EngineEdition.Express:
            return "sqlServer";
        case EngineEdition.SqlDatabase:
            return "azureSqlDatabase";
        case EngineEdition.SqlDataWarehouse:
            return "synapseDedicated";
        case EngineEdition.SqlStretchDatabase:
            return "stretchDatabase";
        case EngineEdition.SqlManagedInstance:
            return "managedInstance";
        case EngineEdition.SqlEdge:
            return "sqlEdge";
        case EngineEdition.SqlOnDemand:
            return "synapseServerless";
        case EngineEdition.SqlDbFabric:
            return "fabric";
        default:
            return "unknown";
    }
}

/** True for editions that ship without SQL Server Agent. */
export function editionLacksAgent(
    engineEditionId: number | undefined,
    edition: string | undefined,
): boolean {
    if (engineEditionId === EngineEdition.Express) {
        return true;
    }
    // Also identifiable by name, which matters when EngineEdition is unavailable.
    return /express/i.test(edition ?? "");
}

/**
 * What each platform supports.
 *
 * Where a platform's behaviour is uncertain the entry is deliberately conservative: gating a
 * feature off produces a clear "not available here" message, while guessing wrong produces an
 * object-not-found error the user cannot act on.
 */
const platformSupport: Readonly<
    Record<
        Platform,
        Pick<
            ServerCapabilities,
            | "hasSqlAgent"
            | "hasServerScopedDmvs"
            | "hasExecutionDmvs"
            | "hasQueryStore"
            | "xeventScope"
        >
    >
> = {
    sqlServer: {
        hasSqlAgent: true, // narrowed for Express below
        hasServerScopedDmvs: true,
        hasExecutionDmvs: true,
        hasQueryStore: true,
        xeventScope: "server",
    },
    managedInstance: {
        hasSqlAgent: true,
        hasServerScopedDmvs: true,
        hasExecutionDmvs: true,
        hasQueryStore: true,
        xeventScope: "server",
    },
    azureSqlDatabase: {
        // Elastic Jobs replaces Agent here, and sessions are database-scoped.
        hasSqlAgent: false,
        hasServerScopedDmvs: false,
        hasExecutionDmvs: true,
        hasQueryStore: true,
        xeventScope: "database",
    },
    sqlEdge: {
        // A trimmed engine: Agent and Query Store are absent, XEvents remain.
        hasSqlAgent: false,
        hasServerScopedDmvs: true,
        hasExecutionDmvs: true,
        hasQueryStore: false,
        xeventScope: "server",
    },
    fabric: {
        hasSqlAgent: false,
        hasServerScopedDmvs: false,
        hasExecutionDmvs: true,
        hasQueryStore: true,
        xeventScope: "database",
    },
    synapseDedicated: {
        // A dedicated pool has its own DMV surface (dm_pdw_*) that none of these queries target.
        hasSqlAgent: false,
        hasServerScopedDmvs: false,
        hasExecutionDmvs: false,
        hasQueryStore: false,
        xeventScope: "none",
    },
    synapseServerless: {
        hasSqlAgent: false,
        hasServerScopedDmvs: false,
        hasExecutionDmvs: false,
        hasQueryStore: false,
        xeventScope: "none",
    },
    stretchDatabase: {
        hasSqlAgent: false,
        hasServerScopedDmvs: false,
        hasExecutionDmvs: false,
        hasQueryStore: false,
        xeventScope: "none",
    },
    unknown: {
        // Nothing is offered against a server we cannot identify, rather than probing blindly.
        hasSqlAgent: false,
        hasServerScopedDmvs: false,
        hasExecutionDmvs: false,
        hasQueryStore: false,
        xeventScope: "none",
    },
};

/** Derives what a server can do from the properties it reports. */
export function capabilitiesFrom(info: {
    engineEditionId?: number;
    edition?: string;
    majorVersion?: number;
    productVersion?: string;
    database?: string;
    serverName?: string;
}): ServerCapabilities {
    const platform = platformFromEngineEdition(info.engineEditionId);
    const support = platformSupport[platform];
    const noAgentEdition = editionLacksAgent(info.engineEditionId, info.edition);

    return {
        platform,
        engineEditionId: info.engineEditionId,
        edition: info.edition,
        majorVersion: info.majorVersion,
        productVersion: info.productVersion,
        database: info.database,
        serverName: info.serverName,
        hasSqlAgent: support.hasSqlAgent && !noAgentEdition,
        hasServerScopedDmvs: support.hasServerScopedDmvs,
        hasExecutionDmvs: support.hasExecutionDmvs,
        hasQueryStore: support.hasQueryStore,
        xeventScope: support.xeventScope,
    };
}

/**
 * One query reporting everything the gating needs. Every property here exists on every
 * supported platform, so it is safe to run before we know what we are connected to.
 */
export const serverCapabilitiesSql = `
SELECT
    CONVERT(int, SERVERPROPERTY('EngineEdition'))                              AS engine_edition_id,
    CONVERT(nvarchar(256), SERVERPROPERTY('Edition'))                          AS edition,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion'))                   AS product_version,
    CONVERT(int, PARSENAME(CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')), 4)) AS major_version,
    CONVERT(nvarchar(256), SERVERPROPERTY('ServerName'))                       AS server_name,
    DB_NAME()                                                                  AS database_name`;

/**
 * Names the Extended Events catalog views for the connected platform. Azure SQL Database and
 * Fabric scope sessions to the database and use different views and a different ALTER scope.
 */
export function xeventCatalog(capabilities: ServerCapabilities): {
    sessions: string;
    runningSessions: string;
    scope: "SERVER" | "DATABASE";
} {
    if (capabilities.xeventScope === "database") {
        return {
            sessions: "sys.database_event_sessions",
            runningSessions: "sys.dm_xe_database_sessions",
            scope: "DATABASE",
        };
    }
    return {
        sessions: "sys.server_event_sessions",
        runningSessions: "sys.dm_xe_sessions",
        scope: "SERVER",
    };
}
