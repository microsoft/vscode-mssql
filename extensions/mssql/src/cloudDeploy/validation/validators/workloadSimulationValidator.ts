/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — workload-simulation validator.
 *
 * Replays a workload `.sql` concurrently against the per-run ephemeral database
 * using the sqlsimtools engine (sqlpysim) and flags throughput / latency
 * regressions versus the run-based baseline. It wraps the engine (see
 * `workloadSimulationEngine.ts`); it does not reimplement load generation.
 *
 * The engine measures the whole workload in aggregate, so this validator emits a
 * single observed "workload" step carrying throughput and average latency. Those
 * are timing-tier signals (noisy, machine-dependent), so every regression is
 * advisory: the gate warns, it never fails.
 *
 * Skips (not failures) when: no ephemeral database was provisioned, the engine
 * was not configured by the host, the workload file is missing, or the run has
 * no differing-schema baseline yet (first run records its measurements).
 */

import { existsSync } from "fs";
import * as path from "path";

import { type Environment, ValidationType } from "../../environments/types";
import {
    type ValidationResult,
    ValidationStatus,
    type WorkloadObservedChange,
    type WorkloadObservedStep,
    type WorkloadRegressionFinding,
    type WorkloadSimulationPayload,
} from "../../runs/types";
import { type ProcessProvider } from "../providers/processProvider";
import {
    type WorkloadSimulationEngineLocation,
    WorkloadSimulationEngineError,
    type WorkloadSimulationMetrics,
    measureWorkloadSimulation,
} from "../providers/workloadSimulationEngine";
import {
    CancellationError,
    type SettingsFor,
    throwIfCancelled,
    type Validator,
    type ValidatorRunOptions,
} from "../types";

const DISPLAY_NAME = "Workload Simulation";
const OBSERVED_STEP_ID = "workload";

const DEFAULT_THREADS = 8;
const DEFAULT_ITERATIONS = 100;
const DEFAULT_RUNS = 3;
const DEFAULT_THROUGHPUT_THRESHOLD = 0.25;
const DEFAULT_LATENCY_THRESHOLD = 0.25;

const SKIPPED_NEEDS_DATABASE =
    "Workload simulation needs a provisioned validation database; none was available for this run.";
const SKIPPED_ENGINE_NOT_CONFIGURED =
    "Workload simulation engine (sqlpysim) is not configured for this host.";
const SKIPPED_MISSING_WORKLOAD_URI = "WorkloadSimulationSettings.workloadUri is not configured.";
const skippedWorkloadFileMissing = (p: string): string => `Workload file not found at ${p}.`;

/**
 * Workload-simulation validator. Constructor takes the process spawner, the
 * host-injected engine location (absent means the gate skips), and the
 * workspace root used to resolve a relative `workloadUri`.
 */
export class WorkloadSimulationValidator implements Validator<ValidationType.WorkloadSimulation> {
    public readonly type = ValidationType.WorkloadSimulation;

    public constructor(
        private readonly _processes: ProcessProvider,
        private readonly _engine?: WorkloadSimulationEngineLocation,
        private readonly _workspaceRoot?: string,
    ) {}

    public async run(
        _env: Environment,
        config: SettingsFor<ValidationType.WorkloadSimulation>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();
        throwIfCancelled(opts.signal);

        const connectionString = opts.ephemeralConnectionString;
        if (connectionString === undefined || connectionString.length === 0) {
            return build(
                ValidationStatus.Skipped,
                [],
                [],
                undefined,
                startedAtMs,
                SKIPPED_NEEDS_DATABASE,
            );
        }
        if (this._engine === undefined) {
            return build(
                ValidationStatus.Skipped,
                [],
                [],
                undefined,
                startedAtMs,
                SKIPPED_ENGINE_NOT_CONFIGURED,
            );
        }
        const workloadUri = config.workloadUri;
        if (workloadUri === undefined || workloadUri.length === 0) {
            return build(
                ValidationStatus.Skipped,
                [],
                [],
                undefined,
                startedAtMs,
                SKIPPED_MISSING_WORKLOAD_URI,
            );
        }
        const workloadPath = path.isAbsolute(workloadUri)
            ? workloadUri
            : path.resolve(this._workspaceRoot ?? process.cwd(), workloadUri);
        if (!existsSync(workloadPath)) {
            return build(
                ValidationStatus.Skipped,
                [],
                [],
                undefined,
                startedAtMs,
                skippedWorkloadFileMissing(workloadPath),
            );
        }

        let metrics: WorkloadSimulationMetrics;
        try {
            metrics = await measureWorkloadSimulation(
                this._engine,
                this._processes,
                {
                    connectionString,
                    workloadPath,
                    threads: config.threads ?? DEFAULT_THREADS,
                    iterations: config.iterations ?? DEFAULT_ITERATIONS,
                    runs: config.runs ?? DEFAULT_RUNS,
                },
                opts.signal,
            );
        } catch (err) {
            if (err instanceof CancellationError) {
                throw err;
            }
            if (opts.signal.aborted) {
                throw new CancellationError("user");
            }
            const message =
                err instanceof WorkloadSimulationEngineError
                    ? err.message
                    : `Workload simulation failed: ${err instanceof Error ? err.message : String(err)}`;
            return build(ValidationStatus.Errored, [], [], undefined, startedAtMs, message);
        }

        const observed: WorkloadObservedStep = {
            id: OBSERVED_STEP_ID,
            latencyMs: metrics.avgLatencyMs,
            throughputQps: metrics.throughputPerSec,
        };

        const baseline = opts.workloadBaseline?.find((s) => s.id === OBSERVED_STEP_ID);
        const thresholds = {
            throughput: config.throughputRegressionThreshold ?? DEFAULT_THROUGHPUT_THRESHOLD,
            latency: config.latencyRegressionThreshold ?? DEFAULT_LATENCY_THRESHOLD,
        };
        const findings = baseline !== undefined ? compare(baseline, observed, thresholds) : [];
        const changes = describeChanges(baseline, observed, thresholds);
        return build(
            findings.length === 0 ? ValidationStatus.Passed : ValidationStatus.Warning,
            findings,
            changes,
            observed,
            startedAtMs,
        );
    }
}

// =============================================================================
// Comparison
// =============================================================================

interface SimulationThresholds {
    readonly throughput: number;
    readonly latency: number;
}

/** Advisory regressions: latency rising or throughput dropping past threshold. */
function compare(
    base: WorkloadObservedStep,
    obs: WorkloadObservedStep,
    thresholds: SimulationThresholds,
): readonly WorkloadRegressionFinding[] {
    const findings: WorkloadRegressionFinding[] = [];
    if (base.latencyMs !== undefined && obs.latencyMs !== undefined && base.latencyMs > 0) {
        const ratio = (obs.latencyMs - base.latencyMs) / base.latencyMs;
        if (ratio > thresholds.latency) {
            findings.push({
                kind: "workload-playback",
                stepId: OBSERVED_STEP_ID,
                regression: "latency",
                delta: ratio,
                message: `Latency regression: +${pct(ratio)} (baseline ${base.latencyMs.toFixed(2)} ms, observed ${obs.latencyMs.toFixed(2)} ms).`,
            });
        }
    }
    if (
        base.throughputQps !== undefined &&
        obs.throughputQps !== undefined &&
        base.throughputQps > 0
    ) {
        const drop = (base.throughputQps - obs.throughputQps) / base.throughputQps;
        if (drop > thresholds.throughput) {
            findings.push({
                kind: "workload-playback",
                stepId: OBSERVED_STEP_ID,
                regression: "throughput",
                delta: drop,
                message: `Throughput regression: -${pct(drop)} (baseline ${base.throughputQps.toFixed(0)}/s, observed ${obs.throughputQps.toFixed(0)}/s).`,
            });
        }
    }
    return findings;
}

/**
 * The observed-changes view. Always surfaces both aggregate axes so every run
 * shows the throughput and latency it measured. When a baseline exists each axis
 * carries the delta versus it and is tagged warning when it regressed past the
 * threshold; without a baseline the absolute measurement is shown as an
 * informational row and recorded for the next run to compare against.
 */
function describeChanges(
    base: WorkloadObservedStep | undefined,
    obs: WorkloadObservedStep,
    thresholds: SimulationThresholds,
): readonly WorkloadObservedChange[] {
    const changes: WorkloadObservedChange[] = [];
    if (obs.throughputQps !== undefined) {
        const baseQps = base?.throughputQps;
        if (baseQps !== undefined && baseQps > 0) {
            const ratio = (obs.throughputQps - baseQps) / baseQps;
            changes.push({
                stepId: OBSERVED_STEP_ID,
                axis: "throughput",
                severity: -ratio > thresholds.throughput ? "warning" : "pass",
                delta: ratio,
                message: `Throughput ${sign(ratio)}${pct(ratio)} (${baseQps.toFixed(0)} -> ${obs.throughputQps.toFixed(0)}/s).`,
            });
        } else {
            changes.push({
                stepId: OBSERVED_STEP_ID,
                axis: "throughput",
                severity: "pass",
                delta: 0,
                message: `Throughput ${obs.throughputQps.toFixed(0)}/s measured (no baseline yet).`,
            });
        }
    }
    if (obs.latencyMs !== undefined) {
        const baseMs = base?.latencyMs;
        if (baseMs !== undefined && baseMs > 0) {
            const ratio = (obs.latencyMs - baseMs) / baseMs;
            changes.push({
                stepId: OBSERVED_STEP_ID,
                axis: "latency",
                severity: ratio > thresholds.latency ? "warning" : "pass",
                delta: ratio,
                message: `Latency ${sign(ratio)}${pct(ratio)} (${baseMs.toFixed(2)} -> ${obs.latencyMs.toFixed(2)} ms).`,
            });
        } else {
            changes.push({
                stepId: OBSERVED_STEP_ID,
                axis: "latency",
                severity: "pass",
                delta: 0,
                message: `Avg latency ${obs.latencyMs.toFixed(2)} ms measured (no baseline yet).`,
            });
        }
    }
    return changes;
}

function pct(ratio: number): string {
    return `${(Math.abs(ratio) * 100).toFixed(1)}%`;
}

function sign(ratio: number): string {
    return ratio >= 0 ? "+" : "-";
}

// =============================================================================
// Result builder
// =============================================================================

function build(
    status: ValidationStatus,
    findings: readonly WorkloadRegressionFinding[],
    changes: readonly WorkloadObservedChange[],
    observed: WorkloadObservedStep | undefined,
    startedAtMs: number,
    errorMessage?: string,
): ValidationResult {
    const payload: WorkloadSimulationPayload = {
        validationType: ValidationType.WorkloadSimulation,
        findings,
        summary: {
            steps: observed !== undefined ? 1 : 0,
            regressions: findings.length,
        },
        ...(observed !== undefined ? { observedSteps: [observed] } : {}),
        ...(changes.length > 0 ? { changes } : {}),
    };
    return {
        validationId: ValidationType.WorkloadSimulation,
        displayName: DISPLAY_NAME,
        status,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
    };
}
