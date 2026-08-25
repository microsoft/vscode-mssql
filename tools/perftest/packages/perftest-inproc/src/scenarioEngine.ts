/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scenario step engine (design §16.2). Executes ScenarioSpec steps with
 * VS Code commands and semantic waits — no sleeps, no pixel automation. Steps
 * the engine cannot execute honestly (unimplemented probes) fail the scenario
 * rather than pretending.
 *
 * This is the in-process twin of the orchestrated harness driver: identical
 * step semantics, but it runs inside the live extension host being measured
 * (self-test) instead of a spawned VS Code driven over a control socket.
 */

import * as vscode from "vscode";
import type { MarkerBus } from "./markerBus";

// Structural mirrors of @mssqlperf/contracts (this package is contract-free so
// its .d.ts stays self-contained for cross-repo relative import; the wire
// format is identical JSON).
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
    /** oeExpand: node labels from the server root, e.g. ["Databases","PerfCatalog","Tables"]. */
    oePath?: string[];
    /**
     * oeExpand: create the OE session at SERVER level (database:"") so the
     * root has the Databases folder — a database-scoped connection roots at
     * database folders (Tables, Views, …) and 'Databases' would not exist.
     */
    oeServerLevel?: boolean;
    /** completionProbe: a suggestion label that must be present. */
    expect?: string;
    /** designerOpen: which designer to launch against the profile's database. */
    designer?: "tableDesigner" | "schemaDesigner";
    /** syntheticDelay: milliseconds of real elapsed cost inside the window. */
    ms?: number;
    /** openUntitledSql / windowFetchCheck payloads. */
    content?: string;
    rowStart?: number;
    numberOfRows?: number;
    expectFirstCell?: string;
    timeoutMs?: number;
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
    bus: MarkerBus;
    errors: string[];
    log(message: string): void;
    connectionProfiles?: Record<string, ConnectionProfileSpec>;
    /** SQL Application Name for this rep — the XEvents correlation key (M8). */
    applicationName?: string;
    /** Cooperative cancellation: steps between waits check this. */
    isCancelled?: () => boolean;
    /**
     * Register cleanup that must run after the scenario finishes (including
     * failure paths) — e.g. OE sessions a designer needed while initializing.
     */
    deferCleanup?: (cleanup: () => Promise<void>) => void;
}

const DEFAULT_STEP_TIMEOUT_MS = 30000;

export class ScenarioCancelledError extends Error {
    constructor() {
        super("scenario cancelled");
        this.name = "ScenarioCancelledError";
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timed out after ${timeoutMs}ms: ${what}`)),
            timeoutMs,
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

/** Cancellable sleep: wakes early (rejecting) when the run is cancelled. */
function cancellableSleep(ms: number, ctx: EngineContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const tick = setInterval(
            () => {
                if (ctx.isCancelled?.()) {
                    clearInterval(tick);
                    reject(new ScenarioCancelledError());
                } else if (Date.now() - started >= ms) {
                    clearInterval(tick);
                    resolve();
                }
            },
            Math.min(200, ms),
        );
        tick.unref?.();
    });
}

/** Map "cancelled by user" wait rejections onto the cancellation error type. */
function mapCancelled(error: unknown): Error {
    if (error instanceof Error && /cancelled by user/.test(error.message)) {
        return new ScenarioCancelledError();
    }
    return error instanceof Error ? error : new Error(String(error));
}

export async function runScenario(
    spec: ScenarioSpec,
    ctx: EngineContext,
): Promise<ScenarioRunResult> {
    const steps: StepOutcome[] = [];
    const successChecks: StepOutcome[] = [];
    // Deferred cleanups (OE sessions etc.) run after cleanup steps, even when
    // the scenario failed or was cancelled.
    const deferred: Array<() => Promise<void>> = [];
    ctx.deferCleanup = (cleanup) => {
        deferred.push(cleanup);
    };
    const runDeferred = async (): Promise<void> => {
        while (deferred.length > 0) {
            const cleanup = deferred.pop()!;
            try {
                await cleanup();
            } catch {
                ctx.log("deferred cleanup failed (non-fatal)");
            }
        }
    };

    const runSteps = async (list: ScenarioStep[] | undefined, phase: string): Promise<void> => {
        for (const step of list ?? []) {
            if (ctx.isCancelled?.()) {
                throw new ScenarioCancelledError();
            }
            const label = `${phase}:${describeStep(step)}`;
            const started = Date.now();
            try {
                await executeStep(step, ctx);
                steps.push({ step: label, status: "passed", durationMs: Date.now() - started });
            } catch (error) {
                if (error instanceof ScenarioCancelledError) {
                    throw error;
                }
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
        const measureStartUnixNs = (BigInt(Date.now()) * 1000000n).toString();
        ctx.emitMarker("scenario.start", "instant", { scenarioId: spec.scenarioId });
        try {
            if (spec.loop) {
                await runLoop(spec.loop, ctx, steps);
            }
            await runSteps(spec.measure.action, "action");
            if (spec.measure.end.type === "waitForMarker" && spec.measure.end.name) {
                // Freshness guard: only a marker emitted at/after scenario.start
                // can end the measured interval — stale startup markers can't.
                await ctx.bus
                    .wait(
                        spec.measure.end.name,
                        spec.measure.end.attrs,
                        spec.measure.timeoutMs,
                        measureStartUnixNs,
                        ctx.isCancelled,
                    )
                    .catch((error: unknown) => {
                        throw mapCancelled(error);
                    });
                ctx.emitMarker("scenario.end", "instant", {
                    scenarioId: spec.scenarioId,
                    endBasis: spec.measure.end.name,
                });
            } else {
                ctx.emitMarker("scenario.end", "instant", {
                    scenarioId: spec.scenarioId,
                    endBasis: "afterLastAction",
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
        if (error instanceof ScenarioCancelledError) {
            return { steps, successChecks, failure: { reason: "cancelled" } };
        }
        const stepName = error instanceof ScenarioStepError ? error.step : undefined;
        const reason = error instanceof Error ? error.message : String(error);
        return {
            steps,
            successChecks,
            failure: { reason, ...(stepName ? { step: stepName } : {}) },
        };
    } finally {
        await runDeferred();
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

async function runLoop(
    loop: ScenarioLoopSpec,
    ctx: EngineContext,
    stepsLog: StepOutcome[],
): Promise<void> {
    const warmupCount = loop.warmupIterations ?? 0;
    const onFailure = loop.onFailure ?? "continue";
    const totalIterations = loop.iterations;
    let failures = 0;

    for (let index = 0; index < totalIterations; index++) {
        if (ctx.isCancelled?.()) {
            throw new ScenarioCancelledError();
        }
        const warmup = index < warmupCount;
        const iterStartUnixNs = (BigInt(Date.now()) * 1000000n).toString();
        ctx.emitMarker("iteration.start", "instant", { index, warmup });

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
    const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    switch (step.type) {
        case "noop":
            return;
        case "syntheticDelay":
            // A real elapsed cost inside the measured window, honestly measured.
            await cancellableSleep(step.ms ?? 0, ctx);
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
        case "openUntitledSql": {
            // Self-test convenience: a fresh in-memory SQL document with the
            // given text, no workspace file needed.
            const content = step.content ?? "";
            const doc = await withTimeout(
                Promise.resolve(vscode.workspace.openTextDocument({ language: "sql", content })),
                timeoutMs,
                "openUntitledSql",
            );
            await vscode.window.showTextDocument(doc, { preview: false });
            return;
        }
        case "waitForMarker": {
            if (!step.name) {
                throw new Error("waitForMarker step missing marker name");
            }
            await ctx.bus
                .wait(step.name, step.attrs, timeoutMs, afterUnixNs, ctx.isCancelled)
                .catch((error: unknown) => {
                    throw mapCancelled(error);
                });
            return;
        }
        case "mssqlConnect": {
            const profileName = step.profile ?? "default";
            const profile = ctx.connectionProfiles?.[profileName];
            if (!profile) {
                throw new Error(
                    `No connection profile '${profileName}' is available — this scenario needs a SQL connection`,
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
        case "webviewProbe": {
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
            if (step.designer !== "tableDesigner" && step.designer !== "schemaDesigner") {
                throw new Error(
                    "designerOpen step requires designer: tableDesigner|schemaDesigner",
                );
            }
            await designerOpen(step.designer, step.profile ?? "default", ctx, timeoutMs);
            return;
        }
        case "windowFetchCheck": {
            const result = (await vscode.commands.executeCommand("mssql.perf.gridFetchWindow", {
                rowStart: step.rowStart ?? 0,
                numberOfRows: step.numberOfRows ?? 50,
            })) as { error?: string; rowsReturned?: number; firstRow?: string[] };
            if (!result || result.error) {
                throw new Error(`gridFetchWindow failed: ${result?.error ?? "no response"}`);
            }
            if ((result.rowsReturned ?? 0) === 0) {
                throw new Error(`gridFetchWindow returned no rows at offset ${step.rowStart}`);
            }
            if (
                step.expectFirstCell !== undefined &&
                result.firstRow?.[0] !== step.expectFirstCell
            ) {
                throw new Error(
                    `window content mismatch at offset ${step.rowStart}: first cell '${result.firstRow?.[0]}' != '${step.expectFirstCell}'`,
                );
            }
            return;
        }
        case "completionProbe": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error("completionProbe requires an open document");
            }
            const expect = step.expect;
            const endPos = editor.document.lineAt(Math.max(0, editor.document.lineCount - 1)).range
                .end;
            editor.selection = new vscode.Selection(endPos, endPos);
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
                await cancellableSleep(2000, ctx);
            }
        }
        default:
            throw new Error(`Unknown step type '${step.type}'`);
    }
}

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

interface OeNode {
    label?: unknown;
    nodePath?: string;
}

interface OeProviderSeam {
    createSession(credentials: unknown): Promise<
        | {
              sessionId?: string;
              errorMessage?: string;
              connectionNode?: OeNode;
          }
        | undefined
    >;
    /**
     * Awaits the full expand round-trip and returns the children directly —
     * unlike getChildren, this does NOT depend on the OE tree view being
     * visible to consume refresh callbacks (the old getChildren + "Loading…"
     * polling hung forever when the tree was hidden behind the console).
     */
    expandNode(node: OeNode, sessionId: string): Promise<OeNode[] | undefined>;
    /** Disconnects and removes the session node (no prompt with false). */
    removeNode?(node: OeNode, showUserConfirmationPrompt?: boolean): Promise<void>;
}

function oeLabel(node: OeNode): string {
    return typeof node.label === "string"
        ? node.label
        : ((node.label as { label?: string })?.label ?? "");
}

interface OeSessionHandle {
    provider: OeProviderSeam;
    sessionId: string;
    connectionNode: OeNode;
    dispose: () => Promise<void>;
}

/** Create an OE session for the profile; caller owns dispose(). */
async function createOeSession(
    profileName: string,
    ctx: EngineContext,
    serverLevel: boolean,
): Promise<OeSessionHandle> {
    const profile = ctx.connectionProfiles?.[profileName];
    if (!profile) {
        throw new Error(`No connection profile '${profileName}' for Object Explorer`);
    }
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { _objectExplorerProvider?: OeProviderSeam }
        | undefined;
    const provider = controller?._objectExplorerProvider;
    if (!provider) {
        throw new Error("object explorer provider unavailable");
    }
    const credentials: Record<string, unknown> = {
        server: profile.server,
        database: serverLevel ? "" : (profile.database ?? ""),
        authenticationType: profile.authenticationType,
        user: profile.user ?? "",
        password: profile.password ?? "",
        savePassword: false,
        encrypt: profile.encrypt ?? "Optional",
        trustServerCertificate: profile.trustServerCertificate ?? false,
        applicationName: ctx.applicationName ?? "vscode-mssql-selftest",
        connectTimeout: 30,
        commandTimeout: 30,
        profileName: `selftest-oe-${Date.now()}`,
    };
    const session = await provider.createSession(credentials);
    if (!session?.sessionId || session.errorMessage) {
        throw new Error(`OE session failed: ${session?.errorMessage ?? "no session id returned"}`);
    }
    const connectionNode = session.connectionNode;
    if (!connectionNode) {
        throw new Error("OE session has no connection node");
    }
    return {
        provider,
        sessionId: session.sessionId,
        connectionNode,
        dispose: async () => {
            await provider.removeNode?.(connectionNode, false);
        },
    };
}

/**
 * Walk to the profile's Database node (server-level session → Databases →
 * profile.database or the first user database). System databases (master,
 * msdb, …) live inside the "System Databases" folder, so the search descends
 * into it when the target isn't at the top level. Designers need a real
 * Database TreeNodeInfo (schema designer reads node.metadata.name).
 */
async function findDatabaseNode(handle: OeSessionHandle, database?: string): Promise<OeNode> {
    const rootChildren =
        (await handle.provider.expandNode(handle.connectionNode, handle.sessionId)) ?? [];
    const databasesFolder = rootChildren.find((c) => oeLabel(c).startsWith("Databases"));
    if (!databasesFolder) {
        throw new Error(
            `no Databases folder under the connection (children: ${rootChildren.map(oeLabel).slice(0, 10).join(", ")})`,
        );
    }
    const databases = (await handle.provider.expandNode(databasesFolder, handle.sessionId)) ?? [];
    const systemFolder = databases.find((c) => oeLabel(c).startsWith("System Databases"));
    const isFolder = (node: OeNode) => oeLabel(node).startsWith("System Databases");
    let target = database
        ? databases.find((c) => oeLabel(c) === database)
        : databases.find((c) => !isFolder(c));
    // master/msdb/model/tempdb live under the System Databases folder.
    if (!target && systemFolder) {
        const systemDatabases =
            (await handle.provider.expandNode(systemFolder, handle.sessionId)) ?? [];
        target = database
            ? systemDatabases.find((c) => oeLabel(c) === database)
            : systemDatabases[0];
        if (target) {
            return target;
        }
        if (database) {
            throw new Error(
                `database '${database}' not found (top level: ${databases.map(oeLabel).slice(0, 10).join(", ")}; system: ${systemDatabases.map(oeLabel).slice(0, 8).join(", ")})`,
            );
        }
    }
    if (!target) {
        throw new Error(
            `database ${database ?? "(first user database)"} not found (have: ${databases.map(oeLabel).slice(0, 10).join(", ")})`,
        );
    }
    return target;
}

/**
 * Expand an Object Explorer path (labels from the server root) through the
 * product's REAL OE service — createSession then awaited expandNode hops, so
 * the product's mssql.oe.expand markers fire and results are deterministic
 * regardless of tree-view visibility. The session is removed afterwards so
 * repeated reps never accumulate orphaned sessions/connections.
 */
async function oeExpand(
    path: string[],
    profileName: string,
    ctx: EngineContext,
    serverLevel = false,
): Promise<void> {
    const handle = await createOeSession(profileName, ctx, serverLevel);
    try {
        let current: OeNode = handle.connectionNode;
        for (const label of [...path, undefined]) {
            if (ctx.isCancelled?.()) {
                throw new ScenarioCancelledError();
            }
            const children = (await handle.provider.expandNode(current, handle.sessionId)) ?? [];
            if (label === undefined) {
                // Final hop: the measured expansion itself. Empty is legal
                // (e.g. an empty folder) — the expand completed either way.
                ctx.log(
                    `oeExpand: '${oeLabel(current) || current.nodePath}' returned ${children.length} node(s)`,
                );
                return;
            }
            const next = children.find(
                (child) => oeLabel(child) === label || oeLabel(child).startsWith(label),
            );
            if (!next) {
                const available = children.map(oeLabel).filter(Boolean).slice(0, 12).join(", ");
                throw new Error(
                    `OE node '${label}' not found under '${oeLabel(current) || "root"}' (children: ${available || "(none)"})`,
                );
            }
            current = next;
        }
    } finally {
        // Session cleanup is best-effort but important: leaking one OE session
        // + server connection per rep degrades later reps and runs.
        try {
            await handle.dispose();
        } catch {
            ctx.log("oeExpand: session cleanup failed (non-fatal)");
        }
    }
}

/**
 * Launch a designer (Table Designer via mssql.newTable, Schema Designer via
 * mssql.schemaDesigner) against the profile's database node — the same
 * TreeNodeInfo path the OE context menu uses, so the product's designer init
 * markers fire. The OE session stays alive until the scenario finishes
 * (deferred cleanup) because the designer reads the node during init.
 */
async function designerOpen(
    designer: "tableDesigner" | "schemaDesigner",
    profileName: string,
    ctx: EngineContext,
    timeoutMs: number,
): Promise<void> {
    const profile = ctx.connectionProfiles?.[profileName];
    const handle = await createOeSession(profileName, ctx, true);
    ctx.deferCleanup?.(() => handle.dispose());
    const databaseNode = await withTimeout(
        findDatabaseNode(handle, profile?.database || undefined),
        timeoutMs,
        "designerOpen: locate database node",
    );
    const command = designer === "tableDesigner" ? "mssql.newTable" : "mssql.schemaDesigner";
    await withTimeout(
        Promise.resolve(vscode.commands.executeCommand(command, databaseNode)),
        timeoutMs,
        `designerOpen: ${command}`,
    );
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

async function mssqlConnect(profile: ConnectionProfileSpec, ctx: EngineContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error("mssqlConnect requires an open document (add an openDocument step first)");
    }
    // Must match the product's connection key exactly: it uses uri.toString()
    // WITH encoding (models/utils.ts getActiveTextEditorUri).
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
    const encrypt =
        profile.encrypt !== undefined
            ? profile.encrypt.toLowerCase() === "true"
                ? "Mandatory"
                : profile.encrypt.toLowerCase() === "false"
                  ? "Optional"
                  : profile.encrypt
            : "Optional";
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
        applicationName: ctx.applicationName ?? "vscode-mssql-selftest",
    };
    ctx.log(`connecting ${uri.slice(0, 80)} to ${profile.server}`);
    const ok = await controller.connectionManager.connect(uri, credentials, {
        shouldHandleErrors: false,
        connectionSource: "selfTest",
    });
    if (!ok) {
        throw new Error(`connectionManager.connect returned false for server ${profile.server}`);
    }
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
