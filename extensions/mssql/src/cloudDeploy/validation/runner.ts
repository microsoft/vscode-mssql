/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — validation runner.
 *
 * Takes an `Environment`, dispatches each declared (and enabled) validation
 * through the `ValidatorRegistry`, aggregates the results into a canonical
 * `RunRecord`, and emits run-lifecycle events on the diagnostic bus along
 * the way. Returns the produced `RunRecord` to the caller.
 *
 * Design properties:
 *   - **Sequential dispatch.** Order: connectivity first (when declared),
 *     then the rest in declaration order. Keeps cancellation, status
 *     rollup, and bus-event interleaving trivial. A future `parallel`
 *     option can be added additively if perf data justifies it.
 *   - **Connectivity gates the rest.** If a connectivity validation fails
 *     (Failed / Errored / Cancelled), remaining non-connectivity
 *     validations short-circuit to `Skipped` with a deterministic
 *     `connectivity` finding. The runner emits a `validation-started` and
 *     `validation-finished` for each skipped arm so subscribers see a
 *     complete lifecycle.
 *   - **Cancellation is a status, not a string.** `CancellationError`
 *     thrown by a validator becomes a `ValidationStatus.Cancelled` result
 *     carrying `cancellationReason`. Cancellation also cascades to all
 *     remaining validations.
 *   - **Bus is best-effort.** When `bus` is undefined the runner still
 *     produces the correct `RunRecord` \u2014 the bus is the announcement
 *     channel, not the contract.
 *   - **No persistence.** The runner does not call the run-artifact writer.
 *     The service layer (commit 6) writes the returned `RunRecord` through
 *     D3's writer when the caller opts in.
 */

import { randomUUID } from "crypto";

import type { DiagnosticEventBus } from "../diagnostics";
import { Environment, ValidationConfig, ValidationType } from "../environments/types";
import {
    CancellationReason,
    RUN_STATUS_PRIORITY,
    RunRecord,
    RunStatus,
    RUN_RECORD_SCHEMA_VERSION,
    RunnerIdentity,
    ValidationPayload,
    ValidationResult,
    ValidationStatus,
} from "../runs/types";

import { CancellationError, ValidatorRegistry, ValidatorRunOptions } from "./types";

// =============================================================================
// Public API
// =============================================================================

/**
 * Per-call options for `Runner.run()`. All fields optional; sensible defaults
 * are applied when omitted (`runId` becomes a fresh UUID, `runner` becomes
 * a local-vscode identity, no timeout).
 */
export interface RunnerRunOptions {
    /** Caller-supplied cancellation. Merged with the timeout signal (if any). */
    readonly signal?: AbortSignal;
    /** Overall run timeout in ms. Triggers a `"timeout"`-flavored cancellation. */
    readonly timeoutMs?: number;
    /** Stable run identifier; defaults to a fresh UUID per call. */
    readonly runId?: string;
    /** Runner identity stamped on the `RunRecord`; defaults to a local-vscode marker. */
    readonly runner?: RunnerIdentity;
}

/**
 * Orchestrates a single validation run. Stateless across calls: each
 * `run()` constructs its own ids, signal, and aggregation state.
 *
 * Bus and providers are dependency-injected so tests substitute fakes
 * without monkey-patching imports.
 */
export class Runner {
    public constructor(
        private readonly _registry: ValidatorRegistry,
        private readonly _bus?: DiagnosticEventBus,
    ) {}

    public async run(env: Environment, opts: RunnerRunOptions = {}): Promise<RunRecord> {
        const runId = opts.runId ?? randomUUID();
        const runner = opts.runner ?? DEFAULT_RUNNER_IDENTITY;
        const startedAtMs = Date.now();

        const { signal, dispose: disposeSignal } = buildEffectiveSignal(
            opts.signal,
            opts.timeoutMs,
        );

        // Dispatch order: connectivity first (if enabled), then rest in declaration order.
        const dispatchOrder = orderForDispatch(env.validations);

        this._emitRunStarted(runId, env, dispatchOrder);

        const results: ValidationResult[] = [];
        let connectivityFailed = false;
        let cascadeCancellation: CancellationReason | undefined;

        try {
            for (const config of dispatchOrder) {
                if (!config.enabled) {
                    continue;
                }

                if (cascadeCancellation !== undefined) {
                    const cancelledResult = makeCancelledResult(
                        config,
                        Date.now(),
                        cascadeCancellation,
                    );
                    results.push(cancelledResult);
                    this._emitValidationStarted(runId, config.type);
                    this._emitValidationFinished(runId, cancelledResult);
                    continue;
                }

                if (signal.aborted) {
                    cascadeCancellation = currentCancellationReason(signal);
                    const cancelledResult = makeCancelledResult(
                        config,
                        Date.now(),
                        cascadeCancellation,
                    );
                    results.push(cancelledResult);
                    this._emitValidationStarted(runId, config.type);
                    this._emitValidationFinished(runId, cancelledResult);
                    continue;
                }

                if (connectivityFailed && config.type !== ValidationType.Connectivity) {
                    const skipped = makeGatedSkipResult(config, Date.now());
                    results.push(skipped);
                    this._emitValidationStarted(runId, config.type);
                    this._emitValidationFinished(runId, skipped);
                    continue;
                }

                const result = await this._dispatchOne(env, config, runId, signal);
                results.push(result);

                if (config.type === ValidationType.Connectivity && !isPass(result.status)) {
                    connectivityFailed = true;
                }

                if (result.status === ValidationStatus.Cancelled) {
                    cascadeCancellation = result.cancellationReason ?? "user";
                }
            }
        } finally {
            disposeSignal();
        }

        const endedAtMs = Date.now();
        const status = rollupRunStatus(results);

        const record: RunRecord = {
            schemaVersion: RUN_RECORD_SCHEMA_VERSION,
            runId,
            environmentId: env.id,
            environmentSnapshot: env,
            runner,
            startedAtMs,
            endedAtMs,
            status,
            validations: results,
        };

        this._emitRunFinished(record);

        return record;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private async _dispatchOne(
        env: Environment,
        config: ValidationConfig,
        runId: string,
        signal: AbortSignal,
    ): Promise<ValidationResult> {
        const validator = this._registry[config.type];
        const opts: ValidatorRunOptions = { runId, signal, bus: this._bus };
        const startedAtMs = Date.now();

        // Per-validator start/finish events are emitted by the validator itself
        // when a bus is wired. The runner only emits run-level events here so
        // we don't double-fire the per-validation arm.
        try {
            const result = await (validator as { run: typeof validator.run }).run(
                env,
                config.settings as never,
                opts,
            );
            return result;
        } catch (err) {
            const endedAtMs = Date.now();
            if (err instanceof CancellationError) {
                // The signal is the source of truth for the cancellation
                // reason: a validator that calls `throwIfCancelled(signal)`
                // can't tell `"user"` from `"timeout"` without inspecting the
                // sentinel, so the runner reconciles here.
                const reason = signal.aborted ? currentCancellationReason(signal) : err.reason;
                const cancelled = buildCancelledResultFromError(
                    config,
                    startedAtMs,
                    endedAtMs,
                    reason,
                );
                this._emitValidationStarted(runId, config.type);
                this._emitValidationFinished(runId, cancelled);
                return cancelled;
            }
            const errored = buildErroredResultFromException(config, startedAtMs, endedAtMs, err);
            this._emitValidationStarted(runId, config.type);
            this._emitValidationFinished(runId, errored);
            return errored;
        }
    }

    private _emitRunStarted(
        runId: string,
        env: Environment,
        dispatchOrder: readonly ValidationConfig[],
    ): void {
        this._bus?.emit({
            source: "runner",
            type: "validation-run-started",
            correlationId: runId,
            payload: {
                runId,
                environmentId: env.id,
                validationTypes: dispatchOrder.filter((c) => c.enabled).map((c) => c.type),
            },
        });
    }

    private _emitValidationStarted(runId: string, validationType: ValidationType): void {
        this._bus?.emit({
            source: "validation",
            type: "validation-started",
            correlationId: runId,
            payload: { runId, validationType },
        });
    }

    private _emitValidationFinished(runId: string, result: ValidationResult): void {
        this._bus?.emit({
            source: "validation",
            type: "validation-finished",
            severity: severityForStatus(result.status),
            correlationId: runId,
            payload: {
                runId,
                validationType: result.payload.validationType,
                status: result.status,
                findingsCount: result.payload.findings.length,
                durationMs: result.endedAtMs - result.startedAtMs,
                cancellationReason: result.cancellationReason,
            },
        });
    }

    private _emitRunFinished(record: RunRecord): void {
        this._bus?.emit({
            source: "runner",
            type: "validation-run-finished",
            severity: severityForStatus(record.status),
            correlationId: record.runId,
            payload: {
                runId: record.runId,
                status: record.status,
                durationMs: record.endedAtMs - record.startedAtMs,
                validationCount: record.validations.length,
            },
        });
    }
}

// =============================================================================
// Dispatch ordering
// =============================================================================

/**
 * Returns the dispatch order: connectivity first (if declared), then the
 * remaining configs in their original declaration order. Stable; does not
 * mutate the input.
 */
function orderForDispatch(configs: readonly ValidationConfig[]): readonly ValidationConfig[] {
    const connectivity = configs.filter((c) => c.type === ValidationType.Connectivity);
    const rest = configs.filter((c) => c.type !== ValidationType.Connectivity);
    return [...connectivity, ...rest];
}

// =============================================================================
// Status rollup
// =============================================================================

/**
 * Worst-case rollup: picks the result with the highest `RUN_STATUS_PRIORITY`
 * rank and uses its status as the run-level status. An empty results list
 * collapses to `Passed` (nothing ran, nothing failed).
 *
 * `ValidationStatus` and `RunStatus` share string values, so the lookup
 * via `RUN_STATUS_PRIORITY` is safe.
 */
function rollupRunStatus(results: readonly ValidationResult[]): RunStatus {
    if (results.length === 0) {
        return RunStatus.Passed;
    }
    let worst: RunStatus = RunStatus.Passed;
    let worstRank = RUN_STATUS_PRIORITY[worst];
    for (const r of results) {
        const asRun = r.status as unknown as RunStatus;
        const rank = RUN_STATUS_PRIORITY[asRun];
        if (rank > worstRank) {
            worst = asRun;
            worstRank = rank;
        }
    }
    return worst;
}

function isPass(status: ValidationStatus): boolean {
    return status === ValidationStatus.Passed;
}

// =============================================================================
// Severity mapping
// =============================================================================

/**
 * Maps a `RunStatus` / `ValidationStatus` to a `DiagnosticEventSeverity` so
 * subscribers can filter `validation-finished` and `validation-run-finished`
 * events at the bus level without inspecting payload.
 *
 *   Passed / Skipped / Cancelled -> info
 *   Warning                      -> warn
 *   Failed  / Errored            -> error
 */
function severityForStatus(status: RunStatus | ValidationStatus): "info" | "warn" | "error" {
    switch (status) {
        case ValidationStatus.Warning:
            return "warn";
        case ValidationStatus.Failed:
        case ValidationStatus.Errored:
            return "error";
        default:
            return "info";
    }
}

// =============================================================================
// Result builders (cancellation, gating, error capture)
// =============================================================================

const GATED_BY_CONNECTIVITY_MESSAGE = "Skipped because the connectivity validation did not pass.";

function makeCancelledResult(
    config: ValidationConfig,
    nowMs: number,
    reason: CancellationReason,
): ValidationResult {
    return {
        validationId: validationIdFor(config),
        displayName: displayNameFor(config.type),
        status: ValidationStatus.Cancelled,
        startedAtMs: nowMs,
        endedAtMs: nowMs,
        payload: emptyPayloadFor(config.type),
        cancellationReason: reason,
    };
}

function buildCancelledResultFromError(
    config: ValidationConfig,
    startedAtMs: number,
    endedAtMs: number,
    reason: CancellationReason,
): ValidationResult {
    return {
        validationId: validationIdFor(config),
        displayName: displayNameFor(config.type),
        status: ValidationStatus.Cancelled,
        startedAtMs,
        endedAtMs,
        payload: emptyPayloadFor(config.type),
        cancellationReason: reason,
    };
}

function buildErroredResultFromException(
    config: ValidationConfig,
    startedAtMs: number,
    endedAtMs: number,
    err: unknown,
): ValidationResult {
    return {
        validationId: validationIdFor(config),
        displayName: displayNameFor(config.type),
        status: ValidationStatus.Errored,
        startedAtMs,
        endedAtMs,
        payload: emptyPayloadFor(config.type),
        errorMessage: err instanceof Error ? err.message : String(err),
    };
}

function makeGatedSkipResult(config: ValidationConfig, nowMs: number): ValidationResult {
    // Skipped result with a single `connectivity` finding when the rest of
    // the run was gated. For non-connectivity arms the finding still lives
    // under the validation's own payload so the result shape is consistent.
    const payload = emptyPayloadFor(config.type);
    return {
        validationId: validationIdFor(config),
        displayName: displayNameFor(config.type),
        status: ValidationStatus.Skipped,
        startedAtMs: nowMs,
        endedAtMs: nowMs,
        payload,
        errorMessage: GATED_BY_CONNECTIVITY_MESSAGE,
    };
}

/**
 * Validation id, stable within a run. Derived from `ValidationType`'s string
 * value so consumers can locate the result by type without separately tracking
 * id assignment. If multiple validations of the same type are ever supported,
 * this is the place to change.
 */
function validationIdFor(config: ValidationConfig): string {
    return config.type;
}

function displayNameFor(type: ValidationType): string {
    switch (type) {
        case ValidationType.Connectivity:
            return "Connectivity";
        case ValidationType.StaticAnalysis:
            return "Static Analysis";
        case ValidationType.UnitTests:
            return "Unit Tests";
        case ValidationType.WorkloadPlayback:
            return "Workload Playback";
    }
}

function emptyPayloadFor(type: ValidationType): ValidationPayload {
    switch (type) {
        case ValidationType.Connectivity:
            return {
                validationType: ValidationType.Connectivity,
                findings: [],
                summary: { reachable: false },
            };
        case ValidationType.StaticAnalysis:
            return {
                validationType: ValidationType.StaticAnalysis,
                findings: [],
                summary: { info: 0, warning: 0, error: 0 },
            };
        case ValidationType.UnitTests:
            return {
                validationType: ValidationType.UnitTests,
                findings: [],
                summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 },
            };
        case ValidationType.WorkloadPlayback:
            return {
                validationType: ValidationType.WorkloadPlayback,
                findings: [],
                summary: { steps: 0, regressions: 0 },
            };
    }
}

// =============================================================================
// Signal composition (caller signal + timeout)
// =============================================================================

/**
 * Builds the *effective* `AbortSignal` the runner threads through every
 * validator: the caller-supplied signal (if any) combined with an internal
 * timeout signal (if `timeoutMs` is provided).
 *
 * Returns a `dispose` function to clear the timeout in the success path so
 * Node.js doesn't keep a stray timer alive after the run.
 *
 * The internal timeout controller tags itself with a sentinel reason
 * (`"runner-timeout"`) so we can tell timeout-aborts apart from
 * user-aborts when stamping `cancellationReason`.
 */
function buildEffectiveSignal(
    callerSignal: AbortSignal | undefined,
    timeoutMs: number | undefined,
): { signal: AbortSignal; dispose: () => void } {
    const controllers: AbortController[] = [];
    const sources: AbortSignal[] = [];

    if (callerSignal !== undefined) {
        sources.push(callerSignal);
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeoutMs !== undefined && timeoutMs > 0) {
        const timeoutCtrl = new AbortController();
        controllers.push(timeoutCtrl);
        sources.push(timeoutCtrl.signal);
        timeoutHandle = setTimeout(() => {
            timeoutCtrl.abort(RUNNER_TIMEOUT_REASON);
        }, timeoutMs);
    }

    if (sources.length === 0) {
        // No caller signal, no timeout. Return a fresh never-aborted controller.
        return { signal: new AbortController().signal, dispose: () => undefined };
    }

    const merged = anySignal(sources);
    return {
        signal: merged,
        dispose: () => {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
        },
    };
}

const RUNNER_TIMEOUT_REASON = Symbol("runner-timeout");

/**
 * Returns a single `AbortSignal` that aborts when any of `sources` aborts.
 * Forwards the abort reason from the first triggering source so callers can
 * distinguish timeout-vs-user via `currentCancellationReason`.
 *
 * `AbortSignal.any` is available in modern Node, but VS Code's minimum still
 * spans versions without it; a small polyfill keeps us compatible without a
 * runtime check at every call site.
 */
function anySignal(sources: readonly AbortSignal[]): AbortSignal {
    const ctrl = new AbortController();
    const onAbort = (src: AbortSignal) => {
        if (!ctrl.signal.aborted) {
            ctrl.abort((src as { reason?: unknown }).reason);
        }
    };
    for (const s of sources) {
        if (s.aborted) {
            onAbort(s);
            break;
        }
        s.addEventListener("abort", () => onAbort(s), { once: true });
    }
    return ctrl.signal;
}

/**
 * Maps an aborted signal's `reason` to a `CancellationReason`. The runner's
 * own timeout controller aborts with a sentinel `Symbol`; everything else
 * is treated as user-initiated cancellation.
 */
function currentCancellationReason(signal: AbortSignal): CancellationReason {
    const reason = (signal as { reason?: unknown }).reason;
    return reason === RUNNER_TIMEOUT_REASON ? "timeout" : "user";
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_RUNNER_IDENTITY: RunnerIdentity = Object.freeze({
    userId: "local",
    displayName: "Local",
    hostKind: "vscode",
});
