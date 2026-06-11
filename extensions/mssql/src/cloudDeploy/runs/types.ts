/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — run-record domain types.
 *
 * The `RunRecord` is the in-memory shape that round-trips through a
 * persisted run artifact (`.cdrun.zip`). It captures everything we need to
 * later render a run in the UI without re-executing validations: which
 * environment was targeted, who ran what at what time, the aggregate
 * status, and one `ValidationResult` per executed validation.
 *
 * Schema rules:
 *   * `RUN_RECORD_SCHEMA_VERSION` is bumped only on breaking changes; readers
 *     reject any forward version they don't understand.
 *   * `passthrough()` everywhere in the Zod mirror (see `runArtifactSchema.ts`)
 *     so additive forward-compatible fields don't break older readers.
 *   * All fields are `readonly`: a `RunRecord` is a snapshot.
 *
 * Validation payload shapes live in this file as a discriminated union keyed
 * on `validationType`, so the writer/reader can rely on Zod to narrow without
 * any manual instanceof / typeof gymnastics.
 */

import { Environment, ValidationType } from "../environments/types";

// =============================================================================
// Constants
// =============================================================================

/** Bumped on breaking changes to the on-disk run artifact format. */
export const RUN_RECORD_SCHEMA_VERSION = 1 as const;

// =============================================================================
// Enums
// =============================================================================

/**
 * Overall status of a run, computed by collapsing all per-validation statuses
 * via `RUN_STATUS_PRIORITY` (worst wins). Listed least- to most-severe.
 *
 * `Cancelled` was added in D2: user-cancelled and timed-out runs surface a
 * real status arm instead of a string-matched `errorMessage`. Ranked between
 * `Skipped` and `Warning` — worse than skipping intentionally, better than
 * finding a real warning.
 */
export enum RunStatus {
    Passed = "passed",
    Skipped = "skipped",
    Cancelled = "cancelled",
    Warning = "warning",
    Failed = "failed",
    Errored = "errored",
}

/**
 * Per-status severity rank. Higher value = worse outcome. Aggregation picks
 * the validation with the highest rank as the run-level `RunStatus`.
 *
 * `Object.freeze` prevents accidental mutation of shared module-level state
 * by callers (a real bug class once the store starts copying these constants
 * into telemetry payloads).
 */
export const RUN_STATUS_PRIORITY: Readonly<Record<RunStatus, number>> = Object.freeze({
    [RunStatus.Passed]: 0,
    [RunStatus.Skipped]: 1,
    [RunStatus.Cancelled]: 2,
    [RunStatus.Warning]: 3,
    [RunStatus.Failed]: 4,
    [RunStatus.Errored]: 5,
});

/** Status of a single validation execution. Mirrors `RunStatus` semantics. */
export enum ValidationStatus {
    Passed = "passed",
    Skipped = "skipped",
    Cancelled = "cancelled",
    Warning = "warning",
    Failed = "failed",
    Errored = "errored",
}

/**
 * Why a validation (or run) was cancelled. `"user"` covers explicit
 * user-initiated cancellation; `"timeout"` covers runner-level deadline
 * expiry. Stored on `ValidationResult.cancellationReason` and required
 * whenever the corresponding status is `Cancelled` (enforced in Zod).
 */
export type CancellationReason = "user" | "timeout";

// =============================================================================
// Runner identity
// =============================================================================

/**
 * Identifies who/what initiated a run. `userId` is a stable, non-PII handle
 * (e.g. the VS Code `machineId` or a hashed account id); `displayName` is
 * what the UI surfaces. `hostKind` exists so future Codespaces / GitHub
 * Actions launches can be distinguished from a local VS Code workspace.
 */
export interface RunnerIdentity {
    readonly userId: string;
    readonly displayName: string;
    readonly hostKind: "vscode" | "codespaces" | "github-actions";
}

// =============================================================================
// Findings
// =============================================================================

/**
 * Closed discriminated union of every finding the UI can render. The
 * discriminator is `kind`, matching the corresponding `ValidationType`.
 *
 * Findings are validation-shaped, not test-runner-shaped: a "test failure"
 * inside a unit-test run is `UnitTestFinding`, not a generic message blob.
 * That gives the renderer a typed surface without inspecting magic strings.
 */
export type Finding =
    | ConnectivityFinding
    | StaticAnalysisFinding
    | UnitTestFinding
    | WorkloadRegressionFinding;

export interface ConnectivityFinding {
    readonly kind: "connectivity";
    /**
     * Closed enum of the connection failure modes the connectivity validator
     * surfaces. New modes ride the same arm — additive. `"reachable"` is the
     * success marker (the one finding emitted on a green connection).
     */
    readonly outcome:
        | "reachable"
        | "connection-refused"
        | "auth-failed"
        | "host-unreachable"
        | "timeout"
        | "unknown";
    /** Severity within the validator's vocabulary. `"reachable"` is `"info"`; failures are `"error"`. */
    readonly severity: "info" | "warning" | "error";
    /** Human-readable description; not localized — emitted by the validator. */
    readonly message: string;
}

export interface StaticAnalysisFinding {
    readonly kind: "static-analysis";
    /** Rule identifier (e.g. an SQL linter rule code). */
    readonly ruleId: string;
    /** Severity within the rule's vocabulary. */
    readonly severity: "info" | "warning" | "error";
    /** Human-readable description; not localized — emitted by the analyzer. */
    readonly message: string;
    /** Optional source location for navigation. */
    readonly location?: {
        readonly file: string;
        readonly line?: number;
        readonly column?: number;
    };
}

export interface UnitTestFinding {
    readonly kind: "unit-tests";
    /** Fully-qualified test name (suite + test). */
    readonly testName: string;
    readonly outcome: "passed" | "failed" | "skipped" | "errored";
    /** Failure message when `outcome !== "passed"`. */
    readonly message?: string;
    /** Wall-clock duration; useful for perf regressions but not authoritative. */
    readonly durationMs?: number;
}

export interface WorkloadRegressionFinding {
    readonly kind: "workload-playback";
    /** Workload step / query identifier. */
    readonly stepId: string;
    /** What changed vs. baseline. */
    readonly regression: "throughput" | "latency" | "error-rate" | "plan-change";
    /** Numeric delta (interpretation depends on `regression`). */
    readonly delta: number;
    /** Free-form description for the UI; emitted by the workload runner. */
    readonly message: string;
}

// =============================================================================
// Validation payloads
// =============================================================================

/**
 * Discriminated union of per-validation payloads. The discriminator is
 * `validationType`, matching `ValidationType` from the env model. This lets
 * a single `ValidationResult.payload` be exhaustively narrowed without
 * runtime type checks.
 */
export type ValidationPayload =
    | ConnectivityPayload
    | StaticAnalysisPayload
    | UnitTestsPayload
    | WorkloadPlaybackPayload;

export interface ConnectivityPayload {
    readonly validationType: ValidationType.Connectivity;
    readonly findings: readonly ConnectivityFinding[];
    /**
     * `serverVersion` is captured on a successful probe so the UI can render
     * "connected to SQL Server 2022 (16.0.x)" without re-querying. Absent on
     * failure paths.
     */
    readonly summary: {
        readonly reachable: boolean;
        readonly serverVersion?: string;
    };
}

export interface StaticAnalysisPayload {
    readonly validationType: ValidationType.StaticAnalysis;
    readonly findings: readonly StaticAnalysisFinding[];
    /** Aggregate counts; pre-computed so the UI doesn't recount. */
    readonly summary: {
        readonly info: number;
        readonly warning: number;
        readonly error: number;
    };
}

export interface UnitTestsPayload {
    readonly validationType: ValidationType.UnitTests;
    readonly findings: readonly UnitTestFinding[];
    readonly summary: {
        readonly total: number;
        readonly passed: number;
        readonly failed: number;
        readonly skipped: number;
        readonly errored: number;
    };
}

export interface WorkloadPlaybackPayload {
    readonly validationType: ValidationType.WorkloadPlayback;
    readonly findings: readonly WorkloadRegressionFinding[];
    /** Aggregate counts; pre-computed for fast UI rendering. */
    readonly summary: {
        readonly steps: number;
        readonly regressions: number;
    };
}

// =============================================================================
// ValidationResult
// =============================================================================

/**
 * One executed validation within a run. Owns its own status, timestamps,
 * and payload. Persisted as a separate entry inside the run artifact zip
 * (`validations/{validationId}.json`) so partial reads — e.g. "show me only
 * the static-analysis result" — are cheap.
 */
export interface ValidationResult {
    /** Stable id within the run (typically the validation's id from the env config). */
    readonly validationId: string;
    /** Human-friendly label, copied from the env at run-start time. */
    readonly displayName: string;
    readonly status: ValidationStatus;
    readonly startedAtMs: number;
    readonly endedAtMs: number;
    readonly payload: ValidationPayload;
    /**
     * Optional terse error message when `status === "errored"`. Distinct from
     * `payload.findings`: this is "the validation runner itself crashed",
     * not "the validation found N problems".
     */
    readonly errorMessage?: string;
    /**
     * Why this validation was cancelled. Required whenever
     * `status === ValidationStatus.Cancelled` and forbidden otherwise
     * (enforced by the Zod schema's `superRefine` cross-field check).
     */
    readonly cancellationReason?: CancellationReason;
}

// =============================================================================
// RunRecord
// =============================================================================

/**
 * Identity of the source schema a run validated (Scope 2, decision D-A).
 *
 * `hash` is a content fingerprint of the schema source files (the universal
 * identity that lets runs be told apart and grouped: same schema -> same hash).
 * It is a FINGERPRINT, not a copy \u2014 it answers "same or different schema?",
 * never "what was in the schema?" (that stays git's job). `commitId` / `ref`
 * are populated only in CI, where git provides a friendlier label for the same
 * content the hash already identifies; locally only `hash` is present.
 */
export interface SourceVersion {
    /** Content hash of the schema source, prefixed with the algorithm (e.g. `sha256:...`). */
    readonly hash: string;
    /** Hash algorithm used, so a future algorithm change is detectable. */
    readonly algorithm: "sha256";
    /** CI only: the git commit id this run validated. Absent locally. */
    readonly commitId?: string;
    /** CI only: the git ref / PR branch, for display. Absent locally. */
    readonly ref?: string;
}

/**
 * Top-level run-record shape: one of these per persisted run artifact.
 *
 * `environmentSnapshot` is the FULL env value at the moment the run started,
 * captured by deep-copy. The env may have been edited or deleted since;
 * the snapshot preserves the historical context the run was executed in.
 */
export interface RunRecord {
    /** Always equals `RUN_RECORD_SCHEMA_VERSION` at write time. */
    readonly schemaVersion: typeof RUN_RECORD_SCHEMA_VERSION;
    /** Stable, globally-unique run id (UUID). */
    readonly runId: string;
    /** The env id this run targeted. Matches `environmentSnapshot.id`. */
    readonly environmentId: string;
    /** Frozen copy of the targeted env at run-start time. */
    readonly environmentSnapshot: Environment;
    readonly runner: RunnerIdentity;
    /**
     * Identity of the source schema this run validated (Scope 2, decision D-A).
     * Optional in the type because run artifacts written before Scope 2 predate
     * the field; always written on new runs.
     */
    readonly sourceVersion?: SourceVersion;
    readonly startedAtMs: number;
    readonly endedAtMs: number;
    /** Aggregate status across all `validations`. */
    readonly status: RunStatus;
    /** One entry per validation that executed. May be empty for an aborted run. */
    readonly validations: readonly ValidationResult[];
}

// =============================================================================
// Listing summary
// =============================================================================

/**
 * Lightweight projection of a `RunRecord` cached by `RunStore` and pushed
 * across the webview boundary. Carries just enough for the dashboard tree
 * and the hub's run-list page to render without re-reading the artifact.
 * The full `RunRecord` (events, validations, payloads) is fetched on
 * demand via `RunStore.get(runId)`.
 *
 * Lives in this pure-types file (no Node imports) so it can be referenced
 * from both the extension host and the webview build.
 */
export interface RunListEntry {
    readonly runId: string;
    readonly envId: string;
    readonly envDisplayName: string;
    readonly status: RunStatus;
    readonly startedAtMs: number;
    readonly endedAtMs: number;
    readonly artifactPath: string;
}
