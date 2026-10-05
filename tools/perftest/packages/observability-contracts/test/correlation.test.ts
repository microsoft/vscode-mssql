/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Trace Identity V1 correlation linter: registry-driven pairing (explicit
 * pairsWith — begin/ready, submit/complete), span-family suffix pairing,
 * orphan accounting, leaked roots, and honest scoring.
 */

import { describe, expect, test } from "vitest";
import { CorrelationEvent, lintCorrelation, ROOT_ACTION_TTL_MS } from "../src/index";

let seq = 0;
function ev(partial: Partial<CorrelationEvent> & { type: string }): CorrelationEvent {
    seq++;
    return {
        seq,
        kind: "event",
        epochMs: 1000 + seq,
        process: "extensionHost",
        ...partial,
    };
}

describe("correlation linter", () => {
    test("clean trace scores good: registry pairs balanced, all correlated", () => {
        const report = lintCorrelation([
            ev({ type: "mssql.connection.begin", traceId: "t1" }),
            ev({ type: "mssql.connection.ready", traceId: "t1" }),
            ev({ type: "mssql.query.submit", traceId: "t1" }),
            ev({ type: "mssql.query.complete", traceId: "t1" }),
            ev({ type: "rpc.query/executeString.begin", traceId: "t1" }),
            ev({ type: "rpc.query/executeString.end", traceId: "t1" }),
        ]);
        expect(report.score).toBe("good");
        expect(report.orphanCount).toBe(0);
        expect(report.unmatchedPairs).toEqual([]);
    });

    test("registry pairing catches begin/ready and submit/complete conventions", () => {
        const report = lintCorrelation([
            ev({ type: "mssql.connection.begin", traceId: "t1" }),
            // no connection.ready
            ev({ type: "mssql.query.submit", traceId: "t1" }),
            ev({ type: "mssql.query.submit", traceId: "t2" }),
            ev({ type: "mssql.query.complete", traceId: "t1" }),
        ]);
        const names = report.unmatchedPairs.map((p) => p.name);
        expect(names.some((n) => n.includes("mssql.connection.begin"))).toBe(true);
        expect(names.some((n) => n.includes("mssql.query.submit"))).toBe(true);
        expect(report.score).toBe("fair");
    });

    test("span families pair on .begin/.end; unbalanced rpc flagged", () => {
        const report = lintCorrelation([
            ev({ type: "rpc.connection/connect.begin", traceId: "t1" }),
            ev({ type: "rpc.connection/connect.begin", traceId: "t2" }),
            ev({ type: "rpc.connection/connect.end", traceId: "t1" }),
        ]);
        const rpc = report.unmatchedPairs.find((p) => p.name === "rpc.connection/connect");
        expect(rpc?.begins).toBe(2);
        expect(rpc?.ends).toBe(1);
    });

    test("all registered span-family namespaces are paired", () => {
        const report = lintCorrelation([
            ev({ type: "metadata.hydrate.begin", traceId: "t1" }),
            ev({ type: "metadata.hydrate.begin", traceId: "t2" }),
            ev({ type: "metadata.hydrate.end", traceId: "t1" }),
        ]);
        expect(report.unmatchedPairs).toContainEqual({
            name: "metadata.hydrate",
            begins: 2,
            ends: 1,
        });
    });

    test("orphans counted only for correlatable product markers", () => {
        const report = lintCorrelation([
            ev({ type: "mssql.query.submit" }), // orphan
            ev({ type: "mssql.query.complete" }), // orphan
            ev({ type: "sessionDiag.enabled" }), // exempt lifecycle
            ev({ type: "system.rich.snapshot", kind: "metric" }), // exempt
            ev({ type: "mssql.activate.begin" }), // exempt (pre-correlation)
        ]);
        expect(report.orphanCount).toBe(2);
        expect(report.orphanRatio).toBe(1);
        expect(report.score).toBe("poor");
    });

    test("registered non-mssql namespaces count as correlatable", () => {
        const report = lintCorrelation([
            ev({ type: "queryStudio.sync.request.begin" }),
            ev({ type: "queryStudio.sync.request.end" }),
        ]);
        expect(report.orphanCount).toBe(2);
        expect(report.orphanRatio).toBe(1);
    });

    test("leaked roots flagged past the TTL with honest note", () => {
        const report = lintCorrelation([
            ev({ type: "mssql.query.submit", traceId: "leak", epochMs: 1000 }),
            ev({
                type: "mssql.query.complete",
                traceId: "leak",
                epochMs: 1000 + ROOT_ACTION_TTL_MS + 5000,
            }),
        ]);
        expect(report.longLivedRoots).toHaveLength(1);
        expect(report.longLivedRoots[0].traceId).toBe("leak");
        expect(report.notes.some((n) => n.includes("TTL"))).toBe(true);
    });

    test("epoch-aligned sts events counted + explained, scenario window noise counted", () => {
        const report = lintCorrelation([
            ev({ type: "scenario.start", epochMs: 2000 }),
            ev({ type: "sts2.query.stats", epochMs: 2100 }),
            ev({ type: "mssql.query.submit", traceId: "t", epochMs: 2200 }),
            ev({ type: "mssql.query.complete", traceId: "t", epochMs: 2300 }),
            ev({ type: "scenario.end", epochMs: 3000 }),
            ev({ type: "mssql.command.invoked", traceId: "t", epochMs: 9000 }), // outside
        ]);
        expect(report.epochAlignedCount).toBe(1);
        expect(report.outsideScenarioWindow).toBe(1);
        expect(report.notes.some((n) => n.includes("never official"))).toBe(true);
    });
});
