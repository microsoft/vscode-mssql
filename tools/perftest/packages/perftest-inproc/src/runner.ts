/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * In-process self-test runner. Drives the built-in scenarios through the
 * scenario engine inside the LIVE extension host, one rep at a time.
 *
 * Marker flow (single source of truth = the host's diagnostics stream):
 *   product perfMark ─┐
 *   engine emitMarker ─┼─▶ host diag.emit ─▶ diag sink tap ─▶ runner.deliverMarker ─▶ bus
 * so the runner's wait bus is a pure projection of the same stream the live
 * Debug Console renders. The runner never delivers to the bus directly.
 */

import {
    ConnectionProfileSpec,
    EngineContext,
    ScenarioCancelledError,
    runScenario,
} from "./scenarioEngine";
import { BusMarker, MarkerBus } from "./markerBus";
import { deriveMetrics, DerivedMetric } from "./metrics";
import { BuiltinScenario } from "./scenarios";

export interface RepResult {
    scenarioId: string;
    repId: number;
    warmup: boolean;
    status: "passed" | "failed" | "skipped";
    durationMs?: number;
    metrics: DerivedMetric[];
    failureReason?: string;
}

export interface ScenarioResult {
    scenarioId: string;
    title: string;
    skipped: boolean;
    reason?: string;
    passed: number;
    failed: number;
}

export interface SelfTestRunResult {
    runId: string;
    status: "passed" | "failed" | "invalid";
    scenarios: ScenarioResult[];
    reps: RepResult[];
}

export type SelfTestEvent =
    | { kind: "runStart"; runId: string; totalReps: number; scenarioCount: number }
    | { kind: "scenarioStart"; scenarioId: string; title: string; index: number; total: number }
    | { kind: "scenarioSkipped"; scenarioId: string; title: string; reason: string }
    | { kind: "repStart"; scenarioId: string; repId: number; warmup: boolean }
    | { kind: "repEnd"; result: RepResult; markers: BusMarker[] }
    | { kind: "scenarioEnd"; result: ScenarioResult }
    | { kind: "log"; message: string }
    | { kind: "runEnd"; result: SelfTestRunResult };

export interface SelfTestRunOptions {
    runId: string;
    scenarios: BuiltinScenario[];
    repetitions: number;
    warmupRepetitions: number;
    /** Named connection profiles (e.g. "default"); absent ⇒ SQL scenarios skip. */
    connectionProfiles?: Record<string, ConnectionProfileSpec>;
    applicationNamePrefix?: string;
    /** Engine-emitted markers (scenario.start/end, driver.*, iteration.*). The
     *  host forwards these to diag so they appear in live views AND route back
     *  through the tap into this runner's bus. */
    onEngineMarker: (marker: BusMarker) => void;
    /** Progress + result stream for the UI and logs. */
    onEvent?: (event: SelfTestEvent) => void;
}

function nowUnixNs(): string {
    return (BigInt(Date.now()) * 1_000_000n).toString();
}

export class SelfTestRunner {
    private readonly bus = new MarkerBus();
    private cancelled = false;

    constructor(private readonly options: SelfTestRunOptions) {}

    /** The host pumps every diagnostics event (translated) in here. */
    deliverMarker(marker: BusMarker): void {
        this.bus.deliver(marker);
    }

    cancel(): void {
        this.cancelled = true;
    }

    private emit(event: SelfTestEvent): void {
        try {
            this.options.onEvent?.(event);
        } catch {
            // never let a UI callback break the run
        }
    }

    async run(): Promise<SelfTestRunResult> {
        const { options } = this;
        const totalRepsPerScenario = options.warmupRepetitions + options.repetitions;
        const runnable = options.scenarios;
        this.emit({
            kind: "runStart",
            runId: options.runId,
            scenarioCount: runnable.length,
            totalReps: runnable.length * totalRepsPerScenario,
        });

        const scenarioResults: ScenarioResult[] = [];
        const allReps: RepResult[] = [];

        for (let s = 0; s < runnable.length; s++) {
            if (this.cancelled) break;
            const scenario = runnable[s]!;
            const hasConnection = !!options.connectionProfiles?.["default"];
            const skipReason =
                scenario.inProcess === false
                    ? (scenario.skipReason ??
                      "cannot run inside a live extension host — use the CLI harness")
                    : scenario.needsSql && !hasConnection
                      ? "needs a SQL connection — pick a connection in the run dialog first"
                      : undefined;
            if (skipReason !== undefined) {
                this.emit({
                    kind: "scenarioSkipped",
                    scenarioId: scenario.id,
                    title: scenario.title,
                    reason: skipReason,
                });
                const result: ScenarioResult = {
                    scenarioId: scenario.id,
                    title: scenario.title,
                    skipped: true,
                    reason: skipReason,
                    passed: 0,
                    failed: 0,
                };
                scenarioResults.push(result);
                this.emit({ kind: "scenarioEnd", result });
                continue;
            }

            this.emit({
                kind: "scenarioStart",
                scenarioId: scenario.id,
                title: scenario.title,
                index: s,
                total: runnable.length,
            });

            let passed = 0;
            let failed = 0;
            for (let repId = 0; repId < totalRepsPerScenario; repId++) {
                if (this.cancelled) break;
                const warmup = repId < options.warmupRepetitions;
                this.emit({ kind: "repStart", scenarioId: scenario.id, repId, warmup });

                const startLen = this.bus.all().length;
                const startedMs = Date.now();
                const errors: string[] = [];
                const ctx: EngineContext = {
                    bus: this.bus,
                    errors,
                    log: (message) =>
                        this.emit({ kind: "log", message: `[${scenario.id}] ${message}` }),
                    emitMarker: (name, phase, attrs) => {
                        const marker: BusMarker = {
                            name,
                            phase,
                            timestampUnixNs: nowUnixNs(),
                            monotonicNs: process.hrtime.bigint().toString(),
                            process: { role: "extensionHost", pid: process.pid, name: "selftest" },
                            ...(attrs ? { attrs } : {}),
                        };
                        // Route to the host (→ diag → live views → tap → bus).
                        this.options.onEngineMarker(marker);
                    },
                    applicationName: `${options.applicationNamePrefix ?? "vscode-mssql-selftest"}/${options.runId}/${scenario.id}/${repId}`,
                    isCancelled: () => this.cancelled,
                    ...(options.connectionProfiles
                        ? { connectionProfiles: options.connectionProfiles }
                        : {}),
                };

                let failureReason: string | undefined;
                try {
                    const outcome = await runScenario(scenario.spec, ctx);
                    if (outcome.failure) {
                        failureReason = outcome.failure.reason;
                    }
                } catch (error) {
                    failureReason =
                        error instanceof ScenarioCancelledError
                            ? "cancelled"
                            : error instanceof Error
                              ? error.message
                              : String(error);
                }

                const repMarkers = this.bus.all().slice(startLen);
                const metrics = deriveMetrics(repMarkers, scenario.metrics);
                const status: RepResult["status"] =
                    failureReason === "cancelled" ? "skipped" : failureReason ? "failed" : "passed";
                if (status === "passed") passed++;
                else if (status === "failed") failed++;

                const result: RepResult = {
                    scenarioId: scenario.id,
                    repId,
                    warmup,
                    status,
                    durationMs: Date.now() - startedMs,
                    metrics,
                    ...(failureReason ? { failureReason } : {}),
                };
                allReps.push(result);
                this.emit({ kind: "repEnd", result, markers: repMarkers });

                // Fail fast: when the FIRST rep fails, later reps almost always
                // hit the identical wall — record the failure once and move to
                // the next scenario instead of burning minutes per rep.
                if (repId === 0 && status === "failed") {
                    this.emit({
                        kind: "log",
                        message: `[${scenario.id}] first rep failed — skipping the remaining ${totalRepsPerScenario - 1} rep(s) of this scenario (same outcome expected)`,
                    });
                    break;
                }
            }

            const result: ScenarioResult = {
                scenarioId: scenario.id,
                title: scenario.title,
                skipped: false,
                passed,
                failed,
            };
            scenarioResults.push(result);
            this.emit({ kind: "scenarioEnd", result });
        }

        const anyRan = allReps.some((r) => r.status !== "skipped");
        const anyFailed = allReps.some((r) => r.status === "failed");
        const status: SelfTestRunResult["status"] = !anyRan
            ? "invalid"
            : anyFailed
              ? "failed"
              : "passed";
        const runResult: SelfTestRunResult = {
            runId: options.runId,
            status,
            scenarios: scenarioResults,
            reps: allReps,
        };
        this.emit({ kind: "runEnd", result: runResult });
        return runResult;
    }
}
