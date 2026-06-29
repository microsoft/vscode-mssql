/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `WorkloadPlaybackValidator`.
 *
 * Loads a workload spec via the injected `ArtifactProvider`, then measures
 * each step IN-PROCESS by timing its query against the per-run ephemeral
 * database the runner provisioned. Each step is run
 * a few times and the median latency is recorded. The fresh measurements are
 * compared to a RUN-BASED baseline: the measured steps of the
 * most-recent earlier run of this environment whose schema differed, injected
 * by the runner via `opts.workloadBaseline`. One finding is emitted per step
 * whose latency regressed beyond its threshold.
 *
 * The workload spec is a permissive JSON object `{ steps: [{ id, query,
 * iterations? }] }`; steps missing an `id` or `query` are dropped so a partial
 * spec measures what it can rather than failing the run.
 *
 * A performance regression is surfaced as a `Warning`, NOT a `Failed`: perf
 * cost is a judgment call — a dev may knowingly add an expensive feature — so
 * the validator reports the delta without blocking the run.
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
 *   * Baseline present, one or more steps regressed → `Warning` with one
 *     finding per regressed step.
 *   * A workload query throws while being measured → `Errored`.
 *   * `CancellationError` (entry / artifact-read / measurement) → re-thrown
 *     so the runner reconciles `"user"` vs `"timeout"`.
 *   * Malformed spec JSON → re-thrown so the runner classifies as `Errored`.
 *
 * Threshold defaults are deliberately conservative (25 % latency / 25 %
 * throughput / 5pp error-rate) so first-time users see the validator behave
 * sanely without any tuning. `WorkloadPlaybackSettings` overrides each
 * threshold individually.
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
}

interface ResolvedThresholds {
    readonly latency: number;
    readonly throughput: number;
    readonly errorRate: number;
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
            for (const step of spec) {
                throwIfCancelled(opts.signal);
                const latencyMs = await measureStep(connection, step, opts.signal);
                observed.push({ id: step.id, latencyMs });
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

/**
 * Times `step.query` against `connection` `iterations` times and returns the
 * median elapsed milliseconds. The median (not mean) shrugs off the occasional
 * slow outlier (GC pause, cache miss) so the figure is stable run-to-run.
 */
async function measureStep(
    connection: ConnectionHandle,
    step: WorkloadSpecStep,
    signal: AbortSignal,
): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < step.iterations; i++) {
        throwIfCancelled(signal);
        const started = Date.now();
        await connection.execute(step.query, signal);
        samples.push(Date.now() - started);
    }
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    return samples.length % 2 === 0 ? (samples[mid - 1] + samples[mid]) / 2 : samples[mid];
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
    }));
}

/** Lifts persisted baseline steps back into the internal comparison shape. */
function toWorkloadSteps(steps: readonly WorkloadObservedStep[]): WorkloadStep[] {
    return steps.map((s) => ({
        id: s.id,
        latencyMs: s.latencyMs,
        throughputQps: s.throughputQps,
        errorRate: s.errorRate,
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
    // A performance regression is a *signal*, not a
    // hard failure. Perf cost is a judgment call — a dev may knowingly add an
    // expensive feature — so we surface the delta as a Warning rather than
    // blocking the run with a Failed.
    return {
        validationId: ValidationType.WorkloadPlayback,
        displayName: DISPLAY_NAME,
        status: findings.length === 0 ? ValidationStatus.Passed : ValidationStatus.Warning,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
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
