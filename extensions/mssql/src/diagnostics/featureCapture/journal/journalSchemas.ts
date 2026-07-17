/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rich feature-capture journal contracts (final plan WI-2.1 / addendum §3.5).
 *
 * The journal is a versioned append-only stream of TYPED lifecycle records —
 * never generic merge patches. Every record carries the frozen record schema
 * id and a monotonically increasing recordSeq; the stream opens with exactly
 * one header at recordSeq 0. A child manifest (owned exclusively by the
 * stream's writer — Amendment A) catalogs segments, exact dropped ranges,
 * totals, and the honest durability level (§3.7).
 *
 * Placement decision: these types live host-side in the journal module, NOT
 * in src/sharedInterfaces — the webview consumes thin projected rows (WI-2.5),
 * never raw journal records. The file is still kept webview-safe (pure JSON
 * types, no Node imports) so it can be re-exported unchanged if a UI ever
 * needs it.
 */

import { RichCapturePolicySnapshot } from "../../../sharedInterfaces/featureTrace";

/** Frozen schema ids (final plan §1.4). */
export const FEATURE_CAPTURE_STREAM_SCHEMA = "mssql.featureCapture.stream/1";
export const FEATURE_CAPTURE_RECORD_SCHEMA = "mssql.featureCapture.record/1";
export const FEATURE_CAPTURE_MANIFEST_SCHEMA = "mssql.featureCapture.manifest/1";

// ---------------------------------------------------------------------------
// Journal records
// ---------------------------------------------------------------------------

/**
 * Stream header — always recordSeq 0, always the first record. Freezes the
 * stream identity and the capture policy: the policy's fidelity is the
 * MAXIMUM content fidelity any later record may carry (no redaction
 * resurrection — addendum §9.2).
 */
export interface FeatureCaptureStreamHeaderRecordV1 {
    schema: typeof FEATURE_CAPTURE_RECORD_SCHEMA;
    kind: "stream.header";
    recordSeq: 0;
    featureId: string;
    hostSessionId: string;
    captureSessionId: string;
    /** Schema id of TCreated/TFinal event values, e.g. "mssql.inlineCompletionDebugEvent/1". */
    eventSchema: string;
    /** Schema id of the feature's overrides object. */
    overridesSchema: string;
    capturePolicy: RichCapturePolicySnapshot;
    createdUtc: string;
}

/** First record of a logical event; eventRevision is always 1. */
export interface FeatureCaptureEventCreatedRecordV1<TCreated> {
    schema: typeof FEATURE_CAPTURE_RECORD_SCHEMA;
    kind: "event.created";
    recordSeq: number;
    eventRevision: 1;
    captureEventId: string;
    at: number;
    value: TCreated;
}

/** Terminal-state record; revision strictly greater than every prior record. */
export interface FeatureCaptureEventFinalizedRecordV1<TFinal> {
    schema: typeof FEATURE_CAPTURE_RECORD_SCHEMA;
    kind: "event.finalized";
    recordSeq: number;
    eventRevision: number;
    captureEventId: string;
    at: number;
    value: TFinal;
}

/** Acceptance-state change; only valid against a finalized event. */
export interface FeatureCaptureAcceptanceChangedRecordV1<TAcceptance> {
    schema: typeof FEATURE_CAPTURE_RECORD_SCHEMA;
    kind: "acceptance.changed";
    recordSeq: number;
    eventRevision: number;
    captureEventId: string;
    at: number;
    value: TAcceptance;
}

/** Appended commentary (replay tags, ratings, notes); never mutates state. */
export interface FeatureCaptureAnnotationAddedRecordV1<TAnnotation> {
    schema: typeof FEATURE_CAPTURE_RECORD_SCHEMA;
    kind: "annotation.added";
    recordSeq: number;
    eventRevision: number;
    captureEventId: string;
    at: number;
    value: TAnnotation;
}

/** The versioned append-only record union (addendum §3.5, normative). */
export type FeatureCaptureJournalRecordV1<
    TCreated,
    TFinal,
    TAcceptance,
    TAnnotation = Record<string, unknown>,
> =
    | FeatureCaptureStreamHeaderRecordV1
    | FeatureCaptureEventCreatedRecordV1<TCreated>
    | FeatureCaptureEventFinalizedRecordV1<TFinal>
    | FeatureCaptureAcceptanceChangedRecordV1<TAcceptance>
    | FeatureCaptureAnnotationAddedRecordV1<TAnnotation>;

export const KNOWN_JOURNAL_RECORD_KINDS: ReadonlySet<string> = new Set([
    "stream.header",
    "event.created",
    "event.finalized",
    "acceptance.changed",
    "annotation.added",
]);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What callers hand to the writer: an event-lifecycle record without the
 * writer-owned fields (the writer stamps `schema` and assigns `recordSeq`;
 * the header is constructed by the writer itself).
 */
export type FeatureCaptureJournalEventRecordInputV1<
    TCreated,
    TFinal,
    TAcceptance,
    TAnnotation = Record<string, unknown>,
> = DistributiveOmit<
    Exclude<
        FeatureCaptureJournalRecordV1<TCreated, TFinal, TAcceptance, TAnnotation>,
        FeatureCaptureStreamHeaderRecordV1
    >,
    "schema" | "recordSeq"
>;

/** Header fields the writer needs to open a stream (it stamps the rest). */
export type FeatureCaptureStreamHeaderInputV1 = Omit<
    FeatureCaptureStreamHeaderRecordV1,
    "schema" | "kind" | "recordSeq" | "createdUtc"
> & { createdUtc?: string };

// ---------------------------------------------------------------------------
// Child manifest
// ---------------------------------------------------------------------------

/**
 * Honest durability labels (addendum §3.7). This writer may claim only
 * "appended" (append visible to normal reads) or "checkpointed" (segments and
 * manifest agree). "durable" requires a tested flush contract that does not
 * exist yet; "memory" never reaches a manifest.
 */
export type FeatureCaptureDurabilityLevel = "memory" | "appended" | "checkpointed" | "durable";

export type FeatureCaptureStreamStatus = "active" | "closed" | "partial";

export interface FeatureCaptureSegmentDescriptorV1 {
    /** File name relative to the stream directory, e.g. "segment-000001.jsonl". */
    file: string;
    firstRecordSeq: number;
    lastRecordSeq: number;
    records: number;
    /** event.created records in the segment (logical events started here). */
    events: number;
    bytes: number;
    status: "active" | "closed";
    /**
     * Hex content digest — present only on segments closed COMPLETE (every
     * append verified). A closed segment without a digest had an interrupted
     * write; readers treat its content as honest-but-unverified.
     */
    sha256?: string;
    /** Capture policy in force for the segment (policy changes roll segments). */
    capturePolicyId: string;
}

export type FeatureCaptureDropReason =
    | "queueOverflowRecords"
    | "queueOverflowBytes"
    | "serializationError"
    | "writerFailed"
    | "writerClosed";

/** EXACT dropped record range — never a bare count (honesty invariant §2.2). */
export interface FeatureCaptureDroppedRangeV1 {
    fromRecordSeq: number;
    throughRecordSeq: number;
    reason: FeatureCaptureDropReason;
}

export interface FeatureCaptureManifestTotalsV1 {
    records: number;
    events: number;
    bytes: number;
    droppedRecords: number;
}

/**
 * The child manifest — owned exclusively by the stream's journal writer
 * (Amendment A: one writer per manifest, updated by temp-file + atomic
 * rename). The parent bundle catalogs it by relative path only.
 */
export interface FeatureCaptureManifestV1 {
    schema: typeof FEATURE_CAPTURE_MANIFEST_SCHEMA;
    streamSchema: typeof FEATURE_CAPTURE_STREAM_SCHEMA;
    /** Stream identity block — mirrors the recordSeq-0 header. */
    stream: {
        featureId: string;
        hostSessionId: string;
        captureSessionId: string;
        eventSchema: string;
        overridesSchema: string;
        capturePolicyId: string;
    };
    status: FeatureCaptureStreamStatus;
    /** Strongest durability claim for the persisted stream (addendum §3.7). */
    durability: FeatureCaptureDurabilityLevel;
    segments: FeatureCaptureSegmentDescriptorV1[];
    droppedRanges: FeatureCaptureDroppedRangeV1[];
    totals: FeatureCaptureManifestTotalsV1;
    createdUtc: string;
    updatedUtc: string;
    closedUtc?: string;
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export type JournalValidationSeverity = "info" | "warning" | "error";

export type JournalValidationCode =
    // stream-level
    | "header.missing"
    | "header.duplicate"
    | "header.notFirst"
    // record-level
    | "record.malformed"
    | "record.unknownKind"
    | "record.unknownSchema"
    | "record.outOfOrder"
    | "record.seqGap"
    | "record.tooDeep"
    // event lifecycle
    | "event.duplicateCreated"
    | "event.staleRevision"
    | "event.identityMutation"
    | "event.missingCreated"
    | "acceptance.beforeFinalized"
    | "redaction.resurrection"
    // storage-level (reader)
    | "manifest.missing"
    | "manifest.malformed"
    | "segment.missing"
    | "segment.unreadable"
    | "segment.digestMismatch"
    | "segment.tornTailLine"
    | "segment.recordCountMismatch"
    | "segment.invalidName"
    | "segment.lineTooLong";

export interface JournalValidationIssue {
    severity: JournalValidationSeverity;
    code: JournalValidationCode;
    recordSeq?: number;
    message: string;
}

// ---------------------------------------------------------------------------
// Shape guards (records read back from disk are untrusted input)
// ---------------------------------------------------------------------------

export function isJournalRecordShape(
    value: unknown,
): value is FeatureCaptureJournalRecordV1<unknown, unknown, unknown, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.schema === "string" &&
        typeof record.kind === "string" &&
        typeof record.recordSeq === "number"
    );
}
