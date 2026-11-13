/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Waterfall span lifecycle + viewer self-noise: the Debug Console's own RPC
 * spans (tag "viewerInternal") must never pollute or extend the traces being
 * viewed, completed traces must keep a fixed end, and the store query excludes
 * them by default with an explicit opt-in.
 */

import { expect } from "chai";
import { buildWaterfall, stripViewerNoise, userActions } from "../../src/diagnostics/analysis";
import { SessionStore } from "../../src/diagnostics/sessionStore";
import { DIAG_SCHEMA_VERSION, DiagEvent } from "../../src/sharedInterfaces/debugConsole";

let seq = 0;

function makeEvent(partial: Partial<DiagEvent> & { type: string }): DiagEvent {
    seq++;
    return {
        schemaVersion: DIAG_SCHEMA_VERSION,
        eventId: `evt_${seq}`,
        sessionId: "sess_test",
        seq,
        epochMs: 1_000_000 + seq * 10,
        process: "extensionHost",
        feature: "query",
        kind: "event",
        status: "ok",
        cls: { max: "public", redactedFields: 0, policyId: "p" },
        ...partial,
    };
}

/** A realistic completed scenario trace: query submit → complete. */
function scenarioTrace(traceId: string): DiagEvent[] {
    return [
        makeEvent({ type: "mssql.query.submit", traceId, epochMs: 1000 }),
        makeEvent({ type: "mssql.query.complete", traceId, epochMs: 1500 }),
    ];
}

/** Viewer-internal span events as webviewBaseController emits them. */
function viewerEvents(traceId: string, atMs: number): DiagEvent[] {
    return [
        makeEvent({
            type: "webview.debugConsole.dc/getWaterfall.begin",
            feature: "webview.debugConsole",
            kind: "span",
            traceId,
            tags: ["viewerInternal"],
            epochMs: atMs,
        }),
        makeEvent({
            type: "webview.debugConsole.dc/getWaterfall.end",
            feature: "webview.debugConsole",
            kind: "span",
            traceId,
            tags: ["viewerInternal"],
            durationMs: 3,
            epochMs: atMs + 3,
        }),
    ];
}

suite("Debug Console viewer self-noise + waterfall lifecycle", () => {
    test("stripViewerNoise removes only viewer-internal events", () => {
        const events = [...scenarioTrace("t1"), ...viewerEvents("viewer_sess", 2000)];
        const stripped = stripViewerNoise(events);
        expect(stripped).to.have.length(2);
        expect(stripped.every((e) => !e.tags?.includes("viewerInternal"))).to.equal(true);
    });

    test("a completed trace's waterfall end is FIXED even when viewer events join its trace id", () => {
        const traceId = "trace_query_1";
        const clean = scenarioTrace(traceId);
        const before = buildWaterfall(clean, traceId)!;
        // Simulate the old bug: viewer spans landing in the SAME trace, later.
        const polluted = [...clean, ...viewerEvents(traceId, 90_000)];
        const after = buildWaterfall(polluted, traceId)!;
        expect(after.endEpochMs).to.equal(before.endEpochMs);
        expect(after.activities.length).to.equal(before.activities.length);
    });

    test("repeatedly rebuilding a completed waterfall is stable", () => {
        const traceId = "trace_query_2";
        let events = scenarioTrace(traceId);
        const first = buildWaterfall(events, traceId)!;
        for (let round = 0; round < 5; round++) {
            events = [...events, ...viewerEvents(traceId, 100_000 + round * 1000)];
            const rebuilt = buildWaterfall(events, traceId)!;
            expect(rebuilt.endEpochMs, `round ${round}`).to.equal(first.endEpochMs);
        }
    });

    test("userActions ignores viewer-internal traffic", () => {
        const events = [
            ...scenarioTrace("t2"),
            ...viewerEvents("viewer_sess", 2000),
            ...viewerEvents("viewer_sess", 3000),
        ];
        const actions = userActions(events);
        expect(actions).to.have.length(1);
        expect(actions[0].eventCount).to.equal(2);
    });

    test("connection.failed pairs with connection.begin in the waterfall", () => {
        const traceId = "trace_conn";
        const events = [
            makeEvent({
                type: "mssql.connection.begin",
                feature: "connection",
                traceId,
                epochMs: 1000,
            }),
            makeEvent({
                type: "mssql.connection.failed",
                feature: "connection",
                traceId,
                status: "error",
                epochMs: 1400,
            }),
        ];
        const model = buildWaterfall(events, traceId)!;
        const bar = model.activities.find((a) => a.label.includes("connection.failed"));
        expect(bar, "paired connection.failed activity").to.not.equal(undefined);
        expect(bar!.durationMs).to.equal(400);
        expect(bar!.status).to.equal("error");
    });

    test("store query excludes viewer internals by default and includes on request", () => {
        const store = new SessionStore("/nonexistent-test-root");
        const events = [...scenarioTrace("t3"), ...viewerEvents("viewer_sess", 2000)];
        const defaultResult = store.query(events, { sourceId: "live:x" }, []);
        expect(defaultResult.rows).to.have.length(2);
        const withViewer = store.query(
            events,
            { sourceId: "live:x", includeViewerInternal: true },
            [],
        );
        expect(withViewer.rows).to.have.length(4);
    });
});
