/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "../common/platform";
import { maxDopOneHint, sessionPreamble } from "../common/session";
import {
    SqlReadOptions,
    SqlReader,
    SqlRecord,
    readBoolean,
    readDateTime,
    readNumber,
    readString,
    toIdText,
    toRecords,
} from "../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "./result";

/** A row of `sys.database_automatic_tuning_options`, for example FORCE_LAST_GOOD_PLAN. */
export interface AutomaticTuningOption {
    readonly name: string;
    /** `desired_state_desc`, for example ON, OFF, or DEFAULT. */
    readonly desiredState?: string;
    /** `actual_state_desc`: ON or OFF. */
    readonly actualState?: string;
    /**
     * `reason_desc`: why the actual state is not the desired state, for example DISABLED,
     * QUERY_STORE_OFF, QUERY_STORE_READ_ONLY, or NOT_SUPPORTED.
     */
    readonly reason?: string;
}

/** A row of `sys.dm_db_tuning_recommendations`. Times are ISO 8601 UTC. */
export interface TuningRecommendation {
    readonly name: string;
    /** For example FORCE_LAST_GOOD_PLAN, CREATE_INDEX, or DROP_INDEX. */
    readonly type?: string;
    readonly reason?: string;
    readonly validSince?: string;
    readonly lastRefresh?: string;
    readonly score?: number;
    /** JSON_VALUE(state, '$.currentValue'): Active, Verifying, Success, Reverted, Expired. */
    readonly state?: string;
    /** JSON_VALUE(state, '$.reason'). */
    readonly stateReason?: string;
    readonly isExecutableAction?: boolean;
    readonly isRevertableAction?: boolean;
    readonly executeActionStartTime?: string;
    /** `User` or `System`. */
    readonly executeActionInitiatedBy?: string;
    readonly revertActionStartTime?: string;
    /** `User` or `System`. */
    readonly revertActionInitiatedBy?: string;
    /** `$.implementationDetails.script`. */
    readonly script?: string;
    /** `$.createIndexDetails`, or `$.dropIndexDetails`. The names keep their brackets. */
    readonly index?: {
        readonly indexName?: string;
        readonly schema?: string;
        readonly table?: string;
        readonly indexColumns?: string;
        readonly includedColumns?: string;
        readonly indexType?: string;
    };
    /** `$.planForceDetails`. The IDs are decimal strings. */
    readonly plan?: {
        readonly queryId?: string;
        readonly regressedPlanId?: string;
        readonly recommendedPlanId?: string;
    };
    /** Raw JSON of $.estimatedImpact, when present. */
    readonly estimatedImpact?: string;
    /** Raw details JSON when neither index nor plan details could be read. */
    readonly details?: string;
}

export interface AutomaticTuningInfo {
    /** Ordered by name. */
    readonly options: readonly AutomaticTuningOption[];
    /** Ordered by score descending, and then by name. */
    readonly recommendations: readonly TuningRecommendation[];
}

/**
 * True when the platform has automatic tuning: SQL Server 2017 and later, Azure SQL Managed
 * Instance, Azure SQL Database, and SQL database in Fabric.
 */
export function hasAutomaticTuning(info: PlatformInfo): boolean {
    switch (info.platform) {
        case "sqlServer":
            return (info.majorVersion ?? 0) >= 14;
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        default:
            return false;
    }
}

/**
 * Reads the automatic tuning options of the current database and the tuning recommendations,
 * with the automatic changes that are still in memory. The recommendations are lost when the
 * engine restarts. `unsupported` on the platforms without automatic tuning. The options need VIEW
 * DATABASE STATE; the recommendations need VIEW SERVER STATE (VIEW SERVER PERFORMANCE STATE on
 * SQL Server 2022 and later) or, on Azure SQL Database and Fabric, VIEW DATABASE STATE. A
 * missing permission gives `permissionMissing`.
 */
export async function readAutomaticTuning(
    reader: SqlReader,
    info: PlatformInfo,
    options?: SqlReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<AutomaticTuningInfo>> {
    if (!hasAutomaticTuning(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const [optionSet, recommendationSet] = await reader.read(
            buildAutomaticTuningQuery(info),
            options,
        );
        return {
            status: "ready",
            platform: info.platform,
            source: "dmv",
            scope: "database",
            observedAtUtc: now.toISOString(),
            data: {
                options: toRecords(optionSet).map(toAutomaticTuningOption),
                recommendations: toRecords(recommendationSet).map(toTuningRecommendation),
            },
            missing: [],
        };
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/**
 * Returns the batch of {@link readAutomaticTuning}: the options, and then the recommendations
 * with their raw `state` and `details` JSON. Exported for tests.
 */
export function buildAutomaticTuningQuery(info: PlatformInfo): string {
    return `${sessionPreamble(info, "read")}
SELECT
    name,
    desired_state_desc,
    actual_state_desc,
    reason_desc
FROM sys.database_automatic_tuning_options
ORDER BY name;
SELECT
    name,
    type,
    reason,
    valid_since,
    last_refresh,
    score,
    state,
    is_executable_action,
    is_revertable_action,
    execute_action_start_time,
    execute_action_initiated_by,
    revert_action_start_time,
    revert_action_initiated_by,
    details
FROM sys.dm_db_tuning_recommendations
ORDER BY score DESC, name${maxDopOneHint(info)};`;
}

/**
 * Maps a row of the recommendations. The JSON of `state` and `details` is parsed here; text that
 * is not valid JSON gives no values, and the details stay as raw text.
 */
export function toTuningRecommendation(record: SqlRecord): TuningRecommendation {
    const state = parseJsonObject(readString(record, "state"));
    const detailsText = readString(record, "details");
    const details = parseJsonObject(detailsText);
    const implementation = objectAt(details, "implementationDetails");
    const planDetails = objectAt(details, "planForceDetails");
    const indexDetails =
        objectAt(details, "createIndexDetails") ?? objectAt(details, "dropIndexDetails");

    const plan = planDetails
        ? withValues({
              queryId: idAt(planDetails, "queryId"),
              regressedPlanId: idAt(planDetails, "regressedPlanId"),
              recommendedPlanId: idAt(planDetails, "recommendedPlanId"),
          })
        : undefined;
    const index = indexDetails
        ? withValues({
              indexName: textAt(indexDetails, "indexName"),
              schema: textAt(indexDetails, "schema"),
              table: textAt(indexDetails, "table"),
              indexColumns: textAt(indexDetails, "indexColumns"),
              includedColumns: textAt(indexDetails, "includedColumns"),
              indexType: textAt(indexDetails, "indexType"),
          })
        : undefined;
    const hasPlan = plan !== undefined && Object.keys(plan).length > 0;
    const hasIndex = index !== undefined && Object.keys(index).length > 0;
    const estimatedImpact = details?.estimatedImpact;

    return withValues({
        name: readString(record, "name") ?? "",
        type: readString(record, "type"),
        reason: readString(record, "reason"),
        validSince: readDateTime(record, "valid_since"),
        lastRefresh: readDateTime(record, "last_refresh"),
        score: readNumber(record, "score"),
        state: textAt(state, "currentValue"),
        stateReason: textAt(state, "reason"),
        isExecutableAction: readBoolean(record, "is_executable_action"),
        isRevertableAction: readBoolean(record, "is_revertable_action"),
        executeActionStartTime: readDateTime(record, "execute_action_start_time"),
        executeActionInitiatedBy: readString(record, "execute_action_initiated_by"),
        revertActionStartTime: readDateTime(record, "revert_action_start_time"),
        revertActionInitiatedBy: readString(record, "revert_action_initiated_by"),
        script: textAt(implementation, "script"),
        index: hasIndex ? index : undefined,
        plan: hasPlan ? plan : undefined,
        estimatedImpact:
            estimatedImpact === undefined || estimatedImpact === null
                ? undefined
                : JSON.stringify(estimatedImpact),
        details:
            !hasPlan && !hasIndex && detailsText !== undefined && detailsText.trim() !== ""
                ? detailsText
                : undefined,
    });
}

function toAutomaticTuningOption(record: SqlRecord): AutomaticTuningOption {
    return withValues({
        name: readString(record, "name") ?? "",
        desiredState: readString(record, "desired_state_desc"),
        actualState: readString(record, "actual_state_desc"),
        reason: readString(record, "reason_desc"),
    });
}

type JsonObject = Readonly<Record<string, unknown>>;

/** Parses a JSON object. Undefined for text that is not a JSON object. */
function parseJsonObject(text: string | undefined): JsonObject | undefined {
    if (text === undefined || text.trim() === "") {
        return undefined;
    }
    try {
        const value: unknown = JSON.parse(text);
        return isJsonObject(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(value: JsonObject | undefined, key: string): JsonObject | undefined {
    const item = value?.[key];
    return isJsonObject(item) ? item : undefined;
}

function textAt(value: JsonObject | undefined, key: string): string | undefined {
    const item = value?.[key];
    if (typeof item === "string") {
        return item.trim() === "" ? undefined : item;
    }
    return typeof item === "number" || typeof item === "boolean" ? String(item) : undefined;
}

/** A Query Store ID as a decimal string. JSON numbers above 2^53 lose precision, so they are left out. */
function idAt(value: JsonObject, key: string): string | undefined {
    return toIdText(value[key]);
}

/** Leaves out the values that are undefined. */
function withValues<T extends object>(values: { [K in keyof T]: T[K] | undefined }): T {
    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
    ) as T;
}
