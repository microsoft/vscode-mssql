/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ring-vs-journal reconciliation (final plan WI-2.6, addendum §10.3 —
 * normative field list). During the M2 dark-journal stage the live ring and
 * the journal are written independently; this module compares them per
 * capture session and produces the report that gates the M4 cutover:
 *
 * - created / terminal / unique-id / pending-at-shutdown / accepted /
 *   replay-tagged counts;
 * - redaction mode (journal stream header vs the expected policy);
 * - first and last timestamps (computed over the ids BOTH sides hold, so a
 *   bounded ring doesn't skew the comparison);
 * - per-event digest after the feature's compatibility projection — sha256
 *   over canonical (key-sorted) JSON of the adapter's normalized subset.
 *   Content fields (prompts, responses, schema text, locals) are excluded
 *   by the completions adapter so full and redacted streams reconcile
 *   identically; content fidelity is proven by privacy canaries instead;
 * - dropped/truncated ranges (journal manifest droppedRanges; any journal
 *   drop is a mismatch — ring evictions are the ring being a bounded cache
 *   and are TOLERATED: journal-only events up to the epoch's eviction count
 *   do not fail the match).
 *
 * Ring events without a link block have no durable identity, are never
 * journaled (WI-2.4), and are excluded here with an explicit count.
 */

import { createHash } from "crypto";
import { FeatureCaptureEventBase } from "./captureStore";
import {
    FeatureCaptureJournalReadResult,
    ReadFeatureCaptureJournalOptions,
    readFeatureCaptureJournal,
} from "./journal/journalReader";
import { JournalReducerState } from "./journal/journalReducer";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** Feature adapter: how to interpret events + project the journal. */
export interface CaptureReconciliationAdapter<TEvent extends FeatureCaptureEventBase> {
    /** True when the event reached a terminal (non-pending/queued) result. */
    isTerminal(event: TEvent): boolean;
    isAccepted(event: TEvent): boolean;
    isReplayTagged(event: TEvent): boolean;
    /**
     * Compatibility projection: journal read model → the feature's event
     * shape (completions: projectJournalToCompletionEvents).
     */
    projectJournal(
        state: JournalReducerState<unknown, unknown, unknown, Record<string, unknown>>,
    ): TEvent[];
    /**
     * Normalized digest subset for the per-event comparison. Canonicalized
     * (key-sorted) and sha256'd by the reconciler; the adapter documents
     * which fields participate.
     */
    digestFields(event: TEvent): Record<string, unknown>;
}

export interface CaptureReconciliationRow {
    field: string;
    ring: string | number;
    journal: string | number;
    match: boolean;
    note?: string;
}

export interface CaptureReconciliationReport {
    matches: boolean;
    comparedAtUtc: string;
    captureSessionId?: string;
    rows: CaptureReconciliationRow[];
    /** Human-readable description of every failed comparison. */
    mismatches: string[];
    /** Ring events excluded for having no durable link identity. */
    ringLinklessExcluded: number;
    /** Ring evictions this epoch (bounded-cache behavior, tolerated). */
    ringEvictedCount: number;
    /** Journal-side storage/lifecycle validation issues (count). */
    journalIssueCount: number;
    digest: {
        compared: number;
        mismatched: string[];
        ringOnly: string[];
        journalOnly: string[];
    };
    droppedRanges: Array<{ fromRecordSeq: number; throughRecordSeq: number; reason: string }>;
}

export interface ReconcileCaptureSessionOptions {
    /** Evictions from the live ring this epoch (FeatureCaptureStore.evictedEventCount). */
    ringEvictedCount?: number;
    /** The fidelity the binding believes it wrote with (redaction-mode row). */
    expectedFidelity?: "fullLocal" | "contentRedacted" | "digestOnly";
    /** Used when `journal` is a directory path. */
    read?: ReadFeatureCaptureJournalOptions;
    /** Clock for the report timestamp; Date.now by default. */
    now?: () => number;
}

type AnyReadResult = FeatureCaptureJournalReadResult<
    unknown,
    unknown,
    unknown,
    Record<string, unknown>
>;

// ---------------------------------------------------------------------------
// Reconciler
// ---------------------------------------------------------------------------

/**
 * Compare one capture session's ring events against its journal stream(s).
 * `journal` accepts a stream directory, one read result, or several read
 * results (the policy-phase streams of ONE epoch — later phases win when a
 * captureEventId appears in more than one). Never throws.
 */
export async function reconcileCaptureSession<TEvent extends FeatureCaptureEventBase>(
    ringEvents: readonly TEvent[],
    journal: string | AnyReadResult | readonly AnyReadResult[],
    adapter: CaptureReconciliationAdapter<TEvent>,
    options: ReconcileCaptureSessionOptions = {},
): Promise<CaptureReconciliationReport> {
    const readResults: AnyReadResult[] =
        typeof journal === "string"
            ? [await readFeatureCaptureJournal(journal, options.read ?? {})]
            : Array.isArray(journal)
              ? [...journal]
              : [journal as AnyReadResult];

    // Project each phase stream independently (recordSeq restarts per stream)
    // and merge by captureEventId — the later phase wins.
    const journalById = new Map<string, TEvent>();
    const journalCreatedIds = new Set<string>();
    let journalIssueCount = 0;
    const droppedRanges: CaptureReconciliationReport["droppedRanges"] = [];
    let headerFidelity: string | undefined;
    let captureSessionId: string | undefined;
    for (const result of readResults) {
        journalIssueCount += result.issues.filter((issue) => issue.severity !== "info").length;
        for (const range of result.manifest?.droppedRanges ?? []) {
            droppedRanges.push({ ...range });
        }
        if (result.state.header) {
            headerFidelity = result.state.header.capturePolicy?.fidelity;
            captureSessionId = result.state.header.captureSessionId;
        }
        for (const [captureEventId, model] of result.state.events) {
            if (model.createdValue !== undefined) {
                journalCreatedIds.add(captureEventId);
            }
        }
        for (const event of adapter.projectJournal(result.state)) {
            const id = event.link?.captureEventId;
            if (id) {
                journalById.set(id, event);
            }
        }
    }

    // Ring side: linked events only (linkless = no durable identity).
    const ringById = new Map<string, TEvent>();
    let ringLinklessExcluded = 0;
    for (const event of ringEvents) {
        const id = event.link?.captureEventId;
        if (!id) {
            ringLinklessExcluded++;
            continue;
        }
        ringById.set(id, event);
    }

    const ringEvictedCount = options.ringEvictedCount ?? 0;
    const ringIds = new Set(ringById.keys());
    const journalIds = new Set(journalById.keys());
    const ringOnly = [...ringIds].filter((id) => !journalIds.has(id));
    const journalOnly = [...journalIds].filter((id) => !ringIds.has(id));
    // Journal-only events up to the eviction count are the journal DOING ITS
    // JOB (outliving the bounded ring); anything beyond that is a mismatch.
    const journalOnlyExcess = Math.max(0, journalOnly.length - ringEvictedCount);

    const rows: CaptureReconciliationRow[] = [];
    const mismatches: string[] = [];
    const addRow = (
        field: string,
        ring: string | number,
        journalValue: string | number,
        match: boolean,
        note?: string,
    ): void => {
        rows.push({ field, ring, journal: journalValue, match, ...(note ? { note } : {}) });
        if (!match) {
            mismatches.push(
                `${field}: ring=${ring} journal=${journalValue}${note ? ` (${note})` : ""}`,
            );
        }
    };

    // Count comparisons tolerate a journal-side surplus explained by ring
    // evictions; a ring-side surplus is always a mismatch (the journal lost
    // records — visible via droppedRanges, still a cutover blocker).
    const countsMatch = (ring: number, journalCount: number): boolean =>
        journalCount >= ring && journalCount - ring <= ringEvictedCount && ringOnly.length === 0;

    const ringLinked = ringById.size;
    addRow(
        "createdCount",
        ringLinked,
        journalCreatedIds.size,
        countsMatch(ringLinked, journalCreatedIds.size),
        ringEvictedCount > 0 ? `${ringEvictedCount} ring eviction(s) tolerated` : undefined,
    );

    const ringTerminal = [...ringById.values()].filter((event) => adapter.isTerminal(event)).length;
    const journalTerminal = [...journalById.values()].filter((event) =>
        adapter.isTerminal(event),
    ).length;
    addRow(
        "terminalCount",
        ringTerminal,
        journalTerminal,
        countsMatch(ringTerminal, journalTerminal),
    );

    addRow(
        "uniqueCaptureEventIds",
        ringIds.size,
        journalIds.size,
        ringOnly.length === 0 && journalOnlyExcess === 0,
        ringOnly.length > 0
            ? `ring-only ids: ${ringOnly.slice(0, 5).join(", ")}${ringOnly.length > 5 ? ", …" : ""}`
            : journalOnlyExcess > 0
              ? `${journalOnlyExcess} journal-only id(s) beyond the eviction tolerance`
              : undefined,
    );

    const ringPending = ringLinked - ringTerminal;
    const journalPending = journalById.size - journalTerminal;
    addRow(
        "pendingAtShutdown",
        ringPending,
        journalPending,
        countsMatch(ringPending, journalPending) ||
            (ringPending === journalPending && ringOnly.length === 0),
    );

    const ringAccepted = [...ringById.values()].filter((event) => adapter.isAccepted(event)).length;
    const journalAccepted = [...journalById.values()].filter((event) =>
        adapter.isAccepted(event),
    ).length;
    addRow(
        "acceptedCount",
        ringAccepted,
        journalAccepted,
        countsMatch(ringAccepted, journalAccepted),
    );

    const ringReplay = [...ringById.values()].filter((event) =>
        adapter.isReplayTagged(event),
    ).length;
    const journalReplay = [...journalById.values()].filter((event) =>
        adapter.isReplayTagged(event),
    ).length;
    addRow("replayTaggedCount", ringReplay, journalReplay, countsMatch(ringReplay, journalReplay));

    addRow(
        "redactionMode",
        options.expectedFidelity ?? "(unspecified)",
        headerFidelity ?? "(missing header)",
        options.expectedFidelity === undefined ? true : headerFidelity === options.expectedFidelity,
        options.expectedFidelity === undefined ? "informational" : undefined,
    );

    // Timestamps over the intersection so the bounded ring does not skew.
    const sharedIds = [...ringIds].filter((id) => journalIds.has(id));
    const ringTimes = sharedIds.map((id) => ringById.get(id)!.timestamp);
    const journalTimes = sharedIds.map((id) => journalById.get(id)!.timestamp);
    const first = (times: number[]): number => (times.length > 0 ? Math.min(...times) : 0);
    const last = (times: number[]): number => (times.length > 0 ? Math.max(...times) : 0);
    addRow(
        "firstTimestamp",
        first(ringTimes),
        first(journalTimes),
        first(ringTimes) === first(journalTimes),
    );
    addRow(
        "lastTimestamp",
        last(ringTimes),
        last(journalTimes),
        last(ringTimes) === last(journalTimes),
    );

    // Per-event digest over ids terminal on BOTH sides (pending ring rows
    // carry stage churn the journal deliberately does not record).
    const digestMismatched: string[] = [];
    let digestCompared = 0;
    for (const id of sharedIds) {
        const ringEvent = ringById.get(id)!;
        const journalEvent = journalById.get(id)!;
        if (!adapter.isTerminal(ringEvent) || !adapter.isTerminal(journalEvent)) {
            continue;
        }
        digestCompared++;
        if (
            digestOfFields(adapter.digestFields(ringEvent)) !==
            digestOfFields(adapter.digestFields(journalEvent))
        ) {
            digestMismatched.push(id);
        }
    }
    addRow(
        "eventDigest",
        digestCompared,
        digestCompared - digestMismatched.length,
        digestMismatched.length === 0,
        digestMismatched.length > 0
            ? `mismatched: ${digestMismatched.slice(0, 5).join(", ")}${digestMismatched.length > 5 ? ", …" : ""}`
            : undefined,
    );

    const droppedRecords = droppedRanges.reduce(
        (sum, range) => sum + (range.throughRecordSeq - range.fromRecordSeq + 1),
        0,
    );
    addRow(
        "droppedRecords",
        0,
        droppedRecords,
        droppedRecords === 0,
        droppedRecords > 0 ? `${droppedRanges.length} exact dropped range(s)` : undefined,
    );

    const matches = mismatches.length === 0;
    return {
        matches,
        comparedAtUtc: new Date((options.now ?? Date.now)()).toISOString(),
        ...(captureSessionId ? { captureSessionId } : {}),
        rows,
        mismatches,
        ringLinklessExcluded,
        ringEvictedCount,
        journalIssueCount,
        digest: {
            compared: digestCompared,
            mismatched: digestMismatched,
            ringOnly,
            journalOnly,
        },
        droppedRanges,
    };
}

// ---------------------------------------------------------------------------
// Canonical digest
// ---------------------------------------------------------------------------

/** sha256 hex over canonical (recursively key-sorted) JSON. */
export function digestOfFields(fields: Record<string, unknown>): string {
    return createHash("sha256").update(canonicalJson(fields), "utf8").digest("hex");
}

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
}
