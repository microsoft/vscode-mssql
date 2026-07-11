/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Consolidated Trace filter expressions + harness span forwarding: the
 * completions-style live-capture query language, duration filters in the
 * store, and PerfModeSink's additive forwarding of diagnostic spans (which
 * gives CLI waterfalls their sublane detail).
 */

import { expect } from "chai";
import { applyTraceFilter, parseTraceFilter } from "../../src/sharedInterfaces/traceFilter";
import { SessionStore } from "../../src/diagnostics/sessionStore";
import { PerfModeSink } from "../../src/diagnostics/sinks";
import { DIAG_SCHEMA_VERSION, DiagEvent } from "../../src/sharedInterfaces/debugConsole";

suite("Trace filter expressions", () => {
    test("duration comparisons parse ms and seconds", () => {
        expect(parseTraceFilter("dur>1000").minDurationMs).to.equal(1000);
        expect(parseTraceFilter("dur>=1.5s").minDurationMs).to.equal(1500);
        expect(parseTraceFilter("dur<200").maxDurationMs).to.equal(200);
        expect(parseTraceFilter("dur<=2s").maxDurationMs).to.equal(2000);
    });

    test("process aliases map to DiagProcess values", () => {
        expect(parseTraceFilter("proc:sts").processes).to.deep.equal(["sqlToolsService"]);
        expect(parseTraceFilter("proc:extension").processes).to.deep.equal(["extensionHost"]);
        expect(parseTraceFilter("process:webview").processes).to.deep.equal(["webview"]);
    });

    test("status, feature, type, and free text combine (ANDed)", () => {
        const parsed = parseTraceFilter("status:error feat:query type:submit slow");
        expect(parsed.statuses).to.deep.equal(["error"]);
        expect(parsed.features).to.deep.equal(["query"]);
        expect(parsed.text).to.equal("submit slow");
        expect(parsed.invalid).to.deep.equal([]);
    });

    test("unknown tokens are surfaced as invalid, never silently dropped", () => {
        const parsed = parseTraceFilter("dur>abc proc:mars status:sideways");
        expect(parsed.invalid).to.deep.equal(["dur>abc", "proc:mars", "status:sideways"]);
    });

    test("applyTraceFilter merges into an EventQuery with expression precedence", () => {
        const merged = applyTraceFilter(
            { sourceId: "s", text: "existing" },
            parseTraceFilter("dur>50 proc:sts extra"),
        );
        expect(merged.minDurationMs).to.equal(50);
        expect(merged.processes).to.deep.equal(["sqlToolsService"]);
        expect(merged.text).to.equal("existing extra");
    });
});

let seq = 0;
function makeEvent(partial: Partial<DiagEvent> & { type: string }): DiagEvent {
    seq++;
    return {
        schemaVersion: DIAG_SCHEMA_VERSION,
        eventId: `evt_${seq}`,
        sessionId: "sess",
        seq,
        epochMs: 1000 + seq,
        process: "extensionHost",
        feature: "query",
        kind: "event",
        status: "ok",
        cls: { max: "public", redactedFields: 0, policyId: "p" },
        ...partial,
    };
}

suite("Store duration filters", () => {
    test("minDurationMs excludes shorter and duration-less events", () => {
        const store = new SessionStore("/nonexistent");
        const events = [
            makeEvent({ type: "a", durationMs: 50 }),
            makeEvent({ type: "b", durationMs: 1500 }),
            makeEvent({ type: "c" }),
        ];
        const result = store.query(events, { sourceId: "s", minDurationMs: 1000 }, []);
        expect(result.rows).to.have.length(1);
        expect((result.rows[0] as DiagEvent).type).to.equal("b");
    });
});

suite("PerfModeSink diagnostic span forwarding", () => {
    function sink(): PerfModeSink {
        return new PerfModeSink("http://127.0.0.1:1/unused", "tok", "run", 0, "scen");
    }

    test("perfMarker events still forward (legacy contract)", () => {
        const s = sink();
        s.tryWrite(
            makeEvent({ type: "mssql.query.submit", tags: ["perfMarker", "phase:instant"] }),
        );
        expect(s.queuedCount).to.equal(1);
    });

    test("rpc/webview/sts/token span events forward additively with diag provenance", () => {
        const s = sink();
        s.tryWrite(makeEvent({ type: "rpc.query/executeString.begin", kind: "span" }));
        s.tryWrite(
            makeEvent({ type: "rpc.query/executeString.end", kind: "span", durationMs: 42 }),
        );
        s.tryWrite(
            makeEvent({
                type: "sts.sql.executeReader",
                process: "sqlToolsService",
                durationMs: 12,
                tags: ["stsDiag"],
            }),
        );
        s.tryWrite(makeEvent({ type: "webview.tableDesigner.processTableEdit.begin" }));
        s.tryWrite(
            makeEvent({
                type: "sqlDataPlane.auth.token.begin",
                kind: "span",
                payload: {
                    authKind: { v: "aad", cls: "diagnostic.metadata", handling: "plain" },
                },
            }),
        );
        s.tryWrite(
            makeEvent({
                type: "sqlDataPlane.auth.token.end",
                kind: "span",
                durationMs: 25,
                payload: {
                    authKind: { v: "aad", cls: "diagnostic.metadata", handling: "plain" },
                    result: { v: "acquired", cls: "diagnostic.metadata", handling: "plain" },
                },
            }),
        );
        expect(s.queuedCount).to.equal(6);
        const queued = (s as unknown as { queue: Array<Record<string, unknown>> }).queue;
        expect(queued[4]).to.deep.include({
            name: "sqlDataPlane.auth.token.begin",
            phase: "begin",
        });
        expect(queued[4]["attrs"]).to.deep.equal({ authKind: "aad", diag: true });
        expect(queued[5]).to.deep.include({
            name: "sqlDataPlane.auth.token.end",
            phase: "end",
        });
        expect(queued[5]["attrs"]).to.deep.equal({
            authKind: "aad",
            result: "acquired",
            diag: true,
            durationMs: 25,
        });
    });

    test("viewer-internal and unrelated events never enter the harness wire", () => {
        const s = sink();
        s.tryWrite(
            makeEvent({
                type: "webview.debugConsole.dc/getWaterfall.begin",
                tags: ["viewerInternal"],
            }),
        );
        s.tryWrite(makeEvent({ type: "sessionDiag.enabled" }));
        s.tryWrite(makeEvent({ type: "system.rich.snapshot", kind: "metric" }));
        expect(s.queuedCount).to.equal(0);
    });
});
