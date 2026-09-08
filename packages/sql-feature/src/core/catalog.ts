/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiagnosticsPort, SqlDiagEvents, nullDiagnostics, userText, sys } from "./diagnostics";
import { Platform, ServerCapabilities, platformNames } from "./platform";
import { ColumnInfo, QueryOptions, QueryResult, Row, SqlRunner } from "./types";
import { SqlExecutionError } from "./execution";

export type { Platform };

/** How a column should be presented. Drives alignment and formatting, nothing more. */
export type ColumnFormat =
    | "text"
    | "number"
    | "duration-us"
    | "duration-ms"
    | "bytes"
    | "datetime"
    | "percent";

export interface CatalogColumn {
    /** Column name as the query returns it. */
    readonly field: string;
    /** Header shown to the user. */
    readonly header: string;
    readonly format?: ColumnFormat;
    readonly width?: number;
    /** Longer text that should render in a detail pane rather than a narrow cell. */
    readonly wide?: boolean;
}

/**
 * One runnable diagnostic query: its SQL, where it can run, what it needs, and how to show it.
 */
export interface CatalogQuery {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    /** Platforms this query is valid on. Anything else is gated out with a reason. */
    readonly platforms: readonly Platform[];
    /**
     * Capability the query depends on beyond its platform list, checked against what the
     * server actually reported. Catches cases a platform name cannot express, such as Express
     * edition having no SQL Server Agent.
     */
    readonly requiresCapability?: keyof Pick<
        ServerCapabilities,
        "hasSqlAgent" | "hasServerScopedDmvs" | "hasExecutionDmvs" | "hasQueryStore"
    >;
    /** Minimum SQL Server major version, when the query uses newer catalog views. */
    readonly minMajorVersion?: number;
    /** True when the query needs Query Store to be on for the current database. */
    readonly requiresQueryStore?: boolean;
    /** Permission the query needs, named so a failure can say what is missing. */
    readonly requiresPermission?: string;
    /** Resolves permission wording when the required scope varies by platform. */
    readonly permissionFor?: (capabilities: ServerCapabilities) => string;
    readonly columns: readonly CatalogColumn[];
    /** Builds the SQL. Parameters are inlined as literals only after validation. */
    readonly sql: (params?: Readonly<Record<string, unknown>>) => string;
    /** Raises the per-cell limit for queries that legitimately return large values. */
    readonly maxCellBytes?: number;
}

export interface GateResult {
    readonly allowed: boolean;
    /** Present when not allowed: what is missing, in words a user can act on. */
    readonly reason?: string;
}

export interface RunOutcome {
    readonly query: CatalogQuery;
    readonly result?: QueryResult;
    readonly gate: GateResult;
    readonly error?: string;
    /** A transport or server failure must not be mistaken for an empty successful sample. */
    readonly outcome: "succeeded" | "failed" | "unknown";
    readonly durationMs: number;
}

const capabilityReasons: Readonly<Record<string, string>> = {
    hasSqlAgent: "SQL Server Agent is not available",
    hasServerScopedDmvs: "server-scoped dynamic management views are not available",
    hasExecutionDmvs: "the query execution management views are not available",
    hasQueryStore: "Query Store is not available",
};

/**
 * Decides whether a query can run here, and says why not when it cannot.
 */
export function gate(
    query: CatalogQuery,
    capabilities: ServerCapabilities,
    queryStoreOn?: boolean,
): GateResult {
    const where = platformNames[capabilities.platform];

    if (!query.platforms.includes(capabilities.platform)) {
        return { allowed: false, reason: `${query.title} is not available on ${where}.` };
    }

    if (query.requiresCapability && !capabilities[query.requiresCapability]) {
        const detail =
            capabilityReasons[query.requiresCapability] ?? "a required feature is unavailable";
        const edition = capabilities.edition ? ` (${capabilities.edition})` : "";
        return {
            allowed: false,
            reason: `${query.title} is unavailable because ${detail} on ${where}${edition}.`,
        };
    }

    if (
        query.minMajorVersion !== undefined &&
        capabilities.majorVersion !== undefined &&
        capabilities.majorVersion < query.minMajorVersion
    ) {
        return {
            allowed: false,
            reason: `${query.title} needs SQL Server ${query.minMajorVersion} or later; this server reports version ${capabilities.productVersion ?? capabilities.majorVersion}.`,
        };
    }

    if (query.requiresQueryStore && queryStoreOn === false) {
        return {
            allowed: false,
            reason: `Query Store is not enabled on ${capabilities.database ?? "this database"}. Turn it on to use ${query.title}.`,
        };
    }

    return { allowed: true };
}

/**
 * Runs one catalog query, gating first and reporting truncation honestly.
 */
export async function runCatalogQuery(
    query: CatalogQuery,
    runner: SqlRunner,
    capabilities: ServerCapabilities,
    options?: {
        params?: Readonly<Record<string, unknown>>;
        queryStoreOn?: boolean;
        diagnostics?: DiagnosticsPort;
    },
): Promise<RunOutcome> {
    const diag = options?.diagnostics ?? nullDiagnostics;
    const gateResult = gate(query, capabilities, options?.queryStoreOn);

    if (!gateResult.allowed) {
        diag.emit({
            type: SqlDiagEvents.queryGated,
            status: "error",
            fields: {
                queryId: sys(query.id),
                platform: sys(capabilities.platform),
                reason: sys(gateResult.reason),
            },
        });
        return { query, gate: gateResult, outcome: "failed", durationMs: 0 };
    }

    const span = diag.startSpan(SqlDiagEvents.queryRun, {
        queryId: sys(query.id),
        platform: sys(capabilities.platform),
        edition: sys(capabilities.engineEditionId),
    });
    const started = Date.now();

    try {
        const queryOptions: QueryOptions = {
            tag: query.id,
            maxCellBytes: query.maxCellBytes,
        };
        const result = await runner.query(query.sql(options?.params), queryOptions);
        const durationMs = Date.now() - started;

        if (result.truncated) {
            // Surfaced separately: a truncated cell is a partial answer, and the caller has to
            // be able to tell the user that rather than presenting a prefix as the whole value.
            diag.emit({
                type: SqlDiagEvents.cellTruncated,
                status: "ok",
                fields: { queryId: sys(query.id), rows: sys(result.rows.length) },
            });
        }

        span.end("ok", { rows: sys(result.rows.length), durationMs: sys(durationMs) });
        return { query, result, gate: gateResult, outcome: "succeeded", durationMs };
    } catch (error) {
        span.fail(error);
        const message = describeError(error, query, capabilities);
        diag.emit({
            type: SqlDiagEvents.queryRun,
            status: "error",
            fields: { queryId: sys(query.id), error: userText(message) },
        });
        return {
            query,
            gate: gateResult,
            error: message,
            outcome:
                error instanceof SqlExecutionError && error.outcomeCertainty === "unknown"
                    ? "unknown"
                    : "failed",
            durationMs: Date.now() - started,
        };
    }
}

/**
 * Turns a server error into something a user can act on, naming the missing permission when
 * the query declared one rather than surfacing a bare SQL error.
 */
export function describeError(
    error: unknown,
    query: CatalogQuery,
    capabilities?: ServerCapabilities,
): string {
    const raw = error instanceof Error ? error.message : String(error);
    const denied = /permission|principal|not have|denied/i.test(raw);
    const permission =
        capabilities && query.permissionFor
            ? query.permissionFor(capabilities)
            : query.requiresPermission;

    if (denied && permission) {
        return `${query.title} needs the ${permission} permission. ${raw}`;
    }
    return raw;
}

/** Column metadata for a catalog query, for callers building a grid. */
export function columnsFor(query: CatalogQuery): readonly ColumnInfo[] {
    return query.columns.map((c) => ({ name: c.field }));
}

/** Looks up a row value, tolerating the casing the server returns. */
export function value(row: Row, field: string): unknown {
    if (field in row) {
        return row[field];
    }
    const lowered = field.toLowerCase();
    for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lowered) {
            return row[key];
        }
    }
    return undefined;
}
