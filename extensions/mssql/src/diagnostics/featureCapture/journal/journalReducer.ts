/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure lifecycle reducer over feature-capture journal records (final plan
 * WI-2.1 / addendum §3.5). Applies records in recordSeq order into a read
 * model keyed by captureEventId, enforcing the lifecycle invariants:
 *
 * - created appears once (identical duplicate = silent idempotent no-op;
 *   a DIFFERING duplicate keeps the original and notes an issue);
 * - revisions strictly increase (stale revision = idempotent skip + info);
 * - finalized/acceptance/annotation can never alter immutable identity
 *   (captureEventId, captureSessionId, hostSessionId, featureId, link) —
 *   violations reject the record;
 * - acceptance applies only to a finalized event. DECISION: an early
 *   acceptance is HELD (visible in state.pendingAcceptances) and applied
 *   when the finalization arrives — acceptance is user evidence and the
 *   "don't lose anything" invariant outranks arrival-order purity. The
 *   hold is surfaced as an issue either way;
 * - redacted streams never regain fuller content: when the header policy
 *   is contentRedacted/digestOnly, any record whose value carries plain
 *   text under a content-bearing key is rejected;
 * - unknown future record kinds/schemas are tolerated and counted
 *   (forward compatibility); out-of-order or gapped recordSeq is surfaced.
 *
 * Deterministic: no clock, no I/O, no randomness — state is a function of
 * the record sequence alone. projectEvents() iterates events in creation
 * (first-record-arrival) order so projections are reproducible.
 */

import {
    FEATURE_CAPTURE_RECORD_SCHEMA,
    FeatureCaptureAcceptanceChangedRecordV1,
    FeatureCaptureAnnotationAddedRecordV1,
    FeatureCaptureEventCreatedRecordV1,
    FeatureCaptureEventFinalizedRecordV1,
    FeatureCaptureJournalRecordV1,
    FeatureCaptureStreamHeaderRecordV1,
    JournalValidationIssue,
    KNOWN_JOURNAL_RECORD_KINDS,
} from "./journalSchemas";

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface JournalEventReadModel<TCreated, TFinal, TAcceptance, TAnnotation> {
    captureEventId: string;
    /** Highest applied revision (created = 1). */
    eventRevision: number;
    /**
     * Missing when the created record was lost (e.g. dropped in a queue
     * overflow) and the event was materialized from a later record — the
     * gap is honest, surfaced as an "event.missingCreated" issue.
     */
    createdValue?: TCreated;
    createdAt?: number;
    finalizedValue?: TFinal;
    finalizedAt?: number;
    acceptance?: TAcceptance;
    acceptanceAt?: number;
    annotations: Array<{ at: number; eventRevision: number; value: TAnnotation }>;
    firstRecordSeq: number;
    lastRecordSeq: number;
}

export interface JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation> {
    header?: FeatureCaptureStreamHeaderRecordV1;
    events: Map<string, JournalEventReadModel<TCreated, TFinal, TAcceptance, TAnnotation>>;
    /** captureEventIds in first-record-arrival order — the projection order. */
    order: string[];
    /** Acceptances held until their event finalizes (latest recordSeq wins). */
    pendingAcceptances: Map<
        string,
        { record: FeatureCaptureAcceptanceChangedRecordV1<TAcceptance> }
    >;
    issues: JournalValidationIssue[];
    recordsApplied: number;
    recordsRejected: number;
    unknownKindCount: number;
    unknownSchemaCount: number;
    lastRecordSeq: number;
}

export interface JournalReducerOptions {
    /**
     * Keys whose values count as feature content for the redaction-
     * resurrection check. Features with their own vocabulary override this;
     * the default covers the completions serializer's sensitive keys plus
     * common content spellings.
     */
    contentKeys?: ReadonlySet<string>;
    /** Replacement token content was redacted to; "[REDACTED]" by default. */
    redactionReplacement?: string;
    /**
     * recordSeq ranges known to be missing (the manifest's droppedRanges).
     * Gaps fully covered by an expected range are accounted-for evidence,
     * not new issues.
     */
    expectedGaps?: ReadonlyArray<{ fromRecordSeq: number; throughRecordSeq: number }>;
}

export const DEFAULT_CONTENT_BEARING_KEYS: ReadonlySet<string> = new Set([
    "userPrompt",
    "systemPrompt",
    "customSystemPrompt",
    "promptMessages",
    "rawResponse",
    "sanitizedResponse",
    "finalCompletionText",
    "content",
    "text",
    "sqlText",
    "documentText",
    "schemaContextText",
    "locals",
]);

const DEFAULT_REDACTION_REPLACEMENT = "[REDACTED]";

export function createJournalReducerState<
    TCreated,
    TFinal,
    TAcceptance,
    TAnnotation,
>(): JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation> {
    return {
        header: undefined,
        events: new Map(),
        order: [],
        pendingAcceptances: new Map(),
        issues: [],
        recordsApplied: 0,
        recordsRejected: 0,
        unknownKindCount: 0,
        unknownSchemaCount: 0,
        lastRecordSeq: -1,
    };
}

/** Convenience: reduce a full record sequence into a fresh state. */
export function reduceJournalRecords<TCreated, TFinal, TAcceptance, TAnnotation>(
    records: ReadonlyArray<
        FeatureCaptureJournalRecordV1<TCreated, TFinal, TAcceptance, TAnnotation>
    >,
    options: JournalReducerOptions = {},
): JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation> {
    const state = createJournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>();
    for (const record of records) {
        applyJournalRecord(state, record, options);
    }
    return state;
}

/**
 * Apply one record. Returns true when the record changed state; rejections
 * and idempotent skips return false with the reason in state.issues.
 * Never throws — malformed input becomes a validation issue.
 */
export function applyJournalRecord<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: FeatureCaptureJournalRecordV1<TCreated, TFinal, TAcceptance, TAnnotation>,
    options: JournalReducerOptions = {},
): boolean {
    if (typeof record !== "object" || record === null || typeof record.recordSeq !== "number") {
        addIssue(state, "error", "record.malformed", undefined, "Record is not a journal record.");
        state.recordsRejected++;
        return false;
    }

    // Unknown schema majors are a different product generation: tolerate and
    // count, never guess at semantics (forward compatibility).
    if (record.schema !== FEATURE_CAPTURE_RECORD_SCHEMA) {
        state.unknownSchemaCount++;
        if (state.unknownSchemaCount === 1) {
            addIssue(
                state,
                "info",
                "record.unknownSchema",
                record.recordSeq,
                `Records with unknown schema "${String(record.schema)}" were tolerated and counted, not applied.`,
            );
        }
        noteSeq(state, record.recordSeq, options);
        return false;
    }

    if (!KNOWN_JOURNAL_RECORD_KINDS.has(record.kind)) {
        state.unknownKindCount++;
        addIssue(
            state,
            "info",
            "record.unknownKind",
            record.recordSeq,
            `Unknown record kind "${String(record.kind)}" tolerated (forward compatibility).`,
        );
        noteSeq(state, record.recordSeq, options);
        return false;
    }

    noteSeq(state, record.recordSeq, options);

    switch (record.kind) {
        case "stream.header":
            return applyHeader(state, record);
        case "event.created":
            return applyCreated(state, record, options);
        case "event.finalized":
            return applyFinalized(state, record, options);
        case "acceptance.changed":
            return applyAcceptance(state, record, options);
        case "annotation.added":
            return applyAnnotation(state, record, options);
    }
}

/**
 * Deterministic projection hook: map the read model into a feature's event
 * shape (for completions this later produces InlineCompletionDebugEvent[]).
 * Events are visited in creation order; a projector returning undefined
 * skips the event.
 */
export function projectEvents<TProjected, TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    projector: (
        event: JournalEventReadModel<TCreated, TFinal, TAcceptance, TAnnotation>,
        index: number,
    ) => TProjected | undefined,
): TProjected[] {
    const projected: TProjected[] = [];
    for (const captureEventId of state.order) {
        const event = state.events.get(captureEventId);
        if (!event) {
            continue;
        }
        const result = projector(event, projected.length);
        if (result !== undefined) {
            projected.push(result);
        }
    }
    return projected;
}

// ---------------------------------------------------------------------------
// Per-kind application
// ---------------------------------------------------------------------------

function applyHeader<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: FeatureCaptureStreamHeaderRecordV1,
): boolean {
    if (state.header) {
        if (deepEqual(state.header, record)) {
            // Idempotent duplicate — e.g. a re-fed batch; no issue.
            return false;
        }
        addIssue(
            state,
            "error",
            "header.duplicate",
            record.recordSeq,
            "A second, differing stream.header was rejected — stream identity is frozen at recordSeq 0.",
        );
        state.recordsRejected++;
        return false;
    }
    if (record.recordSeq !== 0 || state.recordsApplied > 0) {
        addIssue(
            state,
            "warning",
            "header.notFirst",
            record.recordSeq,
            "stream.header was not the first record (recordSeq 0); applied anyway.",
        );
    }
    state.header = record;
    state.recordsApplied++;
    return true;
}

function applyCreated<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: FeatureCaptureEventCreatedRecordV1<TCreated>,
    options: JournalReducerOptions,
): boolean {
    if (!requireEventFields(state, record)) {
        return false;
    }
    if (violatesRedaction(state, record.recordSeq, record.value, options)) {
        return false;
    }
    if (violatesIdentity(state, record.recordSeq, record.captureEventId, record.value)) {
        return false;
    }

    const existing = state.events.get(record.captureEventId);
    if (existing) {
        if (existing.createdValue !== undefined) {
            // Duplicate created: idempotent no-op; an issue ONLY when the
            // payload differs (the original is kept either way).
            if (!deepEqual(existing.createdValue, record.value)) {
                addIssue(
                    state,
                    "warning",
                    "event.duplicateCreated",
                    record.recordSeq,
                    `Duplicate event.created for ${record.captureEventId} with a DIFFERENT payload was rejected; the original is kept.`,
                );
                state.recordsRejected++;
            }
            return false;
        }
        // The event was materialized from a later record because its created
        // was lost — backfill the created value without regressing revision.
        existing.createdValue = record.value;
        existing.createdAt = record.at;
        existing.lastRecordSeq = Math.max(existing.lastRecordSeq, record.recordSeq);
        state.recordsApplied++;
        return true;
    }

    state.events.set(record.captureEventId, {
        captureEventId: record.captureEventId,
        eventRevision: 1,
        createdValue: record.value,
        createdAt: record.at,
        annotations: [],
        firstRecordSeq: record.recordSeq,
        lastRecordSeq: record.recordSeq,
    });
    state.order.push(record.captureEventId);
    state.recordsApplied++;
    return true;
}

function applyFinalized<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: FeatureCaptureEventFinalizedRecordV1<TFinal>,
    options: JournalReducerOptions,
): boolean {
    if (!requireEventFields(state, record)) {
        return false;
    }
    if (violatesRedaction(state, record.recordSeq, record.value, options)) {
        return false;
    }
    if (violatesIdentity(state, record.recordSeq, record.captureEventId, record.value)) {
        return false;
    }

    const event = getOrMaterializeEvent(state, record.captureEventId, record.recordSeq);

    // Immutable identity: the finalized value may not contradict the created
    // value's identity fields (captureEventId, captureSessionId, link block).
    if (event.createdValue !== undefined && identityConflicts(event.createdValue, record.value)) {
        addIssue(
            state,
            "error",
            "event.identityMutation",
            record.recordSeq,
            `event.finalized for ${record.captureEventId} attempted to alter immutable identity fields; record rejected.`,
        );
        state.recordsRejected++;
        return false;
    }

    if (record.eventRevision <= event.eventRevision) {
        addIssue(
            state,
            "info",
            "event.staleRevision",
            record.recordSeq,
            `Stale event.finalized revision ${record.eventRevision} for ${record.captureEventId} (already at ${event.eventRevision}); idempotent skip.`,
        );
        return false;
    }

    event.finalizedValue = record.value;
    event.finalizedAt = record.at;
    event.eventRevision = record.eventRevision;
    event.lastRecordSeq = Math.max(event.lastRecordSeq, record.recordSeq);
    state.recordsApplied++;

    // A held acceptance becomes applicable the moment the event finalizes.
    const held = state.pendingAcceptances.get(record.captureEventId);
    if (held) {
        state.pendingAcceptances.delete(record.captureEventId);
        event.acceptance = held.record.value;
        event.acceptanceAt = held.record.at;
        event.eventRevision = Math.max(event.eventRevision, held.record.eventRevision);
        event.lastRecordSeq = Math.max(event.lastRecordSeq, held.record.recordSeq);
    }
    return true;
}

function applyAcceptance<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: FeatureCaptureAcceptanceChangedRecordV1<TAcceptance>,
    options: JournalReducerOptions,
): boolean {
    if (!requireEventFields(state, record)) {
        return false;
    }
    if (violatesRedaction(state, record.recordSeq, record.value, options)) {
        return false;
    }

    const event = state.events.get(record.captureEventId);
    if (!event || event.finalizedValue === undefined) {
        // DECISION: held, not rejected — acceptance is user evidence and the
        // finalization may legitimately land later (write races) or have been
        // dropped. Latest-arriving held acceptance wins.
        addIssue(
            state,
            "warning",
            "acceptance.beforeFinalized",
            record.recordSeq,
            `acceptance.changed for ${record.captureEventId} arrived before event.finalized; held until finalization.`,
        );
        state.pendingAcceptances.set(record.captureEventId, { record });
        return false;
    }

    if (record.eventRevision <= event.eventRevision) {
        addIssue(
            state,
            "info",
            "event.staleRevision",
            record.recordSeq,
            `Stale acceptance.changed revision ${record.eventRevision} for ${record.captureEventId} (already at ${event.eventRevision}); idempotent skip.`,
        );
        return false;
    }

    event.acceptance = record.value;
    event.acceptanceAt = record.at;
    event.eventRevision = record.eventRevision;
    event.lastRecordSeq = Math.max(event.lastRecordSeq, record.recordSeq);
    state.recordsApplied++;
    return true;
}

function applyAnnotation<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: FeatureCaptureAnnotationAddedRecordV1<TAnnotation>,
    options: JournalReducerOptions,
): boolean {
    if (!requireEventFields(state, record)) {
        return false;
    }
    if (violatesRedaction(state, record.recordSeq, record.value, options)) {
        return false;
    }

    const event = getOrMaterializeEvent(state, record.captureEventId, record.recordSeq);
    if (record.eventRevision <= event.eventRevision) {
        addIssue(
            state,
            "info",
            "event.staleRevision",
            record.recordSeq,
            `Stale annotation.added revision ${record.eventRevision} for ${record.captureEventId} (already at ${event.eventRevision}); idempotent skip.`,
        );
        return false;
    }

    event.annotations.push({
        at: record.at,
        eventRevision: record.eventRevision,
        value: record.value,
    });
    event.eventRevision = record.eventRevision;
    event.lastRecordSeq = Math.max(event.lastRecordSeq, record.recordSeq);
    state.recordsApplied++;
    return true;
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

function addIssue<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    severity: JournalValidationIssue["severity"],
    code: JournalValidationIssue["code"],
    recordSeq: number | undefined,
    message: string,
): void {
    state.issues.push(
        recordSeq === undefined
            ? { severity, code, message }
            : { severity, code, recordSeq, message },
    );
}

/** Sequence bookkeeping: strict monotonic increase, gaps vs expected drops. */
function noteSeq<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    recordSeq: number,
    options: JournalReducerOptions,
): void {
    if (recordSeq === state.lastRecordSeq) {
        // Same-seq redelivery: the lifecycle rules decide idempotently —
        // identical duplicates stay silent, conflicts get their own issues.
        return;
    }
    if (recordSeq < state.lastRecordSeq) {
        addIssue(
            state,
            "warning",
            "record.outOfOrder",
            recordSeq,
            `recordSeq ${recordSeq} arrived after ${state.lastRecordSeq}; lifecycle rules still apply idempotently.`,
        );
        return;
    }
    if (recordSeq > state.lastRecordSeq + 1 && state.lastRecordSeq >= 0) {
        const gapFrom = state.lastRecordSeq + 1;
        const gapThrough = recordSeq - 1;
        if (!isGapExpected(gapFrom, gapThrough, options.expectedGaps)) {
            addIssue(
                state,
                "info",
                "record.seqGap",
                recordSeq,
                `recordSeq gap ${gapFrom}..${gapThrough} is not covered by the manifest's dropped ranges.`,
            );
        }
    }
    state.lastRecordSeq = recordSeq;
}

function isGapExpected(
    fromSeq: number,
    throughSeq: number,
    expectedGaps: JournalReducerOptions["expectedGaps"],
): boolean {
    if (!expectedGaps) {
        return false;
    }
    // Every seq in the gap must fall inside some expected range.
    for (let seq = fromSeq; seq <= throughSeq; seq++) {
        const covered = expectedGaps.some(
            (range) => seq >= range.fromRecordSeq && seq <= range.throughRecordSeq,
        );
        if (!covered) {
            return false;
        }
    }
    return true;
}

function requireEventFields<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    record: { recordSeq: number; captureEventId?: unknown; eventRevision?: unknown },
): boolean {
    if (!state.header) {
        // Emitted once: everything after still applies (honest partial).
        if (!state.issues.some((issue) => issue.code === "header.missing")) {
            addIssue(
                state,
                "warning",
                "header.missing",
                record.recordSeq,
                "Event records arrived before any stream.header; stream identity and capture policy are unknown.",
            );
        }
    }
    if (
        typeof record.captureEventId !== "string" ||
        record.captureEventId.length === 0 ||
        typeof record.eventRevision !== "number"
    ) {
        addIssue(
            state,
            "error",
            "record.malformed",
            record.recordSeq,
            "Event record is missing captureEventId or eventRevision; rejected.",
        );
        state.recordsRejected++;
        return false;
    }
    return true;
}

function getOrMaterializeEvent<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    captureEventId: string,
    recordSeq: number,
): JournalEventReadModel<TCreated, TFinal, TAcceptance, TAnnotation> {
    const existing = state.events.get(captureEventId);
    if (existing) {
        return existing;
    }
    // The created record was lost (dropped range, torn segment). DECISION:
    // materialize a placeholder rather than discard later evidence — the
    // missing created is a visible issue and createdValue stays undefined.
    addIssue(
        state,
        "warning",
        "event.missingCreated",
        recordSeq,
        `Record for ${captureEventId} arrived without a prior event.created; materialized with a missing created value.`,
    );
    const placeholder: JournalEventReadModel<TCreated, TFinal, TAcceptance, TAnnotation> = {
        captureEventId,
        eventRevision: 0,
        annotations: [],
        firstRecordSeq: recordSeq,
        lastRecordSeq: recordSeq,
    };
    state.events.set(captureEventId, placeholder);
    state.order.push(captureEventId);
    return placeholder;
}

/**
 * Redaction resurrection (addendum §9.2): when the header froze a redacted
 * policy, no later record may carry plain content under a content-bearing
 * key. Violating records are rejected wholesale.
 */
function violatesRedaction<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    recordSeq: number,
    value: unknown,
    options: JournalReducerOptions,
): boolean {
    const fidelity = state.header?.capturePolicy?.fidelity;
    if (fidelity !== "contentRedacted" && fidelity !== "digestOnly") {
        return false;
    }
    const contentKeys = options.contentKeys ?? DEFAULT_CONTENT_BEARING_KEYS;
    const replacement = options.redactionReplacement ?? DEFAULT_REDACTION_REPLACEMENT;
    if (!containsPlainContent(value, contentKeys, replacement, undefined)) {
        return false;
    }
    addIssue(
        state,
        "error",
        "redaction.resurrection",
        recordSeq,
        `Record carries plain content under a content-bearing key while the stream policy is "${fidelity}"; record rejected.`,
    );
    state.recordsRejected++;
    return true;
}

/**
 * True when any string nested under a content-bearing key is non-empty and
 * not the redaction token. Digests and metadata must live OUTSIDE content
 * keys under redacted policies — that is the writer-side contract.
 */
function containsPlainContent(
    value: unknown,
    contentKeys: ReadonlySet<string>,
    replacement: string,
    parentIsContent: boolean | undefined,
): boolean {
    if (typeof value === "string") {
        return parentIsContent === true && value.length > 0 && value !== replacement;
    }
    if (Array.isArray(value)) {
        return value.some((item) =>
            containsPlainContent(item, contentKeys, replacement, parentIsContent),
        );
    }
    if (typeof value !== "object" || value === null) {
        return false;
    }
    for (const [key, entry] of Object.entries(value)) {
        const isContent = parentIsContent === true || contentKeys.has(key);
        if (containsPlainContent(entry, contentKeys, replacement, isContent)) {
            return true;
        }
    }
    return false;
}

interface ExtractedIdentity {
    captureEventId?: string;
    captureSessionId?: string;
    hostSessionId?: string;
    featureId?: string;
}

/** Pull the identity fields a value may carry (top level and link block). */
function extractIdentity(value: unknown): ExtractedIdentity {
    if (typeof value !== "object" || value === null) {
        return {};
    }
    const record = value as Record<string, unknown>;
    const link =
        typeof record.link === "object" && record.link !== null
            ? (record.link as Record<string, unknown>)
            : undefined;
    const pick = (field: string): string | undefined => {
        const fromLink = link?.[field];
        if (typeof fromLink === "string") {
            return fromLink;
        }
        const direct = record[field];
        return typeof direct === "string" ? direct : undefined;
    };
    return {
        captureEventId: pick("captureEventId"),
        captureSessionId: pick("captureSessionId"),
        hostSessionId: pick("hostSessionId"),
        featureId: pick("featureId"),
    };
}

/**
 * A record's value may not contradict the record's own captureEventId or the
 * stream identity frozen in the header.
 */
function violatesIdentity<TCreated, TFinal, TAcceptance, TAnnotation>(
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>,
    recordSeq: number,
    captureEventId: string,
    value: unknown,
): boolean {
    const identity = extractIdentity(value);
    const conflicts: string[] = [];
    if (identity.captureEventId !== undefined && identity.captureEventId !== captureEventId) {
        conflicts.push(`captureEventId "${identity.captureEventId}" != "${captureEventId}"`);
    }
    if (state.header) {
        if (
            identity.captureSessionId !== undefined &&
            identity.captureSessionId !== state.header.captureSessionId
        ) {
            conflicts.push(`captureSessionId "${identity.captureSessionId}" is foreign`);
        }
        if (
            identity.hostSessionId !== undefined &&
            identity.hostSessionId !== state.header.hostSessionId
        ) {
            conflicts.push(`hostSessionId "${identity.hostSessionId}" is foreign`);
        }
        if (identity.featureId !== undefined && identity.featureId !== state.header.featureId) {
            conflicts.push(`featureId "${identity.featureId}" is foreign`);
        }
    }
    if (conflicts.length === 0) {
        return false;
    }
    addIssue(
        state,
        "error",
        "event.identityMutation",
        recordSeq,
        `Record value contradicts immutable identity (${conflicts.join("; ")}); record rejected.`,
    );
    state.recordsRejected++;
    return true;
}

/** Created-vs-finalized identity comparison: fields present in BOTH must match. */
function identityConflicts(createdValue: unknown, finalValue: unknown): boolean {
    const created = extractIdentity(createdValue);
    const finalized = extractIdentity(finalValue);
    for (const field of [
        "captureEventId",
        "captureSessionId",
        "hostSessionId",
        "featureId",
    ] as const) {
        if (
            created[field] !== undefined &&
            finalized[field] !== undefined &&
            created[field] !== finalized[field]
        ) {
            return true;
        }
    }
    return false;
}

/** Structural deep equality over JSON-shaped values (key order agnostic). */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
    }
    if (
        typeof a !== "object" ||
        typeof b !== "object" ||
        a === null ||
        b === null ||
        Array.isArray(a) ||
        Array.isArray(b)
    ) {
        return false;
    }
    const aEntries = Object.entries(a).filter(([, value]) => value !== undefined);
    const bEntries = Object.entries(b).filter(([, value]) => value !== undefined);
    if (aEntries.length !== bEntries.length) {
        return false;
    }
    return aEntries.every(([key, value]) => deepEqual(value, (b as Record<string, unknown>)[key]));
}
