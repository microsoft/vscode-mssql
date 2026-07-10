/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transform spec v1 (C2D-T, addendum §3.2/§3.4): a small, versioned,
 * serializable logical plan — never callbacks — so the same shape is the AI
 * tool's validated input, a derived snapshot's reproducible definition, an
 * auditable digest for diagnostics/replay, and a future pushdown unit.
 *
 * Validation is strict: unknown ops/terminals/comparators/aggregates reject;
 * a validated spec canonicalizes to a stable JSON string whose sha256[0:12]
 * is the specDigest. Filter/inSet LITERALS are user/model data — they ride
 * the spec but never diagnostics (§3.7).
 */

import * as crypto from "crypto";

// --- shapes ---------------------------------------------------------------------

export type TransformComparator =
    | "eq"
    | "ne"
    | "lt"
    | "le"
    | "gt"
    | "ge"
    | "isNull"
    | "notNull"
    | "contains"
    | "startsWith"
    | "inSet";

export type TransformPredicate =
    | { and: TransformPredicate[] }
    | { or: TransformPredicate[] }
    | { not: TransformPredicate }
    | {
          col: number;
          cmp: TransformComparator;
          value?: string | number | boolean;
          values?: Array<string | number | boolean>;
      };

export type TransformOp =
    | { op: "filter"; pred: TransformPredicate }
    | { op: "project"; columns: number[] }
    | { op: "slice"; offset: number; limit: number };

export type TransformAggregateFn =
    | "count"
    | "nullCount"
    | "sum"
    | "avg"
    | "min"
    | "max"
    | "stddev"
    | "distinctCount";

export interface TransformAggregate {
    fn: TransformAggregateFn;
    /** Post-ops column ordinal; count needs none. */
    col?: number;
}

export type TransformSampleStrategy = "head" | "head_tail" | "uniform_windows" | "reservoir";

export type TransformTerminal =
    | { kind: "rows"; limit: number }
    | { kind: "aggregate"; aggs: TransformAggregate[] }
    | {
          kind: "groupBy";
          keys: number[];
          aggs: TransformAggregate[];
          maxGroups?: number;
          orderBy?: { agg: number; dir: "asc" | "desc" };
          limitGroups?: number;
      }
    | { kind: "topK"; col: number; k: number; by: "value" | "frequency" }
    | { kind: "histogram"; col: number; boundaries?: number[]; bucketCount?: number }
    | { kind: "distinctCount"; col: number }
    | { kind: "sample"; strategy: TransformSampleStrategy; n: number };

export interface TransformSource {
    snapshotId: string;
    resultSetId: string;
    rows?: { kind: "all" } | { kind: "span"; start: number; count: number };
    /** Source-column projection applied before ops (ordinals). */
    columns?: number[];
}

export interface TransformSpec {
    v: 1;
    source: TransformSource;
    ops?: TransformOp[];
    terminal: TransformTerminal;
}

// --- validation ---------------------------------------------------------------------

export interface TransformSpecError {
    path: string;
    message: string;
}

const COMPARATORS = new Set<string>([
    "eq",
    "ne",
    "lt",
    "le",
    "gt",
    "ge",
    "isNull",
    "notNull",
    "contains",
    "startsWith",
    "inSet",
]);
const AGG_FNS = new Set<string>([
    "count",
    "nullCount",
    "sum",
    "avg",
    "min",
    "max",
    "stddev",
    "distinctCount",
]);
const SAMPLE_STRATEGIES = new Set<string>(["head", "head_tail", "uniform_windows", "reservoir"]);
const MAX_PREDICATE_NODES = 200;
const MAX_OPS = 16;

function isOrdinal(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4095;
}

function isScalar(value: unknown): boolean {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function validatePredicate(
    raw: unknown,
    path: string,
    errors: TransformSpecError[],
    budget: { nodes: number },
): void {
    if (++budget.nodes > MAX_PREDICATE_NODES) {
        errors.push({ path, message: `predicate exceeds ${MAX_PREDICATE_NODES} nodes` });
        return;
    }
    if (raw === null || typeof raw !== "object") {
        errors.push({ path, message: "predicate node must be an object" });
        return;
    }
    const node = raw as Record<string, unknown>;
    if (Array.isArray(node.and) || Array.isArray(node.or)) {
        const list = (node.and ?? node.or) as unknown[];
        if (list.length === 0) {
            errors.push({ path, message: "and/or requires at least one child" });
        }
        list.forEach((child, index) =>
            validatePredicate(
                child,
                `${path}.${node.and ? "and" : "or"}[${index}]`,
                errors,
                budget,
            ),
        );
        return;
    }
    if (node.not !== undefined) {
        validatePredicate(node.not, `${path}.not`, errors, budget);
        return;
    }
    if (!isOrdinal(node.col)) {
        errors.push({ path, message: "leaf requires a col ordinal" });
        return;
    }
    if (typeof node.cmp !== "string" || !COMPARATORS.has(node.cmp)) {
        errors.push({ path, message: `unknown comparator '${String(node.cmp)}'` });
        return;
    }
    if (node.cmp === "inSet") {
        if (!Array.isArray(node.values) || node.values.length === 0 || node.values.length > 1000) {
            errors.push({ path, message: "inSet requires 1..1000 scalar values" });
        } else if (!node.values.every(isScalar)) {
            errors.push({ path, message: "inSet values must be scalars" });
        }
    } else if (node.cmp !== "isNull" && node.cmp !== "notNull") {
        if (!isScalar(node.value)) {
            errors.push({ path, message: `comparator '${node.cmp}' requires a scalar value` });
        }
    }
}

function validateAggs(raw: unknown, path: string, errors: TransformSpecError[]): void {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) {
        errors.push({ path, message: "requires 1..32 aggregates" });
        return;
    }
    raw.forEach((agg, index) => {
        const node = agg as Record<string, unknown>;
        if (typeof node?.fn !== "string" || !AGG_FNS.has(node.fn)) {
            errors.push({ path: `${path}[${index}]`, message: "unknown aggregate fn" });
            return;
        }
        if (node.fn !== "count" && !isOrdinal(node.col)) {
            errors.push({ path: `${path}[${index}]`, message: `${node.fn} requires a col` });
        }
    });
}

/** Validate an untrusted spec value. Returns a typed spec or errors. */
export function validateTransformSpec(
    raw: unknown,
):
    | { spec: TransformSpec; errors?: undefined }
    | { spec?: undefined; errors: TransformSpecError[] } {
    const errors: TransformSpecError[] = [];
    const value = raw as Record<string, unknown> | null;
    if (value === null || typeof value !== "object") {
        return { errors: [{ path: "$", message: "spec must be an object" }] };
    }
    if (value.v !== 1) {
        errors.push({ path: "$.v", message: "unsupported spec version (expected 1)" });
    }
    const source = value.source as Record<string, unknown> | undefined;
    if (!source || typeof source !== "object") {
        errors.push({ path: "$.source", message: "source is required" });
    } else {
        if (typeof source.snapshotId !== "string" || source.snapshotId.length === 0) {
            errors.push({ path: "$.source.snapshotId", message: "snapshotId is required" });
        }
        if (typeof source.resultSetId !== "string" || source.resultSetId.length === 0) {
            errors.push({ path: "$.source.resultSetId", message: "resultSetId is required" });
        }
        const rows = source.rows as Record<string, unknown> | undefined;
        if (rows !== undefined) {
            if (rows?.kind === "span") {
                if (!isOrdinal(rows.start) || typeof rows.count !== "number" || rows.count < 0) {
                    errors.push({ path: "$.source.rows", message: "span requires start/count" });
                }
            } else if (rows?.kind !== "all") {
                errors.push({ path: "$.source.rows", message: "rows.kind must be all|span" });
            }
        }
        if (source.columns !== undefined) {
            if (
                !Array.isArray(source.columns) ||
                source.columns.length === 0 ||
                !source.columns.every(isOrdinal)
            ) {
                errors.push({ path: "$.source.columns", message: "columns must be ordinals" });
            }
        }
    }
    const ops = value.ops as unknown[] | undefined;
    if (ops !== undefined) {
        if (!Array.isArray(ops) || ops.length > MAX_OPS) {
            errors.push({ path: "$.ops", message: `ops must be an array of at most ${MAX_OPS}` });
        } else {
            ops.forEach((rawOp, index) => {
                const op = rawOp as Record<string, unknown>;
                const path = `$.ops[${index}]`;
                if (op?.op === "filter") {
                    validatePredicate(op.pred, `${path}.pred`, errors, { nodes: 0 });
                } else if (op?.op === "project") {
                    if (
                        !Array.isArray(op.columns) ||
                        op.columns.length === 0 ||
                        !op.columns.every(isOrdinal)
                    ) {
                        errors.push({ path, message: "project requires column ordinals" });
                    }
                } else if (op?.op === "slice") {
                    if (
                        typeof op.offset !== "number" ||
                        op.offset < 0 ||
                        typeof op.limit !== "number" ||
                        op.limit < 0
                    ) {
                        errors.push({ path, message: "slice requires offset/limit ≥ 0" });
                    }
                } else {
                    errors.push({ path, message: `unknown op '${String(op?.op)}'` });
                }
            });
        }
    }
    const terminal = value.terminal as Record<string, unknown> | undefined;
    if (!terminal || typeof terminal !== "object") {
        errors.push({ path: "$.terminal", message: "terminal is required" });
    } else {
        const path = "$.terminal";
        switch (terminal.kind) {
            case "rows":
                if (typeof terminal.limit !== "number" || terminal.limit <= 0) {
                    errors.push({ path, message: "rows requires limit > 0" });
                }
                break;
            case "aggregate":
                validateAggs(terminal.aggs, `${path}.aggs`, errors);
                break;
            case "groupBy":
                if (
                    !Array.isArray(terminal.keys) ||
                    terminal.keys.length === 0 ||
                    terminal.keys.length > 8 ||
                    !terminal.keys.every(isOrdinal)
                ) {
                    errors.push({
                        path: `${path}.keys`,
                        message: "groupBy requires 1..8 key ordinals",
                    });
                }
                validateAggs(terminal.aggs, `${path}.aggs`, errors);
                if (terminal.orderBy !== undefined) {
                    const orderBy = terminal.orderBy as Record<string, unknown>;
                    if (
                        !isOrdinal(orderBy?.agg) ||
                        (orderBy.dir !== "asc" && orderBy.dir !== "desc")
                    ) {
                        errors.push({
                            path: `${path}.orderBy`,
                            message: "orderBy requires agg/dir",
                        });
                    }
                }
                break;
            case "topK":
                if (!isOrdinal(terminal.col)) {
                    errors.push({ path, message: "topK requires col" });
                }
                if (typeof terminal.k !== "number" || terminal.k <= 0 || terminal.k > 1000) {
                    errors.push({ path, message: "topK requires 1..1000 k" });
                }
                if (terminal.by !== "value" && terminal.by !== "frequency") {
                    errors.push({ path, message: "topK by must be value|frequency" });
                }
                break;
            case "histogram":
                if (!isOrdinal(terminal.col)) {
                    errors.push({ path, message: "histogram requires col" });
                }
                if (terminal.boundaries !== undefined) {
                    if (
                        !Array.isArray(terminal.boundaries) ||
                        terminal.boundaries.length < 1 ||
                        terminal.boundaries.length > 256 ||
                        !terminal.boundaries.every((b) => typeof b === "number") ||
                        !terminal.boundaries.every(
                            (b, i, arr) => i === 0 || (arr[i - 1] as number) < (b as number),
                        )
                    ) {
                        errors.push({
                            path: `${path}.boundaries`,
                            message: "boundaries must be 1..256 strictly ascending numbers",
                        });
                    }
                } else if (
                    terminal.bucketCount !== undefined &&
                    (typeof terminal.bucketCount !== "number" ||
                        terminal.bucketCount < 1 ||
                        terminal.bucketCount > 256)
                ) {
                    errors.push({ path, message: "bucketCount must be 1..256" });
                }
                break;
            case "distinctCount":
                if (!isOrdinal(terminal.col)) {
                    errors.push({ path, message: "distinctCount requires col" });
                }
                break;
            case "sample":
                if (
                    typeof terminal.strategy !== "string" ||
                    !SAMPLE_STRATEGIES.has(terminal.strategy)
                ) {
                    errors.push({ path, message: "unknown sample strategy" });
                }
                if (typeof terminal.n !== "number" || terminal.n <= 0 || terminal.n > 10_000) {
                    errors.push({ path, message: "sample requires 1..10000 n" });
                }
                break;
            default:
                errors.push({ path, message: `unknown terminal '${String(terminal?.kind)}'` });
        }
    }
    if (errors.length > 0) {
        return { errors };
    }
    return { spec: value as unknown as TransformSpec };
}

// --- canonicalization + digest ----------------------------------------------------------

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const out: Record<string, unknown> = {};
        for (const [key, v] of entries) {
            out[key] = canonicalize(v);
        }
        return out;
    }
    return value;
}

/** Stable digest of the canonical spec — loggable (structural), reproducible. */
export function transformSpecDigest(spec: TransformSpec): string {
    const canonical = JSON.stringify(canonicalize(spec));
    return crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}

/** True when the terminal's output contains cell-derived bytes (§1.4). */
export function transformOutputClass(spec: TransformSpec): "values" | "aggregateNumeric" {
    const terminal = spec.terminal;
    switch (terminal.kind) {
        case "rows":
        case "sample":
        case "topK":
            return "values";
        case "groupBy":
            return "values"; // group KEYS are cell values
        case "histogram":
            return terminal.boundaries ? "aggregateNumeric" : "values"; // auto boundaries derive from data
        case "distinctCount":
            return "aggregateNumeric";
        case "aggregate":
            return terminal.aggs.some((agg) => agg.fn === "min" || agg.fn === "max")
                ? "values"
                : "aggregateNumeric";
    }
}
