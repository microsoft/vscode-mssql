/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-5 gate enforcement (addendum §8.4): value-class reads fail AT the
 * gated facade even for a deliberately misbehaving caller; grants are
 * single-use, expiring, and owner/snapshot/class-scoped; aggregate-numeric
 * output flows ungated; per-owner snapshot caps hold; the filter-literal
 * canary stays out of every diagnostics-safe surface.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { packBitmap } from "../../src/services/sqlDataPlane/api";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { QueryResultAccessService } from "../../src/queryResults/queryResultAccessService";
import {
    GatedQueryResultAccess,
    ResultAccessDenied,
    ResultAccessGate,
} from "../../src/queryResults/resultAccessGate";
import {
    QUERY_RESULTS_DEFAULTS,
    QueryResultsParams,
    computeQueryResultsDigest,
} from "../../src/queryResults/queryResultsParams";
import {
    LiveQueryResultSource,
    QueryResultAccessError,
    QueryResultSetFrozenSummary,
} from "../../src/queryResults/queryResultTypes";
import { operationNeedsConfirmation } from "../../src/queryResults/queryResultsTool";

const VALUE_CANARY = "CANARY_gate_1f9c";
const LITERAL_CANARY = "LITCANARY_77e0";

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "qr-gate-"));
}

function page(rowOffset: number, rows: unknown[][]) {
    const bits: boolean[] = [];
    for (const row of rows) {
        for (const cell of row) {
            bits.push(cell === null);
        }
    }
    return {
        rowOffset,
        rowCount: rows.length,
        approxBytes: 1000,
        compact: {
            values: rows.map((r) => r.map((c) => (c === null ? undefined : c))),
            nullBitmap: packBitmap(bits),
        },
    };
}

class GateFakeSource implements LiveQueryResultSource {
    readonly sourceId = "gate-src";
    readonly sourceKind = "queryStudio" as const;
    store: RetainedRowStore | undefined;
    private summaries: QueryResultSetFrozenSummary[] = [];

    async seed(rows: unknown[][]) {
        const rowStore = new RowStore(tempDir());
        rowStore.beginResultSet("rs1", [
            { name: "k", displayName: "k" },
            { name: "v", displayName: "v" },
        ]);
        for (let i = 0; i < rows.length; i++) {
            await rowStore.appendPage("rs1", page(i, [rows[i]]));
        }
        rowStore.endResultSet("rs1");
        this.store = new RetainedRowStore(rowStore, {
            runId: "qsrun_gate",
            createdEpochMs: Date.now(),
            retainedMemoryBytes: 8 * 1024 * 1024,
        });
        this.summaries = [
            {
                resultSetId: "rs1",
                columnNames: ["k", "v"],
                rowCount: rows.length,
                complete: true,
                corrupt: false,
            },
        ];
    }

    sourceTitle() {
        return "gate fixture";
    }
    sourceUriDigest() {
        return "feedfeedfeed";
    }
    state() {
        return { streaming: false, resultSets: this.summaries };
    }
    currentStore() {
        return this.store;
    }
    messagesSnapshot() {
        return [];
    }
    queryText() {
        return undefined;
    }
    runRecordId() {
        return undefined;
    }
    tuning() {
        return {};
    }
}

function harness(overrides: Partial<QueryResultsParams> = {}, now?: () => number) {
    const params = Object.freeze({ ...QUERY_RESULTS_DEFAULTS, ...overrides });
    const service = new QueryResultAccessService(
        () => ({ params, digest: computeQueryResultsDigest(params), overriddenKeys: [] }),
        now,
    );
    const gate = new ResultAccessGate(now);
    const gated = new GatedQueryResultAccess(service, gate, () => params);
    return { service, gate, gated };
}

async function seedSnapshot(service: QueryResultAccessService, gated: GatedQueryResultAccess) {
    const fixture = new GateFakeSource();
    await fixture.seed([
        ["a", VALUE_CANARY],
        ["b", 2],
        ["a", 3],
    ]);
    service.registerLiveSource(fixture);
    const lease = await gated.createSnapshot({
        ownerKey: "ownerA",
        sourceId: "gate-src",
        reason: "gate tests",
    });
    return { fixture, snapshotId: lease.snapshotId };
}

suite("queryResults access gate", () => {
    test("hostile caller: value-class reads fail at the facade without a grant", async () => {
        const { service, gated } = harness();
        const { snapshotId } = await seedSnapshot(service, gated);
        try {
            await gated.getRows(
                { snapshotId, resultSetId: "rs1", rowStart: 0, rowCount: 10 },
                { ownerKey: "ownerA" }, // no grant, on purpose
            );
            expect.fail("expected ResultAccessDenied");
        } catch (error) {
            expect(error).to.be.instanceOf(ResultAccessDenied);
            expect((error as ResultAccessDenied).denialReason).to.equal("missingGrant");
        }
        // Values-class transform (rows terminal) — same refusal.
        try {
            await gated.evaluateTransform(
                {
                    v: 1,
                    source: { snapshotId, resultSetId: "rs1" },
                    terminal: { kind: "rows", limit: 5 },
                },
                { ownerKey: "ownerA" },
            );
            expect.fail("expected ResultAccessDenied");
        } catch (error) {
            expect(error).to.be.instanceOf(ResultAccessDenied);
        }
        service.dispose();
    });

    test("aggregate-numeric output flows without a grant (§1.4)", async () => {
        const { service, gated } = harness();
        const { snapshotId } = await seedSnapshot(service, gated);
        const result = await gated.evaluateTransform(
            {
                v: 1,
                source: { snapshotId, resultSetId: "rs1" },
                ops: [{ op: "filter", pred: { col: 0, cmp: "eq", value: LITERAL_CANARY } }],
                terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
            },
            { ownerKey: "ownerA" },
        );
        expect(result.rows[0]![0]).to.equal(0);
        expect(result.outputClass).to.equal("aggregateNumeric");
        service.dispose();
    });

    test("grants: valid grant admits once; reuse, wrong owner, wrong snapshot all deny", async () => {
        const { service, gate, gated } = harness();
        const { snapshotId } = await seedSnapshot(service, gated);
        const grant = gate.mint({ snapshotId, ownerKey: "ownerA", operationClass: "values" });
        const window = await gated.getRows(
            { snapshotId, resultSetId: "rs1", rowStart: 0, rowCount: 10 },
            { ownerKey: "ownerA", grantId: grant.grantId },
        );
        expect(window.rowCount).to.equal(3);
        // Single-use: the same grant cannot admit twice.
        try {
            await gated.getRows(
                { snapshotId, resultSetId: "rs1", rowStart: 0, rowCount: 1 },
                { ownerKey: "ownerA", grantId: grant.grantId },
            );
            expect.fail("expected reuse denial");
        } catch (error) {
            expect((error as ResultAccessDenied).denialReason).to.equal("unknownGrant");
        }
        // Owner mismatch.
        const grantB = gate.mint({ snapshotId, ownerKey: "ownerA", operationClass: "values" });
        try {
            await gated.getRows(
                { snapshotId, resultSetId: "rs1", rowStart: 0, rowCount: 1 },
                { ownerKey: "ownerB", grantId: grantB.grantId },
            );
            expect.fail("expected scope denial");
        } catch (error) {
            expect((error as ResultAccessDenied).denialReason).to.equal("scopeMismatch");
        }
        service.dispose();
    });

    test("grants expire", async () => {
        let nowMs = 1_000_000;
        const { service, gate, gated } = harness({}, () => nowMs);
        const { snapshotId } = await seedSnapshot(service, gated);
        const grant = gate.mint({ snapshotId, ownerKey: "ownerA", operationClass: "values" });
        nowMs += 3 * 60_000; // past the 2-minute TTL
        try {
            await gated.getRows(
                { snapshotId, resultSetId: "rs1", rowStart: 0, rowCount: 1 },
                { ownerKey: "ownerA", grantId: grant.grantId },
            );
            expect.fail("expected expiry denial");
        } catch (error) {
            expect((error as ResultAccessDenied).denialReason).to.equal("expired");
        }
        service.dispose();
    });

    test("per-owner snapshot cap refuses with a typed error; release frees a slot", async () => {
        const { service, gated } = harness({ aiMaxSnapshotsPerConversation: 1 });
        const { snapshotId } = await seedSnapshot(service, gated);
        try {
            await gated.createSnapshot({
                ownerKey: "ownerA",
                sourceId: "gate-src",
                reason: "second",
            });
            expect.fail("expected cap refusal");
        } catch (error) {
            expect((error as QueryResultAccessError).code).to.equal("retentionBudgetExceeded");
        }
        gated.releaseSnapshot(snapshotId, "ownerA");
        expect(service.describeSnapshot(snapshotId), "released snapshot disposed").to.equal(
            undefined,
        );
        const again = await gated.createSnapshot({
            ownerKey: "ownerA",
            sourceId: "gate-src",
            reason: "after release",
        });
        expect(again.snapshotId).to.not.equal(undefined);
        service.dispose();
    });

    test("tool confirmation classifier matches the output-class function", () => {
        expect(operationNeedsConfirmation({ operation: "list_live" })).to.equal(false);
        expect(operationNeedsConfirmation({ operation: "describe_snapshot" })).to.equal(false);
        expect(operationNeedsConfirmation({ operation: "derive_snapshot" })).to.equal(false);
        expect(operationNeedsConfirmation({ operation: "get_rows" })).to.equal(true);
        expect(operationNeedsConfirmation({ operation: "sample_rows" })).to.equal(true);
        const aggregateSpec = {
            v: 1,
            source: { snapshotId: "s", resultSetId: "r" },
            terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
        };
        expect(
            operationNeedsConfirmation({ operation: "evaluate_transform", spec: aggregateSpec }),
        ).to.equal(false);
        const rowsSpec = {
            v: 1,
            source: { snapshotId: "s", resultSetId: "r" },
            terminal: { kind: "rows", limit: 5 },
        };
        expect(
            operationNeedsConfirmation({ operation: "evaluate_transform", spec: rowsSpec }),
        ).to.equal(true);
        const groupBySpec = {
            v: 1,
            source: { snapshotId: "s", resultSetId: "r" },
            terminal: { kind: "groupBy", keys: [0], aggs: [{ fn: "count" }] },
        };
        expect(
            operationNeedsConfirmation({ operation: "evaluate_transform", spec: groupBySpec }),
            "groupBy keys are cell values",
        ).to.equal(true);
    });

    test("canaries: cell value and filter literal absent from safe surfaces", async () => {
        const { service, gated } = harness();
        const { snapshotId } = await seedSnapshot(service, gated);
        await gated.evaluateTransform(
            {
                v: 1,
                source: { snapshotId, resultSetId: "rs1" },
                ops: [{ op: "filter", pred: { col: 1, cmp: "eq", value: LITERAL_CANARY } }],
                terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
            },
            { ownerKey: "ownerA" },
        );
        const surfaces = JSON.stringify({
            describe: service.describeSnapshot(snapshotId),
            list: service.listSnapshots(),
            status: service.status(),
        });
        expect(surfaces).to.not.include(VALUE_CANARY);
        expect(surfaces).to.not.include(LITERAL_CANARY);
        service.dispose();
    });
});
