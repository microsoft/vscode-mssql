/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `WorkloadPlaybackValidator`.
 *
 * Loads a captured workload via the injected `ArtifactProvider`, replays it
 * via the injected `ProcessProvider`, parses observed per-step metrics from
 * the replay tool's stdout, then compares them to a baseline (also loaded
 * via `ArtifactProvider`) and emits one finding per significant regression.
 *
 * The shape of both the workload artifact and the baseline artifact is a
 * permissive JSON object with a `steps` array; per step we read the metric
 * fields the comparator needs and ignore the rest. Forward-compat is
 * deliberately built into the parser so future capture formats (Query Store
 * extracts, Distributed Replay capture files) only need to project into the
 * `WorkloadStep` shape — the validator itself does not need to understand
 * the source-of-truth.
 *
 * Source-of-truth gating mirrors `UnitTestsValidator`: replay needs a live
 * target, so non-`Container` envs are `Skipped` with a directing finding. A
 * missing `workloadUri` or `baselineUri` in `WorkloadPlaybackSettings` is
 * also `Skipped` (with config-pointing findings) — the env was declared
 * intent-wise but isn't yet wired up.
 *
 * Outcome mapping:
 *   * Source-of-truth not Container → `Skipped` with a config finding.
 *   * `workloadUri` or `baselineUri` missing in settings → `Skipped` with
 *     a config finding naming the missing field.
 *   * Workload or baseline artifact missing on disk
 *     (`ArtifactNotFoundError`) → `Skipped` with a finding directing the
 *     user to populate the artifact.
 *   * Replay tool exits non-zero → `Failed` with a synthesized regression
 *     finding carrying a stderr excerpt.
 *   * Replay tool exits zero → parse stdout JSON, compare to baseline,
 *     emit one regression finding per matched step that exceeded its
 *     threshold. Status is `Passed` if zero regressions, `Failed`
 *     otherwise.
 *   * `CancellationError` (entry / artifact-read / spawn / post-spawn) →
 *     re-thrown so the runner reconciles `"user"` vs `"timeout"`.
 *   * Spawn-time `Error` (binary not found, OS refused) → re-thrown so the
 *     runner classifies as `Errored`.
 *
 * Threshold defaults are deliberately conservative (25 % latency / 25 %
 * throughput / 5pp error-rate) so first-time users see the validator behave
 * sanely without any tuning. `WorkloadPlaybackSettings` overrides each
 * threshold individually.
 */

import { type Environment, SourceOfTruthKind, ValidationType } from "../../environments/types";
import {
    type ValidationResult,
    ValidationStatus,
    type WorkloadPlaybackPayload,
    type WorkloadRegressionFinding,
} from "../../runs/types";
import { ArtifactNotFoundError, type ArtifactProvider } from "../providers/artifactProvider";
import { type ProcessProvider, type ProcessResult } from "../providers/processProvider";
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

/** Replay tool command name when settings don't override. The service layer
 * may resolve an absolute path before commit 6 wires production. */
const DEFAULT_REPLAY_COMMAND = "sql-workload-replay";

/** Latency regression flagged when observed exceeds baseline by this fraction. */
const DEFAULT_LATENCY_THRESHOLD = 0.25;
/** Throughput regression flagged when observed drops below baseline by this fraction. */
const DEFAULT_THROUGHPUT_THRESHOLD = 0.25;
/** Error-rate regression flagged when (observed − baseline) exceeds this absolute delta. */
const DEFAULT_ERROR_RATE_THRESHOLD = 0.05;

/** Bytes of stderr surfaced in a synthesized regression finding when the
 * replay tool exits non-zero with no parseable observations. */
const STDERR_EXCERPT_BYTES = 1024;

const SKIPPED_NEEDS_CONTAINER_MESSAGE =
    "Workload playback requires a Container source of truth (a live target to replay against).";
const SKIPPED_MISSING_WORKLOAD_URI_MESSAGE =
    "WorkloadPlaybackSettings.workloadUri is not configured.";
const SKIPPED_MISSING_BASELINE_URI_MESSAGE =
    "WorkloadPlaybackSettings.baselineUri is not configured.";

const SYNTHETIC_STEP_ID_REPLAY_FAILED = "__replay_failed__";
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

    public constructor(
        private readonly _artifacts: ArtifactProvider,
        private readonly _processes: ProcessProvider,
    ) {}

    public async run(
        env: Environment,
        config: SettingsFor<ValidationType.WorkloadPlayback>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();
        throwIfCancelled(opts.signal);

        if (env.sourceOfTruth.kind !== SourceOfTruthKind.Container) {
            return buildSkippedResult(
                SYNTHETIC_STEP_ID_NOT_CONFIGURED,
                SKIPPED_NEEDS_CONTAINER_MESSAGE,
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

        const baselineUri = config.baselineUri;
        if (baselineUri === undefined || baselineUri.length === 0) {
            return buildSkippedResult(
                SYNTHETIC_STEP_ID_NOT_CONFIGURED,
                SKIPPED_MISSING_BASELINE_URI_MESSAGE,
                startedAtMs,
            );
        }

        let workloadBuf: Buffer;
        let baselineBuf: Buffer;
        try {
            workloadBuf = await this._artifacts.read(workloadUri);
        } catch (err) {
            if (err instanceof ArtifactNotFoundError) {
                return buildSkippedResult(
                    SYNTHETIC_STEP_ID_ARTIFACT_MISSING,
                    `Captured workload artifact not found at ${err.uri}.`,
                    startedAtMs,
                );
            }
            throw err;
        }
        throwIfCancelled(opts.signal);

        try {
            baselineBuf = await this._artifacts.read(baselineUri);
        } catch (err) {
            if (err instanceof ArtifactNotFoundError) {
                return buildSkippedResult(
                    SYNTHETIC_STEP_ID_ARTIFACT_MISSING,
                    `Baseline artifact not found at ${err.uri}.`,
                    startedAtMs,
                );
            }
            throw err;
        }
        throwIfCancelled(opts.signal);

        // Parse the baseline now so a malformed baseline file fails the run
        // before we burn time on a replay we can't interpret. Workload bytes
        // are forwarded to the replay tool verbatim via stdin so we don't
        // parse them here.
        const baselineSteps = parseSteps(baselineBuf, "baseline");
        const command = config.replayCommand ?? DEFAULT_REPLAY_COMMAND;

        let result: ProcessResult;
        try {
            result = await this._processes.spawn(command, [], {
                signal: opts.signal,
                stdin: workloadBuf.toString("utf-8"),
            });
        } catch (err) {
            if (err instanceof CancellationError) {
                throw err;
            }
            if (opts.signal.aborted) {
                throw new CancellationError("user");
            }
            throw err;
        }
        throwIfCancelled(opts.signal);

        if (result.aborted) {
            throw new CancellationError("user");
        }

        if (result.exitCode !== 0) {
            return buildFailedReplayResult(result, startedAtMs);
        }

        const observedSteps = parseSteps(Buffer.from(result.stdout, "utf-8"), "replay output");
        const thresholds = resolveThresholds(config);
        const findings = compareSteps(baselineSteps, observedSteps, thresholds);

        return buildComparisonResult(findings, baselineSteps.length, startedAtMs);
    }
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Decodes a `{ steps: [...] }` JSON document into our internal `WorkloadStep`
 * shape. Unknown step fields are dropped; missing metric fields are left
 * `undefined` so the comparator skips them rather than synthesizing zero.
 *
 * Throws a plain `Error` on JSON-parse failure or top-level shape mismatch
 * (validators bubble these as `Errored` via the runner).
 */
function parseSteps(buf: Buffer, label: string): readonly WorkloadStep[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(buf.toString("utf-8"));
    } catch (err) {
        throw new Error(
            `Failed to parse ${label} JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("steps" in parsed) ||
        !Array.isArray((parsed as { steps: unknown }).steps)
    ) {
        throw new Error(`${label} document is missing the required "steps" array.`);
    }
    const out: WorkloadStep[] = [];
    for (const raw of (parsed as { steps: unknown[] }).steps) {
        if (typeof raw !== "object" || raw === null) {
            continue;
        }
        const obj = raw as Record<string, unknown>;
        if (typeof obj.id !== "string" || obj.id.length === 0) {
            continue;
        }
        out.push({
            id: obj.id,
            latencyMs: numberOrUndefined(obj.latencyMs),
            throughputQps: numberOrUndefined(obj.throughputQps),
            errorRate: numberOrUndefined(obj.errorRate),
            planHash: typeof obj.planHash === "string" ? obj.planHash : undefined,
        });
    }
    return out;
}

function numberOrUndefined(v: unknown): number | undefined {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
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
    baselineStepCount: number,
    startedAtMs: number,
): ValidationResult {
    const payload: WorkloadPlaybackPayload = {
        validationType: ValidationType.WorkloadPlayback,
        findings,
        summary: {
            steps: baselineStepCount,
            regressions: findings.length,
        },
    };
    return {
        validationId: ValidationType.WorkloadPlayback,
        displayName: DISPLAY_NAME,
        status: findings.length === 0 ? ValidationStatus.Passed : ValidationStatus.Failed,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}

function buildFailedReplayResult(result: ProcessResult, startedAtMs: number): ValidationResult {
    const excerpt = (result.stderr || result.stdout).slice(0, STDERR_EXCERPT_BYTES).trim();
    const message =
        excerpt.length > 0
            ? `Replay tool exited with code ${result.exitCode}: ${excerpt}`
            : `Replay tool exited with code ${result.exitCode} (no diagnostics on stderr).`;
    const finding: WorkloadRegressionFinding = {
        kind: "workload-playback",
        stepId: SYNTHETIC_STEP_ID_REPLAY_FAILED,
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
        status: ValidationStatus.Failed,
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
