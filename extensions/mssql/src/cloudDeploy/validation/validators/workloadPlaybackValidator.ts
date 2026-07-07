/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `WorkloadPlaybackValidator`.
 *
 * Loads a workload spec via the injected `ArtifactProvider`, then measures
 * each step IN-PROCESS against the per-run ephemeral database the runner
 * provisioned. For each step it times the query (median of N iterations) AND,
 * best-effort, captures two deterministic signals from the plan cache: the
 * actual execution-plan hash and the logical reads / CPU time of the last
 * execution. The fresh measurements are compared to a RUN-BASED baseline: the
 * measured steps of the most-recent earlier run of this environment whose
 * schema differed, injected by the runner via `opts.workloadBaseline`. One
 * finding is emitted per step per axis that regressed beyond its threshold.
 *
 * The workload spec is a permissive JSON object `{ steps: [{ id, query,
 * iterations? }] }`; steps missing an `id` or `query` are dropped so a partial
 * spec measures what it can rather than failing the run.
 *
 * Signals are tiered by how deterministic they are. Plan hash and logical
 * reads depend on schema + query shape, not on how busy the box is, so they
 * drive the verdict; wall-clock latency and CPU are noisy in a throwaway
 * container, so they are advisory. A plan change on its own is advisory (the
 * new plan may be an improvement); a plan change that ALSO cost latency is
 * treated as a real regression.
 *
 * Outcome mapping:
 *   * No ephemeral connection (no runtime validator provisioned one) →
 *     `Skipped` with a config finding.
 *   * `workloadUri` missing in settings → `Skipped` with a config finding.
 *   * Workload spec missing on disk (`ArtifactNotFoundError`) → `Skipped`.
 *   * Spec declares no measurable steps → `Skipped`.
 *   * No run-based baseline (first run, or no comparable predecessor) →
 *     `Passed`, recording the fresh measurements for the next run to baseline.
 *   * Baseline present, no step regressed → `Passed`.
 *   * Baseline present, only advisory signals regressed (latency / CPU /
 *     throughput / a bare plan change) → `Warning`.
 *   * Baseline present, a deterministic signal regressed (logical reads out of
 *     range, or a plan change paired with a latency regression) → `Failed`.
 *   * A workload query throws while being measured → `Errored`.
 *   * `CancellationError` (entry / artifact-read / measurement) → re-thrown
 *     so the runner reconciles `"user"` vs `"timeout"`.
 *   * Malformed spec JSON → re-thrown so the runner classifies as `Errored`.
 *
 * Threshold defaults are deliberately conservative (25 % latency / 25 %
 * throughput / 5pp error-rate) so first-time users see the validator behave
 * sanely without any tuning. `WorkloadPlaybackSettings` overrides each
 * threshold individually. Plan-hash / logical-read / CPU capture is
 * best-effort: a connection that cannot surface the plan cache degrades
 * cleanly to latency-only rather than failing the run.
 */

import { type Environment, ValidationType } from "../../environments/types";
import {
    type ValidationResult,
    ValidationStatus,
    type WorkloadObservedStep,
    type WorkloadPlaybackPayload,
    type WorkloadRegressionFinding,
} from "../../runs/types";
import { ArtifactNotFoundError, type ArtifactProvider } from "../providers/artifactProvider";
import { type ConnectionHandle } from "../providers/connectionProvider";
import {
    CancellationError,
    type SettingsFor,
    throwIfCancelled,
    type Validator,
    type ValidatorRunOptions,
} from "../types";

// =============================================================================
// Constants
// =============================================================================

const DISPLAY_NAME = "Workload Playback";

/** Latency regression flagged when observed exceeds baseline by this fraction. */
const DEFAULT_LATENCY_THRESHOLD = 0.25;
/** Throughput regression flagged when observed drops below baseline by this fraction. */
const DEFAULT_THROUGHPUT_THRESHOLD = 0.25;
/** Error-rate regression flagged when (observed − baseline) exceeds this absolute delta. */
const DEFAULT_ERROR_RATE_THRESHOLD = 0.05;
/** Logical-reads regression flagged when observed exceeds baseline by this fraction. */
const DEFAULT_LOGICAL_READS_THRESHOLD = 0.25;
/** CPU regression flagged when observed exceeds baseline by this fraction (advisory). */
const DEFAULT_CPU_THRESHOLD = 0.25;

const SKIPPED_NEEDS_DATABASE_MESSAGE =
    "Workload playback needs a provisioned validation database; none was available for this run.";
const SKIPPED_MISSING_WORKLOAD_URI_MESSAGE =
    "WorkloadPlaybackSettings.workloadUri is not configured.";
const SKIPPED_EMPTY_SPEC_MESSAGE = "The workload spec declares no measurable steps.";

const SYNTHETIC_STEP_ID_MEASUREMENT_FAILED = "__measurement_failed__";
const SYNTHETIC_STEP_ID_NOT_CONFIGURED = "__not_configured__";
const SYNTHETIC_STEP_ID_ARTIFACT_MISSING = "__artifact_missing__";

// =============================================================================
// Internal shapes
// =============================================================================

/**
 * Per-step metrics shape. All metric fields are optional so partial captures
 * (e.g. a workload that didn't record plan hashes) compare cleanly without
 * synthesizing missing data.
 */
interface WorkloadStep {
    readonly id: string;
    readonly latencyMs?: number;
    readonly throughputQps?: number;
    readonly errorRate?: number;
    readonly planHash?: string;
    readonly logicalReads?: number;
    readonly cpuMs?: number;
}

interface ResolvedThresholds {
    readonly latency: number;
    readonly throughput: number;
    readonly errorRate: number;
    readonly logicalReads: number;
    readonly cpu: number;
}

// =============================================================================
// Validator
// =============================================================================

/**
 * Workload-playback validator. Constructor takes an `ArtifactProvider`
 * (artifacts) and a `ProcessProvider` (replay tool spawner); production
 * wires `LiveArtifactProvider` + `LiveProcessProvider`, tests substitute
 * `FakeArtifactProvider` + `FakeProcessProvider`.
 */
export class WorkloadPlaybackValidator implements Validator<ValidationType.WorkloadPlayback> {
    public readonly type = ValidationType.WorkloadPlayback;

    public constructor(private readonly _artifacts: ArtifactProvider) {}

    public async run(
        _env: Environment,
        config: SettingsFor<ValidationType.WorkloadPlayback>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();
        throwIfCancelled(opts.signal);

        // Workload runs against the per-run ephemeral
        // database the runner provisioned + seeded. No live connection means
        // there is nothing to measure.
        const connection = opts.ephemeralConnection;
        if (connection === undefined) {
            return buildSkippedResult(
                SYNTHETIC_STEP_ID_NOT_CONFIGURED,
                SKIPPED_NEEDS_DATABASE_MESSAGE,
                startedAtMs,
            );
        }

        const workloadUri = config.workloadUri;
        if (workloadUri === undefined || workloadUri.length === 0) {
            return buildSkippedResult(
                SYNTHETIC_STEP_ID_NOT_CONFIGURED,
                SKIPPED_MISSING_WORKLOAD_URI_MESSAGE,
                startedAtMs,
            );
        }

        // The workload spec lists the steps to measure: each names a SQL query
        // (or proc call) plus how many times to run it.
        let specBuf: Buffer;
        try {
            specBuf = await this._artifacts.read(workloadUri);
        } catch (err) {
            if (err instanceof ArtifactNotFoundError) {
                return buildSkippedResult(
                    SYNTHETIC_STEP_ID_ARTIFACT_MISSING,
                    `Workload spec not found at ${err.uri}.`,
                    startedAtMs,
                );
            }
            throw err;
        }
        throwIfCancelled(opts.signal);

        const spec = parseWorkloadSpec(specBuf);
        if (spec.length === 0) {
            return buildSkippedResult(
                SYNTHETIC_STEP_ID_NOT_CONFIGURED,
                SKIPPED_EMPTY_SPEC_MESSAGE,
                startedAtMs,
            );
        }

        // Measure each step in-process by timing the query against the ephemeral
        // connection (median of N iterations to shrug off noise).
        const observed: WorkloadStep[] = [];
        try {
            for (let i = 0; i < spec.length; i++) {
                const step = spec[i];
                throwIfCancelled(opts.signal);
                const measured = await measureStep(connection, step, i, opts.signal);
                observed.push({ id: step.id, ...measured });
            }
        } catch (err) {
            if (err instanceof CancellationError) {
                throw err;
            }
            if (opts.signal.aborted) {
                throw new CancellationError("user");
            }
            // A query that errors is a measurement failure, surfaced as Errored.
            return buildMeasurementErroredResult(err, startedAtMs);
        }

        const observedSteps = toObservedSteps(observed);

        // Run-based baseline: compare against the prior run's
        // measured steps. With no baseline (first run) we record the
        // measurements but flag no regression.
        const baseline = opts.workloadBaseline;
        if (baseline === undefined || baseline.length === 0) {
            return buildFirstRunResult(observedSteps, startedAtMs);
        }

        const thresholds = resolveThresholds(config);
        const findings = compareSteps(toWorkloadSteps(baseline), observed, thresholds);
        return buildComparisonResult(findings, observedSteps, startedAtMs);
    }
}

// =============================================================================
// Measurement
// =============================================================================

/** A workload spec step: a SQL statement to time, and how many iterations. */
interface WorkloadSpecStep {
    readonly id: string;
    readonly query: string;
    readonly iterations: number;
}

/** The per-step metrics a single measurement pass produces. */
interface StepMeasurement {
    readonly latencyMs: number;
    readonly planHash?: string;
    readonly logicalReads?: number;
    readonly cpuMs?: number;
}

/**
 * A per-step block-comment marker prepended to the step's query so its cached
 * plan can be located in `sys.dm_exec_query_stats` afterwards. The marker is
 * plan-neutral (SQL Server ignores comments when compiling) and is built from
 * the step's index alone, so it is unique within a run and injection-safe.
 */
function planMarker(index: number): string {
    return `/* mssql-cd-wl-${index} */`;
}

/**
 * Measures one workload step against `connection`. Times `step.query`
 * `iterations` times (median, to shrug off the occasional slow outlier such as
 * a GC pause) and, best-effort, reads the deterministic signals — actual plan
 * hash, logical reads, CPU time — for the last execution from the plan cache.
 * A connection that cannot surface the plan cache degrades to latency-only.
 */
async function measureStep(
    connection: ConnectionHandle,
    step: WorkloadSpecStep,
    index: number,
    signal: AbortSignal,
): Promise<StepMeasurement> {
    const markedQuery = `${planMarker(index)}\n${step.query}`;
    const samples: number[] = [];
    for (let i = 0; i < step.iterations; i++) {
        throwIfCancelled(signal);
        const started = Date.now();
        await connection.execute(markedQuery, signal);
        samples.push(Date.now() - started);
    }
    const stats = await capturePlanAndIo(connection, planMarker(index), signal);
    return { latencyMs: median(samples), ...stats };
}

/** Median of a non-empty sample set (not mean — resists slow outliers). */
function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Reads the actual plan hash and the last execution's logical reads / CPU time
 * for the marked statement from `sys.dm_exec_query_stats`. Best-effort: any
 * failure (permissions, an unsupported host, a cache miss) yields an empty
 * result so the step falls back to latency-only rather than failing the run.
 */
async function capturePlanAndIo(
    connection: ConnectionHandle,
    marker: string,
    signal: AbortSignal,
): Promise<Omit<StepMeasurement, "latencyMs">> {
    try {
        const rows = await connection.execute(buildQueryStatsSql(marker), signal);
        const first = rows[0];
        if (!Array.isArray(first)) {
            return {};
        }
        const planHash = typeof first[0] === "string" ? first[0] : undefined;
        const workerTimeUs = toFiniteNumber(first[2]);
        return {
            planHash,
            logicalReads: toFiniteNumber(first[1]),
            cpuMs: workerTimeUs === undefined ? undefined : workerTimeUs / 1000,
        };
    } catch {
        return {};
    }
}

/**
 * Builds the plan-cache probe that fetches the plan hash plus the last
 * execution's logical reads and CPU for the statement tagged with `marker`.
 * The marker is matched as an anchored prefix (so the probe never matches
 * itself) and is built from a numeric index only, so inlining it in the `LIKE`
 * literal is injection-safe.
 */
function buildQueryStatsSql(marker: string): string {
    return [
        "SELECT TOP 1",
        "CONVERT(VARCHAR(34), qs.query_plan_hash, 1) AS plan_hash,",
        "qs.last_logical_reads AS logical_reads,",
        "qs.last_worker_time AS worker_time_us",
        "FROM sys.dm_exec_query_stats AS qs",
        "CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st",
        `WHERE st.text LIKE '${marker}%' AND st.text NOT LIKE '%sys.dm_exec_query_stats%'`,
        "ORDER BY qs.last_execution_time DESC;",
    ].join(" ");
}

/** Coerces a DMV cell (number / bigint / numeric string) to a finite number. */
function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

/** Default iterations per step when the spec omits a count. */
const DEFAULT_STEP_ITERATIONS = 5;

/**
 * Parses a workload spec document: `{ steps: [{ id, query, iterations? }] }`.
 * Steps missing an `id` or `query` are dropped (a partial spec measures what it
 * can rather than failing the run). Throws only on JSON-parse / shape errors.
 */
function parseWorkloadSpec(buf: Buffer): readonly WorkloadSpecStep[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(buf.toString("utf-8"));
    } catch (err) {
        throw new Error(
            `Failed to parse workload spec JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !Array.isArray((parsed as { steps?: unknown }).steps)
    ) {
        throw new Error(`Workload spec is missing the required "steps" array.`);
    }
    const out: WorkloadSpecStep[] = [];
    for (const raw of (parsed as { steps: unknown[] }).steps) {
        if (typeof raw !== "object" || raw === null) {
            continue;
        }
        const obj = raw as Record<string, unknown>;
        if (typeof obj.id !== "string" || obj.id.length === 0) {
            continue;
        }
        if (typeof obj.query !== "string" || obj.query.length === 0) {
            continue;
        }
        const iterations =
            typeof obj.iterations === "number" &&
            Number.isFinite(obj.iterations) &&
            obj.iterations > 0
                ? Math.floor(obj.iterations)
                : DEFAULT_STEP_ITERATIONS;
        out.push({ id: obj.id, query: obj.query, iterations });
    }
    return out;
}

/** Projects measured internal steps to the persisted `WorkloadObservedStep` shape. */
function toObservedSteps(steps: readonly WorkloadStep[]): WorkloadObservedStep[] {
    return steps.map((s) => ({
        id: s.id,
        ...(s.latencyMs !== undefined ? { latencyMs: s.latencyMs } : {}),
        ...(s.throughputQps !== undefined ? { throughputQps: s.throughputQps } : {}),
        ...(s.errorRate !== undefined ? { errorRate: s.errorRate } : {}),
        ...(s.planHash !== undefined ? { planHash: s.planHash } : {}),
        ...(s.logicalReads !== undefined ? { logicalReads: s.logicalReads } : {}),
        ...(s.cpuMs !== undefined ? { cpuMs: s.cpuMs } : {}),
    }));
}

/** Lifts persisted baseline steps back into the internal comparison shape. */
function toWorkloadSteps(steps: readonly WorkloadObservedStep[]): WorkloadStep[] {
    return steps.map((s) => ({
        id: s.id,
        latencyMs: s.latencyMs,
        throughputQps: s.throughputQps,
        errorRate: s.errorRate,
        planHash: s.planHash,
        logicalReads: s.logicalReads,
        cpuMs: s.cpuMs,
    }));
}

// =============================================================================
// Comparison
// =============================================================================

function resolveThresholds(
    config: SettingsFor<ValidationType.WorkloadPlayback>,
): ResolvedThresholds {
    return {
        latency: config.latencyRegressionThreshold ?? DEFAULT_LATENCY_THRESHOLD,
        throughput: config.throughputRegressionThreshold ?? DEFAULT_THROUGHPUT_THRESHOLD,
        errorRate: config.errorRateThreshold ?? DEFAULT_ERROR_RATE_THRESHOLD,
        logicalReads: config.logicalReadsRegressionThreshold ?? DEFAULT_LOGICAL_READS_THRESHOLD,
        cpu: DEFAULT_CPU_THRESHOLD,
    };
}

/**
 * Walks baseline steps in order; for each one, looks up the matching observed
 * step by `id`. Steps in baseline that are missing from observed and steps
 * in observed that aren't in baseline are intentionally not emitted as
 * findings — this validator surfaces *regressions*, not coverage gaps. A
 * future commit can add a separate "missing-step" finding kind if there's
 * demand.
 */
function compareSteps(
    baseline: readonly WorkloadStep[],
    observed: readonly WorkloadStep[],
    thresholds: ResolvedThresholds,
): readonly WorkloadRegressionFinding[] {
    const observedById = new Map<string, WorkloadStep>();
    for (const step of observed) {
        observedById.set(step.id, step);
    }
    const findings: WorkloadRegressionFinding[] = [];
    for (const base of baseline) {
        const obs = observedById.get(base.id);
        if (obs === undefined) {
            continue;
        }
        const latencyFinding = compareLatency(base, obs, thresholds.latency);
        if (latencyFinding !== undefined) {
            findings.push(latencyFinding);
        }
        const throughputFinding = compareThroughput(base, obs, thresholds.throughput);
        if (throughputFinding !== undefined) {
            findings.push(throughputFinding);
        }
        const errorFinding = compareErrorRate(base, obs, thresholds.errorRate);
        if (errorFinding !== undefined) {
            findings.push(errorFinding);
        }
        const planFinding = comparePlanHash(base, obs);
        if (planFinding !== undefined) {
            findings.push(planFinding);
        }
        const logicalReadsFinding = compareLogicalReads(base, obs, thresholds.logicalReads);
        if (logicalReadsFinding !== undefined) {
            findings.push(logicalReadsFinding);
        }
        const cpuFinding = compareCpu(base, obs, thresholds.cpu);
        if (cpuFinding !== undefined) {
            findings.push(cpuFinding);
        }
    }
    return findings;
}

function compareLatency(
    base: WorkloadStep,
    obs: WorkloadStep,
    threshold: number,
): WorkloadRegressionFinding | undefined {
    if (base.latencyMs === undefined || obs.latencyMs === undefined || base.latencyMs <= 0) {
        return undefined;
    }
    const ratio = (obs.latencyMs - base.latencyMs) / base.latencyMs;
    if (ratio <= threshold) {
        return undefined;
    }
    return {
        kind: "workload-playback",
        stepId: base.id,
        regression: "latency",
        delta: ratio,
        message: `Latency regression: ${formatPercent(ratio)} (baseline ${base.latencyMs} ms, observed ${obs.latencyMs} ms).`,
    };
}

function compareThroughput(
    base: WorkloadStep,
    obs: WorkloadStep,
    threshold: number,
): WorkloadRegressionFinding | undefined {
    if (
        base.throughputQps === undefined ||
        obs.throughputQps === undefined ||
        base.throughputQps <= 0
    ) {
        return undefined;
    }
    // Negative ratio = drop. We flag drops larger (in magnitude) than threshold.
    const ratio = (obs.throughputQps - base.throughputQps) / base.throughputQps;
    if (ratio >= -threshold) {
        return undefined;
    }
    return {
        kind: "workload-playback",
        stepId: base.id,
        regression: "throughput",
        delta: ratio,
        message: `Throughput regression: ${formatPercent(ratio)} (baseline ${base.throughputQps} qps, observed ${obs.throughputQps} qps).`,
    };
}

function compareErrorRate(
    base: WorkloadStep,
    obs: WorkloadStep,
    threshold: number,
): WorkloadRegressionFinding | undefined {
    if (base.errorRate === undefined || obs.errorRate === undefined) {
        return undefined;
    }
    const delta = obs.errorRate - base.errorRate;
    if (delta <= threshold) {
        return undefined;
    }
    return {
        kind: "workload-playback",
        stepId: base.id,
        regression: "error-rate",
        delta,
        message: `Error rate regression: +${formatPercent(delta)} (baseline ${formatPercent(base.errorRate)}, observed ${formatPercent(obs.errorRate)}).`,
    };
}

function comparePlanHash(
    base: WorkloadStep,
    obs: WorkloadStep,
): WorkloadRegressionFinding | undefined {
    if (base.planHash === undefined || obs.planHash === undefined) {
        return undefined;
    }
    if (base.planHash === obs.planHash) {
        return undefined;
    }
    return {
        kind: "workload-playback",
        stepId: base.id,
        regression: "plan-change",
        delta: 0,
        message: `Plan change: baseline ${base.planHash}, observed ${obs.planHash}.`,
    };
}

function compareLogicalReads(
    base: WorkloadStep,
    obs: WorkloadStep,
    threshold: number,
): WorkloadRegressionFinding | undefined {
    if (
        base.logicalReads === undefined ||
        obs.logicalReads === undefined ||
        base.logicalReads <= 0
    ) {
        return undefined;
    }
    const ratio = (obs.logicalReads - base.logicalReads) / base.logicalReads;
    if (ratio <= threshold) {
        return undefined;
    }
    return {
        kind: "workload-playback",
        stepId: base.id,
        regression: "logical-reads",
        delta: ratio,
        message: `Logical-reads regression: ${formatPercent(ratio)} (baseline ${base.logicalReads} pages, observed ${obs.logicalReads} pages).`,
    };
}

function compareCpu(
    base: WorkloadStep,
    obs: WorkloadStep,
    threshold: number,
): WorkloadRegressionFinding | undefined {
    if (base.cpuMs === undefined || obs.cpuMs === undefined || base.cpuMs <= 0) {
        return undefined;
    }
    const ratio = (obs.cpuMs - base.cpuMs) / base.cpuMs;
    if (ratio <= threshold) {
        return undefined;
    }
    return {
        kind: "workload-playback",
        stepId: base.id,
        regression: "cpu",
        delta: ratio,
        message: `CPU regression: ${formatPercent(ratio)} (baseline ${base.cpuMs.toFixed(1)} ms, observed ${obs.cpuMs.toFixed(1)} ms).`,
    };
}

function formatPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
}

// =============================================================================
// Result builders
// =============================================================================

function buildComparisonResult(
    findings: readonly WorkloadRegressionFinding[],
    observedSteps: readonly WorkloadObservedStep[],
    startedAtMs: number,
): ValidationResult {
    const payload: WorkloadPlaybackPayload = {
        validationType: ValidationType.WorkloadPlayback,
        findings,
        summary: {
            steps: observedSteps.length,
            regressions: findings.length,
        },
        observedSteps,
    };
    // Deterministic signals (logical reads, or a plan change that also cost
    // latency) fail the run; noisy signals (latency, CPU, throughput, a bare
    // plan change) are advisory and surface as a Warning. Only the signals that
    // reliably mean "this regressed" block the run.
    return {
        validationId: ValidationType.WorkloadPlayback,
        displayName: DISPLAY_NAME,
        status: decideStatus(findings),
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}

/**
 * Maps findings onto a status. No findings → `Passed`. A deterministic
 * regression — logical reads out of range, an error-rate increase, or a plan
 * change on a step that ALSO regressed on latency — → `Failed`. Otherwise the
 * findings are advisory (latency / CPU / throughput / a bare plan change) →
 * `Warning`.
 */
function decideStatus(findings: readonly WorkloadRegressionFinding[]): ValidationStatus {
    if (findings.length === 0) {
        return ValidationStatus.Passed;
    }
    const hasHardSignal = findings.some(
        (f) => f.regression === "logical-reads" || f.regression === "error-rate",
    );
    const latencyStepIds = new Set(
        findings.filter((f) => f.regression === "latency").map((f) => f.stepId),
    );
    const planChangeWithCost = findings.some(
        (f) => f.regression === "plan-change" && latencyStepIds.has(f.stepId),
    );
    return hasHardSignal || planChangeWithCost ? ValidationStatus.Failed : ValidationStatus.Warning;
}

/**
 * First run for an environment (or first run after a schema change with no
 * comparable predecessor): there is no baseline, so we record the freshly
 * measured steps as Passed. The next run uses these as its baseline.
 */
function buildFirstRunResult(
    observedSteps: readonly WorkloadObservedStep[],
    startedAtMs: number,
): ValidationResult {
    const payload: WorkloadPlaybackPayload = {
        validationType: ValidationType.WorkloadPlayback,
        findings: [],
        summary: { steps: observedSteps.length, regressions: 0 },
        observedSteps,
    };
    return {
        validationId: ValidationType.WorkloadPlayback,
        displayName: DISPLAY_NAME,
        status: ValidationStatus.Passed,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}

/** A workload query that threw while being measured fails the validator. */
function buildMeasurementErroredResult(err: unknown, startedAtMs: number): ValidationResult {
    const message = `Workload measurement failed: ${err instanceof Error ? err.message : String(err)}`;
    const finding: WorkloadRegressionFinding = {
        kind: "workload-playback",
        stepId: SYNTHETIC_STEP_ID_MEASUREMENT_FAILED,
        regression: "error-rate",
        delta: 0,
        message,
    };
    const payload: WorkloadPlaybackPayload = {
        validationType: ValidationType.WorkloadPlayback,
        findings: [finding],
        summary: { steps: 0, regressions: 1 },
    };
    return {
        validationId: ValidationType.WorkloadPlayback,
        displayName: DISPLAY_NAME,
        status: ValidationStatus.Errored,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}

function buildSkippedResult(
    syntheticStepId: string,
    message: string,
    startedAtMs: number,
): ValidationResult {
    const finding: WorkloadRegressionFinding = {
        kind: "workload-playback",
        stepId: syntheticStepId,
        regression: "plan-change",
        delta: 0,
        message,
    };
    const payload: WorkloadPlaybackPayload = {
        validationType: ValidationType.WorkloadPlayback,
        findings: [finding],
        summary: { steps: 0, regressions: 0 },
    };
    return {
        validationId: ValidationType.WorkloadPlayback,
        displayName: DISPLAY_NAME,
        status: ValidationStatus.Skipped,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}
