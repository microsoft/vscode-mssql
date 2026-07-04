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
 * pages pick them up with no extra import step. Completed runs are attached to
 * the console as a source for trace/waterfall drill-in.
 *
 * Connection modes (user-selected, never implicit-only):
 *   active — any connected editor's live connection (not just the focused one)
 *   saved  — a saved connection profile (password via the credential store)
 *   env    — a connection string from an environment variable (never persisted)
 *   none   — SQL scenarios skip honestly
 *
 * Privacy: raw connection strings and passwords are never logged or persisted;
 * provenance records the mode and a server/database label only. Capture stays
 * at the current mode unless the caller opts into elevation for the run window.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Types come from the perftest repo's built dist (type-only ⇒ erased at
// compile time); the module itself loads at runtime via inprocLoader so a
// missing/unbuilt perftest repo degrades to an honest error, not a crash.
import type {
    BusMarker,
    ConnectionProfileSpec,
    SelfTestEvent,
    SelfTestRunner,
} from "../../../../../../perftest/packages/perftest-inproc/dist/index";
import { loadInproc } from "./inprocLoader";

import {
    DiagEvent,
    DiagProcess,
    SelfTestCatalog,
    SelfTestConnectionOption,
    SelfTestProgress,
    SelfTestRunRequest,
    SelfTestRunStarted,
    SelfTestScenarioInfo,
} from "../../sharedInterfaces/debugConsole";
import { diag, RawField } from "../diagnosticsCore";
import { richStats } from "../richCollection";
import { connectionStringLabel, parseSqlConnectionString } from "./connectionString";

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

/** Registers a finished run as a console source; returns its sourceId. */
type AttachRun = (runId: string, runDir: string) => string | undefined;

const DEFAULT_ENV_VAR = "MSSQL_PERFTEST_CONNECTION_STRING";

interface RawCredentials {
    server?: string;
    database?: string;
    user?: string;
    password?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    profileName?: string;
    savePassword?: boolean;
}

interface ConnectionManagerSeam {
    isConnected(uri: string): boolean;
    getConnectionInfo(uri: string): { credentials?: RawCredentials } | undefined;
    connectionStore?: {
        readAllConnections(includeRecent?: boolean): Promise<RawCredentials[]>;
        lookupPassword(credentials: unknown, isConnectionString?: boolean): Promise<string>;
    };
}

/** Cached resolution data behind each option id (never sent to the webview). */
interface OptionBacking {
    mode: "active" | "saved" | "env" | "none";
    uri?: string;
    profile?: RawCredentials;
}

export class SelfTestService {
    private running = false;
    private runner: SelfTestRunner | undefined;
    private tapId: string | undefined;
    private optionBacking = new Map<string, OptionBacking>();

    // Status bar "on-air" indicator: tests control the live instance, so the
    // user must always see that a run is active even when editors cover the
    // console. Clicking it brings the Debug Console back.
    private statusItem: vscode.StatusBarItem | undefined;
    private statusHideTimer: NodeJS.Timeout | undefined;
    private repsDone = 0;
    private repsTotal = 0;
    private currentScenario = "";
    private cancelling = false;
    private activeRunId = "";

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly emitProgress: ProgressSink,
        private readonly attachRun?: AttachRun,
    ) {}

    private ensureStatusItem(): vscode.StatusBarItem {
        if (!this.statusItem) {
            // Very low priority ⇒ right-most among right-aligned items, so the
            // indicator stays put while other items come and go during a run.
            this.statusItem = vscode.window.createStatusBarItem(
                "mssql.selfTest",
                vscode.StatusBarAlignment.Right,
                -1000,
            );
            this.statusItem.name = "MSSQL Self-Test";
            this.statusItem.command = "mssql.openDebugConsole";
            this.context.subscriptions.push(this.statusItem);
        }
        if (this.statusHideTimer) {
            clearTimeout(this.statusHideTimer);
            this.statusHideTimer = undefined;
        }
        return this.statusItem;
    }

    private updateStatusRunning(): void {
        const item = this.ensureStatusItem();
        const counter = this.repsTotal > 0 ? ` ${this.repsDone}/${this.repsTotal}` : "";
        item.text = this.cancelling
            ? `$(sync~spin) MSSQL Self-Test: cancelling…`
            : `$(record) MSSQL Self-Test${counter}`;
        item.tooltip = `MSSQL self-test running${this.currentScenario ? ` — ${this.currentScenario}` : ""} (${this.repsDone}/${this.repsTotal} reps). Click to open the Debug Console.`;
        item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        item.show();
    }

    private updateStatusDone(status: string, passed: number, failed: number): void {
        const item = this.ensureStatusItem();
        const ok = status !== "failed";
        item.text = ok
            ? `$(check) Self-test ${status} · ${passed} passed`
            : `$(error) Self-test failed · ${failed} failing`;
        item.tooltip = "MSSQL self-test finished. Click to open the Debug Console.";
        item.backgroundColor = ok
            ? undefined
            : new vscode.ThemeColor("statusBarItem.errorBackground");
        item.show();
        this.statusHideTimer = setTimeout(() => this.statusItem?.hide(), 12_000);
        this.statusHideTimer.unref?.();
    }

    // --- catalog ---------------------------------------------------------------

    public async catalog(): Promise<SelfTestCatalog> {
        const loaded = loadInproc();
        const scenarios: SelfTestScenarioInfo[] = (loaded.module?.BUILTIN_SCENARIOS ?? []).map(
            (s) => ({
                id: s.id,
                title: s.title,
                description: s.description,
                tags: s.tags,
                needsSql: s.needsSql,
                ...(s.inProcess === false ? { cliOnly: true } : {}),
                estMs: s.estMs,
            }),
        );
        return {
            scenarios,
            connections: await this.listConnectionOptions(),
            perfRunsRoot: this.effectivePerfRunsRoot(),
            running: this.running,
            ...(loaded.error ? { unavailableReason: loaded.error } : {}),
        };
    }

    /**
     * Enumerate every way this run could get SQL connectivity. Labels are
     * server/database only; option ids are opaque indices resolved through a
     * service-side map so no URI or profile detail crosses to the webview.
     */
    private async listConnectionOptions(): Promise<SelfTestConnectionOption[]> {
        const options: SelfTestConnectionOption[] = [];
        this.optionBacking.clear();
        const cm = await this.connectionManager();

        // Active connections — every connected editor, not just the focused one.
        if (cm) {
            const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
            const connections =
                (cm as unknown as { _connections?: Record<string, unknown> })._connections ?? {};
            let index = 0;
            for (const uri of Object.keys(connections)) {
                let creds: RawCredentials | undefined;
                try {
                    if (!cm.isConnected(uri)) continue;
                    creds = cm.getConnectionInfo(uri)?.credentials;
                } catch {
                    continue;
                }
                if (!creds?.server) continue;
                const id = `active:${index++}`;
                this.optionBacking.set(id, { mode: "active", uri });
                options.push({
                    id,
                    mode: "active",
                    label: redactedLabel(creds),
                    detail: `${uri === activeUri ? "focused editor" : "connected editor"} · ${creds.authenticationType ?? "unknown auth"}`,
                    available: true,
                });
            }
        }

        // Saved profiles.
        if (cm?.connectionStore) {
            try {
                const profiles = await cm.connectionStore.readAllConnections(false);
                let index = 0;
                for (const profile of profiles.slice(0, 25)) {
                    if (!profile.server) continue;
                    const id = `saved:${index++}`;
                    this.optionBacking.set(id, { mode: "saved", profile });
                    const azure = profile.authenticationType === "AzureMFA";
                    options.push({
                        id,
                        mode: "saved",
                        label: profile.profileName || redactedLabel(profile),
                        detail: `${redactedLabel(profile)} · ${profile.authenticationType ?? "unknown auth"}`,
                        available: !azure,
                        ...(azure
                            ? {
                                  reason: "Azure MFA profiles need interactive tokens — not supported for self-test yet",
                              }
                            : {}),
                    });
                }
            } catch {
                // saved profiles unavailable; other modes still offered
            }
        }

        // Environment variable connection string.
        const envSet = !!process.env[DEFAULT_ENV_VAR];
        this.optionBacking.set("env", { mode: "env" });
        options.push({
            id: "env",
            mode: "env",
            label: `Connection string from $${DEFAULT_ENV_VAR}`,
            detail: envSet
                ? "variable is set (value never displayed or persisted)"
                : "variable not set — set it or type another name in the dialog",
            available: envSet,
            ...(envSet ? {} : { reason: `${DEFAULT_ENV_VAR} is not set` }),
        });

        // No SQL.
        this.optionBacking.set("none", { mode: "none" });
        options.push({
            id: "none",
            mode: "none",
            label: "No SQL connection",
            detail: "harness-only scenarios run; SQL scenarios skip with a clear reason",
            available: true,
        });
        return options;
    }

    /**
     * Resolve the requested connection into an engine profile. Fails early
     * with an actionable reason; never logs credentials.
     */
    private async resolveConnection(
        request: SelfTestRunRequest["connection"],
    ): Promise<{ spec?: ConnectionProfileSpec; label: string } | { error: string }> {
        const mode = request?.mode ?? "none";
        if (mode === "none") {
            return { label: "no SQL connection (SQL scenarios skip)" };
        }
        if (mode === "env") {
            const varName = request?.envVarName?.trim() || DEFAULT_ENV_VAR;
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
                return { error: `'${varName}' is not a valid environment variable name` };
            }
            const raw = process.env[varName];
            if (!raw) {
                return {
                    error: `environment variable ${varName} is not set in this VS Code process — set it and restart, or choose another mode`,
                };
            }
            const outcome = parseSqlConnectionString(raw);
            if ("error" in outcome) {
                return { error: `$${varName}: ${outcome.error}` };
            }
            const parsed = outcome.parsed;
            return {
                spec: {
                    server: parsed.server,
                    ...(parsed.database ? { database: parsed.database } : {}),
                    authenticationType: parsed.integrated ? "Integrated" : "SqlLogin",
                    ...(parsed.user ? { user: parsed.user } : {}),
                    ...(parsed.password ? { password: parsed.password } : {}),
                    ...(parsed.encrypt ? { encrypt: parsed.encrypt } : {}),
                    ...(parsed.trustServerCertificate !== undefined
                        ? { trustServerCertificate: parsed.trustServerCertificate }
                        : {}),
                },
                label: `$${varName} → ${connectionStringLabel(parsed)}`,
            };
        }

        const backing = request?.optionId
            ? this.optionBacking.get(request.optionId)
            : // Robust default for "active": first connected editor.
              [...this.optionBacking.values()].find((b) => b.mode === mode);
        if (!backing || backing.mode !== mode) {
            return {
                error: `the selected ${mode} connection is no longer available — reopen the dialog to refresh options`,
            };
        }

        if (backing.mode === "active") {
            const cm = await this.connectionManager();
            if (!cm || !backing.uri || !cm.isConnected(backing.uri)) {
                return { error: "that editor is no longer connected — pick another connection" };
            }
            const creds = cm.getConnectionInfo(backing.uri)?.credentials;
            if (!creds?.server) {
                return { error: "could not read the active connection's details" };
            }
            return { spec: toSpec(creds), label: redactedLabel(creds) };
        }

        // saved
        const profile = backing.profile;
        if (!profile?.server) {
            return { error: "saved profile is no longer available" };
        }
        let password = profile.password;
        if (!password && profile.authenticationType === "SqlLogin") {
            const cm = await this.connectionManager();
            try {
                password = (await cm?.connectionStore?.lookupPassword(profile)) || undefined;
            } catch {
                password = undefined;
            }
            if (!password) {
                return {
                    error: `saved profile '${profile.profileName ?? redactedLabel(profile)}' has no retrievable password — connect with it once (Save Password) or choose another mode`,
                };
            }
        }
        return {
            spec: toSpec({ ...profile, ...(password ? { password } : {}) }),
            label: profile.profileName || redactedLabel(profile),
        };
    }

    private async connectionManager(): Promise<ConnectionManagerSeam | undefined> {
        try {
            const controller = (await vscode.commands.executeCommand(
                "mssql.getControllerForTests",
            )) as { connectionManager?: ConnectionManagerSeam } | undefined;
            return controller?.connectionManager;
        } catch {
            return undefined;
        }
    }

    // --- run -------------------------------------------------------------------

    public async run(request: SelfTestRunRequest): Promise<SelfTestRunStarted> {
        if (this.running) {
            return { accepted: false, runId: "", reason: "a self-test is already running" };
        }
        const loaded = loadInproc();
        if (!loaded.module) {
            return { accepted: false, runId: "", reason: loaded.error ?? "runner unavailable" };
        }
        const inproc = loaded.module;
        const scenarios = request.scenarioIds
            .map((id) => inproc.builtinScenario(id))
            .filter((s): s is NonNullable<typeof s> => s !== undefined);
        if (scenarios.length === 0) {
            return { accepted: false, runId: "", reason: "no known scenarios selected" };
        }

        // Resolve the connection BEFORE starting: fail early and actionably.
        const resolved = await this.resolveConnection(request.connection);
        if ("error" in resolved) {
            return { accepted: false, runId: "", reason: resolved.error };
        }
        const needsSql = scenarios.some((s) => s.needsSql);
        if (needsSql && !resolved.spec && (request.connection?.mode ?? "none") !== "none") {
            return {
                accepted: false,
                runId: "",
                reason: "selected scenarios need SQL but no connection resolved",
            };
        }

        const runId = makeRunId();
        this.running = true;
        this.activeRunId = runId;
        this.cancelling = false;
        this.currentScenario = "";
        this.repsDone = 0;
        this.repsTotal = 0;
        this.updateStatusRunning();

        // Opt-in capture elevation for the run window (auto-reverts). Keeps the
        // default privacy-first stance: off unless the caller asks.
        if (request.elevateCapture) {
            diag.setCaptureMode("full", {
                reason: `self-test ${runId}`,
                durationMs: 10 * 60_000,
            });
        }
        // Rich diagnostics for the run window only; released in finally below.
        if (request.collectRich) {
            richStats.enable(`selftest:${runId}`);
        }

        const runDir = path.join(this.effectivePerfRunsRoot(), runId);
        const connectionProfiles = resolved.spec ? { default: resolved.spec } : undefined;

        const runner = new inproc.SelfTestRunner({
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
        const provenance = {
            connectionMode: request.connection?.mode ?? "none",
            connectionLabel: resolved.label,
        };
        void this.execute(runner, runId, runDir, provenance).finally(() => {
            if (this.tapId) {
                diag.removeSink(this.tapId);
                this.tapId = undefined;
            }
            if (request.collectRich) {
                richStats.disable(`selftest:${runId}`);
            }
            this.running = false;
            this.runner = undefined;
        });

        return { accepted: true, runId, connectionLabel: resolved.label };
    }

    public cancel(): { cancelled: boolean } {
        if (this.runner) {
            this.runner.cancel();
            this.cancelling = true;
            this.updateStatusRunning();
            this.emitProgress({
                runId: this.activeRunId,
                phase: "log",
                message:
                    "⛔ cancellation requested — interrupting the current wait and stopping after this step…",
            });
            return { cancelled: true };
        }
        return { cancelled: false };
    }

    private async execute(
        runner: SelfTestRunner,
        runId: string,
        runDir: string,
        provenance: { connectionMode: string; connectionLabel: string },
    ): Promise<void> {
        try {
            fs.mkdirSync(runDir, { recursive: true });
            const result = await runner.run();
            const passed = result.reps.filter((r) => r.status === "passed").length;
            const failed = result.reps.filter((r) => r.status === "failed").length;
            const skipped = result.scenarios.filter((s) => s.skipped).length;
            // Run-level summary the Perf/History pages read. Provenance carries
            // the connection MODE and redacted label only — never credentials.
            writeJson(path.join(runDir, "summary.json"), {
                status: result.status,
                passType: "selfTest",
                environmentHash: "selftest",
                runId,
                connection: provenance,
                scenarios: Object.fromEntries(
                    result.scenarios.map((s) => [
                        s.scenarioId,
                        s.skipped
                            ? { skipped: true, reason: s.reason }
                            : { passed: s.passed, failed: s.failed },
                    ]),
                ),
            });
            // Attach the completed run to the console as a source so the trace
            // and waterfall can drill into it immediately.
            let attachedSourceId: string | undefined;
            try {
                attachedSourceId = this.attachRun?.(runId, runDir);
            } catch {
                attachedSourceId = undefined;
            }
            this.updateStatusDone(result.status, passed, failed);
            this.emitProgress({
                runId,
                phase: "runEnd",
                runStatus: result.status,
                perfRunsRoot: this.effectivePerfRunsRoot(),
                passed,
                failed,
                skipped,
                ...(attachedSourceId ? { attachedSourceId } : {}),
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
                    connectionMode: { raw: provenance.connectionMode, cls: "diagnostic.metadata" },
                },
            });
        } catch (error) {
            this.updateStatusDone("failed", 0, 0);
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
                this.repsTotal = event.totalReps;
                this.repsDone = 0;
                this.updateStatusRunning();
                this.emitProgress({
                    runId,
                    phase: "runStart",
                    scenarioCount: event.scenarioCount,
                    totalReps: event.totalReps,
                });
                break;
            case "scenarioStart":
                this.currentScenario = event.title;
                this.updateStatusRunning();
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
                this.repsDone++;
                this.updateStatusRunning();
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
                    ...(event.result.reason ? { reason: event.result.reason } : {}),
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
        // Rich enrichment survives into persisted markers (perf_ prefix) so
        // the history Diagnostics tab can surface it per rep.
        if (event.perf) {
            for (const [key, value] of Object.entries(event.perf.metrics)) {
                attrs[`perf_${key}`] = value;
            }
        }
        if (event.durationMs !== undefined && attrs["durationMs"] === undefined) {
            attrs["durationMs"] = event.durationMs;
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
}

/** Server/database display label — never credentials. */
function redactedLabel(creds: RawCredentials): string {
    return `${creds.server}${creds.database ? ` / ${creds.database}` : ""}`;
}

function toSpec(creds: RawCredentials): ConnectionProfileSpec {
    return {
        server: creds.server!,
        ...(creds.database ? { database: creds.database } : {}),
        authenticationType: creds.authenticationType === "SqlLogin" ? "SqlLogin" : "Integrated",
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
