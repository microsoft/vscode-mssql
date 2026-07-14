/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2 §9 observability wiring regression.
 *
 * The engine emits NOTHING to diagnostics itself; `createDiagEngineObserver`
 * is the only adapter onto the diag substrate, and the composition root
 * (sqlDataPlaneService) builds it on the ACTIVATION side so it binds to the
 * diag singleton that actually owns the registered sinks — then injects it
 * into the lazy provider chunk. The chunk bundles its OWN sink-less copy of
 * diagnosticsCore, so an observer built inside it emits into a dead singleton
 * and every sqlDataPlane.tsNative.* event silently vanishes from the session
 * journal (the shipped-once, found-in-dogfood bug this guards).
 *
 * A unit test can't reproduce bundle duplication (one module graph, one diag),
 * but it CAN pin the contract the fix depends on: an observer bound to a diag
 * WITH a sink emits a well-formed terminal event; the status maps correctly;
 * and only protocol metadata (no SQL text, rows, or identifiers) rides it.
 */

import { expect } from "chai";
import { diag, DiagnosticSink } from "../../../src/diagnostics/diagnosticsCore";
import { DiagEvent } from "../../../src/sharedInterfaces/debugConsole";
import { QueryCompleteSummary } from "../../../src/services/sqlDataPlane/api";
import { createDiagEngineObserver } from "../../../src/services/tsNative/observability";
import { EngineAggregates } from "../../../src/services/tsNative/queryEngine";

function recordingSink(events: DiagEvent[]): DiagnosticSink {
    return {
        id: "test.tsNative.observability",
        tryWrite: (event) => events.push(event),
    };
}

const AGGREGATES: EngineAggregates = {
    resultSets: 1,
    rows: 100,
    pages: 1,
    driverEvents: 104,
    logicalEncodedBytes: 4096,
    encodeMsTotal: 1.23,
    sinkWaitMsTotal: 0.4,
    pauseMsByReason: { sinkBackpressure: 0, cpuYield: 0 },
    yields: 0,
    maxSynchronousSliceMs: 2.5,
    firstMetadataMs: 3.1,
    firstPageProducedMs: 4.2,
    firstPageAcceptedMs: 5.3,
};

function summary(overrides: Partial<QueryCompleteSummary>): QueryCompleteSummary {
    return {
        clientQueryId: "cq-1",
        status: "succeeded",
        resultSetCount: 1,
        totalRows: 100,
        errorCount: 0,
        durationMs: 12,
        ...overrides,
    } as QueryCompleteSummary;
}

suite("ts-native observability wiring (TSQ2 §9)", () => {
    let events: DiagEvent[];

    setup(() => {
        events = [];
        diag.addSink(recordingSink(events));
    });

    teardown(() => {
        diag.removeSink("test.tsNative.observability");
    });

    test("onTerminal emits one metadata-only terminal event to a sink-backed diag", () => {
        createDiagEngineObserver().onTerminal(summary({}), AGGREGATES);
        const terminal = events.filter((e) => e.type === "sqlDataPlane.tsNative.query.terminal");
        expect(terminal, "exactly one terminal event reached the sink").to.have.length(1);
        expect(terminal[0].status).to.equal("ok");
        expect(terminal[0].feature).to.equal("sqlDataPlane");
        // Aggregate counters ride the event as protocol metadata (§9.3).
        const raw = JSON.stringify(terminal[0]);
        expect(raw).to.contain("resultSets");
        expect(raw).to.contain("rows");
    });

    test("query status maps onto diag status (ok / warning / error)", () => {
        const observer = createDiagEngineObserver();
        observer.onTerminal(summary({ status: "succeeded" }), AGGREGATES);
        observer.onTerminal(summary({ status: "completedWithErrors" }), AGGREGATES);
        observer.onTerminal(summary({ status: "failed" }), AGGREGATES);
        observer.onTerminal(summary({ status: "connectionLost" }), AGGREGATES);
        const statuses = events
            .filter((e) => e.type === "sqlDataPlane.tsNative.query.terminal")
            .map((e) => e.status);
        expect(statuses).to.deep.equal(["ok", "warning", "error", "error"]);
    });

    test("invariant violations surface individually as error events", () => {
        createDiagEngineObserver().onProtocolViolation("done-before-metadata");
        const violations = events.filter(
            (e) => e.type === "sqlDataPlane.tsNative.invariantViolation",
        );
        expect(violations).to.have.length(1);
        expect(violations[0].status).to.equal("error");
    });

    test("carries no SQL text, row values, or server identifiers", () => {
        createDiagEngineObserver().onTerminal(
            summary({ error: { code: "SqlDataPlane.QueryFailed", message: "boom" } as never }),
            AGGREGATES,
        );
        const raw = JSON.stringify(
            events.filter((e) => e.type === "sqlDataPlane.tsNative.query.terminal"),
        );
        // The error CODE is safe protocol metadata; the human message is not.
        expect(raw).to.contain("SqlDataPlane.QueryFailed");
        expect(raw).to.not.contain("boom");
    });
});
