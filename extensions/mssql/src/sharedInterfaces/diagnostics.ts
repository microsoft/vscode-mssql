/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared contracts for the MSSQL diagnostics substrate and the Debug Console
 * webview (design: debug-docs/MSSQL_Debug_Console_Technical_Design.md).
 * Everything here crosses the extension-host <-> webview boundary, so it must
 * stay JSON-serializable and free of runtime imports.
 */

export const DIAG_SCHEMA_VERSION = "mssql.diag.event/1";

export type DiagProcess =
    | "extensionHost"
    | "webview"
    | "renderer"
    | "sqlToolsService"
    | "sqlServer"
    | "harness"
    | "system";

export type DiagKind =
    | "event"
    | "span"
    | "metric"
    | "request"
    | "response"
    | "sqlActivity"
    | "renderPhase"
    | "gap"
    | "state";

export type DiagStatus = "ok" | "info" | "warning" | "error" | "blocked" | "partial";

export type DiagTimingClass =
    | "officialSameProcess"
    | "productTimer"
    | "epochAlignedDiagnostic"
    | "collectorDiagnostic"
    | "inferred";

export type DataClassification =
    | "public"
    | "system.metadata"
    | "diagnostic.metadata"
    | "source.path"
    | "server.name"
    | "database.name"
    | "schema.name"
    | "object.name"
    | "sql.text"
    | "sql.digest"
    | "row.data"
    | "result.shape"
    | "secret"
    | "connection.string"
    | "token"
    | "user.text"
    | "model.prompt"
    | "model.response"
    | "unknown";

export type RedactionHandling =
    | "plain"
    | "redacted"
    | "digest"
    | "tokenized"
    | "truncated"
    | "omitted";

/**
 * A payload field after capture-policy application. Raw sensitive values are
 * redacted BEFORE the envelope is constructed — a redacted value never exists
 * in a sink, the store, or the webview DOM.
 */
export interface ClassifiedValue {
    /** Post-redaction display value (absent when handling is omitted/redacted). */
    v?: string | number | boolean | null;
    cls: DataClassification;
    handling: RedactionHandling;
    /** Stable digest for equality/grouping when handling is digest. */
    digest?: string;
    /** Original length for truncated values. */
    len?: number;
}

export interface DiagClassificationSummary {
    max: DataClassification;
    redactedFields: number;
    policyId: string;
}

export interface DiagEvent {
    schemaVersion: typeof DIAG_SCHEMA_VERSION;
    eventId: string;
    sessionId: string;
    seq: number;
    /** Epoch milliseconds (extension-host clock unless process says otherwise). */
    epochMs: number;
    /** Same-process monotonic nanoseconds when available. */
    monotonicNs?: string;
    process: DiagProcess;
    pid?: number;
    feature: string;
    kind: DiagKind;
    /** Semantic type, e.g. "command.mssql.runQuery.begin", "rpc.query/executeString". */
    type: string;
    status: DiagStatus;
    traceId?: string;
    causeEventId?: string;
    /** Entity anchor, e.g. { kind: "document", id: "uri:sha256:..." }. */
    entity?: { kind: string; id: string };
    durationMs?: number;
    timingClass?: DiagTimingClass;
    payload?: Record<string, ClassifiedValue>;
    cls: DiagClassificationSummary;
    tags?: string[];
    /**
     * Rich diagnostics enrichment (opt-in COLLECT_ALL_THE_DATA mode): cheap
     * context metrics captured at emission. Never official-eligible; absent
     * when rich collection is off (zero cost).
     */
    perf?: {
        captureLevel: "rich";
        officialEligible: false;
        metrics: Record<string, number>;
        collectionCost: "free" | "low";
    };
}

export interface GapRecord {
    kind: "gap";
    gapId: string;
    sessionId: string;
    fromSeq: number;
    throughSeq: number;
    droppedCount: number;
    reason: "subscriberOverflow" | "sinkOverflow" | "journalUnavailable";
    /** First seq delivered AFTER the gap — the exact resync point. */
    firstAvailableSeq?: number;
    backfillStatus: "notStarted" | "running" | "succeeded" | "partial" | "failed";
    epochMs: number;
}

// ---------------------------------------------------------------------------
// Capture policy
// ---------------------------------------------------------------------------

export type CaptureMode = "off" | "redacted" | "digest" | "full";

export interface CapturePolicy {
    policyId: string;
    mode: CaptureMode;
    allowSqlText: boolean;
    allowRowData: boolean;
    allowConnectionDetails: boolean;
    /** Secrets are never persisted; the type forbids it. */
    allowSecrets: false;
    /** Elevated policies auto-revert at this time. */
    expiresEpochMs?: number;
    reason?: string;
}

export interface ProvenanceSummary {
    extensionVersion?: string;
    commit?: string;
    dirty?: boolean;
    environmentHash?: string;
    vscodeVersion?: string;
    stsVersion?: string;
}

export interface SessionManifest {
    schemaVersion: "mssql.diag.sessionManifest/1";
    sessionId: string;
    createdUtc: string;
    updatedUtc: string;
    source: "live" | "perfRun" | "bundle";
    captureMode: CaptureMode;
    policyId: string;
    eventCount: number;
    gapCount: number;
    segments: Array<{ file: string; firstSeq: number; lastSeq: number; events: number }>;
    /** Total bytes across segments (updated on flush). */
    sizeBytes?: number;
    /** Exact seq ranges lost to store-buffer overflow. */
    droppedRanges?: Array<{ fromSeq: number; throughSeq: number }>;
    provenance: ProvenanceSummary;
    status: "active" | "closed" | "partial";
}

// ---------------------------------------------------------------------------
export interface SinkHealth {
    id: string;
    healthy: boolean;
    detail: string;
    counters: Record<string, number>;
}
