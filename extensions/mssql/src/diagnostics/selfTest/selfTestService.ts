/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Self-test service: runs perftest scenarios in-process against the LIVE
 * extension host and streams progress to the Debug Console.
 *
 * The scenario engine + runner come from @mssqlperf/inproc (imported relatively
 * from the sibling perftest repo's built output). This host wires the runner's
 * wait bus to the SAME diagnostics stream the Debug Console renders — so the
 * consolidated trace and waterfall light up in real time while scenarios run —
 * and persists results in the standard perf-run layout so the Perf & History
 * pages pick them up with no extra import step.
 *
 * Privacy: capture stays at the current mode unless the caller opts into
 * elevation for the run window (auto-reverts). Metrics are counts and durations
 * (diagnostic metadata, always plain); no SQL text or rows are persisted.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Relative import of the perftest in-process runner (built dist). The .d.ts is
// self-contained; esbuild bundles the .js with `vscode` left external.
import {
    BusMarker,
    BUILTIN_SCENARIOS,
    builtinScenario,
    ConnectionProfileSpec,
    SelfTestEvent,
    SelfTestRunner,
} from "../../../../../../perftest/packages/perftest-inproc/dist/index";

import {
    DiagEvent,
    DiagProcess,
    SelfTestCatalog,
    SelfTestProgress,
    SelfTestRunRequest,
    SelfTestRunStarted,
    SelfTestScenarioInfo,
} from "../../sharedInterfaces/debugConsole";
import { diag, RawField } from "../diagnosticsCore";

/** Marker-name prefix → console feature bucket (mirrors perfTelemetry). */
function featureFor(name: string): string {
    if (name.startsWith("mssql.connection") || name.startsWith("mssql.sts")) return "connection";
    if (name.startsWith("mssql.query")) return "query";
    if (name.startsWith("mssql.resultsGrid")) return "resultsGrid";
    if (name.startsWith("mssql.oe")) return "objectExplorer";
    if (name.startsWith("mssql.activate") || name.startsWith("mssql.extension")) return "system";
    if (name.startsWith("scenario") || name.startsWith("driver") || name.startsWith("iteration"))
        return "harness";
    return "system";
}

/** DiagProcess → harness marker role (inverse of perfRunImport.processFor). */
function roleForProcess(process: DiagProcess): string {
    switch (process) {
        case "extensionHost":
            return "extensionHost";
        case "webview":
        case "renderer":
            return "webview";
        case "sqlToolsService":
            return "sts";
        default:
            return "harness";
    }
}

function phaseFromTags(tags: string[] | undefined, kind: string): string {
    for (const tag of tags ?? []) {
        if (tag.startsWith("phase:")) return tag.slice("phase:".length);
    }
    return kind === "metric" ? "counter" : "instant";
}

interface ProgressSink {
    (progress: SelfTestProgress): void;
}

export class SelfTestService {
    private running = false;
    private runner: SelfTestRunner | undefined;
    private tapId: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly emitProgress: ProgressSink,
    ) {}

    // --- catalog ---------------------------------------------------------------

    public async catalog(): Promise<SelfTestCatalog> {
        const scenarios: SelfTestScenarioInfo[] = BUILTIN_SCENARIOS.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            tags: s.tags,
            needsSql: s.needsSql,
            estMs: s.estMs,
        }));
        const profile = await this.resolveDefaultProfile();
        return {
            scenarios,
            connectionAvailable: profile !== undefined,
            ...(profile ? { connectionLabel: profile.label } : {}),
            perfRunsRoot: this.effectivePerfRunsRoot(),
            running: this.running,
        };
    }

    // --- run -------------------------------------------------------------------

    public async run(request: SelfTestRunRequest): Promise<SelfTestRunStarted> {
        const profile = await this.resolveDefaultProfile();
        if (this.running) {
            return {
                accepted: false,
                runId: "",
                connectionAvailable: profile !== undefined,
                reason: "a self-test is already running",
            };
        }
        const scenarios = request.scenarioIds
            .map((id) => builtinScenario(id))
            .filter((s): s is NonNullable<typeof s> => s !== undefined);
        if (scenarios.length === 0) {
            return {
                accepted: false,
                runId: "",
                connectionAvailable: profile !== undefined,
                reason: "no known scenarios selected",
            };
        }

        const runId = makeRunId();
        this.running = true;

        // Opt-in capture elevation for the run window (auto-reverts). Keeps the
        // default privacy-first stance: off unless the caller asks.
        if (request.elevateCapture) {
            diag.setCaptureMode("full", {
                reason: `self-test ${runId}`,
                durationMs: 10 * 60_000,
            });
        }

        const runDir = path.join(this.effectivePerfRunsRoot(), runId);
        const connectionProfiles: Record<string, ConnectionProfileSpec> | undefined = profile
            ? { default: profile.spec }
            : undefined;

        const runner = new SelfTestRunner({
            runId,
            scenarios,
            repetitions: Math.max(1, Math.min(request.repetitions || 1, 25)),
            warmupRepetitions: Math.max(0, Math.min(request.warmupRepetitions || 0, 5)),
            ...(connectionProfiles ? { connectionProfiles } : {}),
            applicationNamePrefix: "vscode-mssql-selftest",
            onEngineMarker: (marker) => this.emitEngineMarker(marker),
            onEvent: (event) => this.handleEvent(event, runId, runDir),
        });
        this.runner = runner;

        // Tap the diagnostics stream: every event (product marks, engine marks,
        // RPC/STS/webview spans) becomes a bus marker the runner waits on.
        const tapId = `selftest:${runId}`;
        this.tapId = tapId;
        diag.addSink({
            id: tapId,
            tryWrite: (event) => {
                try {
                    runner.deliverMarker(this.toBusMarker(event));
                } catch {
                    // a tap failure must never break the product or the run
                }
            },
        });

        // Fire and forget: progress + persistence flow through onEvent; the RPC
        // returns immediately so the webview can render live.
        void this.execute(runner, runId, runDir).finally(() => {
            if (this.tapId) {
                diag.removeSink(this.tapId);
                this.tapId = undefined;
            }
            this.running = false;
            this.runner = undefined;
        });

        return { accepted: true, runId, connectionAvailable: profile !== undefined };
    }

    public cancel(): { cancelled: boolean } {
        if (this.runner) {
            this.runner.cancel();
            return { cancelled: true };
        }
        return { cancelled: false };
    }

    private async execute(runner: SelfTestRunner, runId: string, runDir: string): Promise<void> {
        try {
            fs.mkdirSync(runDir, { recursive: true });
            const result = await runner.run();
            const passed = result.reps.filter((r) => r.status === "passed").length;
            const failed = result.reps.filter((r) => r.status === "failed").length;
            const skipped = result.scenarios.filter((s) => s.skipped).length;
            // Run-level summary the Perf page reads.
            writeJson(path.join(runDir, "summary.json"), {
                status: result.status,
                passType: "selfTest",
                environmentHash: "selftest",
                runId,
            });
            this.emitProgress({
                runId,
                phase: "runEnd",
                runStatus: result.status,
                perfRunsRoot: this.effectivePerfRunsRoot(),
                passed,
                failed,
                skipped,
            });
            diag.emit({
                feature: "sessionDiag",
                type: "selfTest.run.end",
                status: result.status === "failed" ? "error" : "ok",
                fields: {
                    runId: { raw: runId, cls: "diagnostic.metadata" },
                    status: { raw: result.status, cls: "diagnostic.metadata" },
                    passed: { raw: passed, cls: "diagnostic.metadata" },
                    failed: { raw: failed, cls: "diagnostic.metadata" },
                },
            });
        } catch (error) {
            this.emitProgress({
                runId,
                phase: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // --- event handling + persistence -----------------------------------------

    private handleEvent(event: SelfTestEvent, runId: string, runDir: string): void {
        switch (event.kind) {
            case "runStart":
                this.emitProgress({
                    runId,
                    phase: "runStart",
                    scenarioCount: event.scenarioCount,
                    totalReps: event.totalReps,
                });
                break;
            case "scenarioStart":
                this.emitProgress({
                    runId,
                    phase: "scenarioStart",
                    scenarioId: event.scenarioId,
                    title: event.title,
                    index: event.index,
                    total: event.total,
                });
                break;
            case "scenarioSkipped":
                this.emitProgress({
                    runId,
                    phase: "scenarioSkipped",
                    scenarioId: event.scenarioId,
                    title: event.title,
                    reason: event.reason,
                });
                break;
            case "repStart":
                this.emitProgress({
                    runId,
                    phase: "repStart",
                    scenarioId: event.scenarioId,
                    repId: event.repId,
                    warmup: event.warmup,
                });
                break;
            case "repEnd": {
                // Persist the rep in the standard perf-run layout so the Perf &
                // History pages pick it up.
                this.persistRep(runDir, event);
                this.emitProgress({
                    runId,
                    phase: "repEnd",
                    scenarioId: event.result.scenarioId,
                    repId: event.result.repId,
                    warmup: event.result.warmup,
                    status: event.result.status,
                    durationMs: event.result.durationMs,
                    metrics: event.result.metrics.map((m) => ({
                        name: m.name,
                        value: m.value,
                        official: m.official,
                    })),
                    ...(event.result.failureReason ? { reason: event.result.failureReason } : {}),
                });
                break;
            }
            case "scenarioEnd":
                this.emitProgress({
                    runId,
                    phase: "scenarioEnd",
                    scenarioId: event.result.scenarioId,
                    title: event.result.title,
                    passed: event.result.passed,
                    failed: event.result.failed,
                    ...(event.result.skipped ? { status: "skipped" } : {}),
                });
                break;
            case "log":
                this.emitProgress({ runId, phase: "log", message: event.message });
                break;
            case "runEnd":
                // handled in execute() after run() resolves
                break;
        }
    }

    private persistRep(runDir: string, event: Extract<SelfTestEvent, { kind: "repEnd" }>): void {
        try {
            const rep = event.result;
            const repDir = path.join(
                runDir,
                "scenarios",
                rep.scenarioId,
                "reps",
                `rep-${String(rep.repId).padStart(2, "0")}`,
            );
            fs.mkdirSync(repDir, { recursive: true });
            writeJson(path.join(repDir, "result.json"), {
                runId: path.basename(runDir),
                scenarioId: rep.scenarioId,
                repId: rep.repId,
                status: rep.status,
                warmup: rep.warmup,
                metrics: rep.metrics.map((m) => ({
                    name: m.name,
                    value: m.value,
                    unit: m.unit,
                    official: m.official,
                })),
                ...(rep.failureReason ? { failureReason: rep.failureReason } : {}),
            });
            // markers.jsonl: BusMarker already matches the harness marker shape
            // importPerfRep reads, so the trace view renders the rep too.
            const lines = event.markers
                .map((m) =>
                    JSON.stringify({
                        runId: path.basename(runDir),
                        name: m.name,
                        phase: m.phase,
                        timestampUnixNs: m.timestampUnixNs,
                        monotonicNs: m.monotonicNs ?? m.timestampUnixNs,
                        process: m.process,
                        ...(m.attrs ? { attrs: m.attrs } : {}),
                    }),
                )
                .join("\n");
            fs.writeFileSync(path.join(repDir, "markers.jsonl"), lines ? lines + "\n" : "", "utf8");
        } catch {
            // persistence best-effort; the live view already has the data
        }
    }

    // --- diagnostics bridge ----------------------------------------------------

    /** Engine-emitted markers → diag (live views + tap → runner bus). */
    private emitEngineMarker(marker: BusMarker): void {
        const fields: Record<string, RawField> = {};
        for (const [key, value] of Object.entries(marker.attrs ?? {})) {
            fields[key] = { raw: value, cls: "diagnostic.metadata" };
        }
        diag.emit({
            feature: featureFor(marker.name),
            kind: marker.phase === "counter" ? "metric" : "event",
            type: marker.name,
            epochMs: Number(BigInt(marker.timestampUnixNs) / 1_000_000n),
            ...(marker.monotonicNs ? { monotonicNs: marker.monotonicNs } : {}),
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
            tags: ["selftest", `phase:${marker.phase}`],
        });
    }

    /** DiagEvent → BusMarker: the runner's wait stream is a projection of diag. */
    private toBusMarker(event: DiagEvent): BusMarker {
        const attrs: Record<string, unknown> = {};
        if (event.payload) {
            for (const [key, value] of Object.entries(event.payload)) {
                if (
                    (value.handling === "plain" || value.handling === "truncated") &&
                    value.v !== undefined
                ) {
                    attrs[key] = value.v;
                }
            }
        }
        return {
            name: event.type,
            phase: phaseFromTags(event.tags, event.kind),
            timestampUnixNs: (BigInt(event.epochMs) * 1_000_000n).toString(),
            ...(event.monotonicNs ? { monotonicNs: event.monotonicNs } : {}),
            process: {
                role: roleForProcess(event.process),
                pid: event.pid ?? 0,
                name: event.process,
            },
            ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        };
    }

    // --- connection resolution -------------------------------------------------

    private effectivePerfRunsRoot(): string {
        const configured = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.debugConsole.perfRunsRoot", "")
            ?.trim();
        if (configured) {
            return configured;
        }
        return path.join(this.context.globalStorageUri.fsPath, "self-test-runs");
    }

    /**
     * Resolve a "default" connection profile from the active editor's live
     * connection. Returns undefined when nothing is connected — SQL scenarios
     * then skip honestly rather than prompting or fabricating a connection.
     * The password is passed to the in-process engine and never logged or
     * persisted.
     */
    private async resolveDefaultProfile(): Promise<
        { spec: ConnectionProfileSpec; label: string } | undefined
    > {
        try {
            const controller = (await vscode.commands.executeCommand(
                "mssql.getControllerForTests",
            )) as
                | {
                      connectionManager?: {
                          isConnected(uri: string): boolean;
                          getConnectionInfo(
                              uri: string,
                          ): { credentials?: RawCredentials } | undefined;
                      };
                  }
                | undefined;
            const cm = controller?.connectionManager;
            if (!cm) {
                return undefined;
            }
            const uri = vscode.window.activeTextEditor?.document.uri.toString();
            if (!uri || !cm.isConnected(uri)) {
                return undefined;
            }
            const creds = cm.getConnectionInfo(uri)?.credentials;
            if (!creds?.server) {
                return undefined;
            }
            const authenticationType =
                creds.authenticationType === "SqlLogin" ? "SqlLogin" : "Integrated";
            const spec: ConnectionProfileSpec = {
                server: creds.server,
                ...(creds.database ? { database: creds.database } : {}),
                authenticationType,
                ...(creds.user ? { user: creds.user } : {}),
                ...(creds.password ? { password: creds.password } : {}),
                encrypt:
                    typeof creds.encrypt === "boolean"
                        ? creds.encrypt
                            ? "true"
                            : "false"
                        : (creds.encrypt ?? "Optional"),
                ...(creds.trustServerCertificate !== undefined
                    ? { trustServerCertificate: !!creds.trustServerCertificate }
                    : {}),
            };
            // Label carries no secrets — server + database only.
            const label = `${creds.server}${creds.database ? ` / ${creds.database}` : ""}`;
            return { spec, label };
        } catch {
            return undefined;
        }
    }
}

interface RawCredentials {
    server?: string;
    database?: string;
    user?: string;
    password?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
}

function makeRunId(): string {
    // 2026-07-03T14-30-00Z_selftest — matches the perf-run timestamp parser.
    const iso = new Date().toISOString();
    return `${iso.slice(0, 19).replace(/:/g, "-")}Z_selftest`;
}

function writeJson(file: string, value: unknown): void {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
    } catch {
        // best-effort persistence
    }
}
