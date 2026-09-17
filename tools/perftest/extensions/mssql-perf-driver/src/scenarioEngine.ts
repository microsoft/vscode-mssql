/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scenario step engine (design §16.2). Executes ScenarioSpec steps with
 * VS Code commands and semantic waits — no sleeps, no pixel automation.
 * Steps the driver cannot execute honestly (unimplemented probes) fail the
 * scenario rather than pretending.
 */

import * as vscode from "vscode";
import type { MarkerBus } from "./markerBus";
import { validateTimerMs } from "./timer";

// Structural mirrors of @mssqlperf/contracts (the driver is dependency-free,
// so the shapes are duplicated here; the wire format is identical JSON).
export interface ScenarioStep {
    type: string;
    command?: string;
    args?: unknown[];
    path?: string;
    name?: string;
    attrs?: Record<string, unknown>;
    probe?: string;
    assert?: string;
    profile?: string;
    /** provisionConnectionProfile: save WITHOUT a database (OE parity K1). */
    serverScoped?: boolean;
    /** oeExpand: node labels from the server root, e.g. ["Databases","PerfCatalog","Tables"]. */
    oePath?: string[];
    /** Create the OE session without a database so the path begins at server scope. */
    oeServerLevel?: boolean;
    /** completionProbe: a suggestion label that must be present. */
    expect?: string;
    /** queryStudioInteract: closed semantic result-surface action. */
    action?: {
        kind?: string;
        tab?: string;
        resultSetIndex?: number;
        axis?: string;
        target?: string;
        selection?: string;
    };
    timeoutMs?: number;
    ms?: number;
}

export interface ConnectionProfileSpec {
    server: string;
    database?: string;
    authenticationType: "SqlLogin" | "Integrated";
    user?: string;
    password?: string;
    encrypt?: string;
    trustServerCertificate?: boolean;
}

export interface SuccessCriterion {
    type: string;
    name?: string;
    attrs?: Record<string, unknown>;
    probe?: string;
    assert?: string;
    sources?: string[];
}

export interface MeasureSpec {
    start: { type: string; command?: string; name?: string };
    action: ScenarioStep[];
    end: { type: string; name?: string; attrs?: Record<string, unknown> };
    timeoutMs: number;
}

export interface ScenarioLoopSpec {
    iterations: number;
    warmupIterations?: number;
    steps: ScenarioStep[];
    success?: SuccessCriterion[];
    onFailure?: "continue" | "abort";
    settleSteps?: ScenarioStep[];
}

export interface ScenarioSpec {
    scenarioId: string;
    displayName: string;
    setup?: ScenarioStep[];
    loop?: ScenarioLoopSpec;
    measure: MeasureSpec;
    success?: SuccessCriterion[];
    cleanup?: ScenarioStep[];
}

export interface StepOutcome {
    step: string;
    status: "passed" | "failed" | "skipped";
    durationMs?: number;
    message?: string;
}

export interface ScenarioRunResult {
    steps: StepOutcome[];
    successChecks: StepOutcome[];
    failure?: { reason: string; step?: string };
}

export interface EngineContext {
    emitMarker(
        name: string,
        phase: "instant" | "begin" | "end" | "counter",
        attrs?: Record<string, unknown>,
    ): void;
    /** Emit scenario.end and wait until orchestrator collectors have stopped. */
    emitScenarioEndMarker?: (attrs: Record<string, unknown>) => Promise<void>;
    /** Arm scenario-window collectors before scenario.start is timestamped. */
    prepareScenarioWindow?: () => Promise<void>;
    bus: MarkerBus;
    errors: string[];
    log(message: string): void;
    connectionProfiles?: Record<string, ConnectionProfileSpec>;
    /** SQL Application Name for this rep — the XEvents correlation key (M8). */
    applicationName?: string;
    /**
     * Register cleanup that must run even when the scenario fails mid-step
     * (OE sessions a designer needed while initializing). Ported from the
     * in-proc engine so both hosts share cleanup semantics.
     */
    deferCleanup?: (cleanup: () => Promise<void>) => void;
    /** Per-repetition OE sessions, reused so a second expansion is a real refresh. */
    oeSessions?: Map<string, DriverOeSessionHandle>;
}

const DEFAULT_STEP_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
    const safeTimeoutMs = validateTimerMs(timeoutMs, DEFAULT_STEP_TIMEOUT_MS, `${what} timeout`);
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out after ${safeTimeoutMs}ms: ${what}`)),
            safeTimeoutMs,
        );
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}

export async function runScenario(
    spec: ScenarioSpec,
    ctx: EngineContext,
): Promise<ScenarioRunResult> {
    const steps: StepOutcome[] = [];
    const successChecks: StepOutcome[] = [];
    const deferred: Array<() => Promise<void>> = [];
    ctx.deferCleanup = (cleanup) => deferred.push(cleanup);
    const emitScenarioEnd = async (attrs: Record<string, unknown>): Promise<void> => {
        if (ctx.emitScenarioEndMarker) {
            await ctx.emitScenarioEndMarker(attrs);
        } else {
            ctx.emitMarker("scenario.end", "instant", attrs);
        }
    };

    const runSteps = async (list: ScenarioStep[] | undefined, phase: string): Promise<void> => {
        for (const step of list ?? []) {
            const label = `${phase}:${describeStep(step)}`;
            const started = Date.now();
            try {
                await executeStep(step, ctx);
                steps.push({ step: label, status: "passed", durationMs: Date.now() - started });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                steps.push({
                    step: label,
                    status: "failed",
                    durationMs: Date.now() - started,
                    message,
                });
                ctx.errors.push(message);
                throw new ScenarioStepError(label, message);
            }
        }
    };

    try {
        await runSteps(spec.setup, "setup");

        // Measured interval. scenario.start is emitted immediately before the
        // first action; scenario.end when the end condition resolves.
        // Diagnostic collectors are armed before this timestamp so their setup
        // cost is outside the measured interval and fast queries cannot outrun
        // profiler/trace attachment.
        await ctx.prepareScenarioWindow?.();
        const measureStartUnixNs = (BigInt(Date.now()) * 1000000n).toString();
        ctx.emitMarker("scenario.start", "instant", { scenarioId: spec.scenarioId });
        // Gate-proof hook: PERF_SYNTHETIC_DELAY_MS injects a real, transparent
        // delay into the measured window so the regression pipeline can be proven
        // against an actual slowdown. Recorded on scenario.end for auditability.
        const syntheticDelayMs = validateTimerMs(
            Number(process.env["PERF_SYNTHETIC_DELAY_MS"] ?? "0"),
            0,
            "PERF_SYNTHETIC_DELAY_MS",
        );
        const extraRunQuery = process.env["PERF_EXTRA_RUNQUERY"] === "1";
        try {
            if (spec.loop) {
                await runLoop(spec.loop, ctx, steps);
            }
            await runSteps(spec.measure.action, "action");
            if (syntheticDelayMs > 0) {
                await new Promise<void>((resolveDelay) =>
                    setTimeout(resolveDelay, syntheticDelayMs),
                );
            }
            // Gate-proof hook (12.3 acceptance): PERF_EXTRA_RUNQUERY=1 issues one
            // additional real query in the measured window — a genuine extra SQL
            // round-trip the investigation diff must surface. Recorded on markers.
            if (extraRunQuery) {
                const extraStartNs = (BigInt(Date.now()) * 1000000n).toString();
                await vscode.commands.executeCommand("mssql.runQuery");
                await ctx.bus.wait("mssql.query.complete", undefined, 60000, extraStartNs);
            }
            if (spec.measure.end.type === "waitForMarker" && spec.measure.end.name) {
                // Freshness guard: only a marker emitted at/after scenario.start can
                // end the measured interval — stale markers from startup can't.
                await ctx.bus.wait(
                    spec.measure.end.name,
                    spec.measure.end.attrs,
                    spec.measure.timeoutMs,
                    measureStartUnixNs,
                );
                await emitScenarioEnd({
                    scenarioId: spec.scenarioId,
                    endBasis: spec.measure.end.name,
                    ...(syntheticDelayMs > 0 ? { syntheticDelayMs } : {}),
                    ...(extraRunQuery ? { extraRunQuery: true } : {}),
                });
            } else {
                await emitScenarioEnd({
                    scenarioId: spec.scenarioId,
                    endBasis: "afterLastAction",
                    ...(syntheticDelayMs > 0 ? { syntheticDelayMs } : {}),
                    ...(extraRunQuery ? { extraRunQuery: true } : {}),
                });
            }
        } catch (error) {
            // The measured interval broke: emit no scenario.end (the rep must be
            // invalid — a fabricated end would be a lie) and rethrow.
            throw error;
        }

        // Success criteria (design §7): all must pass or the rep is failed.
        for (const criterion of spec.success ?? []) {
            successChecks.push(await evaluateCriterion(criterion, ctx));
        }

        await runSteps(spec.cleanup, "cleanup");

        const failedCheck = successChecks.find((c) => c.status === "failed");
        if (failedCheck) {
            return {
                steps,
                successChecks,
                failure: {
                    reason: `success criterion failed: ${failedCheck.message ?? failedCheck.step}`,
                },
            };
        }
        return { steps, successChecks };
    } catch (error) {
        const stepName = error instanceof ScenarioStepError ? error.step : undefined;
        const reason = error instanceof Error ? error.message : String(error);
        return {
            steps,
            successChecks,
            failure: { reason, ...(stepName ? { step: stepName } : {}) },
        };
    } finally {
        // Deferred cleanups run even on failure — sessions must never leak
        // into the next rep (and never fail the rep themselves).
        for (const cleanup of deferred.reverse()) {
            try {
                await cleanup();
            } catch {
                // best effort
            }
        }
    }
}

class ScenarioStepError extends Error {
    constructor(
        readonly step: string,
        message: string,
    ) {
        super(message);
    }
}

// ---------------------------------------------------------------------------
// Soak/stress loop (Phase-2 M10). Every iteration is recorded honestly:
// failures are captured (never retried or hidden) and the loop continues or
// aborts per policy. waitForMarker steps and markerSeen criteria inside an
// iteration only accept markers fresh to THAT iteration.
// ---------------------------------------------------------------------------

// PERF_SYNTHETIC_LEAK_KB_PER_ITER: gate-proof hook — deliberately retains
// memory each iteration so leak detection can be proven against a real leak.
// Recorded transparently on iteration markers.
const syntheticLeakRetained: Buffer[] = [];

async function runLoop(
    loop: ScenarioLoopSpec,
    ctx: EngineContext,
    stepsLog: StepOutcome[],
): Promise<void> {
    const warmupCount = loop.warmupIterations ?? 0;
    const onFailure = loop.onFailure ?? "continue";
    const leakKbPerIter = Number(process.env["PERF_SYNTHETIC_LEAK_KB_PER_ITER"] ?? "0");
    // Config-driven override (config.vscode.env, snapshotted with the run) so
    // quick verifications don't need a separate scenario definition.
    const overrideIterations = Number(process.env["PERF_SOAK_ITERATIONS"] ?? "0");
    const totalIterations = overrideIterations > 0 ? overrideIterations : loop.iterations;
    let failures = 0;

    for (let index = 0; index < totalIterations; index++) {
        const warmup = index < warmupCount;
        const iterStartUnixNs = (BigInt(Date.now()) * 1000000n).toString();
        ctx.emitMarker("iteration.start", "instant", {
            index,
            warmup,
            ...(leakKbPerIter > 0 ? { syntheticLeakKb: leakKbPerIter } : {}),
        });

        let status: "passed" | "failed" = "passed";
        let errorKind: string | undefined;
        try {
            for (const step of loop.steps) {
                try {
                    await executeStep(step, ctx, iterStartUnixNs);
                } catch (error) {
                    status = "failed";
                    errorKind = classifyIterationError(step, error);
                    throw error;
                }
            }
            for (const criterion of loop.success ?? []) {
                const outcome = await evaluateCriterion(criterion, ctx, iterStartUnixNs);
                if (outcome.status === "failed") {
                    status = "failed";
                    errorKind = errorKind ?? classifyCriterion(criterion, outcome.message);
                    break;
                }
            }
        } catch {
            // recorded below; loop policy decides whether to continue
        }

        if (leakKbPerIter > 0) {
            syntheticLeakRetained.push(Buffer.alloc(leakKbPerIter * 1024, index % 256));
        }

        ctx.emitMarker("iteration.end", "instant", {
            index,
            warmup,
            status,
            ...(errorKind ? { errorKind } : {}),
        });

        if (status === "failed") {
            failures++;
            if (onFailure === "abort") {
                stepsLog.push({
                    step: `loop:aborted@${index}`,
                    status: "failed",
                    message: `iteration ${index} failed (${errorKind ?? "unknown"}); onFailure=abort`,
                });
                throw new ScenarioStepError(
                    `loop:iteration:${index}`,
                    `loop aborted at iteration ${index}: ${errorKind ?? "unknown"}`,
                );
            }
        }

        if (loop.settleSteps) {
            for (const step of loop.settleSteps) {
                try {
                    await executeStep(step, ctx, iterStartUnixNs);
                } catch (error) {
                    ctx.log(`settle step failed after iteration ${index}: ${String(error)}`);
                }
            }
        }
    }
    stepsLog.push({
        step: `loop:${totalIterations}x`,
        status: "passed",
        message: `${failures} iteration failure(s) recorded`,
    });
}

function classifyIterationError(step: ScenarioStep, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out/i.test(message)) return "timeout";
    switch (step.type) {
        case "mssqlConnect":
            return "connect";
        case "mssqlDisconnect":
            return "disconnect";
        case "command":
        case "waitForMarker":
            return "query";
        default:
            return "other";
    }
}

function classifyCriterion(criterion: SuccessCriterion, message?: string): string {
    if (message && /timed out/i.test(message)) return "timeout";
    if (criterion.type === "markerSeen" && /connect/i.test(criterion.name ?? "")) return "connect";
    return "verification";
}

function describeStep(step: ScenarioStep): string {
    switch (step.type) {
        case "command":
        case "waitForCommandCompletion":
            return `${step.type}(${step.command ?? "?"})`;
        case "openDocument":
            return `openDocument(${step.path ?? "?"})`;
        case "waitForMarker":
            return `waitForMarker(${step.name ?? "?"})`;
        default:
            return step.type;
    }
}

async function executeStep(
    step: ScenarioStep,
    ctx: EngineContext,
    afterUnixNs?: string,
): Promise<void> {
    const timeoutMs = validateTimerMs(
        step.timeoutMs,
        DEFAULT_STEP_TIMEOUT_MS,
        `${describeStep(step)} timeout`,
    );
    switch (step.type) {
        case "noop":
            return;
        case "syntheticDelay":
            // Gate-proving synthetic workload only (see contracts): the delay is a
            // real elapsed cost inside the measured window, honestly measured.
            await new Promise<void>((resolveDelay) =>
                setTimeout(resolveDelay, validateTimerMs(step.ms, 0, "syntheticDelay duration")),
            );
            return;
        case "command":
        case "waitForCommandCompletion": {
            if (!step.command) {
                throw new Error("command step missing command id");
            }
            await withTimeout(
                Promise.resolve(vscode.commands.executeCommand(step.command, ...(step.args ?? []))),
                timeoutMs,
                `command ${step.command}`,
            );
            return;
        }
        case "openDocument": {
            if (!step.path) {
                throw new Error("openDocument step missing path");
            }
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            const uri = workspaceRoot
                ? vscode.Uri.joinPath(workspaceRoot, step.path)
                : vscode.Uri.file(step.path);
            const doc = await withTimeout(
                Promise.resolve(vscode.workspace.openTextDocument(uri)),
                timeoutMs,
                `openTextDocument ${step.path}`,
            );
            await vscode.window.showTextDocument(doc, { preview: false });
            return;
        }
        case "waitForMarker": {
            if (!step.name) {
                throw new Error("waitForMarker step missing marker name");
            }
            await ctx.bus.wait(step.name, step.attrs, timeoutMs, afterUnixNs);
            return;
        }
        case "mssqlConnect": {
            const profileName = step.profile ?? "default";
            const profile = ctx.connectionProfiles?.[profileName];
            if (!profile) {
                throw new Error(
                    `No connection profile '${profileName}' was provided by the orchestrator`,
                );
            }
            await withTimeout(
                mssqlConnect(profile, ctx),
                timeoutMs,
                `mssqlConnect(${profileName})`,
            );
            return;
        }
        case "mssqlDisconnect": {
            await withTimeout(mssqlDisconnect(ctx), timeoutMs, "mssqlDisconnect");
            return;
        }
        case "queryStudioConnect": {
            const profileName = step.profile ?? "default";
            const profile = ctx.connectionProfiles?.[profileName];
            if (!profile) {
                throw new Error(
                    `No connection profile '${profileName}' was provided by the orchestrator`,
                );
            }
            await withTimeout(
                queryStudioConnect(profile, ctx, timeoutMs),
                timeoutMs,
                `queryStudioConnect(${profileName})`,
            );
            return;
        }
        case "provisionConnectionProfile": {
            const profileName = step.profile ?? "default";
            const profile = ctx.connectionProfiles?.[profileName];
            if (!profile) {
                throw new Error(
                    `No connection profile '${profileName}' was provided by the orchestrator`,
                );
            }
            await withTimeout(
                provisionSavedProfile(
                    // K1: a saved database makes the connection DB-scoped and hides
                    // the server-level folders — server-scoped scenarios omit it.
                    step.serverScoped === true ? { ...profile, database: undefined } : profile,
                    ctx,
                ),
                timeoutMs,
                `provisionConnectionProfile(${profileName})`,
            );
            return;
        }
        case "queryStudioExecute": {
            // The seam dispatches and returns immediately ({started}); completion
            // flows through the product's own markers (query.complete /
            // resultsRendered), which the measure end condition waits on.
            const result = (await withTimeout(
                Promise.resolve(
                    vscode.commands.executeCommand("mssql.perf.queryStudioExecute", {}),
                ),
                timeoutMs,
                "mssql.perf.queryStudioExecute",
            )) as { error?: string; started?: boolean; reason?: string } | undefined;
            if (result?.error) {
                throw new Error(`queryStudioExecute failed: ${result.error}`);
            }
            if (result?.started === false) {
                throw new Error(
                    `queryStudioExecute did not start: ${result.reason ?? "unknown reason"}`,
                );
            }
            return;
        }
        case "queryStudioInteract": {
            const action = step.action;
            if (!action?.kind) {
                throw new Error("queryStudioInteract step missing action");
            }
            const issuedAt = (BigInt(Date.now()) * 1000000n).toString();
            if (action.kind === "activateTab") {
                const result = (await withTimeout(
                    Promise.resolve(
                        vscode.commands.executeCommand("mssql.perf.queryStudioActivateTab", {
                            tab: action.tab,
                        }),
                    ),
                    timeoutMs,
                    "mssql.perf.queryStudioActivateTab",
                )) as { error?: string; requestId?: number } | undefined;
                if (result?.error || result?.requestId === undefined) {
                    throw new Error(
                        `queryStudioInteract activateTab failed: ${result?.error ?? "missing request id"}`,
                    );
                }
                await ctx.bus.wait(
                    "mssql.queryStudio.tab.activation.end",
                    { requestId: result.requestId },
                    timeoutMs,
                    issuedAt,
                );
                return;
            }

            const result = (await withTimeout(
                Promise.resolve(
                    vscode.commands.executeCommand("mssql.perf.queryStudioInteract", { action }),
                ),
                timeoutMs,
                "mssql.perf.queryStudioInteract",
            )) as { error?: string; requestId?: number } | undefined;
            if (result?.error || result?.requestId === undefined) {
                throw new Error(
                    `queryStudioInteract failed: ${result?.error ?? "missing request id"}`,
                );
            }
            // The product emits this request-correlated marker after the semantic
            // action and the next paint. A second render/instance marker is not a
            // valid completion requirement: scrolling can reuse an already-painted
            // window or clamp inside a fully visible result set.
            await ctx.bus.wait(
                "mssql.queryStudio.interaction.end",
                { requestId: result.requestId },
                timeoutMs,
                issuedAt,
            );
            return;
        }
        case "webviewProbe": {
            // Live results-grid state via the perf-only product API.
            const state = (await vscode.commands.executeCommand("mssql.perf.gridState")) as {
                error?: string;
                totalRows?: number;
                resultSets?: unknown[];
                maxColumns?: number;
                isExecuting?: boolean | null;
            };
            if (!state || state.error) {
                throw new Error(`gridState probe failed: ${state?.error ?? "no response"}`);
            }
            if (step.assert) {
                assertProbe(step.assert, {
                    rowCount: state.totalRows ?? 0,
                    resultSets: state.resultSets?.length ?? 0,
                    columns: state.maxColumns ?? 0,
                    isExecuting: state.isExecuting === true ? 1 : 0,
                });
            }
            return;
        }
        case "objectExplorerProbe": {
            const snapshot = (await vscode.commands.executeCommand("mssql.perf.oeSnapshot")) as {
                error?: string;
                nodes?: Array<{ nodePath: string; label: string; childCount: number }>;
            };
            if (!snapshot || snapshot.error) {
                throw new Error(`oeSnapshot probe failed: ${snapshot?.error ?? "no response"}`);
            }
            if (step.assert) {
                const target = step.name
                    ? snapshot.nodes?.find(
                          (n) => n.label === step.name || n.nodePath.endsWith(step.name as string),
                      )
                    : undefined;
                assertProbe(step.assert, {
                    childCount: target?.childCount ?? 0,
                    expandedNodes: snapshot.nodes?.length ?? 0,
                });
            }
            return;
        }
        case "oeExpand": {
            if (!step.oePath || step.oePath.length === 0) {
                throw new Error("oeExpand step requires oePath (node labels from the server root)");
            }
            await withTimeout(
                oeExpand(step.oePath, step.profile ?? "default", ctx, step.oeServerLevel === true),
                timeoutMs,
                `oeExpand(${step.oePath.join("/")})`,
            );
            return;
        }
        case "designerOpen": {
            const designer = (step as { designer?: string }).designer;
            if (designer !== "tableDesigner" && designer !== "schemaDesigner") {
                throw new Error(
                    "designerOpen step requires designer: tableDesigner|schemaDesigner",
                );
            }
            await withTimeout(
                designerOpen(designer, step.profile ?? "default", ctx, timeoutMs),
                timeoutMs,
                `designerOpen(${designer})`,
            );
            return;
        }
        case "windowFetchCheck": {
            // Fetch a window through the REAL product row path and verify content
            // correctness at the offset (deterministic fixtures: first cell = Id).
            const args = step as unknown as {
                rowStart?: number;
                numberOfRows?: number;
                expectFirstCell?: string;
            };
            const result = (await vscode.commands.executeCommand("mssql.perf.gridFetchWindow", {
                rowStart: args.rowStart ?? 0,
                numberOfRows: args.numberOfRows ?? 50,
            })) as { error?: string; rowsReturned?: number; firstRow?: string[] };
            if (!result || result.error) {
                throw new Error(`gridFetchWindow failed: ${result?.error ?? "no response"}`);
            }
            if ((result.rowsReturned ?? 0) === 0) {
                throw new Error(`gridFetchWindow returned no rows at offset ${args.rowStart}`);
            }
            if (
                args.expectFirstCell !== undefined &&
                result.firstRow?.[0] !== args.expectFirstCell
            ) {
                throw new Error(
                    `window content mismatch at offset ${args.rowStart}: first cell '${result.firstRow?.[0]}' != '${args.expectFirstCell}'`,
                );
            }
            return;
        }
        case "completionProbe": {
            // Semantic completion measurement: invoke the completion provider at
            // the current cursor and verify expected suggestions arrive.
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error("completionProbe requires an open document");
            }
            const expect = (step as unknown as { expect?: string }).expect;
            // Place the cursor at the end of the document (fixtures end mid-clause,
            // e.g. "SELECT * FROM ").
            const endPos = editor.document.lineAt(Math.max(0, editor.document.lineCount - 1)).range
                .end;
            editor.selection = new vscode.Selection(endPos, endPos);
            // IntelliSense warms asynchronously after connect: retry the provider
            // until the expected suggestion appears (contains-match: schemas may
            // qualify labels, e.g. dbo.PerfRows) or the step timeout elapses. The
            // begin/end markers time the FIRST attempt (cold completion latency).
            const deadline = Date.now() + timeoutMs;
            let attempt = 0;
            for (;;) {
                attempt++;
                if (attempt === 1) ctx.emitMarker("driver.completion.begin", "begin");
                const list = (await vscode.commands.executeCommand(
                    "vscode.executeCompletionItemProvider",
                    editor.document.uri,
                    editor.selection.active,
                )) as { items?: Array<{ label: string | { label: string } }> };
                if (attempt === 1) {
                    ctx.emitMarker("driver.completion.end", "end", {
                        suggestions: list?.items?.length ?? 0,
                    });
                }
                const found =
                    !expect ||
                    (list?.items ?? []).some((item) => {
                        const label =
                            typeof item.label === "string" ? item.label : item.label?.label;
                        return (label ?? "").includes(expect);
                    });
                if (found) {
                    ctx.emitMarker("driver.completion.found", "instant", {
                        attempts: attempt,
                        suggestions: list?.items?.length ?? 0,
                    });
                    return;
                }
                if (Date.now() >= deadline) {
                    throw new Error(
                        `completion did not include '${expect}' within ${timeoutMs}ms (${attempt} attempts, last ${list?.items?.length ?? 0} suggestions)`,
                    );
                }
                await new Promise((r) => setTimeout(r, 2000));
            }
        }
        default:
            throw new Error(`Unknown step type '${step.type}'`);
    }
}

/**
 * Non-interactive connect through the product's own test seam. The product
 * emits mssql.connection.begin/ready markers around the real connection flow,
 * so timing comes from the product, not from this call.
 */
/**
 * Tiny assertion evaluator for probe steps: supports "<field> <op> <number>"
 * with ops == != >= <= > <. No eval, no expressions — honest and predictable.
 */
function assertProbe(assertion: string, fields: Record<string, number>): void {
    const match = /^\s*(\w+)\s*(==|!=|>=|<=|>|<)\s*(\d+(?:\.\d+)?)\s*$/.exec(assertion);
    if (!match) {
        throw new Error(`unsupported probe assertion '${assertion}'`);
    }
    const [, field, op, rawExpected] = match;
    const actual = fields[field!];
    if (actual === undefined) {
        throw new Error(
            `probe assertion field '${field}' unavailable (have: ${Object.keys(fields).join(",")})`,
        );
    }
    const expected = Number(rawExpected);
    const pass =
        op === "=="
            ? actual === expected
            : op === "!="
              ? actual !== expected
              : op === ">="
                ? actual >= expected
                : op === "<="
                  ? actual <= expected
                  : op === ">"
                    ? actual > expected
                    : actual < expected;
    if (!pass) {
        throw new Error(`probe assertion failed: ${field}=${actual} ${op} ${expected} is false`);
    }
}

/**
 * Expand an Object Explorer path (labels from the server root, e.g.
 * ["Databases", "PerfCatalog", "Tables"]) through the product's REAL tree
 * provider — the same getChildren path the tree UI uses, so the product's
 * mssql.oe.expand markers fire.
 */
async function oeExpand(
    path: string[],
    profileName: string,
    ctx: EngineContext,
    serverLevel = false,
): Promise<void> {
    const sessionKey = `${profileName}|${serverLevel ? "server" : "database"}`;
    ctx.oeSessions ??= new Map<string, DriverOeSessionHandle>();
    let handle = ctx.oeSessions.get(sessionKey);
    if (!handle) {
        handle = await createDriverOeSession(profileName, ctx, serverLevel);
        ctx.oeSessions.set(sessionKey, handle);
        const ownedHandle = handle;
        ctx.deferCleanup?.(async () => {
            ctx.oeSessions?.delete(sessionKey);
            await ownedHandle.dispose();
        });
    }

    let current: DriverOeNode = handle.connectionNode;
    for (const label of [...path, undefined]) {
        const children = (await handle.provider.expandNode(current, handle.sessionId)) ?? [];
        if (label === undefined) {
            ctx.log(
                `oeExpand: '${driverOeLabel(current) || current.nodePath}' returned ${children.length} node(s)`,
            );
            return;
        }
        const next = children.find(
            (child) => driverOeLabel(child) === label || driverOeLabel(child).startsWith(label),
        );
        if (!next) {
            const available = children.map(driverOeLabel).filter(Boolean).slice(0, 12).join(", ");
            throw new Error(
                `OE node '${label}' not found under '${driverOeLabel(current) || "root"}' ` +
                    `(children: ${available || "(none)"})`,
            );
        }
        current = next;
    }
}

/** Disconnect the active editor's connection via the product's test seam. */
async function mssqlDisconnect(ctx: EngineContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error("mssqlDisconnect requires an open document");
    }
    const uri = editor.document.uri.toString();
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { connectionManager?: { disconnect(fileUri: string): Promise<boolean> } }
        | undefined;
    if (!controller?.connectionManager) {
        throw new Error("mssql.getControllerForTests returned no controller");
    }
    ctx.log(`disconnecting ${uri.slice(0, 80)}`);
    const ok = await controller.connectionManager.disconnect(uri);
    if (!ok) {
        throw new Error("connectionManager.disconnect returned false");
    }
}

/** STS encrypt values arrive as "true"/"false" from connection strings. */
function normalizeEncrypt(encrypt: string | undefined): string {
    if (encrypt === undefined) return "Optional";
    const lowered = encrypt.toLowerCase();
    return lowered === "true" ? "Mandatory" : lowered === "false" ? "Optional" : encrypt;
}

/**
 * Query Studio connect through the PERF_MODE product seams:
 * 1. Write the orchestrator's profile as the ONLY saved connection
 *    (mssql.perf.setConfig → mssql.connections) so the product's
 *    exactly-one-saved-profile auto-pick engages headlessly. groupId ROOT is
 *    created by the product during activation (which precedes this step).
 * 2. SqlLogin only: seed the credential store through the product's own
 *    connectionStore seam so the saved profile's password resolves — the
 *    password is never written to settings.
 * 3. Retry mssql.perf.queryStudioConnect until { connected: true }: the
 *    custom editor's document model resolves asynchronously after openWith,
 *    so early calls honestly report "no live Query Studio model".
 */
/**
 * Provision-only half of queryStudioConnect: write the profile as the ONLY
 * saved connection + seed the SqlLogin credential. Reused by scenarios whose
 * feature performs its own connect (provisionConnectionProfile step).
 */
async function provisionSavedProfile(
    profile: ConnectionProfileSpec,
    ctx: EngineContext,
): Promise<void> {
    const savedProfile: Record<string, unknown> = {
        id: "perf-querystudio-default",
        groupId: "ROOT",
        profileName: "perf-querystudio-default",
        server: profile.server,
        database: profile.database ?? "",
        authenticationType: profile.authenticationType,
        user: profile.user ?? "",
        password: "",
        savePassword: profile.password !== undefined && profile.password !== "",
        encrypt: normalizeEncrypt(profile.encrypt),
        trustServerCertificate: profile.trustServerCertificate ?? false,
    };
    const applied = (await vscode.commands.executeCommand(
        "mssql.perf.setConfig",
        "mssql.connections",
        [savedProfile],
    )) as { applied?: boolean } | undefined;
    if (applied?.applied !== true) {
        throw new Error("mssql.perf.setConfig(mssql.connections) did not apply (PERF_MODE off?)");
    }
    if (savedProfile["savePassword"] === true) {
        const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
            | {
                  connectionManager?: {
                      connectionStore?: {
                          saveProfilePasswordIfNeeded(profile: unknown): Promise<boolean>;
                          lookupPassword(profile: unknown): Promise<string | undefined>;
                          deleteCredential(profile: unknown): Promise<void>;
                      };
                  };
              }
            | undefined;
        const store = controller?.connectionManager?.connectionStore;
        if (
            !store?.saveProfilePasswordIfNeeded ||
            !store.lookupPassword ||
            !store.deleteCredential
        ) {
            throw new Error(
                "connectionStore seam unavailable — cannot seed the SqlLogin credential",
            );
        }
        const previousPassword = await store.lookupPassword(savedProfile);
        const saved = await store.saveProfilePasswordIfNeeded({
            ...savedProfile,
            password: profile.password,
        });
        if (!saved) {
            throw new Error("credential store refused the SqlLogin password for the saved profile");
        }
        ctx.deferCleanup?.(async () => {
            if (previousPassword) {
                await store.saveProfilePasswordIfNeeded({
                    ...savedProfile,
                    password: previousPassword,
                });
            } else {
                await store.deleteCredential(savedProfile);
            }
        });
    }
    ctx.log(`provisionSavedProfile: saved profile targets ${profile.server}`);
}

async function queryStudioConnect(
    profile: ConnectionProfileSpec,
    ctx: EngineContext,
    timeoutMs: number,
): Promise<void> {
    await provisionSavedProfile(profile, ctx);

    // Inner deadline fires BEFORE the caller's withTimeout so the diagnostic
    // last-response detail reaches the rep record instead of a bare timeout.
    const deadline = Date.now() + Math.max(timeoutMs - 2000, 5000);
    let last: { connected?: boolean; error?: string } | undefined;
    for (;;) {
        last = (await vscode.commands.executeCommand("mssql.perf.queryStudioConnect")) as
            | { connected?: boolean; error?: string }
            | undefined;
        if (last?.connected === true) {
            break;
        }
        if (Date.now() >= deadline) {
            throw new Error(
                `queryStudioConnect did not reach connected:true within ${timeoutMs}ms ` +
                    `(last response: ${JSON.stringify(last ?? null)})`,
            );
        }
        await new Promise<void>((resolveRetry) => setTimeout(resolveRetry, 750));
    }

    // Readiness preflight: the product's post-connect SPID probe briefly holds
    // the session's ONE query slot ("one active query per STS2 session"); a
    // human never races it, the driver would. Run an unmeasured trivial query
    // and retry until the session executes cleanly, so the MEASURED execute
    // can never hit Busy. Failures here are honest setup failures.
    let lastDetail = "";
    for (;;) {
        const exec = (await vscode.commands.executeCommand("mssql.perf.queryStudioExecute", {
            text: "SELECT 1;",
        })) as { error?: string; started?: boolean; reason?: string } | undefined;
        if (exec?.started === true) {
            const state = await queryStudioTerminalState(deadline);
            if (state?.phase === "succeeded" && (state.errorCount ?? 0) === 0) {
                ctx.log("queryStudioConnect: session preflight succeeded");
                return;
            }
            lastDetail = JSON.stringify(state ?? null);
        } else {
            lastDetail = JSON.stringify(exec ?? null);
        }
        if (Date.now() >= deadline) {
            throw new Error(
                `queryStudio session preflight did not succeed within ${timeoutMs}ms (last: ${lastDetail})`,
            );
        }
        await new Promise<void>((resolveRetry) => setTimeout(resolveRetry, 500));
    }
}

/** Poll the perf state probe until the execution phase leaves executing. */
async function queryStudioTerminalState(
    deadline: number,
): Promise<{ phase?: string; errorCount?: number; error?: string } | undefined> {
    for (;;) {
        const state = (await vscode.commands.executeCommand("mssql.perf.queryStudioState")) as
            | { phase?: string; errorCount?: number; error?: string }
            | undefined;
        const phase = state?.phase;
        if (phase && phase !== "executing" && phase !== "cancelRequested") {
            return state;
        }
        if (Date.now() >= deadline) {
            return state;
        }
        await new Promise<void>((resolveRetry) => setTimeout(resolveRetry, 250));
    }
}

async function mssqlConnect(profile: ConnectionProfileSpec, ctx: EngineContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error("mssqlConnect requires an open document (add an openDocument step first)");
    }
    // Must match the product's connection key exactly: it uses uri.toString()
    // WITH encoding (models/utils.ts getActiveTextEditorUri) — toString(true)
    // would register the connection under a different key on Windows (c%3A vs c:).
    const uri = editor.document.uri.toString();
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | {
              connectionManager?: {
                  connect(
                      fileUri: string,
                      credentials: unknown,
                      options?: unknown,
                  ): Promise<boolean>;
              };
          }
        | undefined;
    if (!controller?.connectionManager) {
        throw new Error(
            "mssql.getControllerForTests returned no controller (is ms-mssql.mssql active?)",
        );
    }
    const encrypt = normalizeEncrypt(profile.encrypt);
    const credentials: Record<string, unknown> = {
        server: profile.server,
        database: profile.database ?? "",
        authenticationType: profile.authenticationType,
        user: profile.user ?? "",
        password: profile.password ?? "",
        savePassword: false,
        encrypt,
        trustServerCertificate: profile.trustServerCertificate ?? false,
        persistSecurityInfo: false,
        email: undefined,
        accountId: undefined,
        tenantId: undefined,
        connectTimeout: 30,
        commandTimeout: 30,
        // Correlation key for server-side XEvents capture (M8): exact-matched by
        // the harness, so it must be byte-identical to the orchestrator's format.
        applicationName: ctx.applicationName ?? "vscode-mssql-perf",
    };
    ctx.log(`connecting ${uri.slice(0, 80)} to ${profile.server}`);
    const ok = await controller.connectionManager.connect(uri, credentials, {
        shouldHandleErrors: false,
        connectionSource: "perfDriver",
    });
    if (!ok) {
        throw new Error(`connectionManager.connect returned false for server ${profile.server}`);
    }
}

// --- designerOpen (ported from the in-proc engine: shared semantics) --------

interface DriverOeNode {
    label?: unknown;
    nodePath?: string;
}

interface DriverOeSeam {
    createSession(
        credentials: unknown,
    ): Promise<
        { sessionId?: string; errorMessage?: string; connectionNode?: DriverOeNode } | undefined
    >;
    /** Awaited expand round-trip — view-independent (no Loading… polling). */
    expandNode(node: DriverOeNode, sessionId: string): Promise<DriverOeNode[] | undefined>;
    removeNode?(node: DriverOeNode, showUserConfirmationPrompt?: boolean): Promise<void>;
}

interface DriverOeSessionHandle {
    provider: DriverOeSeam;
    sessionId: string;
    connectionNode: DriverOeNode;
    dispose: () => Promise<void>;
}

function driverOeLabel(node: DriverOeNode): string {
    return typeof node.label === "string"
        ? node.label
        : String((node.label as { label?: string })?.label ?? "");
}

async function createDriverOeSession(
    profileName: string,
    ctx: EngineContext,
    serverLevel: boolean,
): Promise<DriverOeSessionHandle> {
    const profile = ctx.connectionProfiles?.[profileName];
    if (!profile) {
        throw new Error(`No connection profile '${profileName}' for Object Explorer`);
    }
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { _objectExplorerProvider?: DriverOeSeam }
        | undefined;
    const provider = controller?._objectExplorerProvider;
    if (!provider) {
        throw new Error("object explorer provider unavailable");
    }
    const session = await provider.createSession({
        server: profile.server,
        database: serverLevel ? "" : (profile.database ?? ""),
        authenticationType: profile.authenticationType,
        user: profile.user ?? "",
        password: profile.password ?? "",
        savePassword: false,
        encrypt: profile.encrypt ?? "Optional",
        trustServerCertificate: profile.trustServerCertificate ?? false,
        applicationName: ctx.applicationName ?? "vscode-mssql-perf",
        connectTimeout: 30,
        commandTimeout: 30,
        profileName: `perf-oe-${profileName}-${Date.now()}`,
    });
    if (!session?.sessionId || session.errorMessage) {
        throw new Error(`OE session failed: ${session?.errorMessage ?? "no session id returned"}`);
    }
    if (!session.connectionNode) {
        throw new Error("OE session has no connection node");
    }
    return {
        provider,
        sessionId: session.sessionId,
        connectionNode: session.connectionNode,
        dispose: async () => provider.removeNode?.(session.connectionNode!, false),
    };
}

async function designerOpen(
    designer: "tableDesigner" | "schemaDesigner",
    profileName: string,
    ctx: EngineContext,
    timeoutMs: number,
): Promise<void> {
    const profile = ctx.connectionProfiles?.[profileName];
    if (!profile) {
        throw new Error(`No connection profile '${profileName}' for designerOpen`);
    }
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { _objectExplorerProvider?: DriverOeSeam }
        | undefined;
    const provider = controller?._objectExplorerProvider;
    if (!provider) {
        throw new Error("object explorer provider unavailable");
    }
    // Server-level session: the Databases folder only exists at server scope.
    const session = await provider.createSession({
        server: profile.server,
        database: "",
        authenticationType: profile.authenticationType,
        user: profile.user ?? "",
        password: profile.password ?? "",
        savePassword: false,
        encrypt: profile.encrypt ?? "Optional",
        trustServerCertificate: profile.trustServerCertificate ?? false,
        applicationName: ctx.applicationName ?? "vscode-mssql-perf",
        connectTimeout: 30,
        commandTimeout: 30,
        profileName: `perf-designer-${Date.now()}`,
    });
    if (!session?.sessionId || session.errorMessage) {
        throw new Error(`OE session failed: ${session?.errorMessage ?? "no session id returned"}`);
    }
    const connectionNode = session.connectionNode;
    if (!connectionNode) {
        throw new Error("OE session has no connection node");
    }
    ctx.deferCleanup?.(async () => {
        await provider.removeNode?.(connectionNode, false);
    });
    // Walk to the target database node (System Databases folder searched too).
    const rootChildren = (await provider.expandNode(connectionNode, session.sessionId)) ?? [];
    const databasesFolder = rootChildren.find((c) => driverOeLabel(c).startsWith("Databases"));
    if (!databasesFolder) {
        throw new Error(
            `no Databases folder under the connection (children: ${rootChildren.map(driverOeLabel).slice(0, 10).join(", ")})`,
        );
    }
    const databases = (await provider.expandNode(databasesFolder, session.sessionId)) ?? [];
    const wanted = profile.database || undefined;
    const isSystemFolder = (n: DriverOeNode) => driverOeLabel(n).startsWith("System Databases");
    let target = wanted
        ? databases.find((c) => driverOeLabel(c) === wanted)
        : databases.find((c) => !isSystemFolder(c));
    if (!target) {
        const systemFolder = databases.find(isSystemFolder);
        if (systemFolder) {
            const systemDatabases =
                (await provider.expandNode(systemFolder, session.sessionId)) ?? [];
            target = wanted
                ? systemDatabases.find((c) => driverOeLabel(c) === wanted)
                : systemDatabases[0];
        }
    }
    if (!target) {
        throw new Error(
            `database ${wanted ?? "(first user database)"} not found (have: ${databases.map(driverOeLabel).slice(0, 10).join(", ")})`,
        );
    }
    const command = designer === "tableDesigner" ? "mssql.newTable" : "mssql.schemaDesigner";
    ctx.log(`opening ${designer} against ${driverOeLabel(target)}`);
    await withTimeout(
        Promise.resolve(vscode.commands.executeCommand(command, target)),
        timeoutMs,
        `designerOpen: ${command}`,
    );
}

async function evaluateCriterion(
    criterion: SuccessCriterion,
    ctx: EngineContext,
    afterUnixNs?: string,
): Promise<StepOutcome> {
    switch (criterion.type) {
        case "markerSeen": {
            const seen = criterion.name
                ? ctx.bus.find(criterion.name, criterion.attrs, afterUnixNs) !== undefined
                : false;
            const result: StepOutcome = {
                step: `markerSeen(${criterion.name ?? "?"})`,
                status: seen ? "passed" : "failed",
            };
            if (!seen) result.message = `marker '${criterion.name}' not observed`;
            return result;
        }
        case "markerAbsent": {
            // Negative proof: same matching semantics as markerSeen, inverted.
            // A missing name is a spec bug — fail honestly rather than pass vacuously.
            if (!criterion.name) {
                return {
                    step: "markerAbsent(?)",
                    status: "failed",
                    message: "markerAbsent criterion missing marker name",
                };
            }
            const offending = ctx.bus.find(criterion.name, criterion.attrs, afterUnixNs);
            const result: StepOutcome = {
                step: `markerAbsent(${criterion.name})`,
                status: offending ? "failed" : "passed",
            };
            if (offending) {
                result.message =
                    `marker '${criterion.name}' WAS observed at ${offending.timestampUnixNs}ns ` +
                    `from ${offending.process.role}(pid ${offending.process.pid})` +
                    (offending.attrs ? ` attrs=${JSON.stringify(offending.attrs)}` : "");
            }
            return result;
        }
        case "noErrors": {
            const ok = ctx.errors.length === 0;
            const result: StepOutcome = { step: "noErrors", status: ok ? "passed" : "failed" };
            if (!ok) result.message = ctx.errors.join("; ");
            return result;
        }
        case "webviewProbe":
        case "objectExplorerProbe": {
            // Probe criteria execute the same probe steps and pass iff no throw.
            const label = `${criterion.type}(${criterion.assert ?? ""})`;
            try {
                await executeStep(
                    {
                        type: criterion.type,
                        assert: criterion.assert,
                        ...(criterion.type === "objectExplorerProbe" && criterion.name
                            ? { name: criterion.name }
                            : {}),
                    } as ScenarioStep,
                    ctx,
                );
                return { step: label, status: "passed" };
            } catch (error) {
                return {
                    step: label,
                    status: "failed",
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        }
        default:
            return {
                step: criterion.type,
                status: "failed",
                message: `unknown success criterion '${criterion.type}'`,
            };
    }
}
