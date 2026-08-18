/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EngineFacts, EngineProfileResolution, SqlEngineProfile } from "./engineProfile.js";
import {
    engineProfileDisplayName,
    isSqlEngineProfile,
    parseServerMajorVersion,
    resolveEngineProfile,
} from "./engineProfile.js";

/** Boxed SQL Server major versions the language service models. */
export type SqlServerMajorVersion = 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;

/** Database compatibility levels the language service models. */
export type SqlCompatibilityLevel = 80 | 90 | 100 | 110 | 120 | 130 | 140 | 150 | 160 | 170;

const serverMajorVersions: readonly number[] = Object.freeze([
    8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
]);
const compatibilityLevels: readonly number[] = Object.freeze([
    80, 90, 100, 110, 120, 130, 140, 150, 160, 170,
]);

/** The newest language level this package knows how to gate against. */
export const latestServerMajorVersion: SqlServerMajorVersion = 17;
export const latestCompatibilityLevel: SqlCompatibilityLevel = 170;

/**
 * Whether a construct may be used.
 *
 * `deferred` is the answer while the engine is unidentified. It is not `available`: a deferred
 * feature is offered without a restriction diagnostic, but nothing may claim it was verified.
 */
export type FeatureAvailability = "available" | "unavailable" | "deferred";

/**
 * The immutable analysis profile every layer shares.
 *
 * `serverMajorVersion` and `compatibilityLevel` are absent, not defaulted, when the engine has not
 * reported them. A gate reading an absent level defers rather than guessing the newest engine.
 */
export interface TsqlFeatureProfile {
    readonly engineProfile: SqlEngineProfile;
    readonly serverMajorVersion?: SqlServerMajorVersion;
    readonly compatibilityLevel?: SqlCompatibilityLevel;
    readonly previewFeatures: boolean;
}

/**
 * Coarse platform capabilities that binding, metadata, and completion consult.
 *
 * These are the facts too broad to belong to one grammar node. Anything narrower — a statement, a
 * clause, an option, a built-in — belongs in the platform feature registry instead.
 */
export interface EngineCapabilitySet {
    /** Whether a name may reference another database on the same connection. */
    readonly crossDatabaseReferences: FeatureAvailability;
    /** Whether the engine exposes server-scoped objects such as logins and linked servers. */
    readonly serverScopedObjects: FeatureAvailability;
    /** Whether user databases expose files and filegroups to T-SQL. */
    readonly fileAndFilegroupControl: FeatureAvailability;
    /** Whether tables carry a distribution policy (`HASH`, `ROUND_ROBIN`, `REPLICATE`). */
    readonly tableDistribution: FeatureAvailability;
    /** Whether external data sources, file formats, and external tables exist. */
    readonly externalDataObjects: FeatureAvailability;
}

/**
 * The versioned capability object that identifies an analysis.
 *
 * `generation` is the identity: two snapshots are comparable only when their generations match, so
 * every reuse key, worker message, and published result carries it.
 */
export interface EngineCapabilities extends TsqlFeatureProfile {
    readonly generation: string;
    readonly resolution: EngineProfileResolution;
    readonly capabilities: EngineCapabilitySet;
    /** A short phrase naming the engine and level, safe to show in a support view. */
    readonly displayName: string;
}

/**
 * Effective language levels per profile.
 *
 * Azure services keep reporting boxed product versions that do not describe their T-SQL surface —
 * Azure SQL Database and Managed Instance both report `12.0.x` while accepting current syntax, and
 * a dedicated SQL pool reports `12.0.x` while accepting far less. The reported product version is
 * therefore used only for `sql-server`; every other profile takes its level from this table.
 *
 * Evidence: ScriptDOM has one parser per boxed version plus `TSqlFabricDWParser`, whose version
 * flag sits in `TSqlFabricDWAndAbove = TSql160 | TSqlFabricDW | TSql170 | TSql180`
 * (`SqlScriptDom/Parser/TSql/SqlVersionFlags.cs`), so Fabric Data Warehouse is a 160-level
 * language plus Fabric-only extensions. Dedicated SQL pool syntax in the same test corpus
 * (`PredictSqlDwTests.sql`, `CreateExternalTableStatementTests130.sql`) is 130-level.
 */
const profileLanguageLevels: Readonly<
    Record<
        SqlEngineProfile,
        { readonly server?: SqlServerMajorVersion; readonly compatibility?: SqlCompatibilityLevel }
    >
> = Object.freeze({
    "sql-server": {},
    "azure-sql-database": { server: 17, compatibility: 170 },
    "azure-sql-managed-instance": { server: 17, compatibility: 170 },
    "azure-synapse-dedicated": { server: 13, compatibility: 130 },
    "fabric-warehouse": { server: 16, compatibility: 160 },
    unknown: {},
});

/**
 * Coarse capabilities per profile.
 *
 * Every entry is a documented platform restriction rather than a version gate:
 * - Azure SQL Database is a single-database service: it has no server-scoped object surface, no
 *   file or filegroup control, and no ordinary cross-database name resolution.
 * - Managed Instance is instance-scoped, so it keeps logins, linked servers, and cross-database
 *   names. It is deliberately not given Azure SQL Database's restrictions by inheritance.
 * - A dedicated SQL pool is a single database with distributed tables and external objects and no
 *   cross-database references.
 * - Fabric Data Warehouse resolves names across warehouses in a workspace, supports distributed
 *   table declarations and external data objects, but exposes no server-scoped objects or
 *   filegroups.
 */
const profileCapabilities: Readonly<Record<SqlEngineProfile, EngineCapabilitySet>> = Object.freeze({
    "sql-server": Object.freeze({
        crossDatabaseReferences: "available",
        serverScopedObjects: "available",
        fileAndFilegroupControl: "available",
        tableDistribution: "unavailable",
        externalDataObjects: "available",
    }),
    "azure-sql-database": Object.freeze({
        crossDatabaseReferences: "unavailable",
        serverScopedObjects: "unavailable",
        fileAndFilegroupControl: "unavailable",
        tableDistribution: "unavailable",
        externalDataObjects: "available",
    }),
    "azure-sql-managed-instance": Object.freeze({
        crossDatabaseReferences: "available",
        serverScopedObjects: "available",
        fileAndFilegroupControl: "available",
        tableDistribution: "unavailable",
        externalDataObjects: "available",
    }),
    "azure-synapse-dedicated": Object.freeze({
        crossDatabaseReferences: "unavailable",
        serverScopedObjects: "unavailable",
        fileAndFilegroupControl: "unavailable",
        tableDistribution: "available",
        externalDataObjects: "available",
    }),
    "fabric-warehouse": Object.freeze({
        crossDatabaseReferences: "available",
        serverScopedObjects: "unavailable",
        fileAndFilegroupControl: "unavailable",
        tableDistribution: "available",
        externalDataObjects: "available",
    }),
    unknown: Object.freeze({
        crossDatabaseReferences: "deferred",
        serverScopedObjects: "deferred",
        fileAndFilegroupControl: "deferred",
        tableDistribution: "deferred",
        externalDataObjects: "deferred",
    }),
});

/**
 * The profile a host supplies when it has no connection at all.
 *
 * It is `unknown`, not SQL Server: an unconnected document has no engine, and guessing one would
 * produce platform diagnostics no server ever asked for.
 */
export const unknownEngineCapabilities: EngineCapabilities = createEngineCapabilities({});

/**
 * The profile used by offline tests and tools that deliberately analyse the newest boxed engine.
 * Production paths resolve a profile from server facts instead.
 */
export const defaultTsqlFeatureProfile: TsqlFeatureProfile = Object.freeze({
    engineProfile: "sql-server" as const,
    serverMajorVersion: latestServerMajorVersion,
    compatibilityLevel: latestCompatibilityLevel,
    previewFeatures: false,
});

/** Builds the capability object for observed server facts. */
export function createEngineCapabilities(facts: EngineFacts | undefined): EngineCapabilities {
    return capabilitiesFromResolution(resolveEngineProfile(facts));
}

/**
 * Builds the capability object for a profile a host stated directly.
 *
 * Used by offline tools and test harnesses that analyse a named engine without a connection. The
 * stated levels are kept verbatim; nothing is inferred from a product version that does not exist.
 */
export function capabilitiesFromProfile(profile: TsqlFeatureProfile): EngineCapabilities {
    const normalized = resolveTsqlFeatureProfile(profile);
    return Object.freeze({
        ...normalized,
        generation: capabilityGeneration(normalized),
        resolution: {
            profile: normalized.engineProfile,
            source: "hostSupplied" as const,
            reason: "The host stated the engine profile directly.",
            facts: Object.freeze(
                normalized.compatibilityLevel === undefined
                    ? {}
                    : { compatibilityLevel: normalized.compatibilityLevel },
            ),
        },
        capabilities: profileCapabilities[normalized.engineProfile],
        displayName: describeProfile(
            normalized.engineProfile,
            normalized.serverMajorVersion,
            normalized.compatibilityLevel,
        ),
    });
}

/** Builds the capability object for an already-resolved profile. */
export function capabilitiesFromResolution(
    resolution: EngineProfileResolution,
): EngineCapabilities {
    const profile = resolution.profile;
    const level = profileLanguageLevels[profile];
    const reportedCompatibility = coerceCompatibilityLevel(resolution.facts.compatibilityLevel);
    const reportedServer =
        profile === "sql-server"
            ? coerceServerMajorVersion(parseServerMajorVersion(resolution.facts.serverVersion))
            : undefined;
    const serverMajorVersion = reportedServer ?? level.server;
    const compatibilityLevel = reportedCompatibility ?? level.compatibility;
    const previewFeatures = resolution.facts.previewFeatures === true;
    return Object.freeze({
        engineProfile: profile,
        ...(serverMajorVersion === undefined ? {} : { serverMajorVersion }),
        ...(compatibilityLevel === undefined ? {} : { compatibilityLevel }),
        previewFeatures,
        generation: capabilityGeneration({
            engineProfile: profile,
            ...(serverMajorVersion === undefined ? {} : { serverMajorVersion }),
            ...(compatibilityLevel === undefined ? {} : { compatibilityLevel }),
            previewFeatures,
        }),
        resolution,
        capabilities: profileCapabilities[profile],
        displayName: describeProfile(profile, serverMajorVersion, compatibilityLevel),
    });
}

/**
 * Normalizes a partial host profile into a frozen profile.
 *
 * An absent engine profile becomes `unknown` rather than SQL Server, and an unrecognized level is
 * dropped rather than rounded, so a malformed host value can never enable a stricter gate.
 */
export function resolveTsqlFeatureProfile(
    profile: Partial<TsqlFeatureProfile> | undefined,
): TsqlFeatureProfile {
    const engineProfile = profile?.engineProfile;
    const serverMajorVersion = coerceServerMajorVersion(profile?.serverMajorVersion);
    const compatibilityLevel = coerceCompatibilityLevel(profile?.compatibilityLevel);
    return Object.freeze({
        engineProfile: isSqlEngineProfile(engineProfile) ? engineProfile : "unknown",
        ...(serverMajorVersion === undefined ? {} : { serverMajorVersion }),
        ...(compatibilityLevel === undefined ? {} : { compatibilityLevel }),
        previewFeatures: profile?.previewFeatures === true,
    });
}

/** A stable identity for a profile, used wherever a snapshot or reuse key must not cross profiles. */
export function capabilityGeneration(profile: TsqlFeatureProfile): string {
    return [
        profile.engineProfile,
        profile.serverMajorVersion ?? "?",
        profile.compatibilityLevel ?? "?",
        profile.previewFeatures ? "preview" : "ga",
    ].join("/");
}

/** The coarse capability answer for a profile that may be a bare {@link TsqlFeatureProfile}. */
export function engineCapabilitySet(profile: TsqlFeatureProfile): EngineCapabilitySet {
    return profileCapabilities[profile.engineProfile] ?? profileCapabilities.unknown;
}

export function describeProfile(
    profile: SqlEngineProfile,
    serverMajorVersion?: number,
    compatibilityLevel?: number,
): string {
    const name = engineProfileDisplayName(profile);
    const level =
        profile === "sql-server" && serverMajorVersion !== undefined
            ? ` ${sqlServerProductName(serverMajorVersion)}`
            : "";
    const compatibility =
        compatibilityLevel === undefined ? "" : ` (compatibility level ${compatibilityLevel})`;
    return `${name}${level}${compatibility}`;
}

const sqlServerProductNames: Readonly<Record<number, string>> = Object.freeze({
    8: "2000",
    9: "2005",
    10: "2008",
    11: "2012",
    12: "2014",
    13: "2016",
    14: "2017",
    15: "2019",
    16: "2022",
    17: "2025",
});

export function sqlServerProductName(major: number): string {
    return sqlServerProductNames[major] ?? String(major);
}

function coerceServerMajorVersion(value: number | undefined): SqlServerMajorVersion | undefined {
    return value !== undefined && serverMajorVersions.includes(value)
        ? (value as SqlServerMajorVersion)
        : undefined;
}

function coerceCompatibilityLevel(value: number | undefined): SqlCompatibilityLevel | undefined {
    return value !== undefined && compatibilityLevels.includes(value)
        ? (value as SqlCompatibilityLevel)
        : undefined;
}
