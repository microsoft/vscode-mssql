/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay engine v2 context (final plan WI-3.1/WI-3.2 / addendum §7.2–§7.6):
 * durable ids, queue-time config freeze with recorded digests, real active
 * cancellation (all three §7.4 outcome classes), hard item-cap refusal,
 * estimate/safety/preflight surfaces, run-observer lifecycle, disposal
 * honesty, and config-group digest stability.
 */

import { expect } from "chai";
import {
    FeatureReplayEngine,
    FeatureReplayEngineOptions,
    FeatureReplayHost,
    FeatureReplayItemOutcome,
    FeatureReplayPlannedItem,
    REPLAY_ENGINE_DEFAULT_MAX_ITEMS_PER_RUN,
} from "../../src/diagnostics/featureCapture/replayEngine";
import {
    deriveConfigGroupId,
    resolveConfigGroupDigest,
    sha256OfCanonicalJson,
} from "../../src/diagnostics/featureCapture/configGroups";
import { createInlineCompletionConfigGroup } from "../../src/copilot/inlineCompletionDebug/inlineCompletionConfigGroups";
import { INLINE_COMPLETION_PROFILE_DEFINITIONS_VERSION } from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";
import { CONFIG_GROUP_SCHEMA } from "../../src/sharedInterfaces/configGroup";
import {
    FeatureReplayCancellationToken,
    FeatureReplayExecuteResult,
    FeatureReplayMatrixCellBase,
    FeatureReplayRun,
    FeatureReplayTags,
} from "../../src/sharedInterfaces/featureReplay";
import { InlineCompletionDebugReplayConfig } from "../../src/sharedInterfaces/inlineCompletionDebug";
import {
    ReplayPreflightContext,
    ReplayPreflightResult,
} from "../../src/sharedInterfaces/replaySafety";

interface TestEvent {
    id: string;
    timestamp: number;
    result: string;
}

interface TestConfig {
    speed: string;
    depth: string;
}

interface TestCell extends FeatureReplayMatrixCellBase {
    speed: string;
    depth: string;
}

type ExecuteImpl = (
    event: TestEvent,
    config: TestConfig,
    tags: FeatureReplayTags,
    cancellation: FeatureReplayCancellationToken,
) => Promise<FeatureReplayExecuteResult | void>;

interface HarnessOptions {
    engineOptions?: Omit<FeatureReplayEngineOptions<TestEvent, TestConfig, TestCell>, "observer">;
    withEstimate?: boolean;
    withSafety?: boolean;
    preflight?: (context: ReplayPreflightContext<TestConfig>) => Promise<ReplayPreflightResult>;
}

function createHarness(options: HarnessOptions = {}) {
    const executed: Array<{ eventId: string; config: TestConfig; tags: FeatureReplayTags }> = [];
    const queuedRuns: Array<{
        run: FeatureReplayRun<TestCell>;
        items: FeatureReplayPlannedItem<TestEvent, TestConfig>[];
    }> = [];
    const runUpdates: FeatureReplayRun<TestCell>[] = [];
    const itemOutcomes: FeatureReplayItemOutcome[] = [];
    let disposed = false;
    let liveConfig: TestConfig = { speed: "live", depth: "live" };
    let executeImpl: ExecuteImpl = async (event, config, tags) => {
        executed.push({ eventId: event.id, config, tags });
    };
    const host: FeatureReplayHost<TestEvent, TestConfig, TestCell> = {
        feature: "testFeatureV2",
        isRunnable: (event) => event.result !== "pending" && event.result !== "queued",
        captureConfig: () => ({ speed: "captured", depth: "captured" }),
        resolveLiveConfig: () => ({ ...liveConfig }),
        compactConfig: (config) => ({ ...config }),
        compactPartialConfig: (partial) => ({ ...(partial ?? {}) }),
        resolveMatrixCellConfig: (cell) => ({ speed: cell.speed, depth: cell.depth }),
        formatCellLabel: (cell) => `${cell.speed} x ${cell.depth}`,
        formatSourceLabel: (event) => `src-${event.id}`,
        createQueuedEvent: (snapshot) => ({ ...snapshot.event, result: "queued" }),
        markEventRunning: (event, startedAt) => ({
            ...event,
            timestamp: startedAt,
            result: "pending",
        }),
        execute: (event, config, tags, cancellation) =>
            executeImpl(event, config, tags, cancellation),
        ...(options.withEstimate
            ? {
                  estimate: (sources: Array<unknown>, cells: TestCell[], repetitions?: number) => ({
                      sourceItems: sources.length,
                      matrixCells: cells.length,
                      repetitions: repetitions ?? 1,
                      totalExecutions: sources.length * Math.max(cells.length, 1),
                      estimatedInputTokens: 123,
                      warnings: [],
                  }),
              }
            : {}),
        ...(options.withSafety
            ? {
                  classifySafety: () => ({
                      sideEffectClass: "none" as const,
                      targetBinding: "none" as const,
                      requiresConfirmation: false,
                      requiresSandbox: false,
                      reasons: ["model call only"],
                  }),
              }
            : {}),
        ...(options.preflight ? { preflight: options.preflight } : {}),
        onStateChanged: () => undefined,
        isDisposed: () => disposed,
    };
    const engine = new FeatureReplayEngine<TestEvent, TestConfig, TestCell>(host, {
        ...(options.engineOptions ?? {}),
        observer: {
            onRunQueued: (run, items) => queuedRuns.push({ run, items }),
            onRunUpdated: (run) => runUpdates.push(run),
            onItemSettled: (outcome) => itemOutcomes.push(outcome),
        },
    });
    return {
        engine,
        executed,
        queuedRuns,
        runUpdates,
        itemOutcomes,
        setExecute: (impl: ExecuteImpl) => (executeImpl = impl),
        setLiveConfig: (config: TestConfig) => (liveConfig = config),
        setDisposed: (value: boolean) => (disposed = value),
    };
}

function testEvent(id: string): TestEvent {
    return { id, timestamp: 100, result: "success" };
}

function cartItems(...ids: string[]): Array<{ event: TestEvent; sourceLabel?: string }> {
    return ids.map((id) => ({ event: testEvent(id) }));
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

const UUID_SUFFIX = /^[a-z]{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

suite("Replay engine v2", () => {
    test("run and item ids are durable identity.ts ids, globally unique", async () => {
        const harness = createHarness();
        harness.engine.addToCart(cartItems("E-1", "E-2"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().runs[1]?.status === "completed");

        const runs = harness.engine.getState().runs;
        expect(runs.length).to.equal(2);
        for (const run of runs) {
            expect(run.id).to.match(UUID_SUFFIX);
            expect(run.id.startsWith("rr-")).to.equal(true);
        }
        expect(runs[0].id).to.not.equal(runs[1].id);

        const itemIds = harness.queuedRuns.flatMap((entry) =>
            entry.items.map((item) => item.replayItemId),
        );
        expect(itemIds.length).to.equal(4);
        expect(new Set(itemIds).size).to.equal(4);
        for (const itemId of itemIds) {
            expect(itemId).to.match(UUID_SUFFIX);
            expect(itemId.startsWith("ri-")).to.equal(true);
        }
    });

    test("live config resolves and FREEZES at queue time; digest recorded", async () => {
        const harness = createHarness();
        const frozen = { speed: "frozen-live", depth: "frozen-live" };
        harness.setLiveConfig(frozen);
        const gate = createGate();
        harness.setExecute(async (event, config, tags) => {
            harness.executed.push({ eventId: event.id, config, tags });
            await gate.wait();
        });
        harness.engine.addToCart(cartItems("E-1", "E-2"));
        harness.engine.queueCart("live");

        // The rows exist synchronously: mutate the live config MID-RUN.
        const rows = harness.engine.getState().queueRows;
        expect(rows.length).to.equal(2);
        harness.setLiveConfig({ speed: "changed", depth: "changed" });
        gate.open();
        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        expect(harness.executed.map((entry) => entry.config)).to.deep.equal([frozen, frozen]);
        const expectedDigest = sha256OfCanonicalJson(frozen);
        for (const row of rows) {
            expect(row.configDigest).to.equal(expectedDigest);
        }
        for (const outcome of harness.itemOutcomes) {
            expect(outcome.configDigest).to.equal(expectedDigest);
        }
    });

    test("cancel: token reaches the active item; queued rows are cancelledBeforeStart", async () => {
        const harness = createHarness();
        let tokenSeenCancelled = false;
        harness.setExecute(
            (event, _config, _tags, cancellation) =>
                new Promise<void>((_resolve, reject) => {
                    if (event.id !== "E-1") {
                        reject(new Error("only E-1 should ever run"));
                        return;
                    }
                    cancellation.onCancellationRequested(() => {
                        tokenSeenCancelled = cancellation.isCancellationRequested;
                        reject(new Error("interrupted by cancellation"));
                    });
                }),
        );
        harness.engine.addToCart(cartItems("E-1", "E-2", "E-3"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().queueRows[0]?.status === "running");

        const runId = harness.engine.getState().runs[0].id;
        harness.engine.cancelRun(runId);
        // §7.4: run holds "cancelling" until the active execution settles.
        expect(
            ["cancelling", "cancelled"].includes(harness.engine.getState().runs[0].status),
        ).to.equal(true);
        expect(harness.engine.getState().runs[0].cancelRequestedAt).to.be.a("number");

        await waitFor(() => harness.engine.getState().runs[0].status === "cancelled");
        expect(tokenSeenCancelled).to.equal(true);
        expect(harness.engine.getState().queueRows.length).to.equal(0);

        const outcomesBySource = new Map(
            harness.itemOutcomes.map((outcome) => [outcome.sourceEventId, outcome]),
        );
        expect(outcomesBySource.get("E-1")?.status).to.equal("cancelled");
        expect(outcomesBySource.get("E-1")?.cancellationOutcome).to.equal("cancelledInFlight");
        expect(outcomesBySource.get("E-2")?.cancellationOutcome).to.equal("cancelledBeforeStart");
        expect(outcomesBySource.get("E-3")?.cancellationOutcome).to.equal("cancelledBeforeStart");
        expect(outcomesBySource.get("E-2")?.status).to.equal("cancelled");
        // Observer saw the cancelling → cancelled transition.
        expect(harness.runUpdates.some((run) => run.status === "cancelling")).to.equal(true);
        expect(harness.runUpdates[harness.runUpdates.length - 1].status).to.equal("cancelled");
    });

    test("cancel while the active item completes anyway = cancelRequestedButCompleted", async () => {
        const harness = createHarness();
        const gate = createGate();
        harness.setExecute(async (event, config, tags) => {
            harness.executed.push({ eventId: event.id, config, tags });
            await gate.wait(); // deliberately ignores the token
        });
        harness.engine.addToCart(cartItems("E-1"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().queueRows[0]?.status === "running");

        harness.engine.cancelRun(harness.engine.getState().runs[0].id);
        expect(harness.engine.getState().runs[0].status).to.equal("cancelling");
        gate.open();
        await waitFor(() => harness.engine.getState().runs[0].status === "cancelled");

        expect(harness.itemOutcomes.length).to.equal(1);
        expect(harness.itemOutcomes[0].status).to.equal("completed");
        expect(harness.itemOutcomes[0].cancellationOutcome).to.equal("cancelRequestedButCompleted");
    });

    test("hard item cap refuses with an honest failed run; nothing executes", () => {
        const harness = createHarness({ engineOptions: { maxItemsPerRun: 2 } });
        harness.engine.addToCart(cartItems("E-1", "E-2", "E-3"));
        harness.engine.queueCart();

        const state = harness.engine.getState();
        expect(state.runs.length).to.equal(1);
        expect(state.runs[0].status).to.equal("failed");
        expect(state.runs[0].errorMessage).to.contain("hard cap");
        expect(state.runs[0].totalEvents).to.equal(3);
        expect(state.queueRows.length).to.equal(0);
        expect(harness.executed.length).to.equal(0);
        expect(harness.queuedRuns.length).to.equal(0);
        expect(REPLAY_ENGINE_DEFAULT_MAX_ITEMS_PER_RUN).to.equal(500);
    });

    test("host estimate and safety classification surface on the run state", async () => {
        const harness = createHarness({ withEstimate: true, withSafety: true });
        harness.engine.addToCart(cartItems("E-1", "E-2"));
        harness.engine.runMatrix([
            { cellId: "cell-1", ordinal: 1, speed: "fast", depth: "shallow" },
            { cellId: "cell-2", ordinal: 2, speed: "slow", depth: "deep" },
        ]);
        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        const run = harness.engine.getState().runs[0];
        expect(run.estimate).to.deep.equal({
            sourceItems: 2,
            matrixCells: 2,
            repetitions: 1,
            totalExecutions: 4,
            estimatedInputTokens: 123,
            warnings: [],
        });
        expect(run.safety?.sideEffectClass).to.equal("none");
        expect(harness.queuedRuns[0].run.estimate?.totalExecutions).to.equal(4);
    });

    test("preflight ok:false refuses the run before anything queues", async () => {
        const harness = createHarness({
            preflight: async () => ({ ok: false, blockedReason: "target not bound" }),
        });
        harness.engine.addToCart(cartItems("E-1"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().runs[0]?.status === "failed");

        expect(harness.engine.getState().runs[0].errorMessage).to.equal("target not bound");
        expect(harness.executed.length).to.equal(0);
        expect(harness.queuedRuns.length).to.equal(0);
    });

    test("preflight ok:true lets the run drain normally", async () => {
        const contexts: ReplayPreflightContext<TestConfig>[] = [];
        const harness = createHarness({
            preflight: async (context) => {
                contexts.push(context);
                return { ok: true };
            },
        });
        harness.engine.addToCart(cartItems("E-1", "E-2"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        expect(harness.executed.length).to.equal(2);
        expect(contexts.length).to.equal(1);
        expect(contexts[0].sourceItems).to.equal(2);
        expect(contexts[0].configs.length).to.equal(2);
    });

    test("dispose marks in-flight runs partial — evidence is never lost silently", async () => {
        const harness = createHarness();
        const gate = createGate();
        harness.setExecute(async () => {
            await gate.wait();
        });
        harness.engine.addToCart(cartItems("E-1", "E-2"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().queueRows[0]?.status === "running");

        harness.setDisposed(true);
        harness.engine.dispose();
        gate.open();

        const run = harness.engine.getState().runs[0];
        expect(run.status).to.equal("partial");
        expect(harness.runUpdates.some((update) => update.status === "partial")).to.equal(true);
        // Late-settling executes must not resurrect the run.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(harness.engine.getState().runs[0].status).to.equal("partial");
    });

    test("failed executor rows record errorCode/errorMessage outcomes", async () => {
        const harness = createHarness();
        harness.setExecute(async (event, config, tags) => {
            if (event.id === "E-2") {
                throw new Error("executor exploded");
            }
            harness.executed.push({ eventId: event.id, config, tags });
        });
        harness.engine.addToCart(cartItems("E-1", "E-2", "E-3"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        const failed = harness.itemOutcomes.find((outcome) => outcome.sourceEventId === "E-2");
        expect(failed?.status).to.equal("failed");
        expect(failed?.errorMessage).to.equal("executor exploded");
        expect(failed?.errorCode).to.equal("Error");
        expect(harness.executed.length).to.equal(2);
    });

    test("host result reference (result ids) flows into the item outcome", async () => {
        const harness = createHarness();
        harness.setExecute(async () => ({
            resultEventId: "E-99",
            resultCaptureEventId: "ce-result-1",
        }));
        harness.engine.addToCart(cartItems("E-1"));
        harness.engine.queueCart();
        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        expect(harness.itemOutcomes[0].resultEventId).to.equal("E-99");
        expect(harness.itemOutcomes[0].resultCaptureEventId).to.equal("ce-result-1");
        expect(harness.itemOutcomes[0].attempt).to.equal(1);
    });
});

suite("Config groups (WI-3.1)", () => {
    test("digest is stable across key order and equals canonical sha256", () => {
        const a = resolveConfigGroupDigest({ alpha: 1, beta: { gamma: [1, 2] }, nul: null });
        const b = resolveConfigGroupDigest({ nul: null, beta: { gamma: [1, 2] }, alpha: 1 });
        expect(a).to.equal(b);
        expect(a).to.match(/^[0-9a-f]{64}$/);
        expect(resolveConfigGroupDigest({ alpha: 2 })).to.not.equal(
            resolveConfigGroupDigest({ alpha: 1 }),
        );
        expect(deriveConfigGroupId(a)).to.equal(`cg-${a.slice(0, 16)}`);
    });

    test("completions factory: schema, hot mutability, base profile version, determinism", () => {
        const config: InlineCompletionDebugReplayConfig = {
            profileId: "balanced",
            modelSelector: "copilot/gpt-test",
            continuationModelSelector: null,
            useSchemaContext: true,
            includeSqlDiagnostics: null,
            debounceMs: 500,
            maxTokens: null,
            enabledCategories: null,
            forceIntentMode: null,
            customSystemPrompt: null,
            allowAutomaticTriggers: null,
            schemaContext: { budgetProfile: "balanced" },
        };
        const group = createInlineCompletionConfigGroup(config, "Balanced x Balanced");

        expect(group.schema).to.equal(CONFIG_GROUP_SCHEMA);
        expect(group.featureId).to.equal("completions");
        expect(group.label).to.equal("Balanced x Balanced");
        expect(group.baseProfileId).to.equal("balanced");
        expect(group.baseProfileVersion).to.equal(INLINE_COMPLETION_PROFILE_DEFINITIONS_VERSION);
        // Every completions override key is "hot" (documented in the factory).
        expect(Object.keys(group.settingMutability).sort()).to.deep.equal(
            Object.keys(config).sort(),
        );
        expect(new Set(Object.values(group.settingMutability))).to.deep.equal(new Set(["hot"]));
        // partialOverrides keep only the keys that deviate (non-null).
        expect(Object.keys(group.partialOverrides).sort()).to.deep.equal([
            "debounceMs",
            "modelSelector",
            "profileId",
            "schemaContext",
            "useSchemaContext",
        ]);
        expect(group.effectiveConfigDigest).to.equal(
            resolveConfigGroupDigest(group.effectiveConfig!),
        );
        // Deterministic id: the same effective config collapses to one group.
        const again = createInlineCompletionConfigGroup({ ...config }, "other label");
        expect(again.configGroupId).to.equal(group.configGroupId);
    });
});

function createGate(): { wait: () => Promise<void>; open: () => void } {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { wait: () => promise, open: () => release() };
}
