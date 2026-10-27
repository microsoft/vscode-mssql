/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query session options (SSMS parity). The classic editor declared the
 * mssql.query.* settings and relied on the STS v1 service reading synced
 * configuration; Query Studio's data plane applies them EXPLICITLY as one
 * deterministic SET batch on the user session — at connect and reconnect
 * (SET state is per-connection, so it survives across executions on the
 * same session). Per-QUERY: only executionTimeout (ExecuteOptions.timeoutMs)
 * and the plan/parse mode wrappers, which the orchestrator owns.
 *
 * Everything is validated/whitelisted here — settings values are NEVER
 * interpolated raw into SQL.
 */

export interface QuerySessionOptions {
    readonly ansiDefaults: boolean;
    readonly quotedIdentifier: boolean;
    readonly ansiNullDefaultOn: boolean;
    readonly ansiNulls: boolean;
    readonly ansiPadding: boolean;
    readonly ansiWarnings: boolean;
    readonly implicitTransactions: boolean;
    readonly cursorCloseOnCommit: boolean;
    readonly arithAbort: boolean;
    readonly xactAbortOn: boolean;
    readonly noCount: boolean;
    readonly noExec: boolean;
    readonly statisticsTime: boolean;
    readonly statisticsIO: boolean;
    readonly rowCount: number;
    readonly textSize: number;
    readonly lockTimeout: number;
    readonly queryGovernorCostLimit: number;
    readonly deadlockPriority: "Normal" | "Low" | "High";
    readonly transactionIsolationLevel: string;
    readonly executionTimeoutSeconds: number;
}

export const QUERY_SESSION_DEFAULTS: QuerySessionOptions = {
    ansiDefaults: false,
    quotedIdentifier: true,
    ansiNullDefaultOn: true,
    ansiNulls: true,
    ansiPadding: true,
    ansiWarnings: true,
    implicitTransactions: false,
    cursorCloseOnCommit: false,
    arithAbort: true,
    xactAbortOn: false,
    noCount: false,
    noExec: false,
    statisticsTime: false,
    statisticsIO: false,
    rowCount: 0,
    textSize: 2147483647,
    lockTimeout: -1,
    queryGovernorCostLimit: -1,
    deadlockPriority: "Normal",
    transactionIsolationLevel: "READ COMMITTED",
    executionTimeoutSeconds: 0,
};

type ConfigReader = <T>(key: string, defaultValue: T) => T;

/** Read the mssql.query.* settings into a validated snapshot. */
export function readQuerySessionOptions(get: ConfigReader): QuerySessionOptions {
    const d = QUERY_SESSION_DEFAULTS;
    const deadlockRaw = String(get("mssql.query.deadlockPriority", d.deadlockPriority));
    const deadlockPriority =
        deadlockRaw === "Low" || deadlockRaw === "High" ? deadlockRaw : "Normal";
    return {
        ansiDefaults: get("mssql.query.ansiDefaults", d.ansiDefaults) === true,
        quotedIdentifier: get("mssql.query.quotedIdentifier", d.quotedIdentifier) === true,
        ansiNullDefaultOn: get("mssql.query.ansiNullDefaultOn", d.ansiNullDefaultOn) === true,
        ansiNulls: get("mssql.query.ansiNulls", d.ansiNulls) === true,
        ansiPadding: get("mssql.query.ansiPadding", d.ansiPadding) === true,
        ansiWarnings: get("mssql.query.ansiWarnings", d.ansiWarnings) === true,
        implicitTransactions:
            get("mssql.query.implicitTransactions", d.implicitTransactions) === true,
        cursorCloseOnCommit: get("mssql.query.cursorCloseOnCommit", d.cursorCloseOnCommit) === true,
        arithAbort: get("mssql.query.arithAbort", d.arithAbort) === true,
        xactAbortOn: get("mssql.query.xactAbortOn", d.xactAbortOn) === true,
        noCount: get("mssql.query.noCount", d.noCount) === true,
        noExec: get("mssql.query.noExec", d.noExec) === true,
        statisticsTime: get("mssql.query.statisticsTime", d.statisticsTime) === true,
        statisticsIO: get("mssql.query.statisticsIO", d.statisticsIO) === true,
        rowCount: safeInt(get("mssql.query.rowCount", d.rowCount), d.rowCount, 0),
        textSize: safeInt(get("mssql.query.textSize", d.textSize), d.textSize, 0),
        lockTimeout: safeInt(get("mssql.query.lockTimeout", d.lockTimeout), d.lockTimeout, -1),
        queryGovernorCostLimit: safeInt(
            get("mssql.query.queryGovernorCostLimit", d.queryGovernorCostLimit),
            d.queryGovernorCostLimit,
            -1,
        ),
        deadlockPriority,
        transactionIsolationLevel: String(
            get("mssql.query.transactionIsolationLevel", d.transactionIsolationLevel),
        ),
        executionTimeoutSeconds: safeInt(
            get("mssql.query.executionTimeout", d.executionTimeoutSeconds),
            d.executionTimeoutSeconds,
            0,
        ),
    };
}

function safeInt(value: unknown, fallback: number, min: number): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
        return fallback;
    }
    return n;
}

const ISOLATION_LEVELS = new Set([
    "READ UNCOMMITTED",
    "READ COMMITTED",
    "REPEATABLE READ",
    "SNAPSHOT",
    "SERIALIZABLE",
]);

const onOff = (value: boolean): "ON" | "OFF" => (value ? "ON" : "OFF");

/**
 * One deterministic SET batch for the session. Statement order is stable so
 * the batch is diff/test-friendly. NOEXEC is emitted LAST (and only when ON)
 * so it cannot suppress the other SET statements.
 */
export function buildSessionOptionsBatch(options: QuerySessionOptions): string {
    const statements: string[] = [];
    if (options.ansiDefaults) {
        statements.push("SET ANSI_DEFAULTS ON;");
    } else {
        statements.push(
            `SET QUOTED_IDENTIFIER ${onOff(options.quotedIdentifier)};`,
            `SET ANSI_NULL_DFLT_ON ${onOff(options.ansiNullDefaultOn)};`,
            `SET ANSI_NULLS ${onOff(options.ansiNulls)};`,
            `SET ANSI_PADDING ${onOff(options.ansiPadding)};`,
            `SET ANSI_WARNINGS ${onOff(options.ansiWarnings)};`,
            `SET IMPLICIT_TRANSACTIONS ${onOff(options.implicitTransactions)};`,
            `SET CURSOR_CLOSE_ON_COMMIT ${onOff(options.cursorCloseOnCommit)};`,
        );
    }
    statements.push(
        `SET ARITHABORT ${onOff(options.arithAbort)};`,
        `SET XACT_ABORT ${onOff(options.xactAbortOn)};`,
        `SET NOCOUNT ${onOff(options.noCount)};`,
        `SET STATISTICS TIME ${onOff(options.statisticsTime)};`,
        `SET STATISTICS IO ${onOff(options.statisticsIO)};`,
        `SET ROWCOUNT ${options.rowCount};`,
        `SET TEXTSIZE ${options.textSize};`,
        `SET LOCK_TIMEOUT ${options.lockTimeout};`,
    );
    if (options.queryGovernorCostLimit >= 0) {
        statements.push(`SET QUERY_GOVERNOR_COST_LIMIT ${options.queryGovernorCostLimit};`);
    }
    statements.push(`SET DEADLOCK_PRIORITY ${options.deadlockPriority.toUpperCase()};`);
    const isolation = options.transactionIsolationLevel.toUpperCase();
    if (ISOLATION_LEVELS.has(isolation)) {
        statements.push(`SET TRANSACTION ISOLATION LEVEL ${isolation};`);
    }
    if (options.noExec) {
        statements.push("SET NOEXEC ON;");
    }
    return statements.join("\n");
}

/** Per-query timeout in milliseconds; undefined = no timeout (0 in settings). */
export function executionTimeoutMs(options: QuerySessionOptions): number | undefined {
    return options.executionTimeoutSeconds > 0 ? options.executionTimeoutSeconds * 1000 : undefined;
}
