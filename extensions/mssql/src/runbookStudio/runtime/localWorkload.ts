/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";

export const MAX_LOCAL_WORKLOAD_BYTES = 1024 * 1024;
export const MAX_LOCAL_WORKLOAD_BATCHES = 256;
export const MAX_LOCAL_WORKLOAD_GO_REPETITION = 100;
export const LOCAL_CITIES_WORKLOAD_TEMPLATE = "application-cities-shadow";
export const MIN_LOCAL_CITIES_SAMPLE_ROWS = 10;
export const MAX_LOCAL_CITIES_SAMPLE_ROWS = 20;
export const MAX_LOCAL_CITIES_ITERATIONS = 1000;

export interface LocalCitiesSampleRow {
    cityName: string;
    stateProvinceId: number;
    latestRecordedPopulation: number | null;
    lastEditedBy: number;
}

const BLOCKED_WORKLOAD_POLICY =
    /\b(?:use\s+|backup\s+(?:database|log)|restore\s+(?:database|log)|(?:create|alter|drop)\s+database|alter\s+server|(?:create|alter|drop)\s+server\s+role|shutdown\b|kill\s+\d+|dbcc\b|reconfigure\b|sp_configure\b|xp_[a-z0-9_]*\b|create\s+(?:login|credential|external\s+(?:data\s+source|file\s+format|table|library))|alter\s+login|drop\s+login|execute\s+as\s+login|openrowset\b|opendatasource\b|bulk\s+insert)\b/i;
const CROSS_DATABASE_REFERENCE =
    /(?:\b[A-Za-z_][A-Za-z0-9_$#@]*\b|\[[^\]\r\n]+\])\s*\.\s*(?:\b[A-Za-z_][A-Za-z0-9_$#@]*\b|\[[^\]\r\n]+\])\s*\./;
const MUTATION_SIGNAL =
    /\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|deny|revoke|execute|exec)\b/i;

export interface LocalWorkloadPlan {
    workloadSha256: string;
    sourceByteCount: number;
    batchCount: number;
    mutating: boolean;
    batches: string[];
}

export interface LocalWorkloadMeasurementSummary {
    measurementSampleCount: number;
    meanDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    standardDeviationMs: number;
}

export class LocalWorkloadPolicyError extends Error {
    constructor(
        public readonly reason:
            | "empty"
            | "tooLarge"
            | "unsupportedDirective"
            | "unresolvedVariable"
            | "unsafeStatement"
            | "tooManyBatches"
            | "invalidGoRepetition",
    ) {
        super(`Local workload policy rejected the script: ${reason}`);
        this.name = "LocalWorkloadPolicyError";
    }
}

export function parseLocalWorkload(content: Buffer | string): LocalWorkloadPlan {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    if (bytes.length === 0) {
        throw new LocalWorkloadPolicyError("empty");
    }
    if (bytes.length > MAX_LOCAL_WORKLOAD_BYTES) {
        throw new LocalWorkloadPolicyError("tooLarge");
    }
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    if (text.includes("\0")) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    const variables = new Map<string, string>();
    const sqlLines: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const setVariable = /^\s*:setvar\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/i.exec(line);
        if (setVariable) {
            const rawValue = setVariable[2].trim();
            variables.set(
                setVariable[1].toLowerCase(),
                rawValue.startsWith('"') && rawValue.endsWith('"')
                    ? rawValue.slice(1, -1).replace(/""/g, '"')
                    : rawValue,
            );
            continue;
        }
        if (
            /^\s*:(?:r|on\s+error|connect|list|reset|error|out|perftrace)\b/i.test(line) ||
            /^\s*!!/.test(line)
        ) {
            throw new LocalWorkloadPolicyError("unsupportedDirective");
        }
        sqlLines.push(line);
    }

    const batches: string[] = [];
    let pending: string[] = [];
    const appendPending = (repetitions: number) => {
        const rawBatch = pending.join("\n").trim();
        pending = [];
        if (!rawBatch) {
            return;
        }
        const batch = rawBatch.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (_match, name) => {
            const value = variables.get(String(name).toLowerCase());
            if (value === undefined) {
                throw new LocalWorkloadPolicyError("unresolvedVariable");
            }
            return value;
        });
        const policyText = maskSqlStringsAndComments(batch);
        if (BLOCKED_WORKLOAD_POLICY.test(policyText) || CROSS_DATABASE_REFERENCE.test(policyText)) {
            throw new LocalWorkloadPolicyError("unsafeStatement");
        }
        if (batches.length + repetitions > MAX_LOCAL_WORKLOAD_BATCHES) {
            throw new LocalWorkloadPolicyError("tooManyBatches");
        }
        for (let repetition = 0; repetition < repetitions; repetition++) {
            batches.push(batch);
        }
    };

    for (const line of sqlLines) {
        const go = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(line);
        if (!go) {
            pending.push(line);
            continue;
        }
        const repetitions = go[1] ? Number.parseInt(go[1], 10) : 1;
        if (
            !Number.isSafeInteger(repetitions) ||
            repetitions < 1 ||
            repetitions > MAX_LOCAL_WORKLOAD_GO_REPETITION
        ) {
            throw new LocalWorkloadPolicyError("invalidGoRepetition");
        }
        appendPending(repetitions);
    }
    appendPending(1);
    if (batches.length === 0) {
        throw new LocalWorkloadPolicyError("empty");
    }
    return {
        workloadSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        sourceByteCount: bytes.length,
        batchCount: batches.length,
        mutating: batches.some((batch) => MUTATION_SIGNAL.test(maskSqlStringsAndComments(batch))),
        batches,
    };
}

/** Closed workload generator for the first data-driven developer scenario.
 * Sample values never enter a model call; they are projected by the host
 * directly into a disposable shadow table in the owned target container. */
export function buildLocalCitiesShadowWorkload(
    rows: readonly LocalCitiesSampleRow[],
    iterations: number,
    tableSuffix: string,
): string {
    if (
        rows.length < MIN_LOCAL_CITIES_SAMPLE_ROWS ||
        rows.length > MAX_LOCAL_CITIES_SAMPLE_ROWS ||
        !Number.isSafeInteger(iterations) ||
        iterations < 1 ||
        iterations > MAX_LOCAL_CITIES_ITERATIONS ||
        !/^[a-f0-9]{12}$/.test(tableSuffix)
    ) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    const values = rows
        .map(
            (row) =>
                `(N'${escapeSqlString(row.cityName)}', ${integerSql(row.stateProvinceId)}, ${
                    row.latestRecordedPopulation === null
                        ? "NULL"
                        : integerSql(row.latestRecordedPopulation)
                }, ${integerSql(row.lastEditedBy)})`,
        )
        .join(",\n    ");
    const tableName = `[rbs_workload].[Cities_${tableSuffix}]`;
    return [
        "SET NOCOUNT ON;",
        "SET XACT_ABORT ON;",
        "IF SCHEMA_ID(N'rbs_workload') IS NULL EXEC(N'CREATE SCHEMA [rbs_workload] AUTHORIZATION [dbo]');",
        `IF OBJECT_ID(N'${tableName}', N'U') IS NOT NULL THROW 51020, 'Runbook workload shadow table already exists.', 1;`,
        `CREATE TABLE ${tableName}(`,
        "    [WorkloadRowId] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,",
        "    [CityName] nvarchar(100) NOT NULL,",
        "    [StateProvinceID] int NOT NULL,",
        "    [LatestRecordedPopulation] bigint NULL,",
        "    [LastEditedBy] int NOT NULL",
        ");",
        `INSERT ${tableName} ([CityName], [StateProvinceID], [LatestRecordedPopulation], [LastEditedBy]) VALUES`,
        `    ${values};`,
        "DECLARE @rbsIteration int = 1;",
        "DECLARE @rbsInsertedId bigint;",
        `WHILE @rbsIteration <= ${iterations}`,
        "BEGIN",
        `    INSERT ${tableName} ([CityName], [StateProvinceID], [LatestRecordedPopulation], [LastEditedBy])`,
        "    SELECT CONCAT(LEFT([CityName], 72), N'_rbs_', @rbsIteration), [StateProvinceID], [LatestRecordedPopulation], [LastEditedBy]",
        `    FROM ${tableName}`,
        "    ORDER BY [WorkloadRowId]",
        "    OFFSET ((@rbsIteration - 1) % " + rows.length + ") ROWS FETCH NEXT 1 ROWS ONLY;",
        "    SET @rbsInsertedId = SCOPE_IDENTITY();",
        `    DELETE FROM ${tableName} WHERE [WorkloadRowId] = @rbsInsertedId;`,
        "    SET @rbsIteration += 1;",
        "END;",
        `DROP TABLE ${tableName};`,
    ].join("\n");
}

/** Stable identity for comparison across runs. The run-specific shadow-table
 * suffix is deliberately excluded, while sampled source values and the
 * requested iteration count participate in the digest. */
export function localCitiesWorkloadFingerprint(
    rows: readonly LocalCitiesSampleRow[],
    iterations: number,
): string {
    if (
        rows.length < MIN_LOCAL_CITIES_SAMPLE_ROWS ||
        rows.length > MAX_LOCAL_CITIES_SAMPLE_ROWS ||
        !Number.isSafeInteger(iterations) ||
        iterations < 1 ||
        iterations > MAX_LOCAL_CITIES_ITERATIONS
    ) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    const normalizedRows = rows.map((row) => {
        escapeSqlString(row.cityName);
        integerSql(row.stateProvinceId);
        if (row.latestRecordedPopulation !== null) {
            integerSql(row.latestRecordedPopulation);
        }
        integerSql(row.lastEditedBy);
        return [row.cityName, row.stateProvinceId, row.latestRecordedPopulation, row.lastEditedBy];
    });
    return crypto
        .createHash("sha256")
        .update(
            JSON.stringify({
                schemaVersion: 1,
                template: LOCAL_CITIES_WORKLOAD_TEMPLATE,
                iterations,
                rows: normalizedRows,
            }),
        )
        .digest("hex");
}

/** Summarizes only complete successful repetitions. Percentiles use the
 * nearest-rank definition and variance is population variance because the
 * emitted values describe the captured sample. */
export function summarizeLocalWorkloadMeasurements(
    results: readonly {
        iteration: number;
        durationMs: number;
        succeeded: boolean;
    }[],
    batchesPerRepetition: number,
): LocalWorkloadMeasurementSummary {
    if (!Number.isSafeInteger(batchesPerRepetition) || batchesPerRepetition < 1) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    const byIteration = new Map<number, typeof results>();
    for (const result of results) {
        if (
            !Number.isSafeInteger(result.iteration) ||
            result.iteration < 1 ||
            !Number.isFinite(result.durationMs) ||
            result.durationMs < 0
        ) {
            throw new LocalWorkloadPolicyError("unsafeStatement");
        }
        const items = byIteration.get(result.iteration) ?? [];
        byIteration.set(result.iteration, [...items, result]);
    }
    const durations = [...byIteration.values()]
        .filter(
            (items) =>
                items.length === batchesPerRepetition && items.every((item) => item.succeeded),
        )
        .map((items) => items.reduce((sum, item) => sum + item.durationMs, 0))
        .sort((left, right) => left - right);
    if (durations.length === 0) {
        return {
            measurementSampleCount: 0,
            meanDurationMs: 0,
            p50DurationMs: 0,
            p95DurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
            standardDeviationMs: 0,
        };
    }
    const meanDurationMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    const percentile = (value: number) =>
        durations[Math.max(0, Math.ceil((value / 100) * durations.length) - 1)];
    const variance =
        durations.reduce((sum, value) => sum + (value - meanDurationMs) ** 2, 0) / durations.length;
    return {
        measurementSampleCount: durations.length,
        meanDurationMs,
        p50DurationMs: percentile(50),
        p95DurationMs: percentile(95),
        minDurationMs: durations[0],
        maxDurationMs: durations[durations.length - 1],
        standardDeviationMs: Math.sqrt(variance),
    };
}

function escapeSqlString(value: string): string {
    if (value.length === 0 || value.length > 100 || /[\u0000-\u001f]/.test(value)) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    return value.replace(/'/g, "''");
}

function integerSql(value: number): string {
    if (!Number.isSafeInteger(value)) {
        throw new LocalWorkloadPolicyError("unsafeStatement");
    }
    return String(value);
}

/** Retains token boundaries while removing quoted/comment text so policy
 * keywords inside data or comments do not become false positives. */
function maskSqlStringsAndComments(sql: string): string {
    let result = "";
    let index = 0;
    let state: "code" | "string" | "lineComment" | "blockComment" = "code";
    while (index < sql.length) {
        const current = sql[index];
        const next = sql[index + 1];
        if (state === "code") {
            if (current === "'") {
                state = "string";
                result += " ";
            } else if (current === "-" && next === "-") {
                state = "lineComment";
                result += "  ";
                index++;
            } else if (current === "/" && next === "*") {
                state = "blockComment";
                result += "  ";
                index++;
            } else {
                result += current;
            }
        } else if (state === "string") {
            result += current === "\n" ? "\n" : " ";
            if (current === "'" && next === "'") {
                result += " ";
                index++;
            } else if (current === "'") {
                state = "code";
            }
        } else if (state === "lineComment") {
            result += current === "\n" ? "\n" : " ";
            if (current === "\n") {
                state = "code";
            }
        } else {
            result += current === "\n" ? "\n" : " ";
            if (current === "*" && next === "/") {
                result += " ";
                index++;
                state = "code";
            }
        }
        index++;
    }
    return result;
}
