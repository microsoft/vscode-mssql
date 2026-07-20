/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure bounded interpreter for the schema-v2 presentation transform grammar.
 * It has no SQL, model, network, filesystem, or dynamic-code capability.
 */

import {
    AggregateFunction,
    AggregateMeasure,
    JsonScalar,
    PresentationPredicate,
    SortSpec,
    TransformPipeline,
} from "../../sharedInterfaces/runbookPresentation";

export type PresentationCell = string | number | boolean | null;

export interface PresentationTable {
    columns: string[];
    rows: PresentationCell[][];
    truncated?: boolean;
}

export type PresentationTransformFailureReason =
    | "invalidPipeline"
    | "fieldMissing"
    | "typeMismatch"
    | "tooLarge";

export type PresentationTransformResult =
    | { ok: true; table: PresentationTable }
    | { ok: false; reason: PresentationTransformFailureReason };

const MAX_TRANSFORM_STEPS = 20;
const MAX_FIELDS = 100;
const MAX_PREDICATE_DEPTH = 8;
const MAX_PREDICATE_NODES = 100;
const MAX_LIMIT = 10_000;
const MAX_PIVOT_COLUMNS = 100;
const AGGREGATES = new Set<AggregateFunction>([
    "sum",
    "avg",
    "min",
    "max",
    "count",
    "count-distinct",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validName(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validNameArray(value: unknown, allowEmpty = true): value is string[] {
    return (
        Array.isArray(value) &&
        (allowEmpty || value.length > 0) &&
        value.length <= MAX_FIELDS &&
        value.every(validName) &&
        new Set(value).size === value.length
    );
}

function validSort(value: unknown): value is SortSpec[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= MAX_FIELDS &&
        value.every(
            (sort) =>
                isRecord(sort) &&
                validName(sort.field) &&
                (sort.direction === "asc" || sort.direction === "desc"),
        )
    );
}

function validScalar(value: unknown): value is JsonScalar {
    return (
        value === null ||
        (typeof value === "string" && value.length <= 4096) ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean"
    );
}

function validPredicate(
    value: unknown,
    depth = 0,
    budget = { remaining: MAX_PREDICATE_NODES },
): value is PresentationPredicate {
    if (!isRecord(value) || depth > MAX_PREDICATE_DEPTH || budget.remaining-- <= 0) {
        return false;
    }
    if (["eq", "ne", "gt", "gte", "lt", "lte"].includes(String(value.op))) {
        return validName(value.field) && validScalar(value.value);
    }
    if (value.op === "in") {
        return (
            validName(value.field) &&
            Array.isArray(value.values) &&
            value.values.length <= MAX_FIELDS &&
            value.values.every(validScalar)
        );
    }
    if (value.op === "is-null" || value.op === "not-null") {
        return validName(value.field);
    }
    if (value.op === "not") {
        return validPredicate(value.child, depth + 1, budget);
    }
    if (value.op === "and" || value.op === "or") {
        return (
            Array.isArray(value.children) &&
            value.children.length > 0 &&
            value.children.length <= MAX_FIELDS &&
            value.children.every((child) => validPredicate(child, depth + 1, budget))
        );
    }
    return false;
}

function validMeasures(value: unknown): value is AggregateMeasure[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= MAX_FIELDS &&
        value.every(
            (measure) =>
                isRecord(measure) &&
                AGGREGATES.has(measure.fn as AggregateFunction) &&
                validName(measure.as) &&
                (measure.field === undefined || validName(measure.field)) &&
                (measure.fn === "count" || measure.field !== undefined),
        ) &&
        new Set(value.map((measure) => measure.as)).size === value.length
    );
}

/** Strictly validate the untrusted persisted transform envelope. */
export function validateTransformPipeline(value: unknown): value is TransformPipeline {
    if (
        !isRecord(value) ||
        !Array.isArray(value.steps) ||
        value.steps.length > MAX_TRANSFORM_STEPS
    ) {
        return false;
    }
    return value.steps.every((step) => {
        if (!isRecord(step) || typeof step.op !== "string") {
            return false;
        }
        switch (step.op) {
            case "select":
                return validNameArray(step.columns, false);
            case "rename":
                return (
                    isRecord(step.columns) &&
                    Object.keys(step.columns).length > 0 &&
                    Object.keys(step.columns).length <= MAX_FIELDS &&
                    Object.entries(step.columns).every(
                        ([from, to]) => validName(from) && validName(to),
                    )
                );
            case "filter":
                return validPredicate(step.predicate);
            case "sort":
                return validSort(step.by);
            case "limit":
                return (
                    Number.isInteger(step.count) &&
                    Number(step.count) >= 0 &&
                    Number(step.count) <= MAX_LIMIT
                );
            case "aggregate":
                return validNameArray(step.by) && validMeasures(step.measures);
            case "pivot":
                return (
                    validNameArray(step.index) &&
                    validName(step.column) &&
                    validName(step.value) &&
                    AGGREGATES.has(step.reducer as AggregateFunction)
                );
            case "to-timeseries":
                return validName(step.timeField) && validNameArray(step.measureFields, false);
            default:
                return false;
        }
    });
}

function indexes(columns: string[], fields: string[]): number[] | undefined {
    const values = fields.map((field) => columns.indexOf(field));
    return values.some((index) => index < 0) ? undefined : values;
}

function compareCells(left: PresentationCell, right: PresentationCell): number {
    if (left === right) {
        return 0;
    }
    if (left === null) {
        return -1;
    }
    if (right === null) {
        return 1;
    }
    if (typeof left === "number" && typeof right === "number") {
        return left - right;
    }
    return String(left).localeCompare(String(right));
}

function predicateMatches(
    predicate: PresentationPredicate,
    columns: string[],
    row: PresentationCell[],
): boolean | undefined {
    if (predicate.op === "and" || predicate.op === "or") {
        const values = predicate.children.map((child) => predicateMatches(child, columns, row));
        if (values.some((value) => value === undefined)) {
            return undefined;
        }
        return predicate.op === "and" ? values.every(Boolean) : values.some(Boolean);
    }
    if (predicate.op === "not") {
        const value = predicateMatches(predicate.child, columns, row);
        return value === undefined ? undefined : !value;
    }
    if (!("field" in predicate)) {
        return undefined;
    }
    const index = columns.indexOf(predicate.field);
    if (index < 0) {
        return undefined;
    }
    const cell = row[index] ?? null;
    if (predicate.op === "is-null") {
        return cell === null;
    }
    if (predicate.op === "not-null") {
        return cell !== null;
    }
    if (predicate.op === "in") {
        return predicate.values.some((value) => compareCells(cell, value) === 0);
    }
    if (!("value" in predicate)) {
        return undefined;
    }
    const compared = compareCells(cell, predicate.value);
    switch (predicate.op) {
        case "eq":
            return compared === 0;
        case "ne":
            return compared !== 0;
        case "gt":
            return compared > 0;
        case "gte":
            return compared >= 0;
        case "lt":
            return compared < 0;
        case "lte":
            return compared <= 0;
    }
}

function aggregate(
    fn: AggregateFunction,
    values: PresentationCell[],
): PresentationCell | undefined {
    const present = values.filter((value) => value !== null);
    if (fn === "count") {
        return present.length;
    }
    if (fn === "count-distinct") {
        return new Set(present.map((value) => JSON.stringify(value))).size;
    }
    const numeric = present.filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numeric.length !== present.length || numeric.length === 0) {
        return undefined;
    }
    if (fn === "sum") {
        return numeric.reduce((sum, value) => sum + value, 0);
    }
    if (fn === "avg") {
        return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    }
    return fn === "min" ? Math.min(...numeric) : Math.max(...numeric);
}

function groupedRows(
    table: PresentationTable,
    by: string[],
    measures: AggregateMeasure[],
): PresentationTransformResult {
    const byIndexes = indexes(table.columns, by);
    const measureIndexes = measures.map((measure) =>
        measure.field === undefined ? undefined : table.columns.indexOf(measure.field),
    );
    if (!byIndexes || measureIndexes.some((index) => index !== undefined && index < 0)) {
        return { ok: false, reason: "fieldMissing" };
    }
    const groups = new Map<string, { keys: PresentationCell[]; rows: PresentationCell[][] }>();
    for (const row of table.rows) {
        const keys = byIndexes.map((index) => row[index] ?? null);
        const key = JSON.stringify(keys);
        const group = groups.get(key) ?? { keys, rows: [] };
        group.rows.push(row);
        groups.set(key, group);
    }
    const rows: PresentationCell[][] = [];
    for (const group of groups.values()) {
        const values: PresentationCell[] = [...group.keys];
        for (let index = 0; index < measures.length; index++) {
            const measure = measures[index];
            const fieldIndex = measureIndexes[index];
            const sourceValues = group.rows.map((row) =>
                fieldIndex === undefined ? 1 : (row[fieldIndex] ?? null),
            );
            const value = aggregate(measure.fn, sourceValues);
            if (value === undefined) {
                return { ok: false, reason: "typeMismatch" };
            }
            values.push(value);
        }
        rows.push(values);
    }
    return {
        ok: true,
        table: {
            columns: [...by, ...measures.map((measure) => measure.as)],
            rows,
            ...(table.truncated ? { truncated: true } : {}),
        },
    };
}

function pivotRows(
    table: PresentationTable,
    indexFields: string[],
    columnField: string,
    valueField: string,
    reducer: AggregateFunction,
): PresentationTransformResult {
    const indexPositions = indexes(table.columns, indexFields);
    const columnIndex = table.columns.indexOf(columnField);
    const valueIndex = table.columns.indexOf(valueField);
    if (!indexPositions || columnIndex < 0 || valueIndex < 0) {
        return { ok: false, reason: "fieldMissing" };
    }
    const pivotNames: string[] = [];
    const pivotNameSet = new Set<string>();
    const groups = new Map<
        string,
        { keys: PresentationCell[]; values: Map<string, PresentationCell[]> }
    >();
    for (const row of table.rows) {
        const pivotName = String(row[columnIndex] ?? "null");
        if (!pivotNameSet.has(pivotName)) {
            if (pivotNames.length >= MAX_PIVOT_COLUMNS) {
                return { ok: false, reason: "tooLarge" };
            }
            pivotNames.push(pivotName);
            pivotNameSet.add(pivotName);
        }
        const keys = indexPositions.map((index) => row[index] ?? null);
        const key = JSON.stringify(keys);
        const group = groups.get(key) ?? { keys, values: new Map() };
        const values = group.values.get(pivotName) ?? [];
        values.push(row[valueIndex] ?? null);
        group.values.set(pivotName, values);
        groups.set(key, group);
    }
    const rows: PresentationCell[][] = [];
    for (const group of groups.values()) {
        const values = [...group.keys];
        for (const pivotName of pivotNames) {
            const source = group.values.get(pivotName) ?? [];
            if (source.length === 0) {
                values.push(null);
                continue;
            }
            const value = aggregate(reducer, source);
            if (value === undefined) {
                return { ok: false, reason: "typeMismatch" };
            }
            values.push(value);
        }
        rows.push(values);
    }
    return {
        ok: true,
        table: {
            columns: [...indexFields, ...pivotNames],
            rows,
            ...(table.truncated ? { truncated: true } : {}),
        },
    };
}

/** Execute a validated pipeline over one already-bounded table. */
export function applyTransformPipeline(
    input: PresentationTable,
    pipeline: TransformPipeline,
): PresentationTransformResult {
    if (!validateTransformPipeline(pipeline)) {
        return { ok: false, reason: "invalidPipeline" };
    }
    let table: PresentationTable = {
        columns: [...input.columns],
        rows: input.rows.map((row) => [...row]),
        ...(input.truncated ? { truncated: true } : {}),
    };
    for (const step of pipeline.steps) {
        switch (step.op) {
            case "select": {
                const selected = indexes(table.columns, step.columns);
                if (!selected) {
                    return { ok: false, reason: "fieldMissing" };
                }
                table = {
                    ...table,
                    columns: [...step.columns],
                    rows: table.rows.map((row) => selected.map((index) => row[index] ?? null)),
                };
                break;
            }
            case "rename": {
                if (Object.keys(step.columns).some((field) => !table.columns.includes(field))) {
                    return { ok: false, reason: "fieldMissing" };
                }
                const columns = table.columns.map((field) => step.columns[field] ?? field);
                if (new Set(columns).size !== columns.length) {
                    return { ok: false, reason: "invalidPipeline" };
                }
                table = { ...table, columns };
                break;
            }
            case "filter": {
                const matches = table.rows.map((row) =>
                    predicateMatches(step.predicate, table.columns, row),
                );
                if (matches.some((match) => match === undefined)) {
                    return { ok: false, reason: "fieldMissing" };
                }
                table = {
                    ...table,
                    rows: table.rows.filter((_, index) => matches[index] === true),
                };
                break;
            }
            case "sort": {
                const positions = indexes(
                    table.columns,
                    step.by.map((sort) => sort.field),
                );
                if (!positions) {
                    return { ok: false, reason: "fieldMissing" };
                }
                table = {
                    ...table,
                    rows: table.rows
                        .map((row, index) => ({ row, index }))
                        .sort((left, right) => {
                            for (let index = 0; index < step.by.length; index++) {
                                const compared = compareCells(
                                    left.row[positions[index]] ?? null,
                                    right.row[positions[index]] ?? null,
                                );
                                if (compared !== 0) {
                                    return step.by[index].direction === "asc"
                                        ? compared
                                        : -compared;
                                }
                            }
                            return left.index - right.index;
                        })
                        .map(({ row }) => row),
                };
                break;
            }
            case "limit":
                table = { ...table, rows: table.rows.slice(0, step.count) };
                break;
            case "aggregate": {
                const result = groupedRows(table, step.by, step.measures);
                if (!result.ok) {
                    return result;
                }
                table = result.table;
                break;
            }
            case "pivot": {
                const result = pivotRows(table, step.index, step.column, step.value, step.reducer);
                if (!result.ok) {
                    return result;
                }
                table = result.table;
                break;
            }
            case "to-timeseries": {
                const fields = [step.timeField, ...step.measureFields];
                const selected = indexes(table.columns, fields);
                if (!selected) {
                    return { ok: false, reason: "fieldMissing" };
                }
                table = {
                    ...table,
                    columns: fields,
                    rows: table.rows.map((row) => selected.map((index) => row[index] ?? null)),
                };
                break;
            }
        }
    }
    return { ok: true, table };
}
