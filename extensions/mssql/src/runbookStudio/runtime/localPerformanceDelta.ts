/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Deterministic comparison of two same-run DMV snapshots. This produces
 * factual deltas and comparability reasons only; it never produces a
 * performance pass/regression verdict. */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";
import type {
    LocalPerformanceSnapshotResult,
    LocalPerformanceSnapshotRow,
} from "./localPerformanceSnapshot";

export const MAX_LOCAL_PERFORMANCE_DELTA_ROWS = 1000;

export type LocalPerformanceDeltaComparability =
    | "comparable"
    | "pointInTime"
    | "missingBefore"
    | "missingAfter"
    | "counterReset";

export interface LocalPerformanceDeltaRow {
    scope: LocalPerformanceSnapshotRow["scope"];
    category: string;
    item: string;
    metric: string;
    unit: string;
    beforeValue: number | null;
    afterValue: number | null;
    deltaValue: number | null;
    comparability: LocalPerformanceDeltaComparability;
}

export interface LocalPerformanceDeltaResult {
    beforeCapturedAtUtc: string;
    afterCapturedAtUtc: string;
    beforeSnapshotSha256: string;
    afterSnapshotSha256: string;
    rows: LocalPerformanceDeltaRow[];
    comparableMetricCount: number;
    incompleteMetricCount: number;
    counterResetMetricCount: number;
    inputTruncated: boolean;
    truncated: boolean;
    deltaSha256: string;
}

const POINT_IN_TIME_CATEGORIES = new Set(["active_requests", "database_space"]);

export function compareLocalPerformanceSnapshots(
    before: LocalPerformanceSnapshotResult,
    after: LocalPerformanceSnapshotResult,
): LocalPerformanceDeltaResult {
    const beforeEpoch = Date.parse(before.capturedAtUtc);
    const afterEpoch = Date.parse(after.capturedAtUtc);
    if (!Number.isFinite(beforeEpoch) || !Number.isFinite(afterEpoch) || afterEpoch < beforeEpoch) {
        throw new Error("Performance snapshots are not in chronological order");
    }
    const beforeRows = keyedRows(before.rows);
    const afterRows = keyedRows(after.rows);
    const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort((left, right) =>
        left.localeCompare(right),
    );
    const rows: LocalPerformanceDeltaRow[] = [];
    for (const key of keys.slice(0, MAX_LOCAL_PERFORMANCE_DELTA_ROWS)) {
        const beforeRow = beforeRows.get(key);
        const afterRow = afterRows.get(key);
        const identity = afterRow ?? beforeRow;
        if (!identity) {
            continue;
        }
        let comparability: LocalPerformanceDeltaComparability;
        let deltaValue: number | null = null;
        if (!beforeRow) {
            comparability = "missingBefore";
        } else if (!afterRow) {
            comparability = "missingAfter";
        } else if (POINT_IN_TIME_CATEGORIES.has(identity.category)) {
            comparability = "pointInTime";
            deltaValue = afterRow.value - beforeRow.value;
        } else if (afterRow.value < beforeRow.value) {
            comparability = "counterReset";
        } else {
            comparability = "comparable";
            deltaValue = afterRow.value - beforeRow.value;
        }
        rows.push({
            scope: identity.scope,
            category: identity.category,
            item: identity.item,
            metric: identity.metric,
            unit: identity.unit,
            beforeValue: beforeRow?.value ?? null,
            afterValue: afterRow?.value ?? null,
            deltaValue,
            comparability,
        });
    }
    const comparableMetricCount = rows.filter(
        (row) => row.comparability === "comparable" || row.comparability === "pointInTime",
    ).length;
    const counterResetMetricCount = rows.filter(
        (row) => row.comparability === "counterReset",
    ).length;
    const incompleteMetricCount = rows.length - comparableMetricCount;
    const inputTruncated = before.truncated || after.truncated;
    const truncated = keys.length > rows.length;
    const digestInput = {
        beforeSnapshotSha256: before.snapshotSha256,
        afterSnapshotSha256: after.snapshotSha256,
        rows,
        inputTruncated,
        truncated,
    };
    return {
        beforeCapturedAtUtc: before.capturedAtUtc,
        afterCapturedAtUtc: after.capturedAtUtc,
        beforeSnapshotSha256: before.snapshotSha256,
        afterSnapshotSha256: after.snapshotSha256,
        rows,
        comparableMetricCount,
        incompleteMetricCount,
        counterResetMetricCount,
        inputTruncated,
        truncated,
        deltaSha256: crypto
            .createHash("sha256")
            .update(canonicalRunbookJson(digestInput))
            .digest("hex"),
    };
}

function keyedRows(
    rows: readonly LocalPerformanceSnapshotRow[],
): Map<string, LocalPerformanceSnapshotRow> {
    const keyed = new Map<string, LocalPerformanceSnapshotRow>();
    for (const row of rows) {
        const key = [row.scope, row.category, row.item, row.metric, row.unit].join("\u0000");
        if (keyed.has(key)) {
            throw new Error("Performance snapshot contains a duplicate metric identity");
        }
        keyed.set(key, row);
    }
    return keyed;
}
