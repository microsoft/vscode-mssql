/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central-store row DTOs and protocol shapes (central design §4.2/§5/§7.3,
 * review addendum C-1..C-10, §3).
 *
 * Row DTOs use snake_case keys deliberately: they are the exact JSON the
 * stored procedures shred via OPENJSON ... WITH, and the exact canonical row
 * stream both writers digest for `projection_digest`. Renaming a key here is
 * a contract version bump.
 */

import type { CentralSourceKind, DataClassification, UploadPolicyId } from "./policies";

/** DDL + DTO contract version; recorded in schema_info and on every batch. */
export const CENTRAL_CONTRACT_VERSION = "central/1.0";

/** Projection code version; a reprojection under a newer value is legal. */
export const CENTRAL_PROJECTOR_VERSION = "central-projector/1.0";

export const CENTRAL_SCHEMA_NAME = "central";

export interface CentralProjectionIdentity {
    contractVersion: string;
    projectorVersion: string;
    sourceSchemaVersion: string;
    uploadPolicyId: UploadPolicyId;
}

// ---------------------------------------------------------------------------
// Perf-run twin rows (Tier 1)
// ---------------------------------------------------------------------------

export interface CentralRunRow {
    run_id: string;
    created_at_unix_ns: string;
    created_at_utc: string;
    pass_type: "measurement" | "diagnostic" | "calibration";
    status: "passed" | "failed" | "invalid" | "aborted";
    config_hash: string;
    environment_hash: string;
    /** Post-policy: digest, plain label, or null (dropped). */
    machine_id: string | null;
    /** Post-policy: null unless the policy keeps user.text notes. */
    notes: string | null;
}

export interface CentralRunRepositoryRow {
    run_id: string;
    repo: string;
    sha: string;
    branch: string | null;
    dirty: 0 | 1;
    remote: string | null;
}

export interface CentralEnvironmentRow {
    environment_hash: string;
    captured_at_unix_ns: string;
    captured_at_utc: string;
    machine_id: string | null;
    os_platform: string | null;
    os_version: string | null;
    cpu_model: string | null;
    logical_cores: number | null;
    memory_total_mb: number | null;
    vscode_version: string | null;
    extension_versions_json: string | null;
    sts_version: string | null;
    sql_image_digest: string | null;
    sql_snapshot: string | null;
    config_fingerprint_json: string;
}

export interface CentralScenarioRow {
    scenario_id: string;
    display_name: string;
    owner: string | null;
    tags_json: string | null;
    definition_hash: string | null;
}

export interface CentralRepetitionRow {
    run_id: string;
    scenario_id: string;
    rep_id: number;
    attempt_id: number;
    status: "passed" | "failed" | "invalid" | "aborted";
    warmup: 0 | 1;
    trace_id: string | null;
    start_unix_ns: string | null;
    end_unix_ns: string | null;
    start_utc: string | null;
    end_utc: string | null;
}

export interface CentralMetricRow {
    run_id: string;
    scenario_id: string;
    rep_id: number;
    attempt_id: number;
    name: string;
    value: number;
    unit: string;
    component: string;
    process_role: string;
    source: string;
    official: 0 | 1;
    lower_is_better: 0 | 1;
    aggregation: string | null;
    trace_id: string | null;
    span_id: string | null;
    start_unix_ns: string | null;
    end_unix_ns: string | null;
    confidence: string | null;
    tags_json: string | null;
    derivation_json: string | null;
}

export interface CentralValidationRow {
    run_id: string;
    scenario_id: string | null;
    rep_id: number | null;
    attempt_id: number | null;
    name: string;
    status: "passed" | "warning" | "failed" | "skipped";
    message: string | null;
    details_json: string | null;
}

export interface CentralArtifactRefRow {
    run_id: string;
    scenario_id: string | null;
    rep_id: number | null;
    attempt_id: number | null;
    kind: string;
    /** Always relative to the run root; absolute paths are refusedByPolicy (C-8). */
    relative_path: string;
    retention: "always" | "on-regression" | "on-failure" | "never";
    size_bytes: number | null;
    sha256: string | null;
    content_type: string | null;
    created_at_unix_ns: string | null;
    created_at_utc: string | null;
}

// ---------------------------------------------------------------------------
// Diagnostic-session rows
// ---------------------------------------------------------------------------

export interface CentralDiagSessionRow {
    session_id: string;
    source: "live" | "perfRun" | "bundle";
    capture_mode: "off" | "redacted" | "digest" | "full";
    capture_policy_id: string;
    created_utc: string;
    updated_utc: string;
    event_count: number;
    gap_count: number;
    source_size_bytes: number | null;
    /** Policy-filtered provenance (C-7); same projection path as payloads. */
    provenance_json: string;
    environment_hash: string | null;
    product_sha: string | null;
    status: "active" | "closed" | "partial";
}

export interface CentralDiagEventRow {
    seq: number;
    event_id: string;
    epoch_ms: number;
    /** Projector-computed from epoch_ms (C-4/Q-6); the index/retention axis. */
    event_time_utc: string;
    monotonic_ns: string | null;
    process: string;
    pid: number | null;
    feature: string;
    kind: string;
    type: string;
    status: string;
    trace_id: string | null;
    cause_event_id: string | null;
    entity_kind: string | null;
    entity_ref: string | null;
    duration_ms: number | null;
    timing_class: string | null;
    cls_max: DataClassification;
    /** Index of cls_max in the vendored RANK_ORDER (never lexicographic). */
    cls_rank: number;
    cls_redacted_fields: number;
    tags_json: string | null;
    /** Post-upload-policy payload map preserving {cls, handling, digest?, len?}. */
    payload_json: string;
    payload_digest: string;
}

export interface CentralDiagGapRow {
    gap_id: string;
    from_seq: number;
    through_seq: number;
    dropped_count: number;
    reason: "subscriberOverflow" | "sinkOverflow" | "journalUnavailable";
    backfill_status: "notStarted" | "running" | "succeeded" | "partial" | "failed";
    first_available_seq: number | null;
    epoch_ms: number;
    gap_time_utc: string;
}

// ---------------------------------------------------------------------------
// Upload items, preview, projection output
// ---------------------------------------------------------------------------

export type UploadItemKind =
    | "runs"
    | "run_repositories"
    | "environments"
    | "scenarios"
    | "repetitions"
    | "metrics"
    | "validations"
    | "artifact_refs"
    | "diag_sessions"
    | "diag_events"
    | "diag_gaps";

/**
 * Length limits owned by the projection contract. Stored-procedure JSON
 * shredding deliberately uses nvarchar(max), so values are either accepted
 * here or rejected by the destination column instead of being truncated.
 */
export const CENTRAL_COLUMN_LIMITS: Readonly<
    Partial<Record<UploadItemKind, Readonly<Record<string, number>>>>
> = {
    runs: {
        run_id: 100,
        created_at_unix_ns: 30,
        pass_type: 20,
        status: 20,
        config_hash: 100,
        environment_hash: 100,
        machine_id: 200,
    },
    run_repositories: { run_id: 100, repo: 200, sha: 80, branch: 200, remote: 400 },
    environments: {
        environment_hash: 100,
        captured_at_unix_ns: 30,
        machine_id: 200,
        os_platform: 60,
        os_version: 200,
        cpu_model: 200,
        vscode_version: 60,
        sts_version: 60,
        sql_image_digest: 200,
        sql_snapshot: 200,
    },
    scenarios: {
        scenario_id: 200,
        display_name: 400,
        owner: 200,
        definition_hash: 100,
    },
    repetitions: {
        run_id: 100,
        scenario_id: 200,
        status: 20,
        trace_id: 80,
        start_unix_ns: 30,
        end_unix_ns: 30,
    },
    metrics: {
        run_id: 100,
        scenario_id: 200,
        name: 200,
        unit: 40,
        component: 80,
        process_role: 80,
        source: 40,
        aggregation: 40,
        trace_id: 80,
        span_id: 40,
        start_unix_ns: 30,
        end_unix_ns: 30,
        confidence: 20,
    },
    validations: { run_id: 100, scenario_id: 200, name: 200, status: 20 },
    artifact_refs: {
        run_id: 100,
        scenario_id: 200,
        kind: 80,
        relative_path: 400,
        retention: 20,
        sha256: 80,
        content_type: 120,
        created_at_unix_ns: 30,
    },
    diag_sessions: {
        session_id: 100,
        source: 30,
        capture_mode: 40,
        capture_policy_id: 120,
        environment_hash: 100,
        product_sha: 80,
        status: 20,
    },
    diag_events: {
        event_id: 80,
        monotonic_ns: 40,
        process: 40,
        feature: 80,
        kind: 40,
        type: 200,
        status: 40,
        trace_id: 80,
        cause_event_id: 80,
        entity_kind: 40,
        entity_ref: 200,
        timing_class: 60,
        cls_max: 80,
        tags_json: 400,
        payload_digest: 100,
    },
    diag_gaps: { gap_id: 80, reason: 40, backfill_status: 20 },
};

export interface UploadItemPayload {
    item_kind: UploadItemKind;
    item_ordinal: number;
    row_count: number;
    /** Digest of payload_json ("pay_..."). */
    payload_digest: string;
    /** Canonical JSON array of row DTOs — exactly what the proc shreds. */
    payload_json: string;
}

export interface UploadPreviewTable {
    name: string;
    rows: number;
    bytesEstimate: number;
}

export interface UploadPreviewFieldNote {
    field: string;
    cls: DataClassification;
    count: number;
}

export interface UploadPreviewRefusal {
    field: string;
    cls: DataClassification;
    reason: string;
}

/**
 * Dry-run of the exact projection that will be uploaded (base §7.3, C-15).
 * Generated FROM the projected item stream, never by a second estimator; the
 * preview digest ("pvw_...") is passed to usp_begin_upload and echoed on the
 * receipt so preview and commit are checkably the same projection.
 */
export interface UploadPreview {
    contractVersion: string;
    projectorVersion: string;
    sourceKind: CentralSourceKind;
    naturalKey: string;
    uploadPolicyId: UploadPolicyId;
    sourceDigest: string;
    contentDigest: string;
    projectionDigest: string;
    sourceSummary: {
        files: number;
        bytes: number;
        events?: number;
        gaps?: number;
        metrics?: number;
    };
    tables: UploadPreviewTable[];
    dropped: UploadPreviewFieldNote[];
    digested: UploadPreviewFieldNote[];
    refused: UploadPreviewRefusal[];
    warnings: string[];
}

/** Full projection output: what a writer stages and commits. */
export interface CentralProjection {
    kind: CentralSourceKind;
    naturalKey: string;
    identity: CentralProjectionIdentity;
    sourceDigest: string;
    contentDigest: string;
    projectionDigest: string;
    previewDigest: string;
    preview: UploadPreview;
    items: UploadItemPayload[];
}

// ---------------------------------------------------------------------------
// Ingest protocol shapes (addendum §3)
// ---------------------------------------------------------------------------

export type UploadDispositionKind =
    "proceed" | "resume" | "alreadyPresent" | "reprojected" | "extendCandidate" | "refused";

export interface UploadDisposition {
    disposition: UploadDispositionKind;
    uploadBatchId: number | null;
    /** For refused: sourceMutation | projectionMismatch | policyProhibited | ... */
    reasonCode: string | null;
    /** For resume: items already applied, to be skipped by the writer. */
    appliedItems: Array<{ item_kind: string; item_ordinal: number; payload_digest: string }>;
}

export type UploadBatchStatus =
    | "started"
    | "committed"
    | "alreadyPresent"
    | "reprojected"
    | "extended"
    | "refused"
    | "failed"
    | "abandoned"
    | "purged";

export interface UploadReceipt {
    uploadBatchId: number;
    outcome: UploadBatchStatus;
    kind: CentralSourceKind;
    naturalKey: string;
    uploadPolicyId: string;
    rowsByItemKind: Record<string, number>;
    sourceDigest: string;
    contentDigest: string;
    projectionDigest: string;
    previewDigest: string;
    committedAtUtc: string | null;
}
