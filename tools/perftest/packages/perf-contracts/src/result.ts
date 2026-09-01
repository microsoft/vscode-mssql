/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript mirror of schemas/perf-result.schema.json (design §20).
 * One unified `metrics` array; every metric declares its source, official
 * flag, and (for derived metrics) full derivation provenance.
 */

export type PassType = "measurement" | "diagnostic" | "calibration";

export type RepStatus = "passed" | "failed" | "invalid" | "aborted";

export type MetricSource =
    | "marker"
    | "otelSpan"
    | "webviewMark"
    | "sqlServerXEvents"
    | "sqlStatistics"
    | "processSampler"
    | "dotnetCounters"
    | "dotnetTrace"
    | "cdp"
    | "etw"
    | "derived"
    | "manual";

export type Confidence = "high" | "medium" | "low" | "unknown";

export type ValidationStatus = "passed" | "warning" | "failed" | "skipped";

export type ArtifactRetention = "always" | "on-regression" | "on-failure" | "never";

export interface TraceInfo {
    traceId: string;
    rootTraceparent?: string;
    tracestate?: string;
}

export interface GitRepoInfo {
    repo: string;
    sha: string;
    dirty: boolean;
    branch?: string;
    remote?: string;
}

export interface EnvironmentInfo {
    environmentHash: string;
    machineId?: string;
    os?: Record<string, unknown>;
    cpu?: Record<string, unknown>;
    memory?: Record<string, unknown>;
    vscode?: Record<string, unknown>;
    extensions?: Record<string, unknown>;
    sts?: Record<string, unknown>;
    sql?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface Derivation {
    formula: string;
    inputs: string[];
    confidence?: Confidence;
    limitations?: string[];
}

/**
 * Structured eligibility decision (Shared Observability Contract). Splits the
 * overloaded `official` into explicit trust labels with a machine-assembled
 * reason. Mirrors @mssqlperf/observability-contracts MetricEligibility.
 */
export interface MetricEligibility {
    measurementEligible: boolean;
    ciGatingEligible: boolean;
    exploratory: boolean;
    diagnosticOnly: boolean;
    timePlane: "monotonic" | "epoch" | "calibrated" | "derived";
    source: string;
    passType: PassType;
    environment: "controlledHarness" | "interactiveHost" | "unknown";
    reason: string;
}

export interface Metric {
    name: string;
    value: number;
    unit: string;
    component: string;
    processRole: string;
    source: MetricSource;
    /**
     * Official metrics feed regression gating. They may come only from markers
     * or explicit product timers, in a measurement pass, on a passed rep
     * (design §12.2). Everything else must be official: false.
     * `official` remains the gate flag; `eligibility` carries the full decision.
     */
    official: boolean;
    /** Structured trust labels + reason (additive; absent in older results). */
    eligibility?: MetricEligibility;
    lowerIsBetter: boolean;
    aggregation?: string;
    traceId?: string;
    spanId?: string;
    startUnixNs?: string;
    endUnixNs?: string;
    tags?: Record<string, string | number | boolean | null>;
    derivation?: Derivation;
    confidence?: Confidence;
}

export interface ArtifactRef {
    kind: string;
    /** Relative to the rep directory. */
    path: string;
    retention?: ArtifactRetention;
    sizeBytes?: number;
    sha256?: string;
    contentType?: string;
}

export interface ValidationRecord {
    name: string;
    status: ValidationStatus;
    message?: string;
    details?: Record<string, unknown>;
}

export interface ErrorRecord {
    kind: string;
    message: string;
    stack?: string;
    source?: string;
    details?: Record<string, unknown>;
}

export interface PerfResult {
    schemaVersion: 2;
    runId: string;
    repId: number;
    scenarioId: string;
    attemptId?: number;
    passType: PassType;
    status: RepStatus;
    trace: TraceInfo;
    git?: GitRepoInfo[];
    environment: EnvironmentInfo;
    metrics: Metric[];
    artifacts: ArtifactRef[];
    validations: ValidationRecord[];
    errors: ErrorRecord[];
}
