/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WI-4.2 — paired replay-matrix analysis (§8.3): per-cell aggregates,
 * source-paired deltas versus a baseline cell, missingness (expected vs
 * settled, missing pairs), n=1 marking, the fixed exploratory label, and the
 * host-side item-input builders (latency from the durable record; tokens and
 * output presence ONLY from a resolved result event). Also covers the
 * WI-4.4 Replay Lab host-session filter used by the History deep link.
 */

import { expect } from "chai";
import {
    REPLAY_ANALYSIS_DEFAULT_CELL_ID,
    REPLAY_ANALYSIS_EXPLORATORY_LABEL,
    ReplayAnalysisItemInputV1,
    computeReplayRunAnalysis,
} from "../../src/sharedInterfaces/inlineCompletionReplayAnalysis";
import {
    buildLiveReplayAnalysisItemInput,
    buildReplayAnalysisItemInput,
} from "../../src/diagnostics/replayLabRpcHost";
import { ReplayRunItemRecordV1 } from "../../src/diagnostics/featureCapture/replayRunRepository";
import {
    ReplayLabRunRowV1,
    filterReplayLabRunRowsByHostSession,
} from "../../src/sharedInterfaces/replayLabRpc";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugReplayQueueRow,
} from "../../src/sharedInterfaces/inlineCompletionDebug";

const CELLS = [
    { cellId: "cell-a", label: "balanced x tight", ordinal: 0 },
    { cellId: "cell-b", label: "broad x tight", ordinal: 1 },
];

function item(overrides: Partial<ReplayAnalysisItemInputV1>): ReplayAnalysisItemInputV1 {
    return {
        replayItemId: "ri-1",
        sourceCaptureEventId: "src-1",
        matrixCellId: "cell-a",
        repetition: 1,
        status: "completed",
        ...overrides,
    };
}

suite("Paired replay analysis (WI-4.2 / §8.3)", () => {
    test("per-cell aggregates: counts, latency distribution, tokens, presence", () => {
        const analysis = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1", "src-2"],
            repetitions: 1,
            items: [
                item({
                    replayItemId: "a1",
                    sourceCaptureEventId: "src-1",
                    latencyMs: 100,
                    inputTokens: 10,
                    outputTokens: 5,
                    outputPresent: true,
                    replayMode: "rebuildCurrentSchema",
                    schemaContextSource: "current",
                }),
                item({
                    replayItemId: "a2",
                    sourceCaptureEventId: "src-2",
                    latencyMs: 300,
                    inputTokens: 20,
                    outputTokens: 0,
                    outputPresent: false,
                    replayMode: "rebuildCurrentSchema",
                    schemaContextSource: "explicitFallback",
                }),
                item({
                    replayItemId: "b1",
                    matrixCellId: "cell-b",
                    sourceCaptureEventId: "src-1",
                    status: "failed",
                }),
                item({
                    replayItemId: "b2",
                    matrixCellId: "cell-b",
                    sourceCaptureEventId: "src-2",
                    status: "blocked",
                }),
            ],
        });
        expect(analysis.exploratory).to.equal(true);
        expect(analysis.exploratoryLabel).to.equal(REPLAY_ANALYSIS_EXPLORATORY_LABEL);
        expect(analysis.sourceCount).to.equal(2);
        const cellA = analysis.cells.find((cell) => cell.cellId === "cell-a")!;
        expect(cellA.expectedItems).to.equal(2);
        expect(cellA.settledItems).to.equal(2);
        expect(cellA.completed).to.equal(2);
        expect(cellA.missingItems).to.equal(0);
        expect(cellA.latency?.n).to.equal(2);
        expect(cellA.latency?.mean).to.equal(200);
        expect(cellA.inputTokensSum).to.equal(30);
        expect(cellA.outputTokensSum).to.equal(5);
        expect(cellA.tokenSampleCount).to.equal(2);
        expect(cellA.outputPresence).to.deep.equal({ produced: 1, known: 2, rate: 0.5 });
        expect(cellA.singleSample).to.equal(false);
        expect(cellA.replayModes).to.deep.equal(["rebuildCurrentSchema"]);
        expect(cellA.schemaContextSources).to.deep.equal(["current", "explicitFallback"]);
        expect(cellA.fallbackCount).to.equal(1);
        const cellB = analysis.cells.find((cell) => cell.cellId === "cell-b")!;
        expect(cellB.completed).to.equal(0);
        expect(cellB.failed).to.equal(1);
        expect(cellB.blocked).to.equal(1);
        expect(cellB.latency).to.equal(undefined); // no fabricated stats
        expect(cellB.outputPresence.rate).to.equal(undefined);
        expect(cellB.singleSample).to.equal(true);
    });

    test("source-paired deltas versus the baseline (first cell by ordinal)", () => {
        const analysis = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1", "src-2"],
            repetitions: 1,
            items: [
                // baseline cell-a
                item({
                    replayItemId: "a1",
                    sourceCaptureEventId: "src-1",
                    latencyMs: 100,
                    inputTokens: 10,
                    outputTokens: 4,
                    outputPresent: true,
                }),
                item({
                    replayItemId: "a2",
                    sourceCaptureEventId: "src-2",
                    latencyMs: 200,
                    inputTokens: 20,
                    outputTokens: 8,
                    outputPresent: true,
                }),
                // cell-b
                item({
                    replayItemId: "b1",
                    matrixCellId: "cell-b",
                    sourceCaptureEventId: "src-1",
                    latencyMs: 150,
                    inputTokens: 12,
                    outputTokens: 2,
                    outputPresent: true,
                }),
                item({
                    replayItemId: "b2",
                    matrixCellId: "cell-b",
                    sourceCaptureEventId: "src-2",
                    latencyMs: 260,
                    inputTokens: 26,
                    outputTokens: 2,
                    outputPresent: false,
                }),
            ],
        });
        expect(analysis.baselineCellId).to.equal("cell-a");
        expect(analysis.pairedDeltas).to.have.length(1);
        const delta = analysis.pairedDeltas[0]!;
        expect(delta.cellId).to.equal("cell-b");
        expect(delta.baselineCellId).to.equal("cell-a");
        expect(delta.pairedSources).to.equal(2);
        expect(delta.missingPairs).to.equal(0);
        // per-source deltas: src-1 → +50, src-2 → +60
        expect(delta.latencyDelta?.n).to.equal(2);
        expect(delta.latencyDelta?.mean).to.equal(55);
        expect(delta.inputTokensDeltaMean).to.equal(4); // (+2 +6)/2
        expect(delta.outputTokensDeltaMean).to.equal(-4); // (−2 −6)/2
        // presence: cell-b produced for src-1 only → 0.5 − 1.0 = −0.5
        expect(delta.presencePairs).to.equal(2);
        expect(delta.outputPresenceDelta).to.be.closeTo(-0.5, 1e-9);
        expect(delta.singleSample).to.equal(false);
    });

    test("explicit baseline selection is honored", () => {
        const analysis = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1"],
            repetitions: 1,
            items: [
                item({ replayItemId: "a1", latencyMs: 100 }),
                item({ replayItemId: "b1", matrixCellId: "cell-b", latencyMs: 150 }),
            ],
            baselineCellId: "cell-b",
        });
        expect(analysis.baselineCellId).to.equal("cell-b");
        expect(analysis.pairedDeltas[0]!.cellId).to.equal("cell-a");
        expect(analysis.pairedDeltas[0]!.latencyDelta?.mean).to.equal(-50);
        // Unknown baseline falls back to the first cell by ordinal.
        const fallback = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1"],
            repetitions: 1,
            items: [item({})],
            baselineCellId: "nope",
        });
        expect(fallback.baselineCellId).to.equal("cell-a");
    });

    test("missingness: incomplete runs never fabricate denominators", () => {
        const analysis = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1", "src-2", "src-3"],
            repetitions: 1,
            items: [
                item({
                    replayItemId: "a1",
                    sourceCaptureEventId: "src-1",
                    latencyMs: 100,
                    outputPresent: true,
                }),
                item({
                    replayItemId: "b1",
                    matrixCellId: "cell-b",
                    sourceCaptureEventId: "src-2",
                    latencyMs: 400,
                    outputPresent: true,
                }),
                item({
                    replayItemId: "b2",
                    matrixCellId: "cell-b",
                    sourceCaptureEventId: "src-3",
                    status: "running",
                }),
            ],
        });
        const cellA = analysis.cells.find((cell) => cell.cellId === "cell-a")!;
        expect(cellA.expectedItems).to.equal(3);
        expect(cellA.settledItems).to.equal(1);
        expect(cellA.missingItems).to.equal(2);
        const cellB = analysis.cells.find((cell) => cell.cellId === "cell-b")!;
        expect(cellB.pending).to.equal(1);
        expect(cellB.missingItems).to.equal(1); // 3 expected − 1 settled − 1 pending
        // No source has completed items in BOTH cells → zero pairs, no deltas.
        const delta = analysis.pairedDeltas[0]!;
        expect(delta.pairedSources).to.equal(0);
        expect(delta.missingPairs).to.equal(3);
        expect(delta.latencyDelta).to.equal(undefined);
        expect(delta.outputPresenceDelta).to.equal(undefined);
        expect(delta.singleSample).to.equal(true);
    });

    test("n=1 marking on cells and paired sets", () => {
        const analysis = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1"],
            repetitions: 1,
            items: [
                item({ replayItemId: "a1", latencyMs: 100 }),
                item({ replayItemId: "b1", matrixCellId: "cell-b", latencyMs: 130 }),
            ],
        });
        for (const cell of analysis.cells) {
            expect(cell.singleSample, cell.cellId).to.equal(true);
        }
        expect(analysis.pairedDeltas[0]!.singleSample).to.equal(true);
    });

    test("single-config runs fold into a synthetic cell", () => {
        const analysis = computeReplayRunAnalysis({
            cells: [],
            sourceCaptureEventIds: ["src-1"],
            repetitions: 1,
            items: [item({ matrixCellId: undefined, latencyMs: 90 })],
        });
        expect(analysis.cells).to.have.length(1);
        expect(analysis.cells[0]!.cellId).to.equal(REPLAY_ANALYSIS_DEFAULT_CELL_ID);
        expect(analysis.pairedDeltas).to.deep.equal([]);
    });

    test("unresolved result stats are counted (completed items without presence)", () => {
        const analysis = computeReplayRunAnalysis({
            cells: CELLS,
            sourceCaptureEventIds: ["src-1"],
            repetitions: 1,
            items: [
                item({ replayItemId: "a1", latencyMs: 100 }), // no outputPresent
                item({
                    replayItemId: "b1",
                    matrixCellId: "cell-b",
                    latencyMs: 100,
                    outputPresent: true,
                }),
            ],
        });
        expect(analysis.unresolvedResultStats).to.equal(1);
    });
});

suite("Replay analysis item inputs (host projections)", () => {
    const record: ReplayRunItemRecordV1 = {
        replayRunId: "rr-1",
        replayItemId: "ri-1",
        sourceCaptureEventId: "src-1",
        matrixCellId: "cell-a",
        repetition: 1,
        queuedAt: 1_000,
        startedAt: 1_100,
        endedAt: 1_400,
        resolvedConfigDigest: "digest",
        status: "completed",
        resultEventId: "E-9",
        replayMode: "frozenPrompt",
        schemaContextSource: "captured",
        attempt: 1,
    };

    test("latency from the record; tokens/presence only from a resolved event", () => {
        const withoutEvent = buildReplayAnalysisItemInput(record, undefined);
        expect(withoutEvent.latencyMs).to.equal(300);
        expect(withoutEvent.inputTokens).to.equal(undefined);
        expect(withoutEvent.outputTokens).to.equal(undefined);
        expect(withoutEvent.outputPresent).to.equal(undefined); // missing, not false
        expect(withoutEvent.replayMode).to.equal("frozenPrompt");
        expect(withoutEvent.schemaContextSource).to.equal("captured");

        const resultEvent = {
            result: "success",
            inputTokens: 42,
            outputTokens: 7,
        } as InlineCompletionDebugEvent;
        const withEvent = buildReplayAnalysisItemInput(record, resultEvent);
        expect(withEvent.inputTokens).to.equal(42);
        expect(withEvent.outputTokens).to.equal(7);
        expect(withEvent.outputPresent).to.equal(true);

        const emptyEvent = { result: "emptyFromSanitizer" } as InlineCompletionDebugEvent;
        expect(buildReplayAnalysisItemInput(record, emptyEvent).outputPresent).to.equal(false);
    });

    test("live queue rows become pending inputs without event content", () => {
        const row = {
            id: "q-1",
            runId: "rr-1",
            sourceEventId: "SRC-2",
            status: "queued",
            queuedAt: 5,
            matrixCellId: "cell-b",
            repetition: 1,
            config: { replayMode: "rebuildCurrentSchema" },
            event: { link: { captureEventId: "ce-2" } },
        } as unknown as InlineCompletionDebugReplayQueueRow;
        const input = buildLiveReplayAnalysisItemInput(row);
        expect(input).to.deep.equal({
            replayItemId: "q-1",
            sourceCaptureEventId: "ce-2",
            matrixCellId: "cell-b",
            repetition: 1,
            status: "queued",
            replayMode: "rebuildCurrentSchema",
        });
    });
});

suite("Replay Lab host-session filter (WI-4.4 deep link)", () => {
    function row(overrides: Partial<ReplayLabRunRowV1>): ReplayLabRunRowV1 {
        return {
            replayRunId: "rr-x",
            currentHostSession: false,
            featureId: "completions",
            semantics: "interactiveExperiment",
            status: "completed",
            kind: "single",
            createdAt: 1,
            sourceCount: 1,
            cellCount: 0,
            repetitions: 1,
            expectedItems: 1,
            completedItems: 1,
            failedItems: 0,
            cancelledItems: 0,
            blockedItems: 0,
            durable: true,
            live: false,
            ...overrides,
        };
    }

    test("round trip: the chip's host session id selects exactly its runs", () => {
        const rows = [
            row({ replayRunId: "r1", hostSessionId: "hs-1" }),
            row({ replayRunId: "r2", hostSessionId: "hs-2" }),
            // live-only row (no manifest yet) — belongs to the current session
            row({ replayRunId: "r3", live: true, durable: false, currentHostSession: true }),
        ];
        expect(
            filterReplayLabRunRowsByHostSession(rows, "hs-1", "hs-live").map(
                (candidate) => candidate.replayRunId,
            ),
        ).to.deep.equal(["r1"]);
        // Filtering to the CURRENT session includes live-only rows.
        expect(
            filterReplayLabRunRowsByHostSession(rows, "hs-live", "hs-live").map(
                (candidate) => candidate.replayRunId,
            ),
        ).to.deep.equal(["r3"]);
        // No filter = passthrough.
        expect(filterReplayLabRunRowsByHostSession(rows, undefined, "hs-live")).to.have.length(3);
    });
});
