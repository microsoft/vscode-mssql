/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic feature-capture framework (B7): capture store lifecycle, trace
 * codec redaction/truncation, replay engine drain/matrix/cancel semantics,
 * and classified settings snapshots.
 */

import { expect } from "chai";
import {
    FeatureCaptureStore,
    normalizeNullableBoolean,
    normalizeNullableString,
} from "../../src/diagnostics/featureCapture/captureStore";
import {
    FEATURE_TRACE_REDACTED,
    normalizeFeatureTraceFile,
    serializeFeatureTrace,
} from "../../src/diagnostics/featureCapture/traceCodec";
import {
    FeatureReplayEngine,
    FeatureReplayHost,
} from "../../src/diagnostics/featureCapture/replayEngine";
import {
    classifySettingValue,
    emitSettingsSnapshot,
} from "../../src/diagnostics/featureCapture/settingsSnapshot";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import {
    FeatureReplayMatrixCellBase,
    FeatureReplayTags,
} from "../../src/sharedInterfaces/featureReplay";
import { DiagEvent } from "../../src/sharedInterfaces/debugConsole";

interface TestEvent {
    id: string;
    timestamp: number;
    result: string;
    label?: string;
    secretText?: string;
}

interface TestOverrides {
    name: string | null;
    flag: boolean | null;
}

function createStore(capacity?: number) {
    return new FeatureCaptureStore<TestEvent, TestOverrides>({
        logName: "FeatureCaptureTest",
        capacity,
        defaultOverrides: { name: null, flag: null },
        normalizeOverrides: (overrides) => ({
            name: normalizeNullableString(overrides.name ?? null),
            flag: normalizeNullableBoolean(overrides.flag ?? null),
        }),
        normalizePartialOverrides: (overrides) => {
            const normalized: Partial<TestOverrides> = {};
            if (Object.prototype.hasOwnProperty.call(overrides, "name")) {
                normalized.name = normalizeNullableString(overrides.name ?? null);
            }
            if (Object.prototype.hasOwnProperty.call(overrides, "flag")) {
                normalized.flag = normalizeNullableBoolean(overrides.flag ?? null);
            }
            return normalized;
        },
    });
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

suite("Feature capture store", () => {
    test("ring buffer trims oldest past capacity and ids stay monotonic", () => {
        const store = createStore(3);
        for (let index = 0; index < 5; index++) {
            store.addEvent({ timestamp: index, result: "success", label: `evt${index}` });
        }

        const events = store.getEvents();
        expect(events.length).to.equal(3);
        expect(events.map((event) => event.label)).to.deep.equal(["evt2", "evt3", "evt4"]);
        expect(events[2].id).to.equal("E-5");
    });

    test("pending event finalizes in place via updateEvent", () => {
        const store = createStore();
        const pending = store.addEvent({ timestamp: 1, result: "pending" });
        const updated = store.updateEvent(pending.id, { timestamp: 2, result: "success" });

        expect(updated?.id).to.equal(pending.id);
        expect(store.getEvents().length).to.equal(1);
        expect(store.getEvent(pending.id)?.result).to.equal("success");
    });

    test("mutateEvent fires change only when the mutator reports a change", () => {
        const store = createStore();
        const event = store.addEvent({ timestamp: 1, result: "success" });
        let changes = 0;
        store.onDidChange(() => changes++);

        store.mutateEvent(event.id, (target) => {
            if (target.result !== "success") {
                return false;
            }
            target.result = "accepted";
            return true;
        });
        store.mutateEvent(event.id, (target) => target.result === "success" && false);

        expect(changes).to.equal(1);
        expect(store.getEvent(event.id)?.result).to.equal("accepted");
    });

    test("shouldCapture honors panel-open OR record-when-closed", () => {
        const store = createStore();
        expect(store.shouldCapture(false)).to.equal(false);
        expect(store.shouldCapture(true)).to.equal(true);
        store.setPanelOpen(true);
        expect(store.shouldCapture(false)).to.equal(true);
    });

    test("import recovers the id counter and normalizes overrides", () => {
        const store = createStore();
        store.importEvents(
            [
                { id: "E-7", timestamp: 1, result: "success" },
                { id: "external-3", timestamp: 2, result: "error" },
            ],
            { name: "  padded  ", flag: null },
        );

        expect(store.getOverrides().name).to.equal("padded");
        const added = store.addEvent({ timestamp: 3, result: "success" });
        expect(added.id).to.equal("E-8");
    });

    test("partial override update only touches present keys", () => {
        const store = createStore();
        store.updateOverrides({ name: "alpha" });
        store.updateOverrides({ flag: true });
        expect(store.getOverrides()).to.deep.equal({ name: "alpha", flag: true });
    });
});

suite("Feature trace codec", () => {
    const metadata = {
        extensionVersion: "1.0.0-test",
        overrides: { name: "n", flag: true },
        recordWhenClosed: false,
    };

    test("envelope shape and extra metadata ride through", () => {
        const trace = serializeFeatureTrace([{ id: "E-1", timestamp: 5, result: "success" }], {
            ...metadata,
            extra: { customMarker: 42 },
        });

        expect(trace.version).to.equal(1);
        expect(trace._extensionVersion).to.equal("1.0.0-test");
        expect((trace as unknown as { customMarker: number }).customMarker).to.equal(42);
        expect(trace.events.length).to.equal(1);
    });

    test("redaction: key set + structural special case, nested at any depth", () => {
        const events = [
            {
                id: "E-1",
                timestamp: 1,
                result: "success",
                secretText: "CANARY-prompt-a1",
                nested: { inner: [{ secretText: "CANARY-prompt-b2" }] },
                messages: [{ role: "user", content: "CANARY-msg-c3" }],
            },
        ];
        const trace = serializeFeatureTrace(events, metadata, {
            redact: true,
            redaction: {
                redactedKeys: new Set(["secretText"]),
                redactSpecial: (key, value) =>
                    key === "messages" && Array.isArray(value)
                        ? value.map((message) => ({ ...message, content: FEATURE_TRACE_REDACTED }))
                        : undefined,
            },
        });

        const serialized = JSON.stringify(trace);
        expect(serialized.includes("CANARY-prompt-a1")).to.equal(false);
        expect(serialized.includes("CANARY-prompt-b2")).to.equal(false);
        expect(serialized.includes("CANARY-msg-c3")).to.equal(false);
        expect(serialized.includes("user")).to.equal(true);
    });

    test("size cap drops oldest events first and flags truncation", () => {
        const bigPayload = "x".repeat(200_000);
        const events = Array.from({ length: 12 }, (_, index) => ({
            id: `E-${index + 1}`,
            timestamp: index,
            result: "success",
            label: bigPayload,
        }));
        const trace = serializeFeatureTrace(events, metadata, { maxFileSizeMB: 1 });

        expect(trace._truncated).to.equal(true);
        expect(trace.events.length).to.be.greaterThan(0);
        expect(trace.events.length).to.be.lessThan(12);
        expect(trace.events[0].id).to.not.equal("E-1");
        expect(trace.events[trace.events.length - 1].id).to.equal("E-12");
    });

    test("normalize tolerates missing metadata, rejects non-trace JSON", () => {
        const normalized = normalizeFeatureTraceFile<TestEvent, TestOverrides>(
            { events: [{ id: "E-1", timestamp: 1, result: "success" }] },
            "test.json",
            { featureLabel: "test" },
        );
        expect(normalized.version).to.equal(1);
        expect(normalized._extensionVersion).to.equal("unknown");
        expect(normalized.recordWhenClosed).to.equal(false);

        expect(() =>
            normalizeFeatureTraceFile({ nope: true }, "bad.json", { featureLabel: "test" }),
        ).to.throw("bad.json is not a test trace JSON file.");
    });
});

interface TestConfig {
    speed: string;
    depth: string;
}

interface TestCell extends FeatureReplayMatrixCellBase {
    speed: string;
    depth: string;
}

function createEngineHarness() {
    const executed: Array<{ eventId: string; config: TestConfig; tags: FeatureReplayTags }> = [];
    let disposed = false;
    let stateChanges = 0;
    let executeDelayMs = 0;
    let failFor: string | undefined;
    const host: FeatureReplayHost<TestEvent, TestConfig, TestCell> = {
        feature: "testFeature",
        isRunnable: (event) => event.result !== "pending" && event.result !== "queued",
        captureConfig: () => ({ speed: "captured", depth: "captured" }),
        resolveLiveConfig: () => ({ speed: "live", depth: "live" }),
        compactConfig: (config) => ({ ...config }),
        compactPartialConfig: (partial) => ({ ...(partial ?? {}) }),
        resolveMatrixCellConfig: (cell) => ({ speed: cell.speed, depth: cell.depth }),
        formatCellLabel: (cell) => `${cell.speed} x ${cell.depth}`,
        formatSourceLabel: (event) => `src-${event.id}`,
        createQueuedEvent: (snapshot) => ({
            ...snapshot.event,
            result: "queued",
        }),
        markEventRunning: (event, startedAt) => ({
            ...event,
            timestamp: startedAt,
            result: "pending",
        }),
        execute: async (event, config, tags) => {
            if (executeDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, executeDelayMs));
            }
            if (failFor && tags.replaySourceEventId === failFor) {
                throw new Error("executor exploded");
            }
            executed.push({ eventId: event.id, config, tags });
        },
        onStateChanged: () => stateChanges++,
        isDisposed: () => disposed,
    };
    const engine = new FeatureReplayEngine<TestEvent, TestConfig, TestCell>(host);
    return {
        engine,
        executed,
        setDisposed: (value: boolean) => (disposed = value),
        setDelay: (ms: number) => (executeDelayMs = ms),
        setFailFor: (sourceEventId: string) => (failFor = sourceEventId),
        getStateChanges: () => stateChanges,
    };
}

function testEvent(id: string): TestEvent {
    return { id, timestamp: 100, result: "success" };
}

suite("Feature replay engine", () => {
    test("single run drains sequentially in cart order and completes", async () => {
        const harness = createEngineHarness();
        harness.engine.addToCart([testEvent("E-1"), testEvent("E-2"), testEvent("E-3")]);
        harness.engine.queueCart();

        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        expect(harness.executed.map((entry) => entry.tags.replaySourceEventId)).to.deep.equal([
            "E-1",
            "E-2",
            "E-3",
        ]);
        const run = harness.engine.getState().runs[0];
        expect(run.totalEvents).to.equal(3);
        expect(run.completedEvents).to.equal(3);
        expect(harness.engine.getState().queueRows.length).to.equal(0);
        expect(harness.engine.getState().activeRunId).to.equal(undefined);
    });

    test("config modes: snapshot, override merge, live", async () => {
        const harness = createEngineHarness();
        harness.engine.addToCart([testEvent("E-1")]);
        const snapshotId = harness.engine.getState().cart[0].id;
        harness.engine.updateCartSnapshot(snapshotId, {
            configMode: "override",
            override: { depth: "overridden" },
        });
        harness.engine.queueCart();
        await waitFor(
            () => harness.engine.getState().runs.length === 1 && harness.executed.length === 1,
        );
        expect(harness.executed[0].config).to.deep.equal({
            speed: "captured",
            depth: "overridden",
        });

        harness.engine.addToCart([testEvent("E-2")]);
        harness.engine.queueCart("live");
        await waitFor(() => harness.executed.length === 3);
        // Rows 2 and 3: the first cart entry replays again (still in cart) plus the new one.
        expect(harness.executed[2].config).to.deep.equal({ speed: "live", depth: "live" });
    });

    test("matrix run: cells x snapshots rows, cell config and labels", async () => {
        const harness = createEngineHarness();
        harness.engine.addToCart([testEvent("E-1"), testEvent("E-2")]);
        harness.engine.runMatrix([
            { cellId: "cell-1", ordinal: 1, speed: "fast", depth: "shallow" },
            { cellId: "cell-2", ordinal: 2, speed: "slow", depth: "deep" },
        ]);

        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");

        expect(harness.executed.length).to.equal(4);
        const run = harness.engine.getState().runs[0];
        expect(run.kind).to.equal("matrix");
        expect(run.totalEvents).to.equal(4);
        expect(run.matrixCells?.length).to.equal(2);
        expect(harness.executed[0].config).to.deep.equal({ speed: "fast", depth: "shallow" });
        expect(harness.executed[3].config).to.deep.equal({ speed: "slow", depth: "deep" });
        expect(harness.executed[0].tags.replayMatrixCellId).to.equal("cell-1");
        expect(harness.executed[0].tags.replayTraceId).to.equal(run.traceId);
    });

    test("cancelRun drops queued rows, keeps the running row, flips status", async () => {
        const harness = createEngineHarness();
        harness.setDelay(30);
        harness.engine.addToCart([testEvent("E-1"), testEvent("E-2"), testEvent("E-3")]);
        harness.engine.queueCart();

        await waitFor(() => harness.engine.getState().queueRows[0]?.status === "running");
        const runId = harness.engine.getState().runs[0].id;
        harness.engine.cancelRun(runId);

        await waitFor(() => harness.engine.getState().queueRows.length === 0);
        expect(harness.engine.getState().runs[0].status).to.equal("cancelled");
        expect(harness.executed.length).to.equal(1);
    });

    test("a throwing executor does not wedge the drain loop", async () => {
        const harness = createEngineHarness();
        harness.setFailFor("E-2");
        harness.engine.addToCart([testEvent("E-1"), testEvent("E-2"), testEvent("E-3")]);
        harness.engine.queueCart();

        await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");
        expect(harness.executed.map((entry) => entry.tags.replaySourceEventId)).to.deep.equal([
            "E-1",
            "E-3",
        ]);
        expect(harness.engine.getState().runs[0].completedEvents).to.equal(3);
    });

    test("replay.run and replay.item spans reach the diag substrate", async () => {
        const events: DiagEvent[] = [];
        const sink = {
            id: "featureCaptureTestSink",
            tryWrite: (event: DiagEvent) => {
                events.push(event);
            },
        };
        diag.addSink(sink);
        try {
            const harness = createEngineHarness();
            harness.engine.addToCart([testEvent("E-1")]);
            harness.engine.queueCart();
            await waitFor(() => harness.engine.getState().runs[0]?.status === "completed");
            await waitFor(
                () =>
                    events.some((event) => event.type === "replay.run.end") &&
                    events.some((event) => event.type === "replay.item.end"),
            );

            const runBegin = events.find((event) => event.type === "replay.run.begin");
            const itemEnd = events.find((event) => event.type === "replay.item.end");
            expect(runBegin?.feature).to.equal("testFeature");
            expect(itemEnd?.status).to.equal("ok");
        } finally {
            diag.removeSink(sink.id);
        }
    });
});

suite("Feature settings snapshot", () => {
    test("classification: secret pattern wins, explicit cls honored, primitives plain", () => {
        expect(classifySettingValue({ key: "mssql.provider.apiKeyName" }, "abc")).to.equal(
            "secret",
        );
        expect(
            classifySettingValue({ key: "mssql.provider.apiKeyName", cls: "public" }, "abc"),
        ).to.equal("secret");
        expect(
            classifySettingValue(
                { key: "mssql.some.enumSetting", cls: "diagnostic.metadata" },
                "balanced",
            ),
        ).to.equal("diagnostic.metadata");
        expect(classifySettingValue({ key: "mssql.some.numeric" }, 42)).to.equal(
            "diagnostic.metadata",
        );
        expect(classifySettingValue({ key: "mssql.some.freeText" }, "hello world")).to.equal(
            "user.text",
        );
    });

    test("settings.snapshot event is emitted with classified fields", async () => {
        const events: DiagEvent[] = [];
        const sink = {
            id: "settingsSnapshotTestSink",
            tryWrite: (event: DiagEvent) => {
                events.push(event);
            },
        };
        diag.addSink(sink);
        try {
            emitSettingsSnapshot(
                {
                    feature: "testFeature",
                    keys: [
                        "mssql.queryStudio.enabled",
                        { key: "mssql.logDebugInfo", cls: "diagnostic.metadata" },
                    ],
                },
                "manual",
            );

            await waitFor(() => events.some((event) => event.type === "settings.snapshot"));
            const snapshot = events.find((event) => event.type === "settings.snapshot");
            expect(snapshot?.kind).to.equal("state");
            expect(snapshot?.payload?.settingsFeature?.v).to.equal("testFeature");
            const enabledField = snapshot?.payload?.["mssql.queryStudio.enabled"];
            expect(enabledField?.handling).to.equal("plain");
            expect(enabledField?.v).to.equal(false);
        } finally {
            diag.removeSink(sink.id);
        }
    });
});
