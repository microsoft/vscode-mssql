/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WI-4.1 — provenance cohorts and the §8.2 corrected metric table:
 * cohort derivation (replay evidence, explicit stamps, imported traces),
 * default-cohort exclusion of replay, every §8.2 metric against a fixture
 * covering every terminal result (incl. blocked/cancelled) and mixed
 * cohorts, pending/queued/blocked exclusion from terminal denominators,
 * and the WI-4.4 stored-session deep-link matcher.
 */

import { expect } from "chai";
import {
    computeInlineCompletionMetrics,
    computeInlineCompletionRateMetrics,
    classifyInlineCompletionResult,
    createFacetCounts,
    filterInlineCompletionEvents,
    filterInlineCompletionEventsByCohort,
    getEventDimension,
    getEventProvenanceCohort,
    pivotInlineCompletionEvents,
    summarizeNumberDistribution,
    InlineCompletionRateMetricId,
} from "../../src/sharedInterfaces/inlineCompletionAnalysis";
import {
    COMPLETION_REPLAY_PROVENANCE_SCHEMA,
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
    storedSessionFileKeysForHostSession,
} from "../../src/sharedInterfaces/inlineCompletionDebug";

function makeEvent(
    overrides: Partial<InlineCompletionDebugEvent> = {},
): InlineCompletionDebugEvent {
    return {
        id: "E-1",
        timestamp: 1_000,
        documentUri: "file:///a.sql",
        documentFileName: "a.sql",
        line: 1,
        column: 1,
        triggerKind: "automatic",
        explicitFromUser: false,
        completionCategory: "continuation",
        intentMode: false,
        inferredSystemQuery: false,
        modelFamily: "fake-family",
        modelId: "fake-model",
        modelVendor: "test-vendor",
        result: "success",
        latencyMs: 100,
        inputTokens: 10,
        outputTokens: 5,
        schemaObjectCount: 2,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        usedSchemaContext: true,
        overridesApplied: { customSystemPromptUsed: false },
        promptMessages: [],
        rawResponse: "SELECT 1",
        sanitizedResponse: "SELECT 1",
        finalCompletionText: "SELECT 1",
        schemaContextFormatted: undefined,
        locals: {},
        ...overrides,
    };
}

function replayEvent(
    overrides: Partial<InlineCompletionDebugEvent> = {},
): InlineCompletionDebugEvent {
    return makeEvent({
        tags: { replayRunId: "run-1", replaySourceEventId: "E-src" },
        ...overrides,
    });
}

function metricById(events: InlineCompletionDebugEvent[], id: InlineCompletionRateMetricId) {
    const metric = computeInlineCompletionRateMetrics(events).find((entry) => entry.id === id);
    expect(metric, `metric ${id} present`).to.not.equal(undefined);
    return metric!;
}

suite("inlineCompletionAnalysis cohorts (§8.1)", () => {
    test("live user events derive liveUser", () => {
        expect(getEventProvenanceCohort(makeEvent())).to.equal("liveUser");
    });

    test("replay tags derive interactiveReplay", () => {
        expect(getEventProvenanceCohort(replayEvent())).to.equal("interactiveReplay");
        expect(getEventProvenanceCohort(makeEvent({ tags: { replayTraceId: "t-1" } }))).to.equal(
            "interactiveReplay",
        );
        expect(
            getEventProvenanceCohort(makeEvent({ locals: { replayMode: "frozenPrompt" } })),
        ).to.equal("interactiveReplay");
    });

    test("WI-3.4 replay provenance block derives interactiveReplay", () => {
        const event = makeEvent({
            replayProvenance: {
                schema: COMPLETION_REPLAY_PROVENANCE_SCHEMA,
                mode: "frozenPrompt",
                sourceEventSchema: "v1",
                schemaContextSource: "captured",
                extensionVersion: "0.0.0",
                model: {},
                effectiveConfigDigest: "d",
            },
        });
        expect(getEventProvenanceCohort(event)).to.equal("interactiveReplay");
    });

    test("imported trace stamp derives externalImport", () => {
        const event = makeEvent({ locals: { traceSourceKind: "imported" } });
        expect(getEventProvenanceCohort(event)).to.equal("externalImport");
        // Folder and stored-session traces stay liveUser.
        expect(
            getEventProvenanceCohort(makeEvent({ locals: { traceSourceKind: "folder" } })),
        ).to.equal("liveUser");
        expect(
            getEventProvenanceCohort(makeEvent({ locals: { traceSourceKind: "storedSession" } })),
        ).to.equal("liveUser");
    });

    test("explicit cohort stamp wins (full union typed)", () => {
        expect(
            getEventProvenanceCohort(
                makeEvent({ tags: { provenanceCohort: "controlledHarness" } }),
            ),
        ).to.equal("controlledHarness");
        expect(
            getEventProvenanceCohort(
                makeEvent({ locals: { provenanceCohort: "generatedFixture" } }),
            ),
        ).to.equal("generatedFixture");
        // A stamp beats replay evidence — the emitter's claim is authoritative.
        expect(
            getEventProvenanceCohort(
                replayEvent({ tags: { replayRunId: "r", provenanceCohort: "generatedFixture" } }),
            ),
        ).to.equal("generatedFixture");
    });

    test("default Live selection excludes replay, imports, and fixtures", () => {
        const events = [
            makeEvent({ id: "live-1" }),
            replayEvent({ id: "replay-1" }),
            makeEvent({ id: "import-1", locals: { traceSourceKind: "imported" } }),
            makeEvent({ id: "fixture-1", tags: { provenanceCohort: "generatedFixture" } }),
        ];
        const live = filterInlineCompletionEventsByCohort(events, "live");
        expect(live.map((event) => event.id)).to.deep.equal(["live-1"]);
        const replay = filterInlineCompletionEventsByCohort(events, "replay");
        expect(replay.map((event) => event.id)).to.deep.equal(["replay-1"]);
        expect(filterInlineCompletionEventsByCohort(events, "all")).to.have.length(4);
    });

    test("provenanceCohort is a dimension, facet, and filter", () => {
        const events = [makeEvent(), replayEvent(), replayEvent()];
        expect(getEventDimension(events[0]!, "provenanceCohort")).to.equal("liveUser");
        const facets = createFacetCounts(events, "provenanceCohort");
        expect(facets).to.deep.equal([
            { value: "interactiveReplay", count: 2 },
            { value: "liveUser", count: 1 },
        ]);
        const filtered = filterInlineCompletionEvents(events, {
            provenanceCohorts: ["interactiveReplay"],
        });
        expect(filtered).to.have.length(2);
        const pivot = pivotInlineCompletionEvents(events, "provenanceCohort");
        expect(pivot.map((row) => row.key)).to.deep.equal(["interactiveReplay", "liveUser"]);
    });
});

suite("inlineCompletionAnalysis §8.2 corrected metrics (WI-4.1)", () => {
    // One fixture covering EVERY terminal result plus every non-terminal
    // record kind, with a replay cohort mixed in.
    const fixture: InlineCompletionDebugEvent[] = [
        makeEvent({ id: "s1", result: "success" }),
        makeEvent({ id: "s2", result: "success" }),
        makeEvent({ id: "a1", result: "accepted" }),
        makeEvent({ id: "sk1", result: "skipped" }),
        makeEvent({ id: "em1", result: "emptyFromModel" }),
        makeEvent({ id: "es1", result: "emptyFromSanitizer" }),
        makeEvent({ id: "nm1", result: "noModel" }),
        makeEvent({ id: "np1", result: "noPermission" }),
        makeEvent({ id: "er1", result: "error" }),
        makeEvent({ id: "c1", result: "cancelled" }),
        // Non-terminal: never in any denominator.
        makeEvent({ id: "p1", result: "pending" }),
        makeEvent({ id: "q1", result: "queued" }),
        makeEvent({ id: "b1", result: "blocked" }),
        // Replay cohort: one produced output, one empty, one failed.
        replayEvent({ id: "r1", result: "success" }),
        replayEvent({ id: "r2", result: "emptyFromSanitizer" }),
        replayEvent({ id: "r3", result: "error" }),
    ];
    const liveFixture = filterInlineCompletionEventsByCohort(fixture, "live");

    test("population classification (pending/queued/blocked non-terminal)", () => {
        for (const result of [
            "pending",
            "queued",
            "blocked",
        ] as InlineCompletionDebugEventResult[]) {
            const populations = classifyInlineCompletionResult(result);
            expect(populations.terminal, `${result} terminal`).to.equal(false);
            expect(populations.started, `${result} started`).to.equal(false);
            expect(populations.shown, `${result} shown`).to.equal(false);
        }
        expect(classifyInlineCompletionResult("success").shown).to.equal(true);
        expect(classifyInlineCompletionResult("accepted").shown).to.equal(true);
        expect(classifyInlineCompletionResult("emptyFromSanitizer").rawNonempty).to.equal(true);
        expect(classifyInlineCompletionResult("skipped").started).to.equal(false);
        expect(classifyInlineCompletionResult("noModel").modelCalled).to.equal(false);
        expect(classifyInlineCompletionResult("cancelled").modelCalled).to.equal(false);
    });

    test("acceptance rate = accepted / (accepted + shown-not-accepted)", () => {
        // Live cohort: shown = s1, s2, a1 → 3; accepted = 1.
        const metric = metricById(liveFixture, "acceptanceRate");
        expect(metric.numerator).to.equal(1);
        expect(metric.denominator).to.equal(3);
        expect(metric.rate).to.be.closeTo(1 / 3, 1e-9);
        // emptyFrom*/skip/error/noModel/noPermission/cancelled are NOT shown:
        // total live events are 10 terminal — denominator must not be 10.
        expect(metric.denominator).to.not.equal(10);
    });

    test("request error / skip / unavailable rates use terminal requests", () => {
        // Live cohort terminal = 10 (13 live minus pending/queued/blocked).
        const error = metricById(liveFixture, "requestErrorRate");
        expect(error.numerator).to.equal(1);
        expect(error.denominator).to.equal(10);
        const skip = metricById(liveFixture, "skipRate");
        expect(skip.numerator).to.equal(1);
        expect(skip.denominator).to.equal(10);
        const unavailable = metricById(liveFixture, "unavailableRate");
        expect(unavailable.numerator).to.equal(2); // noModel + noPermission
        expect(unavailable.denominator).to.equal(10);
    });

    test("model-call and yield rates", () => {
        // started = terminal − skipped = 9; modelCalled = s1,s2,a1,em1,es1,er1 = 6.
        const modelCall = metricById(liveFixture, "modelCallRate");
        expect(modelCall.numerator).to.equal(6);
        expect(modelCall.denominator).to.equal(9);
        // shown = 3 of 6 model calls.
        const yieldRate = metricById(liveFixture, "suggestionYieldRate");
        expect(yieldRate.numerator).to.equal(3);
        expect(yieldRate.denominator).to.equal(6);
        expect(yieldRate.denominatorLabel).to.contain("model calls");
    });

    test("cancellation rate = cancelled / started", () => {
        const metric = metricById(liveFixture, "cancellationRate");
        expect(metric.numerator).to.equal(1);
        expect(metric.denominator).to.equal(9);
    });

    test("sanitizer-empty rate = empty after sanitizer / nonempty raw", () => {
        // rawNonempty = s1,s2,a1,es1 = 4; sanitizer-empty = 1.
        const metric = metricById(liveFixture, "sanitizerEmptyRate");
        expect(metric.numerator).to.equal(1);
        expect(metric.denominator).to.equal(4);
    });

    test("replay production rate counts only the interactiveReplay cohort", () => {
        // Over the FULL mixed fixture: replay completed = r1 (success) + r2
        // (emptyFromSanitizer) = 2; produced = r1 only. r3 failed — excluded.
        const metric = metricById(fixture, "replayProductionRate");
        expect(metric.numerator).to.equal(1);
        expect(metric.denominator).to.equal(2);
        // In the default live view the metric is honestly undefined (0/0).
        const liveMetric = metricById(liveFixture, "replayProductionRate");
        expect(liveMetric.denominator).to.equal(0);
        expect(liveMetric.rate).to.equal(undefined);
    });

    test("replay manual preference is an honest placeholder (0/0, undefined)", () => {
        const metric = metricById(fixture, "replayManualPreference");
        expect(metric.numerator).to.equal(0);
        expect(metric.denominator).to.equal(0);
        expect(metric.rate).to.equal(undefined);
    });

    test("every metric names its numerator and denominator", () => {
        for (const metric of computeInlineCompletionRateMetrics(fixture)) {
            expect(metric.numeratorLabel, metric.id).to.have.length.greaterThan(0);
            expect(metric.denominatorLabel, metric.id).to.have.length.greaterThan(0);
        }
    });

    test("computeInlineCompletionMetrics uses the corrected denominators", () => {
        const metrics = computeInlineCompletionMetrics(liveFixture);
        expect(metrics.count).to.equal(13);
        expect(metrics.terminalCount).to.equal(10);
        expect(metrics.nonTerminalCount).to.equal(3);
        expect(metrics.shownCount).to.equal(3);
        expect(metrics.acceptRate).to.be.closeTo(1 / 3, 1e-9); // accepted/shown
        expect(metrics.cancelRate).to.be.closeTo(1 / 9, 1e-9); // cancelled/started
        expect(metrics.skipRate).to.be.closeTo(1 / 10, 1e-9); // skipped/terminal
        expect(metrics.errorRate).to.be.closeTo(3 / 10, 1e-9); // error+noModel+noPermission buckets /terminal
    });

    test("empty groups produce zero rates, not NaN", () => {
        const metrics = computeInlineCompletionMetrics([]);
        expect(metrics.acceptRate).to.equal(0);
        expect(metrics.cancelRate).to.equal(0);
        expect(metrics.terminalCount).to.equal(0);
    });

    test("existing dimensions keep working over the mixed fixture", () => {
        for (const dimension of [
            "model",
            "profile",
            "schemaMode",
            "result",
            "trigger",
            "replayRun",
            "replayMode",
        ] as const) {
            const facets = createFacetCounts(fixture, dimension);
            expect(facets.length, dimension).to.be.greaterThan(0);
        }
    });
});

suite("inlineCompletionAnalysis distribution primitives (WI-4.3)", () => {
    test("summarizeNumberDistribution is honest about empties", () => {
        expect(summarizeNumberDistribution([])).to.equal(undefined);
        const summary = summarizeNumberDistribution([30, 10, 20])!;
        expect(summary.n).to.equal(3);
        expect(summary.mean).to.equal(20);
        expect(summary.p50).to.equal(20);
        expect(summary.min).to.equal(10);
        expect(summary.max).to.equal(30);
    });
});

suite("stored-session deep-link matcher (WI-4.4)", () => {
    test("matches only the hinted host session's stored entries", () => {
        const entries = [
            { fileKey: "storedSession:hs-1/cs-a", sourceKind: "storedSession" as const },
            { fileKey: "storedSession:hs-1/cs-b", sourceKind: "storedSession" as const },
            { fileKey: "storedSession:hs-2/cs-c", sourceKind: "storedSession" as const },
            { fileKey: "file:trace.json", sourceKind: "folder" as const },
            // A folder file that HAPPENS to start with the prefix must not match.
            { fileKey: "storedSession:hs-1/impostor", sourceKind: "imported" as const },
        ];
        expect(storedSessionFileKeysForHostSession(entries, "hs-1")).to.deep.equal([
            "storedSession:hs-1/cs-a",
            "storedSession:hs-1/cs-b",
        ]);
        expect(storedSessionFileKeysForHostSession(entries, "hs-3")).to.deep.equal([]);
    });
});
