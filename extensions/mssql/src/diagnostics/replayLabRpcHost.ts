/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-side projections for the Replay Lab RPCs (final plan WI-3.5): durable
 * catalog entries → thin run rows, items.jsonl records + live engine queue
 * rows → item rows, and frozen config groups → SANITIZED group summaries.
 *
 * PRIVACY: every projection here is allowlist-based. The config-group
 * sanitizer lives in featureCapture/configGroupSanitizer.ts (re-exported
 * here) so the wire and the durable repository share ONE allowlist —
 * content-bearing values collapse to flags before anything crosses the
 * webview boundary OR lands in configGroups.json. Item rows are built
 * field-by-field from the durable record (ids, labels, timestamps, digests);
 * live queue rows never contribute their event bodies.
 */

import { ReplayRunCatalogEntry } from "./featureCapture/replayRunCatalog";
import { ReplayRunItemRecordV1, ReplayRunManifestV1 } from "./featureCapture/replayRunRepository";
import { InlineCompletionDebugReplayQueueRow } from "../sharedInterfaces/inlineCompletionDebug";

export { sanitizeReplayLabConfigGroup } from "./featureCapture/configGroupSanitizer";
import {
    REPLAY_LAB_ITEMS_DEFAULT_LIMIT,
    REPLAY_LAB_ITEMS_MAX_LIMIT,
    REPLAY_LAB_RUN_LIST_DEFAULT_LIMIT,
    REPLAY_LAB_RUN_LIST_MAX_LIMIT,
    ReplayLabItemRowV1,
    ReplayLabRunRowV1,
    DcReplayRunListParams,
    DcReplayRunListResult,
} from "../sharedInterfaces/replayLabRpc";

// ---------------------------------------------------------------------------
// Run rows
// ---------------------------------------------------------------------------

/** Project one durable manifest to a thin Lab run row (metadata only). */
export function projectDurableReplayRunRow(
    entry: ReplayRunCatalogEntry,
    currentHostSessionId: string,
): ReplayLabRunRowV1 {
    const manifest = entry.manifest;
    return {
        replayRunId: manifest.replayRunId,
        hostSessionId: entry.hostSessionId,
        currentHostSession: entry.hostSessionId === currentHostSessionId,
        featureId: manifest.featureId,
        semantics: manifest.semantics,
        status: manifest.status,
        kind: manifest.cells.length > 0 ? "matrix" : "single",
        createdAt: manifest.createdAt,
        ...(manifest.startedAt !== undefined ? { startedAt: manifest.startedAt } : {}),
        ...(manifest.endedAt !== undefined ? { endedAt: manifest.endedAt } : {}),
        sourceCount: manifest.sources.length,
        cellCount: manifest.cells.length,
        repetitions: manifest.repetitions,
        expectedItems: manifest.expectedItems,
        completedItems: manifest.completedItems,
        failedItems: manifest.failedItems,
        cancelledItems: manifest.cancelledItems,
        blockedItems: manifest.blockedItems ?? 0,
        ...(manifest.estimate ? { estimate: manifest.estimate } : {}),
        ...(manifest.actual ? { actualExecutions: manifest.actual.totalExecutions } : {}),
        ...(manifest.safety ? { safetySideEffectClass: manifest.safety.sideEffectClass } : {}),
        durable: true,
        live: false,
    };
}

/** Clamp + page the sorted durable rows (offset cursor over a small set). */
export function buildReplayRunListResult(input: {
    entries: ReplayRunCatalogEntry[];
    issues: string[];
    params: DcReplayRunListParams | undefined;
    currentHostSessionId: string;
    storeAvailable: boolean;
}): DcReplayRunListResult {
    const limit = Math.min(
        REPLAY_LAB_RUN_LIST_MAX_LIMIT,
        Math.max(1, input.params?.limit ?? REPLAY_LAB_RUN_LIST_DEFAULT_LIMIT),
    );
    const offset = parseCursor(input.params?.cursor);
    const page = input.entries.slice(offset, offset + limit);
    const result: DcReplayRunListResult = {
        rows: page.map((entry) => projectDurableReplayRunRow(entry, input.currentHostSessionId)),
        totalCount: input.entries.length,
        storeAvailable: input.storeAvailable,
        issueCount: input.issues.length,
    };
    if (offset + page.length < input.entries.length) {
        result.nextCursor = String(offset + page.length);
    }
    return result;
}

function parseCursor(cursor: string | undefined): number {
    if (cursor === undefined) {
        return 0;
    }
    const parsed = Number(cursor);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function clampReplayLabItemsLimit(limit: number | undefined): number {
    return Math.min(
        REPLAY_LAB_ITEMS_MAX_LIMIT,
        Math.max(1, limit ?? REPLAY_LAB_ITEMS_DEFAULT_LIMIT),
    );
}

// ---------------------------------------------------------------------------
// Item rows
// ---------------------------------------------------------------------------

/** Durable items.jsonl record → item row; labels resolved from the manifest. */
export function projectDurableReplayItemRow(
    record: ReplayRunItemRecordV1,
    manifest: ReplayRunManifestV1 | undefined,
): ReplayLabItemRowV1 {
    const source = manifest?.sources.find(
        (candidate) => candidate.captureEventId === record.sourceCaptureEventId,
    );
    const cell = record.matrixCellId
        ? manifest?.cells.find((candidate) => candidate.matrixCellId === record.matrixCellId)
        : undefined;
    return {
        replayItemId: record.replayItemId,
        sourceCaptureEventId: record.sourceCaptureEventId,
        ...(source ? { sourceLabel: source.label } : {}),
        ...(record.matrixCellId ? { matrixCellId: record.matrixCellId } : {}),
        ...(cell ? { cellLabel: cell.label } : {}),
        repetition: record.repetition,
        status: record.status,
        queuedAt: record.queuedAt,
        ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
        endedAt: record.endedAt,
        ...(record.startedAt !== undefined
            ? { durationMs: Math.max(0, record.endedAt - record.startedAt) }
            : {}),
        ...(record.resultEventId ? { resultEventId: record.resultEventId } : {}),
        ...(record.resultCaptureEventId
            ? { resultCaptureEventId: record.resultCaptureEventId }
            : {}),
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
        ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        ...(record.cancellationOutcome ? { cancellationOutcome: record.cancellationOutcome } : {}),
        ...(record.replayMode ? { replayMode: record.replayMode } : {}),
        ...(record.schemaContextSource ? { schemaContextSource: record.schemaContextSource } : {}),
        // WI-3.6: compact target identity (label + database + opaque salted
        // fingerprint) — ids/labels only, never a connection string.
        ...(record.target?.label ? { targetLabel: record.target.label } : {}),
        ...(record.target?.fingerprint ? { targetFingerprint: record.target.fingerprint } : {}),
        ...(record.targetDatabase ? { targetDatabase: record.targetDatabase } : {}),
        ...(record.configGroupId ? { configGroupId: record.configGroupId } : {}),
        configDigest: record.resolvedConfigDigest,
    };
}

/**
 * LIVE engine queue row (queued/running) → item row. Field-by-field on
 * purpose: the queue row carries the full placeholder event body, which must
 * never ride this projection.
 */
export function projectLiveReplayItemRow(
    row: InlineCompletionDebugReplayQueueRow,
): ReplayLabItemRowV1 {
    return {
        replayItemId: row.id,
        sourceCaptureEventId: row.event.link?.captureEventId ?? row.sourceEventId,
        ...(row.matrixCellId ? { matrixCellId: row.matrixCellId } : {}),
        ...(row.matrixCellLabel ? { cellLabel: row.matrixCellLabel } : {}),
        repetition: row.repetition ?? 1,
        status: row.status,
        queuedAt: row.queuedAt,
        ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
        ...(row.config.replayMode ? { replayMode: row.config.replayMode } : {}),
        ...(row.configDigest ? { configDigest: row.configDigest } : {}),
    };
}
