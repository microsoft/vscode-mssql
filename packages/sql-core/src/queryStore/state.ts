/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlDateTimeOffsetLiteral } from "../common/literals";
import { ReadResult, errorResult } from "../common/result";
import { sessionPreamble } from "../common/session";
import {
    SqlReadOptions,
    SqlReader,
    SqlResultSet,
    readDateTime,
    readNumber,
    toRecords,
} from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";

/** `actual_state` and `desired_state` of `sys.database_query_store_options`. */
export type QueryStoreState = "off" | "readOnly" | "readWrite" | "error" | "readCapture";

/** Why Query Store is read-only. Callers show localized text for each code. */
export type QueryStoreReadOnlyReason =
    | "databaseReadOnly"
    | "singleUserMode"
    | "emergencyMode"
    | "logAcceptMode"
    | "sizeLimit"
    | "memoryLimit";

/** The state of Query Store when a read ran. */
export interface QueryStoreStatus {
    readonly actualState: QueryStoreState;
    /** Set when the state is `readOnly`. */
    readonly readOnlyReason?: QueryStoreReadOnlyReason;
}

/**
 * The result of a Query Store read. `queryStore` is set whenever the state was read: a
 * `readOnly` state means that Query Store does not capture new data, so the data can be old.
 * Query Store OFF or in the error state gives `notConfigured`.
 */
export interface QueryStoreResult<T> extends ReadResult<T> {
    readonly queryStore?: QueryStoreStatus;
}

export type QueryStoreReadOptions = SqlReadOptions;

/** A time window. A runtime stats interval counts in it when the interval starts in it. */
export interface TimeWindow {
    readonly start: Date;
    readonly end: Date;
}

const stateIds: Readonly<Record<number, QueryStoreState>> = {
    0: "off",
    1: "readOnly",
    2: "readWrite",
    3: "error",
    4: "readCapture",
};

/** The `readonly_reason` flags, in the order that SQL Server Management Studio checks them. */
const readOnlyReasonFlags: readonly (readonly [QueryStoreReadOnlyReason, number])[] = [
    ["memoryLimit", 0x00020000],
    ["sizeLimit", 0x00010000],
    ["logAcceptMode", 0x00000008],
    ["emergencyMode", 0x00000004],
    ["singleUserMode", 0x00000002],
    ["databaseReadOnly", 0x00000001],
];

export function toQueryStoreState(value: number | undefined): QueryStoreState {
    return stateIds[value ?? 0] ?? "off";
}

export function toReadOnlyReason(flags: number | undefined): QueryStoreReadOnlyReason | undefined {
    return readOnlyReasonFlags.find(([, flag]) => ((flags ?? 0) & flag) !== 0)?.[0];
}

/** The state of Query Store and how far back its runtime statistics go. */
export interface QueryStoreOverview extends QueryStoreStatus {
    /** The start of the oldest runtime stats interval, ISO 8601 UTC. Absent without data. */
    readonly oldestIntervalStartUtc?: string;
}

/** Reads the state of Query Store and the start of its oldest interval. */
export async function getQueryStoreOverview(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<QueryStoreOverview>> {
    return runQueryStoreRead(reader, capabilities, options, {
        body: `SELECT MIN(start_time) AS oldest_start FROM sys.query_store_runtime_stats_interval;`,
        allStates: true,
        map: ([intervalSet], status) => {
            const oldest = readDateTime(toRecords(intervalSet)[0] ?? {}, "oldest_start");
            return { ...status, ...(oldest ? { oldestIntervalStartUtc: oldest } : {}) };
        },
    });
}

/** @internal How a read builds its batch and maps its result sets. */
export interface QueryStoreReadSpec<T> {
    /** `DECLARE` statements that the body uses. */
    readonly declarations?: readonly string[];
    /** The statements that run when Query Store has data to read. */
    readonly body: string;
    /** Runs the body in every state, not only when Query Store is on. */
    readonly allStates?: boolean;
    /**
     * Maps the body's result sets. `undefined` gives `noData`. An array or a list in the value
     * does not count as empty; the map decides.
     */
    readonly map: (resultSets: readonly SqlResultSet[], status: QueryStoreStatus) => T | undefined;
}

/**
 * @internal Runs one batch: the read preamble, the declarations, the Query Store state, and then
 * the body when Query Store is on (read-write, read-only, or read-capture). One round trip.
 */
export async function runQueryStoreRead<T>(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    options: QueryStoreReadOptions | undefined,
    spec: QueryStoreReadSpec<T>,
): Promise<QueryStoreResult<T>> {
    if (!capabilities.supported) {
        return { status: "unsupported" };
    }
    const sql = [
        sessionPreamble(capabilities.platform, "read"),
        "DECLARE @qs_state int, @qs_readonly_reason int;",
        ...(spec.declarations ?? []),
        "SELECT @qs_state = actual_state, @qs_readonly_reason = readonly_reason FROM sys.database_query_store_options;",
        "SELECT @qs_state AS actual_state, @qs_readonly_reason AS readonly_reason;",
        spec.allStates ? spec.body : `IF @qs_state IN (1, 2, 4)\nBEGIN\n${spec.body}\nEND;`,
    ].join("\n");
    let resultSets: SqlResultSet[];
    try {
        resultSets = await reader.read(sql, options);
    } catch (error) {
        return errorResult(error);
    }
    const [stateSet, ...bodySets] = resultSets;
    const stateRecord = toRecords(stateSet)[0] ?? {};
    const actualState = toQueryStoreState(readNumber(stateRecord, "actual_state"));
    const readOnlyReason =
        actualState === "readOnly"
            ? toReadOnlyReason(readNumber(stateRecord, "readonly_reason"))
            : undefined;
    const queryStore: QueryStoreStatus = {
        actualState,
        ...(readOnlyReason ? { readOnlyReason } : {}),
    };
    if (!spec.allStates && (actualState === "off" || actualState === "error")) {
        return { status: "notConfigured", queryStore };
    }
    const data = spec.map(bodySets, queryStore);
    return data === undefined
        ? { status: "noData", queryStore }
        : { status: "ready", data, queryStore };
}

/** @internal Checks a window and returns the declarations of `@window_start` and `@window_end`. */
export function windowDeclarations(window: TimeWindow): string[] {
    if (!(window?.start instanceof Date) || !(window.end instanceof Date)) {
        throw new RangeError("A window needs a start and an end date.");
    }
    if (window.start.getTime() >= window.end.getTime()) {
        throw new RangeError("The start of a window must be before its end.");
    }
    return [
        `DECLARE @window_start datetimeoffset = ${sqlDateTimeOffsetLiteral(window.start)};`,
        `DECLARE @window_end datetimeoffset = ${sqlDateTimeOffsetLiteral(window.end)};`,
    ];
}
