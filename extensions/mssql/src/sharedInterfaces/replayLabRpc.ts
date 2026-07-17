/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay Lab RPC contract (final plan WI-3.5, addendum §6.2/§6.4): the thin,
 * paged surface the Debug Console Replay Lab page reads runs through —
 * `dc/replayRunList` (durable manifest rows, newest-first, this host session
 * first) and `dc/replayRunDetail` (manifest + paged items + sanitized config
 * groups). Everything here is JSON-serializable and webview-safe.
 *
 * PRIVACY (tested): no prompt bodies, responses, schema text, document paths,
 * or custom system prompts ever ride these responses. Rows carry ids, labels,
 * counts, digests, and timestamps only; config groups are sanitized through
 * an allowlist before leaving the host (custom prompts collapse to a
 * `customSystemPromptUsed` flag).
 *
 * The list returns DURABLE rows only; the page merges them with the live
 * engine runs it already holds via the completions debug provider (the pure
 * merge lives here so it is unit-testable): live state wins for runs the
 * current console is executing, and an active durable run is never listed
 * twice.
 */

import { RequestType } from "vscode-jsonrpc";
import { FeatureReplayRunStatus } from "./featureReplay";
import { InlineCompletionDebugReplayRun } from "./inlineCompletionDebug";
import { ReplayEstimate, ReplaySideEffectClass } from "./replaySafety";

export const REPLAY_LAB_RUN_LIST_DEFAULT_LIMIT = 50;
export const REPLAY_LAB_RUN_LIST_MAX_LIMIT = 200;
export const REPLAY_LAB_ITEMS_DEFAULT_LIMIT = 100;
export const REPLAY_LAB_ITEMS_MAX_LIMIT = 500;

// ---------------------------------------------------------------------------
// Run rows
// ---------------------------------------------------------------------------

/** One Replay Lab runs-table row — metadata only, never payload content. */
export interface ReplayLabRunRowV1 {
    replayRunId: string;
    /** Owning host session directory; absent only for live-only rows. */
    hostSessionId?: string;
    currentHostSession: boolean;
    featureId: string;
    /** "interactiveExperiment" — the Lab renders the semantics label from this. */
    semantics: string;
    status: FeatureReplayRunStatus;
    kind: "single" | "matrix";
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    sourceCount: number;
    cellCount: number;
    repetitions: number;
    expectedItems: number;
    completedItems: number;
    failedItems: number;
    cancelledItems: number;
    blockedItems: number;
    estimate?: ReplayEstimate;
    /** Post-run actual executions where recorded (estimate vs actual). */
    actualExecutions?: number;
    safetySideEffectClass?: ReplaySideEffectClass;
    /** Honest reason for failed/partial runs, where known (live rows). */
    errorMessage?: string;
    /** True when a manifest exists on disk for this run. */
    durable: boolean;
    /** True when THIS console's engine holds the run (progress is live). */
    live: boolean;
    /** Live matrix runs: the currently executing cell's label. */
    activeCellLabel?: string;
    cancelRequestedAt?: number;
}

export interface DcReplayRunListParams {
    /** Opaque cursor from a previous page (offset into the sorted set). */
    cursor?: string;
    limit?: number;
}

export interface DcReplayRunListResult {
    /** Durable rows: current host session first, then newest-first. */
    rows: ReplayLabRunRowV1[];
    nextCursor?: string;
    /** Total durable runs discovered by the catalog scan. */
    totalCount: number;
    /** False when the durable store is unavailable (rows may be live-only). */
    storeAvailable: boolean;
    /** Manifest files that could not be read/parsed (honest gap count). */
    issueCount: number;
}

export namespace DcReplayRunListRequest {
    export const type = new RequestType<DcReplayRunListParams, DcReplayRunListResult, void>(
        "dc/replayRunList",
    );
}

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

export type ReplayLabItemStatus =
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked"
    | "queued"
    | "running";

/** One per-item detail row — ids/labels only, never event content. */
export interface ReplayLabItemRowV1 {
    replayItemId: string;
    sourceCaptureEventId: string;
    /** Source label from the run manifest, when resolvable. */
    sourceLabel?: string;
    matrixCellId?: string;
    cellLabel?: string;
    repetition: number;
    status: ReplayLabItemStatus;
    queuedAt: number;
    startedAt?: number;
    endedAt?: number;
    /** Execution duration (started→ended) where both are known. */
    durationMs?: number;
    /** Ring-local id of the result event (deep link into Completions Live). */
    resultEventId?: string;
    resultCaptureEventId?: string;
    errorCode?: string;
    errorMessage?: string;
    cancellationOutcome?: string;
    replayMode?: string;
    schemaContextSource?: string;
    configGroupId?: string;
    configDigest?: string;
}

/** Sanitized config-group projection (allowlisted keys, no prompt bodies). */
export interface ReplayLabConfigGroupV1 {
    configGroupId: string;
    label: string;
    version: number;
    baseProfileId?: string;
    baseProfileVersion?: number;
    effectiveConfigDigest: string;
    replayMode?: string;
    /** Allowlisted partial overrides; content-bearing values never appear. */
    overridesSummary: Record<string, unknown>;
    customSystemPromptUsed: boolean;
}

export interface DcReplayRunDetailParams {
    replayRunId: string;
    /** Defaults to the current host session. */
    hostSessionId?: string;
    itemsOffset?: number;
    itemsLimit?: number;
}

export interface DcReplayRunDetailResult {
    found: boolean;
    row?: ReplayLabRunRowV1;
    sources?: Array<{ captureEventId: string; label: string }>;
    configGroups?: ReplayLabConfigGroupV1[];
    /** Settled items from items.jsonl plus live queued/running rows. */
    items: ReplayLabItemRowV1[];
    itemsTotal: number;
    itemsOffset: number;
}

export namespace DcReplayRunDetailRequest {
    export const type = new RequestType<DcReplayRunDetailParams, DcReplayRunDetailResult, void>(
        "dc/replayRunDetail",
    );
}

// ---------------------------------------------------------------------------
// Pure projections + merge (webview-side; unit-tested)
// ---------------------------------------------------------------------------

/** Project one LIVE engine run (provider store state) to a Lab row. */
export function projectLiveReplayRunRow(
    run: InlineCompletionDebugReplayRun,
    options: { featureId?: string; semantics?: string } = {},
): ReplayLabRunRowV1 {
    const cellCount = run.matrixCells?.length ?? 0;
    const sourceCount =
        run.totalEvents > 0 ? Math.max(1, Math.round(run.totalEvents / Math.max(cellCount, 1))) : 0;
    const activeCell = run.matrixCells?.find((cell) => cell.cellId === run.activeMatrixCellId);
    return {
        replayRunId: run.id,
        currentHostSession: true,
        featureId: options.featureId ?? "completions",
        semantics: options.semantics ?? "interactiveExperiment",
        status: run.status,
        kind: run.kind,
        createdAt: run.startedAt,
        startedAt: run.startedAt,
        ...(run.completedAt !== undefined ? { endedAt: run.completedAt } : {}),
        sourceCount,
        cellCount,
        repetitions: 1,
        expectedItems: run.totalEvents,
        completedItems: Math.max(0, run.completedEvents - (run.blockedEvents ?? 0)),
        failedItems: 0,
        cancelledItems: 0,
        blockedItems: run.blockedEvents ?? 0,
        ...(run.estimate ? { estimate: run.estimate } : {}),
        ...(run.safety ? { safetySideEffectClass: run.safety.sideEffectClass } : {}),
        ...(run.errorMessage !== undefined ? { errorMessage: run.errorMessage } : {}),
        durable: run.durable === true,
        live: true,
        ...(activeCell
            ? { activeCellLabel: `${activeCell.profileLabel} x ${activeCell.schemaLabel}` }
            : {}),
        ...(run.cancelRequestedAt !== undefined
            ? { cancelRequestedAt: run.cancelRequestedAt }
            : {}),
    };
}

/**
 * Merge live engine rows over durable catalog rows: a run present in both is
 * shown ONCE with the live row's real-time state (progress, cancelling) and
 * the durable row's item breakdown + durability. Live-only rows come first
 * (they are this session's active work), then the durable rows in catalog
 * order.
 */
export function mergeReplayLabRunRows(
    liveRows: ReplayLabRunRowV1[],
    durableRows: ReplayLabRunRowV1[],
): ReplayLabRunRowV1[] {
    const durableById = new Map(durableRows.map((row) => [row.replayRunId, row]));
    const merged: ReplayLabRunRowV1[] = [];
    const liveIds = new Set<string>();
    for (const liveRow of liveRows) {
        liveIds.add(liveRow.replayRunId);
        const durable = durableById.get(liveRow.replayRunId);
        merged.push(
            durable
                ? {
                      ...durable,
                      ...liveRow,
                      // The durable manifest has the per-status item split the
                      // engine state does not retain.
                      completedItems: durable.completedItems,
                      failedItems: durable.failedItems,
                      cancelledItems: durable.cancelledItems,
                      blockedItems: durable.blockedItems,
                      durable: true,
                  }
                : liveRow,
        );
    }
    for (const durableRow of durableRows) {
        if (!liveIds.has(durableRow.replayRunId)) {
            merged.push(durableRow);
        }
    }
    return merged;
}
