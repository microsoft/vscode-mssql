/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The engine a document is analysed for.
 *
 * A profile names a product, not a version. Azure services do not map cleanly onto boxed SQL
 * Server major versions, so every platform decision in the package reads a profile and the
 * capabilities derived from it rather than comparing raw `engineEdition` numbers.
 *
 * `unknown` is a real state, not a placeholder for `sql-server`: it means the host has not yet
 * identified the engine authoritatively. Platform-unavailable decisions are deferred while it is
 * active so a document that is merely still connecting never shows a false restriction.
 */
export type SqlEngineProfile =
    | "sql-server"
    | "azure-sql-database"
    | "azure-sql-managed-instance"
    | "azure-synapse-dedicated"
    | "fabric-warehouse"
    | "unknown";

export const sqlEngineProfiles: readonly SqlEngineProfile[] = Object.freeze([
    "sql-server",
    "azure-sql-database",
    "azure-sql-managed-instance",
    "azure-synapse-dedicated",
    "fabric-warehouse",
    "unknown",
] as const);

/** Profiles that name an actual engine. `unknown` is deliberately excluded. */
export const resolvedSqlEngineProfiles: readonly SqlEngineProfile[] = Object.freeze(
    sqlEngineProfiles.filter((profile) => profile !== "unknown"),
);

const engineProfileDisplayNames: Readonly<Record<SqlEngineProfile, string>> = Object.freeze({
    "sql-server": "SQL Server",
    "azure-sql-database": "Azure SQL Database",
    "azure-sql-managed-instance": "Azure SQL Managed Instance",
    "azure-synapse-dedicated": "Azure Synapse dedicated SQL pool",
    "fabric-warehouse": "Fabric Data Warehouse",
    unknown: "an unidentified engine",
});

export function engineProfileDisplayName(profile: SqlEngineProfile): string {
    return engineProfileDisplayNames[profile];
}

export function isSqlEngineProfile(value: unknown): value is SqlEngineProfile {
    return typeof value === "string" && (sqlEngineProfiles as readonly string[]).includes(value);
}

/**
 * `SERVERPROPERTY('EngineEdition')` values.
 *
 * Mirrors `DatabaseEngineEdition` in SQL Management Objects
 * (`Microsoft/SqlServer/Management/ConnectionInfo/ConnectionEnums.cs`). The values are listed here
 * so the resolver is the single place in the package that reads the number at all.
 */
export const engineEditions = Object.freeze({
    unknown: 0,
    personal: 1,
    standard: 2,
    enterprise: 3,
    express: 4,
    azureSqlDatabase: 5,
    azureSynapseDedicated: 6,
    stretchDatabase: 7,
    azureSqlManagedInstance: 8,
    azureSqlEdge: 9,
    azureArcManagedInstance: 10,
    azureSynapseServerless: 11,
});

/**
 * Server facts a host can observe about a live connection.
 *
 * Every field is optional because a permission-limited or still-loading environment reports fewer
 * facts than a fully readable one, and a missing fact must never be read as a negative one.
 */
export interface EngineFacts {
    /** An authoritative host classification, used when endpoint aliases hide the product suffix. */
    readonly engineProfile?: SqlEngineProfile;
    /** `SERVERPROPERTY('EngineEdition')`. */
    readonly engineEdition?: number;
    /** `SERVERPROPERTY('ProductVersion')`, for example `16.0.1000.6`. */
    readonly serverVersion?: string;
    /** `sys.databases.compatibility_level` for the connected database. */
    readonly compatibilityLevel?: number;
    /**
     * The connected server's host name. Used only to separate Fabric Data Warehouse from Azure
     * Synapse serverless, which report the same engine edition.
     */
    readonly serverName?: string;
    /** Whether the host opted into syntax that has not reached general availability. */
    readonly previewFeatures?: boolean;
}

/** Why the resolver produced the profile it did. Recorded so a support view can explain it. */
export type EngineProfileSource =
    | "engineEdition"
    | "engineEditionAndServerName"
    | "noFacts"
    | "unrecognizedEdition"
    | "outOfScope"
    /** The host stated the profile directly, as an offline tool or a test harness does. */
    | "hostSupplied";

export interface EngineProfileResolution {
    readonly profile: SqlEngineProfile;
    readonly source: EngineProfileSource;
    /** One sentence a support view can show verbatim. Never contains a server or database name. */
    readonly reason: string;
    /** The facts the decision was made from, normalized. */
    readonly facts: EngineFacts;
}

/**
 * Fabric Data Warehouse and Azure Synapse serverless both report engine edition 11, so the
 * endpoint host name is the only fact that separates them. The suffixes match the Fabric endpoint
 * suffixes the extension already configures in `azure/providerSettings.ts`.
 */
const fabricHostSuffixes: readonly string[] = Object.freeze([
    ".datawarehouse.fabric.microsoft.com",
    ".datawarehouse.pbidedicated.windows.net",
    ".datawarehouse.pbidedicated.windows-int.net",
]);

/**
 * Maps observed server facts onto a profile.
 *
 * This is the only function in the package permitted to compare an engine-edition number. Every
 * other layer consumes a {@link SqlEngineProfile} or the capabilities derived from one.
 */
export function resolveEngineProfile(facts: EngineFacts | undefined): EngineProfileResolution {
    const normalized = normalizeFacts(facts);
    if (normalized.engineProfile && normalized.engineProfile !== "unknown") {
        return {
            profile: normalized.engineProfile,
            source: "hostSupplied",
            reason: "The host identified the connected engine authoritatively.",
            facts: normalized,
        };
    }
    const edition = normalized.engineEdition;
    if (edition === undefined || edition === engineEditions.unknown) {
        return {
            profile: "unknown",
            source: "noFacts",
            reason: "The connected engine has not reported an engine edition yet.",
            facts: normalized,
        };
    }
    switch (edition) {
        case engineEditions.personal:
        case engineEditions.standard:
        case engineEditions.enterprise:
        case engineEditions.express:
        case engineEditions.stretchDatabase:
        case engineEditions.azureSqlEdge:
        case engineEditions.azureArcManagedInstance:
            // Azure SQL Edge and Arc-managed instances run the boxed engine, so they take the
            // SQL Server language surface rather than an Azure-service one.
            return {
                profile: "sql-server",
                source: "engineEdition",
                reason: `Engine edition ${edition} is a SQL Server engine.`,
                facts: normalized,
            };
        case engineEditions.azureSqlDatabase:
            return {
                profile: "azure-sql-database",
                source: "engineEdition",
                reason: `Engine edition ${edition} is Azure SQL Database.`,
                facts: normalized,
            };
        case engineEditions.azureSynapseDedicated:
            return {
                profile: "azure-synapse-dedicated",
                source: "engineEdition",
                reason: `Engine edition ${edition} is an Azure Synapse dedicated SQL pool.`,
                facts: normalized,
            };
        case engineEditions.azureSqlManagedInstance:
            return {
                profile: "azure-sql-managed-instance",
                source: "engineEdition",
                reason: `Engine edition ${edition} is Azure SQL Managed Instance.`,
                facts: normalized,
            };
        case engineEditions.azureSynapseServerless:
            return isFabricHost(normalized.serverName)
                ? {
                      profile: "fabric-warehouse",
                      source: "engineEditionAndServerName",
                      reason: `Engine edition ${edition} on a Fabric warehouse endpoint is Fabric Data Warehouse.`,
                      facts: normalized,
                  }
                : {
                      profile: "unknown",
                      source: "outOfScope",
                      reason: `Engine edition ${edition} without a Fabric endpoint is an Azure Synapse serverless SQL pool, which this language service does not profile yet.`,
                      facts: normalized,
                  };
        default:
            return {
                profile: "unknown",
                source: "unrecognizedEdition",
                reason: `Engine edition ${edition} is not a known engine, so platform restrictions are deferred.`,
                facts: normalized,
            };
    }
}

/**
 * Pre-production Fabric tenants prefix the endpoint label instead of adding a sub-domain, so a
 * dogfood warehouse is `<workspace>.msit-datawarehouse.fabric.microsoft.com` rather than
 * `<workspace>.datawarehouse.fabric.microsoft.com`. Matching the suffix at a `.` or `-` boundary
 * accepts both; a plain `endsWith` silently classified every pre-production warehouse as a Synapse
 * serverless pool and deferred all of its platform diagnostics. `models/connectionInfo.ts` in the
 * extension makes the same allowance for the same reason.
 */
function isFabricHost(serverName: string | undefined): boolean {
    if (!serverName) return false;
    const host = (serverName.toLowerCase().split(",")[0] ?? "").trim();
    return fabricHostSuffixes.some((suffix) => {
        const label = suffix.slice(1);
        if (!host.endsWith(label)) return false;
        const boundary = host[host.length - label.length - 1];
        return boundary === "." || boundary === "-";
    });
}

function normalizeFacts(facts: EngineFacts | undefined): EngineFacts {
    if (!facts) return Object.freeze({});
    const normalized: {
        engineProfile?: SqlEngineProfile;
        engineEdition?: number;
        serverVersion?: string;
        compatibilityLevel?: number;
        serverName?: string;
        previewFeatures?: boolean;
    } = {};
    if (isSqlEngineProfile(facts.engineProfile)) normalized.engineProfile = facts.engineProfile;
    if (typeof facts.engineEdition === "number" && Number.isInteger(facts.engineEdition)) {
        normalized.engineEdition = facts.engineEdition;
    }
    if (typeof facts.serverVersion === "string" && facts.serverVersion.length > 0) {
        normalized.serverVersion = facts.serverVersion;
    }
    if (
        typeof facts.compatibilityLevel === "number" &&
        Number.isInteger(facts.compatibilityLevel)
    ) {
        normalized.compatibilityLevel = facts.compatibilityLevel;
    }
    if (typeof facts.serverName === "string" && facts.serverName.length > 0) {
        normalized.serverName = facts.serverName;
    }
    if (typeof facts.previewFeatures === "boolean") {
        normalized.previewFeatures = facts.previewFeatures;
    }
    return Object.freeze(normalized);
}

/** Parses the major component out of `SERVERPROPERTY('ProductVersion')`. */
export function parseServerMajorVersion(serverVersion: string | undefined): number | undefined {
    if (!serverVersion) return undefined;
    const match = /^\s*(\d{1,3})\./u.exec(serverVersion);
    if (!match) return undefined;
    const major = Number(match[1]);
    return Number.isInteger(major) && major > 0 ? major : undefined;
}
