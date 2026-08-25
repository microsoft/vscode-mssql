/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run pipeline (design §9.2 lifecycle, §22 output layout): for each scenario
 * repetition — provision dirs, start control server + marker sink, launch
 * VS Code unforked, handshake + calibrate, execute the scenario, shut down,
 * normalize to result.json, persist to SQLite, and render the run report.
 */

import { mkdirSync, writeFileSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    newControlToken,
    newSpanId,
    newTraceId,
    nowUnixNs,
    traceparent,
    PerfEnv,
    type ArtifactRef,
    type ConnectionProfileSpec,
    type GitRepoInfo,
    type Marker,
    type PerfResult,
    type PassType,
    type ScenarioSpec,
} from "@mssqlperf/contracts";
import { provisionSql, createSqlExecutor, type SqlExecutor } from "../sql/sqlProvisioner";
import { SqlServerXEventsCollector } from "../collectors/sqlServerXEvents";
import { ProcessSamplerCollector } from "../collectors/processSampler";
import { StsEnvelopeJournalCollector } from "../collectors/stsEnvelopeJournal";
import { CdpExtHostProfileCollector } from "../collectors/cdpExtHostProfile";
import { CdpRendererTraceCollector } from "../collectors/cdpRendererTrace";
import { CdpRendererProfileCollector } from "../collectors/cdpRendererProfile";
import { CdpHeapSnapshotCollector } from "../collectors/cdpHeapSnapshot";
import { GcDumpCollector } from "../collectors/gcDump";
import { DotnetCountersCollector } from "../collectors/dotnetCounters";
import { DotnetTraceCollector } from "../collectors/dotnetTrace";
import { WprEtwCollector } from "../collectors/wprEtw";
import type {
    Collector,
    CollectorContext,
    PerfProcess,
    ProcessRegistry,
} from "../collectors/types";
import type { LoadedConfig } from "../config/loadConfig";
import { ControlServer } from "../control/controlServer";
import { MarkerSink } from "../markers/markerSink";
import { resolveVscode, type ResolvedVscode } from "../launch/resolveVscode";
import { spawnVscode, type LaunchedVscode } from "../launch/spawnVscode";
import {
    captureEnvironment,
    environmentRelevantConfig,
    getGitInfo,
    canonicalJson,
} from "./environment";
import { extractIterations } from "../regression/soakAnalysis";
import { normalizeRep } from "../normalize/normalizer";
import { renderMarkdownReport } from "../report/markdownReport";
import { renderHtmlReport } from "../report/htmlReport";
import { writeRunIndex } from "../report/runIndex";
import { PerfStore } from "../store/sqliteStore";
import { getScenario } from "../scenarios/registry";
import { ExitCode, type ExitCodeValue } from "../exitCodes";
import type { HarnessLogger } from "../telemetry/logger";

export interface RunOptions {
    loaded: LoadedConfig;
    scenarioFilter?: string;
    passOverride?: PassType;
    logger: HarnessLogger;
    /** Repo root of the perftest monorepo (for driver path + git info). */
    harnessRoot: string;
}

export interface RunSummary {
    runId: string;
    exitCode: ExitCodeValue;
    results: PerfResult[];
    runDir: string;
}

const HELLO_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 20_000;

export async function executeRun(options: RunOptions): Promise<RunSummary> {
    const { loaded, logger } = options;
    const config = loaded.config;
    const passType = options.passOverride ?? config.passType;
    const runId = loaded.runId;
    const runSpan = logger.span("run", { runId, passType });

    // --- Scenario selection ---------------------------------------------------
    const scenarioIds = config.scenarios.filter(
        (id) => !options.scenarioFilter || id === options.scenarioFilter,
    );
    if (scenarioIds.length === 0) {
        throw new RunConfigError(
            options.scenarioFilter
                ? `--scenario ${options.scenarioFilter} is not in the config's scenario list`
                : "config has no scenarios",
        );
    }
    const specs: ScenarioSpec[] = [];
    for (const id of scenarioIds) {
        const registered = getScenario(id);
        if (!registered) {
            throw new RunConfigError(`Unknown scenario '${id}'`);
        }
        if (!registered.implemented) {
            throw new RunConfigError(
                `Scenario '${id}' is not runnable yet (arrives with ${registered.plannedMilestone})`,
            );
        }
        specs.push(registered.spec);
    }

    const store =
        config.store.type === "sqlite"
            ? PerfStore.open(resolve(config.store.path ?? "./perf.db"), logger.child("store"))
            : undefined;
    if (store?.getRun(runId)) {
        store.close();
        throw new RunConfigError(`Run '${runId}' already exists in the store`);
    }

    let activeCleanup: (() => Promise<void>) | undefined;
    let handlingSignal = false;
    const signalHandler = (signal: NodeJS.Signals): void => {
        if (handlingSignal) {
            return;
        }
        handlingSignal = true;
        logger.warn("run.interrupted", `received ${signal}; aborting run`, { runId });
        try {
            if (store?.getRun(runId)) {
                store.updateRunStatus(runId, "aborted");
            }
        } catch (error) {
            logger.warn("run.interruptStatusFailed", String(error));
        }
        void Promise.resolve(activeCleanup?.()).finally(() => {
            try {
                store?.close();
            } finally {
                process.removeListener("SIGINT", signalHandler);
                process.removeListener("SIGTERM", signalHandler);
                try {
                    process.kill(process.pid, signal);
                } catch {
                    process.exitCode = signal === "SIGINT" ? 130 : 143;
                }
            }
        });
    };

    try {
        // --- Run directory + config snapshot --------------------------------------
        const runDir = resolve(config.output.dir, runId);
        // The CLI creates this directory first so it can attach the run-local log
        // sink. A config snapshot, rather than the directory itself, is the durable
        // signal that this run id has already started.
        if (existsSync(join(runDir, "run-config.snapshot.jsonc"))) {
            throw new RunConfigError(`Run output directory already exists: ${runDir}`);
        }
        mkdirSync(runDir, { recursive: true });
        writeFileSync(join(runDir, "run-config.snapshot.jsonc"), loaded.rawText, "utf8");

        // --- Resolve VS Code + driver extension -----------------------------------
        const vscodeBuild = await resolveVscode(config.vscode.version, logger.child("launch"));
        const devPaths: string[] = [];
        const extensionVersions: Record<string, string> = {};
        for (const ext of config.vscode.extensions) {
            if (ext.source === "developmentPath") {
                // loadConfig resolves config-supplied paths against the config file.
                const extPath = resolve(ext.path);
                const pkgPath = join(extPath, "package.json");
                if (!existsSync(pkgPath)) {
                    throw new RunConfigError(
                        `Extension developmentPath has no package.json: ${extPath}`,
                    );
                }
                const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
                    name: string;
                    version: string;
                    main?: string;
                };
                const mainFile = pkg.main
                    ? join(extPath, pkg.main.endsWith(".js") ? pkg.main : `${pkg.main}.js`)
                    : undefined;
                if (mainFile && !existsSync(mainFile)) {
                    throw new RunConfigError(
                        `Extension '${pkg.name}' at ${extPath} is not built (missing ${pkg.main})`,
                    );
                }
                devPaths.push(extPath);
                extensionVersions[ext.id] = pkg.version;
            } else {
                throw new RunConfigError(
                    `Extension source '${ext.source}' is not supported yet (developmentPath only in M1)`,
                );
            }
        }

        const configFingerprint = environmentRelevantConfig(config);
        const environment = captureEnvironment({
            vscode: vscodeBuild,
            extensionVersions,
            sql: {
                ...(config.sql.imageDigest !== undefined
                    ? { imageDigest: config.sql.imageDigest }
                    : {}),
                snapshot: config.sql.snapshot,
                cacheMode: config.sql.cacheMode,
                provider: config.sql.provider,
            },
            configFingerprint,
            passType,
        });
        writeFileSync(
            join(runDir, "environment.json"),
            JSON.stringify(environment, null, 2),
            "utf8",
        );

        const git: GitRepoInfo[] = [];
        const vscodeMssqlRoot = resolve(options.harnessRoot, "..", "..");
        for (const [name, path] of [
            ["vscode-mssql", vscodeMssqlRoot],
            ["sqltoolsservice", resolve(vscodeMssqlRoot, "..", "sqltoolsservice")],
        ] as const) {
            const info = getGitInfo(path, logger, name);
            if (info) git.push(info);
        }

        // --- Store -----------------------------------------------------------------
        store?.upsertEnvironment({
            environmentHash: environment.environmentHash,
            capturedAtUnixNs: nowUnixNs(),
            machineId: environment.machineId ?? "unknown",
            osPlatform: String((environment.os as Record<string, unknown>)?.["platform"] ?? ""),
            osVersion: String((environment.os as Record<string, unknown>)?.["version"] ?? ""),
            cpuModel: String((environment.cpu as Record<string, unknown>)?.["model"] ?? ""),
            logicalCores: Number(
                (environment.cpu as Record<string, unknown>)?.["logicalCores"] ?? 0,
            ),
            memoryTotalMb: Number(
                (environment.memory as Record<string, unknown>)?.["totalMb"] ?? 0,
            ),
            vscodeVersion: vscodeBuild.version,
            extensionVersionsJson: JSON.stringify(extensionVersions),
            sqlImageDigest: config.sql.imageDigest ?? "",
            sqlSnapshot: config.sql.snapshot,
            configFingerprintJson: canonicalJson({ config: configFingerprint, passType }),
        });
        store?.insertRun({
            runId,
            createdAtUnixNs: nowUnixNs(),
            passType,
            status: "aborted", // remains non-green unless the full run reaches a terminal verdict
            configHash: loaded.configHash,
            configPath: loaded.configPath,
            outputDir: runDir,
            environmentHash: environment.environmentHash,
            machineId: environment.machineId ?? "unknown",
        });
        process.once("SIGINT", signalHandler);
        process.once("SIGTERM", signalHandler);
        for (const repo of git) {
            store?.insertRunRepository(runId, repo);
        }

        // --- SQL provisioning (only when a selected scenario needs a connection) ---
        let sqlProfiles: Record<string, ConnectionProfileSpec> | undefined;
        const needsSql = specs.some(
            (s) => s.sql?.connectionProfile && s.sql.connectionProfile !== "none",
        );
        if (needsSql) {
            // Catalog fixture only when a selected scenario targets it (10k-table
            // build is skip-guarded server-side but still worth avoiding entirely).
            const needsCatalog = specs.some((s) => s.sql?.database === "PerfCatalog");
            const provisionSeed = config.sql.provisionSeed !== false;
            const provisioned = await provisionSql(config, logger.child("sql"), {
                seedFiles: provisionSeed
                    ? [
                          join(options.harnessRoot, "sql", "seed", "create-perf-db.sql"),
                          ...(needsCatalog
                              ? [
                                    join(
                                        options.harnessRoot,
                                        "sql",
                                        "seed",
                                        "create-perf-catalog.sql",
                                    ),
                                ]
                              : []),
                      ]
                    : [],
                ...(provisionSeed
                    ? {
                          verifyQuery: {
                              sql: "SET NOCOUNT ON; SELECT COUNT(*) FROM PerfHarness.dbo.PerfRows",
                              expect: "10000",
                          },
                      }
                    : {}),
                ...(needsCatalog
                    ? {
                          verifyQueries: [
                              {
                                  sql: "SET NOCOUNT ON; SELECT COUNT(*) FROM PerfCatalog.sys.tables",
                                  expect: "10000",
                              },
                          ],
                      }
                    : {}),
            });
            sqlProfiles = { default: provisioned.profile };
            logger.info("run.sqlProvisioned", undefined, {
                provider: provisioned.provider,
                validation: provisioned.validation,
            });
        }
        const sqlExec = needsSql ? createSqlExecutor(config, logger.child("sqlExec")) : undefined;

        // --- Execute ----------------------------------------------------------------
        const allResults: PerfResult[] = [];
        let infrastructureBroken = false;

        for (const spec of specs) {
            store?.upsertScenario({
                scenarioId: spec.scenarioId,
                displayName: spec.displayName,
                tagsJson: JSON.stringify(spec.tags ?? []),
            });
            const totalReps = config.warmupRepetitions + config.repetitions;
            for (let repId = 0; repId < totalReps; repId++) {
                const warmup = repId < config.warmupRepetitions;
                const repResult = await executeRep({
                    runId,
                    repId,
                    spec,
                    passType,
                    warmup,
                    runDir,
                    vscodeBuild,
                    devPaths,
                    environment,
                    git,
                    config,
                    harnessRoot: options.harnessRoot,
                    ...(sqlProfiles ? { sqlProfiles } : {}),
                    ...(sqlExec ? { sqlExec } : {}),
                    logger: logger.child("rep"),
                    onActiveCleanup: (cleanup) => {
                        activeCleanup = cleanup;
                    },
                });
                allResults.push(repResult.result);
                if (store) {
                    persistRep(store, runId, spec.scenarioId, repId, warmup, repResult.result);
                }
                if (repResult.infrastructureBroken) {
                    infrastructureBroken = true;
                    logger.error("run.abort", "infrastructure failure - aborting remaining reps");
                    break;
                }
            }
            if (infrastructureBroken) break;
        }

        // --- Summarize ----------------------------------------------------------------
        const passed = allResults.filter((r) => r.status === "passed").length;
        const failed = allResults.filter((r) => r.status === "failed").length;
        const expectedResults = specs.length * (config.warmupRepetitions + config.repetitions);
        const runStatus: "passed" | "failed" | "invalid" =
            failed > 0
                ? "failed"
                : passed === expectedResults && allResults.length === expectedResults
                  ? "passed"
                  : "invalid";
        store?.updateRunStatus(runId, runStatus);

        const summary = {
            runId,
            passType,
            status: runStatus,
            environmentHash: environment.environmentHash,
            scenarios: Object.fromEntries(
                specs.map((s) => [
                    s.scenarioId,
                    {
                        reps: allResults
                            .filter((r) => r.scenarioId === s.scenarioId)
                            .map((r) => ({
                                repId: r.repId,
                                status: r.status,
                                wallclockMs:
                                    r.metrics.find((m) => m.name === "scenario.wallclock")?.value ??
                                    null,
                            })),
                    },
                ]),
            ),
        };
        writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

        const report = renderMarkdownReport({
            runId,
            passType,
            createdAt: new Date().toISOString(),
            environmentHash: environment.environmentHash,
            ...(environment.machineId !== undefined ? { machineId: environment.machineId } : {}),
            vscodeVersion: vscodeBuild.version,
            results: allResults,
            harnessLogPath: "harness-log.jsonl",
        });
        writeFileSync(join(runDir, "report.md"), report, "utf8");
        writeFileSync(
            join(runDir, "report.html"),
            renderHtmlReport({
                runId,
                passType,
                createdAt: new Date().toISOString(),
                environmentHash: environment.environmentHash,
                ...(environment.machineId !== undefined
                    ? { machineId: environment.machineId }
                    : {}),
                vscodeVersion: vscodeBuild.version,
                results: allResults,
            }),
            "utf8",
        );

        writeRunIndex(runDir, logger.child("report"));

        const exitCode: ExitCodeValue = infrastructureBroken
            ? ExitCode.infrastructureFailure
            : failed > 0
              ? ExitCode.scenarioFailed
              : runStatus === "invalid"
                ? ExitCode.insufficientSamples
                : ExitCode.ok;

        runSpan.end({ status: runStatus, passed, failed, total: allResults.length, exitCode });
        return { runId, exitCode, results: allResults, runDir };
    } catch (error) {
        if (store?.getRun(runId)) {
            store.updateRunStatus(runId, "aborted");
        }
        runSpan.fail(error);
        throw error;
    } finally {
        process.removeListener("SIGINT", signalHandler);
        process.removeListener("SIGTERM", signalHandler);
        store?.close();
    }
}

export class RunConfigError extends Error {}

/** Minimal §15 process registry: self-reports beat tree heuristics. */
class SimpleProcessRegistry implements ProcessRegistry {
    private readonly processes = new Map<number, PerfProcess>();
    all(): PerfProcess[] {
        return [...this.processes.values()];
    }
    byRole(role: string): PerfProcess[] {
        return this.all().filter((p) => p.role === role);
    }
    register(process: PerfProcess): void {
        this.processes.set(process.pid, process);
    }
}

/** Instantiate the collectors enabled by config for this pass (design §14). */
function createCollectors(
    config: LoadedConfig["config"],
    passType: PassType,
    harnessRoot: string,
): Collector[] {
    const collectors: Collector[] = [];
    if (config.diagnostics.processSampler) {
        collectors.push(new ProcessSamplerCollector());
    }
    if (config.diagnostics["stsEnvelopeJournal"] === true) {
        collectors.push(
            new StsEnvelopeJournalCollector({
                captureSqlText: config.diagnostics.captureSqlText === true,
            }),
        );
    }
    if (config.diagnostics.sqlServerXEvents === true) {
        collectors.push(
            new SqlServerXEventsCollector({
                captureSqlText: config.diagnostics["captureSqlText"] === true,
                harnessRoot,
            }),
        );
    }
    if (config.diagnostics.cdp?.extHostProfile === true) {
        collectors.push(new CdpExtHostProfileCollector());
    }
    if (config.diagnostics.cdp?.rendererProfile === true) {
        collectors.push(new CdpRendererProfileCollector());
    }
    if (config.diagnostics.cdp?.rendererTrace === true) {
        collectors.push(new CdpRendererTraceCollector());
    }
    if (config.diagnostics.dotnetTrace === true) {
        collectors.push(
            new DotnetTraceCollector(
                config.diagnostics.dotnetTraceProfile,
                config.diagnostics.dotnetTraceDurationSeconds,
            ),
        );
    }
    if (config.diagnostics.wprEtw === true) {
        collectors.push(new WprEtwCollector());
    }
    if (config.diagnostics["heapSnapshots"] === true) {
        collectors.push(new CdpHeapSnapshotCollector());
    }
    if (config.diagnostics["gcDump"] === true) {
        collectors.push(new GcDumpCollector());
    }
    if (config.diagnostics.dotnetCounters === true) {
        collectors.push(new DotnetCountersCollector());
    }
    return collectors.filter(
        (c) =>
            c.allowedPassTypes.includes(passType) &&
            (c.platforms.includes("all") ||
                c.platforms.includes(process.platform as "win32" | "linux" | "darwin")),
    );
}

/** Run one collector hook with fault isolation (§A3.6). */
async function collectorHook(
    logger: HarnessLogger,
    collector: Collector,
    hook: string,
    fn: () => Promise<unknown> | undefined,
): Promise<unknown> {
    try {
        return await fn();
    } catch (error) {
        logger.warn("collector.hookFailed", String(error), { collector: collector.name, hook });
        return undefined;
    }
}

// -----------------------------------------------------------------------------

interface RepExecutionInputs {
    runId: string;
    repId: number;
    spec: ScenarioSpec;
    passType: PassType;
    warmup: boolean;
    runDir: string;
    vscodeBuild: ResolvedVscode;
    devPaths: string[];
    environment: ReturnType<typeof captureEnvironment>;
    git: GitRepoInfo[];
    config: LoadedConfig["config"];
    harnessRoot: string;
    sqlProfiles?: Record<string, ConnectionProfileSpec>;
    sqlExec?: SqlExecutor;
    logger: HarnessLogger;
    onActiveCleanup?: (cleanup: (() => Promise<void>) | undefined) => void;
}

async function executeRep(
    inputs: RepExecutionInputs,
): Promise<{ result: PerfResult; infrastructureBroken: boolean }> {
    const { runId, repId, spec, logger } = inputs;
    const repDir = join(
        inputs.runDir,
        "scenarios",
        spec.scenarioId,
        "reps",
        `rep-${String(repId).padStart(2, "0")}`,
    );
    const artifactsDir = join(repDir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const repSpan = logger.span("rep", {
        scenarioId: spec.scenarioId,
        repId,
        warmup: inputs.warmup,
    });
    const traceId = newTraceId();
    const rootTraceparent = traceparent(traceId, newSpanId());
    const token = newControlToken();

    // Profile mode (design §13.2): fresh = new dirs per rep; warmed = dirs
    // shared across the scenario's reps (rep 0 / warmups warm the caches).
    const warmedProfile = spec.profileMode === "warmed";
    const profileRoot = warmedProfile
        ? join(inputs.runDir, "scenarios", spec.scenarioId, "profile")
        : repDir;
    const userDataDir = join(profileRoot, "vscode-user-data");
    const extensionsDir = join(profileRoot, "vscode-extensions");

    const sink = new MarkerSink(join(repDir, "markers.jsonl"), logger.child("markerSink"));
    const server = await ControlServer.start({
        token,
        runId,
        repId,
        scenarioId: spec.scenarioId,
        sink,
        logger: logger.child("controlServer"),
    });

    let infrastructureError: string | undefined;
    let outcome;
    let calibration;
    let launched: LaunchedVscode | undefined;
    let infrastructureBroken = false;
    let spawnAtMs = 0;
    let readyAtMs = 0;
    let cleanupPromise: Promise<void> | undefined;
    const cleanupImmediately = (): Promise<void> => {
        cleanupPromise ??= (async () => {
            try {
                if (launched) {
                    await launched.killTree();
                    await launched.waitForExit(5000);
                }
            } finally {
                await server.close();
                await sink.close();
            }
        })();
        return cleanupPromise;
    };
    inputs.onActiveCleanup?.(cleanupImmediately);

    // coldDb cache mode (12.6): drop clean buffers + proc cache before each
    // rep so SQL starts cold. Requires sysadmin; failure is a validation
    // warning and the rep's cacheMode claim would be dishonest — so it aborts.
    if (inputs.config.sql.cacheMode === "coldDb") {
        if (!inputs.sqlExec) {
            throw new Error(
                "cacheMode coldDb requires a SQL executor (external/dockerCompose provider)",
            );
        }
        await inputs.sqlExec(
            "DBCC DROPCLEANBUFFERS WITH NO_INFOMSGS; DBCC FREEPROCCACHE WITH NO_INFOMSGS;",
            "coldDb:reset",
        );
        logger.info("rep.coldDbReset", undefined, { scenarioId: spec.scenarioId, repId });
    }

    // Collector framework (design §14): per-rep instances, fault-isolated.
    const collectors = createCollectors(inputs.config, inputs.passType, inputs.harnessRoot);
    const processRegistry = new SimpleProcessRegistry();
    const collectorCtx: CollectorContext = {
        runId,
        repId,
        attemptId: 0,
        scenarioId: spec.scenarioId,
        passType: inputs.passType,
        repDir,
        artifactsDir,
        logger: logger.child("collectors"),
        ...(inputs.sqlExec ? { sqlExec: inputs.sqlExec } : {}),
    };
    const scenarioStartHookPromises = new Map<string, Promise<unknown>>();
    const scenarioEndHookPromises = new Map<string, Promise<unknown>>();
    let scenarioStartAckPromise: Promise<void> | undefined;
    let scenarioEndAckPromise: Promise<void> | undefined;
    const dispatchScenarioStartHooks = (marker: Marker, acknowledgeDriver = false): void => {
        for (const collector of collectors) {
            if (!scenarioStartHookPromises.has(collector.name)) {
                scenarioStartHookPromises.set(
                    collector.name,
                    collectorHook(collectorCtx.logger, collector, "onScenarioStart", () =>
                        collector.onScenarioStart?.(collectorCtx, marker),
                    ),
                );
            }
        }
        if (acknowledgeDriver && !scenarioStartAckPromise) {
            scenarioStartAckPromise = Promise.all(scenarioStartHookPromises.values()).then(() => {
                server.sendScenarioBoundaryAck("start");
            });
        }
    };
    const dispatchScenarioEndHooks = (marker: Marker, acknowledgeDriver = false): void => {
        for (const collector of collectors) {
            if (!scenarioEndHookPromises.has(collector.name)) {
                scenarioEndHookPromises.set(
                    collector.name,
                    (async () => {
                        await scenarioStartHookPromises.get(collector.name);
                        return collectorHook(collectorCtx.logger, collector, "onScenarioEnd", () =>
                            collector.onScenarioEnd?.(collectorCtx, marker),
                        );
                    })(),
                );
            }
        }
        if (acknowledgeDriver && !scenarioEndAckPromise) {
            scenarioEndAckPromise = Promise.all(scenarioEndHookPromises.values()).then(() => {
                server.sendScenarioBoundaryAck("end");
            });
        }
    };
    // STS self-reports its pid through the product marker; register on arrival.
    // Scenario-window collectors (CDP profiler, WPR) key off the scenario
    // boundary markers.
    sink.on("marker", (marker) => {
        if (marker.name === "mssql.sts.ready" && typeof marker.attrs?.["pid"] === "number") {
            const stsProcess: PerfProcess = {
                role: "sts",
                pid: marker.attrs["pid"],
                name: "MicrosoftSqlToolsServiceLayer",
                reportedBy: "vscode-mssql",
                discoveryMethods: ["marker"],
            };
            processRegistry.register(stsProcess);
            for (const collector of collectors) {
                void collectorHook(collectorCtx.logger, collector, "onProcessDiscovered", () =>
                    collector.onProcessDiscovered?.(collectorCtx, stsProcess),
                );
            }
        } else if (marker.name === "scenario.collectors.prepare") {
            dispatchScenarioStartHooks(marker, true);
        } else if (marker.name === "scenario.start") {
            // Compatibility fallback for scenario hosts without the pre-measure
            // collector barrier. Dispatch is idempotent when prepare already ran.
            dispatchScenarioStartHooks(marker);
        } else if (marker.name === "scenario.end") {
            // Stop at the actual measured boundary. The driver waits for this ack
            // before success checks and cleanup can remove the webview target.
            dispatchScenarioEndHooks(marker, true);
        }
    });

    // Collector validation + launch-spec amendment (§14.2 validate/preLaunch).
    const collectorValidations: import("@mssqlperf/contracts").ValidationRecord[] = [];
    for (const collector of collectors) {
        const checks = (await collectorHook(collectorCtx.logger, collector, "validate", () =>
            collector.validate?.(collectorCtx),
        )) as import("../collectors/types").CollectorValidation[] | undefined;
        for (const check of checks ?? []) {
            collectorValidations.push({
                name: `collector:${collector.name}:${check.name}`,
                status: check.status,
                ...(check.message ? { message: check.message } : {}),
            });
        }
    }
    // Scenario-declared user settings must exist BEFORE launch: activation-time
    // consumers (e.g. serviceclient appends --enable-sts2 to the STS spawn args
    // when mssql.sqlDataPlane.enabled is true) never see a post-activation
    // setConfig flip. Merge-write so runtime writes from earlier reps (saved
    // connections, setConfig flips) survive in warmed profiles.
    if (spec.userSettings && Object.keys(spec.userSettings).length > 0) {
        const settingsDir = join(userDataDir, "User");
        const settingsPath = join(settingsDir, "settings.json");
        mkdirSync(settingsDir, { recursive: true });
        let existing: Record<string, unknown> = {};
        if (existsSync(settingsPath)) {
            try {
                existing = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
                    string,
                    unknown
                >;
            } catch {
                // unreadable settings are replaced — the harness profile is disposable
            }
        }
        writeFileSync(
            settingsPath,
            JSON.stringify({ ...existing, ...spec.userSettings }, null, 2),
            "utf8",
        );
        logger.info("rep.userSettingsSeeded", undefined, {
            scenarioId: spec.scenarioId,
            repId,
            keys: Object.keys(spec.userSettings),
        });
    }

    const launchSpec = {
        args: [...(inputs.config.vscode.extraArgs ?? [])],
        env: {} as Record<string, string>,
    };
    for (const collector of collectors) {
        await collectorHook(collectorCtx.logger, collector, "preLaunch", () =>
            collector.preLaunch?.(collectorCtx, launchSpec),
        );
    }

    try {
        spawnAtMs = Date.now();
        launched = spawnVscode(
            {
                executablePath: inputs.vscodeBuild.executablePath,
                userDataDir,
                extensionsDir,
                extensionDevelopmentPaths: inputs.devPaths,
                crashDir: join(artifactsDir, "vscode-crashes"),
                ...(inputs.config.vscode.workspaceRoot
                    ? { workspacePath: resolve(inputs.config.vscode.workspaceRoot) }
                    : {}),
                ...(launchSpec.args.length > 0 ? { extraArgs: launchSpec.args } : {}),
                env: {
                    ...inputs.config.vscode.env,
                    ...launchSpec.env,
                    [PerfEnv.mode]: "1",
                    [PerfEnv.runId]: runId,
                    [PerfEnv.repId]: String(repId),
                    [PerfEnv.scenarioId]: spec.scenarioId,
                    [PerfEnv.controlUrl]: server.controlUrl,
                    [PerfEnv.controlToken]: token,
                    [PerfEnv.markerUrl]: server.markerUrl,
                    [PerfEnv.artifactDir]: artifactsDir,
                    [PerfEnv.traceparent]: rootTraceparent,
                },
                stdoutPath: join(artifactsDir, "vscode-stdout.log"),
                stderrPath: join(artifactsDir, "vscode-stderr.log"),
            },
            logger.child("launcher"),
        );

        processRegistry.register({
            role: "vscodeMain",
            pid: launched.pid,
            name: "Code",
            reportedBy: "orchestrator",
            discoveryMethods: ["spawn"],
        });
        for (const collector of collectors) {
            await collectorHook(collectorCtx.logger, collector, "postLaunch", () =>
                collector.postLaunch?.(collectorCtx, processRegistry),
            );
        }

        // Handshake: hello → calibration → ready (design §9.2, §11.3).
        const exitEarly = launched.exited.then((code) => {
            throw new Error(`VS Code exited early with code ${code}`);
        });
        const hello = await Promise.race([server.waitForHello(HELLO_TIMEOUT_MS), exitEarly]);
        processRegistry.register({
            role: "extensionHost",
            pid: hello.payload.extensionHostPid,
            name: "extensionHost",
            reportedBy: "mssql-perf-driver",
            discoveryMethods: ["hello"],
        });
        calibration = await server.calibrate();
        await Promise.race([server.waitForReady(READY_TIMEOUT_MS), exitEarly]);
        readyAtMs = Date.now();

        // Per-scenario database override (e.g. expand-tables-node-10k targets
        // PerfCatalog while the provisioned default is PerfHarness).
        const scenarioProfiles =
            inputs.sqlProfiles && spec.sql?.database && inputs.sqlProfiles["default"]
                ? {
                      ...inputs.sqlProfiles,
                      default: { ...inputs.sqlProfiles["default"], database: spec.sql.database },
                  }
                : inputs.sqlProfiles;
        server.startScenario(spec, traceId, rootTraceparent, artifactsDir, scenarioProfiles);
        // The driver holds completion until bounded scenario-window collectors
        // have flushed, outside the measured interval.
        const outcomeTimeout = spec.measure.timeoutMs + 65_000;
        outcome = await Promise.race([server.waitForScenarioOutcome(outcomeTimeout), exitEarly]);

        // Scenario-window collectors stop here, AWAITED, while VS Code and the
        // SQL session are still alive (trace flush, ring-buffer read).
        const endMarker = sink.first("scenario.end") ?? sink.first("scenario.start") ?? undefined;
        if (endMarker) {
            dispatchScenarioEndHooks(endMarker);
            for (const promise of scenarioEndHookPromises.values()) {
                await promise;
            }
        }
    } catch (error) {
        infrastructureError = error instanceof Error ? error.message : String(error);
        // A scenario timeout is a scenario problem; anything before the
        // handshake completes is an infrastructure problem worth aborting on.
        infrastructureBroken = !server.hello;
        logger.error("rep.brokenLoop", infrastructureError, { scenarioId: spec.scenarioId, repId });
    } finally {
        for (const collector of collectors) {
            await collectorHook(collectorCtx.logger, collector, "preShutdown", () =>
                collector.preShutdown?.(collectorCtx),
            );
        }
        try {
            server.sendShutdown("rep complete");
            const exitCode = await launched?.waitForExit(SHUTDOWN_GRACE_MS);
            if (exitCode === undefined && launched) {
                await launched.killTree();
                await launched.waitForExit(5000);
            }
        } catch (error) {
            logger.warn("rep.shutdownError", String(error));
        }
        await server.close();
        await sink.close();
        inputs.onActiveCleanup?.(undefined);
    }

    // Collector artifacts + resource metrics (always official:false / resource-only).
    const collectorArtifacts: ArtifactRef[] = [];
    const collectorMetrics: import("@mssqlperf/contracts").Metric[] = [];
    for (const collector of collectors) {
        const artifacts = (await collectorHook(collectorCtx.logger, collector, "postExit", () =>
            collector.postExit?.(collectorCtx),
        )) as ArtifactRef[] | undefined;
        if (artifacts) collectorArtifacts.push(...artifacts);
        const metrics = (await collectorHook(collectorCtx.logger, collector, "normalize", () =>
            collector.normalize?.(collectorCtx),
        )) as import("@mssqlperf/contracts").Metric[] | undefined;
        if (metrics) collectorMetrics.push(...metrics.filter((m) => !m.official));
        for (const check of collector.postRunValidations?.() ?? []) {
            collectorValidations.push({
                name: `collector:${collector.name}:${check.name}`,
                status: check.status,
                ...(check.message ? { message: check.message } : {}),
            });
        }
        await collectorHook(collectorCtx.logger, collector, "teardown", () =>
            collector.teardown?.(collectorCtx),
        );
    }

    // Soak runs: per-iteration records land beside the markers (contract:
    // result.json carries summaries only; the artifact carries the series).
    if (spec.loop) {
        const iterations = extractIterations(sink.all());
        if (iterations.length > 0) {
            writeFileSync(
                join(repDir, "soak-iterations.jsonl"),
                iterations.map((i) => JSON.stringify(i)).join("\n") + "\n",
                "utf8",
            );
        }
    }

    const artifacts: ArtifactRef[] = [
        ...collectorArtifacts,
        ...(spec.loop && existsSync(join(repDir, "soak-iterations.jsonl"))
            ? [
                  {
                      kind: "soakIterations",
                      path: "soak-iterations.jsonl",
                      retention: "always" as const,
                  },
              ]
            : []),
        {
            kind: "markers",
            path: "markers.jsonl",
            retention: "always",
            ...sizeOf(join(repDir, "markers.jsonl")),
        },
        {
            kind: "vscodeStdout",
            path: "artifacts/vscode-stdout.log",
            retention: "on-failure",
            ...sizeOf(join(artifactsDir, "vscode-stdout.log")),
        },
        {
            kind: "vscodeStderr",
            path: "artifacts/vscode-stderr.log",
            retention: "on-failure",
            ...sizeOf(join(artifactsDir, "vscode-stderr.log")),
        },
    ];

    const result = normalizeRep({
        runId,
        repId,
        attemptId: 0,
        scenarioId: spec.scenarioId,
        passType: inputs.passType,
        traceId,
        rootTraceparent,
        markers: sink.all(),
        markersRejected: sink.rejected,
        outcome,
        ...(infrastructureError !== undefined ? { infrastructureError } : {}),
        ...(calibration !== undefined ? { calibration } : {}),
        environment: inputs.environment,
        git: inputs.git,
        artifacts,
        spec,
        extraMetrics: collectorMetrics,
        extraValidations: collectorValidations,
        ...(spawnAtMs > 0 && readyAtMs > 0
            ? { orchestratorTimings: { spawnToReadyMs: readyAtMs - spawnAtMs } }
            : {}),
    });
    writeFileSync(join(repDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    repSpan.end({ status: result.status });
    return { result, infrastructureBroken };
}

function sizeOf(path: string): { sizeBytes?: number } {
    try {
        return { sizeBytes: statSync(path).size };
    } catch {
        return {};
    }
}

function persistRep(
    store: PerfStore,
    runId: string,
    scenarioId: string,
    repId: number,
    warmup: boolean,
    result: PerfResult,
): void {
    const start = result.metrics.find((m) => m.name === "scenario.wallclock")?.startUnixNs;
    const end = result.metrics.find((m) => m.name === "scenario.wallclock")?.endUnixNs;
    store.insertRepetition({
        runId,
        scenarioId,
        repId,
        attemptId: result.attemptId ?? 0,
        status: result.status,
        warmup,
        traceId: result.trace.traceId,
        ...(start !== undefined ? { startUnixNs: start } : {}),
        ...(end !== undefined ? { endUnixNs: end } : {}),
        resultPath: `scenarios/${scenarioId}/reps/rep-${String(repId).padStart(2, "0")}/result.json`,
    });
    store.insertMetrics(runId, scenarioId, repId, result.attemptId ?? 0, result.metrics);
    store.insertArtifacts(
        runId,
        scenarioId,
        repId,
        result.attemptId ?? 0,
        result.artifacts,
        nowUnixNs(),
    );
    store.insertValidations(runId, scenarioId, repId, result.attemptId ?? 0, result.validations);
}
