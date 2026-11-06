/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-1 QueryResultAccessService: snapshot creation (scan-free, frozen
 * clamps, completed-only rule), lease routing, retention (TTL + budget,
 * deduped by store), capture policies, status shape, and the privacy canary
 * (seeded row values must never appear in description/status surfaces).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import {
    QueryResultAccessService,
    sourceUriDigest,
} from "../../src/queryResults/queryResultAccessService";
import {
    LiveQueryResultSource,
    QueryResultAccessError,
    QueryResultSetFrozenSummary,
} from "../../src/queryResults/queryResultTypes";
import {
    QUERY_RESULTS_DEFAULTS,
    QueryResultsParams,
    computeQueryResultsDigest,
} from "../../src/queryResults/queryResultsParams";
import { packBitmap } from "../../src/services/sqlDataPlane/api";
import { QsMessageRow } from "../../src/sharedInterfaces/queryStudio";

const CANARY = "CANARY_9f3e2b71";

function page(rowOffset: number, rows: unknown[][], bytes = 1000) {
    const bits: boolean[] = [];
    for (const row of rows) {
        for (const cell of row) {
            bits.push(cell === null);
        }
    }
    return {
        rowOffset,
        rowCount: rows.length,
        approxBytes: bytes,
        compact: {
            values: rows.map((r) => r.map((c) => (c === null ? undefined : c))),
            nullBitmap: packBitmap(bits),
        },
    };
}

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "qr-access-"));
}

/** A controllable fake Query Studio live source over a real RowStore. */
class FakeLiveSource implements LiveQueryResultSource {
    readonly sourceKind = "queryStudio" as const;
    streaming = false;
    messages: QsMessageRow[] = [];
    sql: string | undefined = `select '${CANARY}' as secret`;
    store: RetainedRowStore | undefined;
    private rowStore: RowStore | undefined;
    private summaries: QueryResultSetFrozenSummary[] = [];
    private runOrdinal = 0;

    constructor(readonly sourceId: string) {}

    async newRun(sets: Array<{ id: string; rows: unknown[][]; complete?: boolean }>) {
        this.store?.releaseLiveOwner("rerun");
        this.runOrdinal++;
        this.rowStore = new RowStore(tempDir());
        this.store = new RetainedRowStore(this.rowStore, {
            runId: `qsrun_fake${this.runOrdinal}`,
            createdEpochMs: Date.now(),
            tuningDigest: "abc123def456",
            tuningProfileId: "interactive",
            retainedMemoryBytes: 8 * 1024 * 1024,
        });
        this.summaries = [];
        for (const set of sets) {
            this.rowStore.beginResultSet(set.id, [{ name: "v", displayName: "v" }]);
            for (let i = 0; i < set.rows.length; i++) {
                await this.rowStore.appendPage(set.id, page(i, [set.rows[i]]));
            }
            if (set.complete !== false) {
                this.rowStore.endResultSet(set.id);
            }
            this.summaries.push({
                resultSetId: set.id,
                columnNames: ["v"],
                rowCount: set.rows.length,
                complete: set.complete !== false,
                corrupt: false,
            });
        }
    }

    close(reason: "documentClosed" | "rerun" = "documentClosed") {
        this.store?.releaseLiveOwner(reason);
    }

    /** Test seam: adopt an externally built store + frozen summaries. */
    seedExternal(store: RetainedRowStore, summaries: QueryResultSetFrozenSummary[]) {
        this.store = store;
        this.summaries = summaries;
    }

    sourceTitle() {
        return `Fake ${this.sourceId}`;
    }
    sourceUriDigest() {
        return sourceUriDigest(`untitled:${this.sourceId}`);
    }
    state() {
        return { streaming: this.streaming, resultSets: this.summaries };
    }
    currentStore() {
        return this.store;
    }
    messagesSnapshot() {
        return this.messages;
    }
    queryText() {
        return this.sql;
    }
    runRecordId() {
        return "runrec_1";
    }
    tuning() {
        return { digest: "abc123def456", profileId: "interactive" };
    }
}

function makeService(overrides: Partial<QueryResultsParams> = {}, now?: () => number) {
    const params = Object.freeze({ ...QUERY_RESULTS_DEFAULTS, ...overrides });
    return new QueryResultAccessService(
        () => ({ params, digest: computeQueryResultsDigest(params), overriddenKeys: [] }),
        now,
    );
}

suite("queryResults access service", () => {
    test("snapshot survives rerun and source close; windows clamp to frozen counts", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[1], [2], [3]] }]);
        const lease = await service.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "test pin",
            sourceId: "s1",
            scope: { kind: "resultSet", resultSetId: "rs1" },
        });
        await source.newRun([{ id: "rs1", rows: [[99]] }]); // rerun replaces live data
        source.close();
        const window = await service.getWindow({
            snapshotId: lease.snapshotId,
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 100,
            reason: "grid",
        });
        expect(window.values.map((r) => r[0])).to.deep.equal([1, 2, 3]);
        const past = await service.getWindow({
            snapshotId: lease.snapshotId,
            resultSetId: "rs1",
            rowStart: 3,
            rowCount: 10,
            reason: "grid",
        });
        expect(past.rowCount).to.equal(0);
        lease.dispose();
        expect(service.describeSnapshot(lease.snapshotId)).to.equal(undefined);
        service.dispose();
    });

    test("snapshot creation is scan-free and O(result-set-count)", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        service.registerLiveSource(source);
        await source.newRun(
            Array.from({ length: 20 }, (_, i) => ({ id: `rs${i}`, rows: [[i], [i]] })),
        );
        const readsBefore = source.store!.stats().windowReads;
        const lease = await service.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "pin all",
            sourceId: "s1",
            scope: { kind: "allCompleteResultSets" },
        });
        expect(source.store!.stats().windowReads).to.equal(readsBefore);
        const description = service.describeSnapshot(lease.snapshotId)!;
        expect(description.resultSetCount).to.equal(20);
        expect(description.totalRows).to.equal(40);
        lease.dispose();
        service.dispose();
    });

    test("completed-only rule rejects incomplete result sets with a typed error", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[1]], complete: false }]);
        try {
            await service.createSnapshot({
                owner: { kind: "pinnedDocument" },
                reason: "pin incomplete",
                sourceId: "s1",
                scope: { kind: "resultSet", resultSetId: "rs1" },
            });
            expect.fail("expected resultSetIncomplete");
        } catch (error) {
            expect((error as QueryResultAccessError).code).to.equal("resultSetIncomplete");
        }
        source.close();
        service.dispose();
    });

    test("two snapshots share one store; budget accounting dedupes by store", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[1], [2]] }]);
        const a = await service.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "a",
            sourceId: "s1",
            scope: { kind: "resultSet", resultSetId: "rs1" },
        });
        const b = await service.createSnapshot({
            owner: { kind: "aiTool" },
            reason: "b",
            sourceId: "s1",
            scope: { kind: "resultSet", resultSetId: "rs1" },
        });
        expect(service.status().retainedStores).to.equal(1);
        source.close();
        a.dispose();
        // Store must survive: snapshot b still holds a lease on it.
        const window = await service.getWindow({
            snapshotId: b.snapshotId,
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 2,
            reason: "aiTool",
        });
        expect(window.rowCount).to.equal(2);
        b.dispose();
        service.dispose();
    });

    test("TTL sweep disposes only unleased AI snapshots; pinned dispose on release", async () => {
        let nowMs = 1_000_000;
        const service = makeService({ snapshotTtlMinutes: 1 }, () => nowMs);
        const source = new FakeLiveSource("s1");
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[1]] }]);
        const ai = await service.createSnapshot({
            owner: { kind: "aiTool" },
            reason: "chat",
            sourceId: "s1",
            scope: { kind: "allCompleteResultSets" },
        });
        const aiSnapshotId = ai.snapshotId;
        ai.dispose(); // AI lease released → snapshot idles under TTL
        expect(service.describeSnapshot(aiSnapshotId)).to.not.equal(undefined);
        service.sweepNow();
        expect(service.describeSnapshot(aiSnapshotId), "TTL not reached").to.not.equal(undefined);
        nowMs += 2 * 60_000;
        service.sweepNow();
        expect(service.describeSnapshot(aiSnapshotId), "TTL expired").to.equal(undefined);
        source.close();
        service.dispose();
    });

    test("retention budget refuses a new store when leased snapshots fill it", async () => {
        // Budget floor: 64 MB (params clamp). Each source's store reports
        // 40 MB of in-memory pages (below RowStore's own 64 MiB eviction
        // threshold, so the number is stable — no spill races).
        const service2 = makeService({ maxRetainedBytesMb: 64 });
        const mkSource = async (sourceId: string) => {
            const source = new FakeLiveSource(sourceId);
            service2.registerLiveSource(source);
            source.store?.releaseLiveOwner("rerun");
            const dir = tempDir();
            const rowStore = new RowStore(dir);
            rowStore.beginResultSet("rs1", [{ name: "v", displayName: "v" }]);
            for (let i = 0; i < 40; i++) {
                await rowStore.appendPage("rs1", page(i, [[i]], 1024 * 1024));
            }
            rowStore.endResultSet("rs1");
            source.seedExternal(
                new RetainedRowStore(rowStore, {
                    runId: `qsrun_${sourceId}`,
                    createdEpochMs: Date.now(),
                    retainedMemoryBytes: 64 * 1024 * 1024,
                }),
                [
                    {
                        resultSetId: "rs1",
                        columnNames: ["v"],
                        rowCount: 40,
                        complete: true,
                        corrupt: false,
                    },
                ],
            );
            return source;
        };
        const first = await mkSource("first");
        const second = await mkSource("second");
        const leaseA = await service2.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "first 40MB store",
            sourceId: "first",
            scope: { kind: "allCompleteResultSets" },
        });
        try {
            await service2.createSnapshot({
                owner: { kind: "pinnedDocument" },
                reason: "second 40MB store",
                sourceId: "second",
                scope: { kind: "allCompleteResultSets" },
            });
            expect.fail("expected retentionBudgetExceeded");
        } catch (error) {
            expect((error as QueryResultAccessError).code).to.equal("retentionBudgetExceeded");
        }
        leaseA.dispose();
        first.close();
        second.close();
        service2.dispose();
    });

    test("message and query capture policies", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        source.messages = [
            { batchIndex: 0, kind: "info", text: "1 row affected", epochMs: 1 },
            { batchIndex: 0, kind: "error", text: `bad ${CANARY}`, epochMs: 2 },
        ];
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[1]] }]);
        const lease = await service.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "capture",
            sourceId: "s1",
            scope: { kind: "allCompleteResultSets" },
            includeMessages: "allLocal",
            includeQueryText: "digest",
        });
        const description = service.describeSnapshot(lease.snapshotId)!;
        expect(description.messages).to.deep.equal({
            count: 2,
            errorCount: 1,
            firstErrorIndex: 1,
        });
        expect(description.hasLocalMessages).to.equal(true);
        expect(description.hasLocalQueryText).to.equal(false);
        expect(description.queryTextDigest).to.have.length(12);
        const local = await service.getSnapshotMessages(lease.snapshotId, 0, 10);
        expect(local.messages).to.have.length(2);
        // Provenance rides the description.
        expect(description.provenance.tuningDigest).to.equal("abc123def456");
        expect(description.provenance.runRecordId).to.equal("runrec_1");
        expect(description.provenance.storeKind).to.equal("rowStoreV1");
        lease.dispose();
        source.close();
        service.dispose();
    });

    test("privacy canary: no row values, SQL, or message text in describe/status/list", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        source.messages = [{ batchIndex: 0, kind: "error", text: `oops ${CANARY}`, epochMs: 1 }];
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[CANARY], [CANARY]] }]);
        const lease = await service.createSnapshot({
            owner: { kind: "aiTool" },
            reason: "canary",
            sourceId: "s1",
            scope: { kind: "allCompleteResultSets" },
            includeMessages: "summary",
            includeQueryText: "digest",
        });
        const surfaces = JSON.stringify({
            describe: service.describeSnapshot(lease.snapshotId),
            status: service.status(),
            list: service.listSnapshots(),
            live: service.listLiveSources(),
        });
        expect(surfaces).to.not.include(CANARY);
        expect(surfaces, "raw SQL leaked").to.not.include("select '");
        lease.dispose();
        source.close();
        service.dispose();
    });

    test("acquire after dispose returns undefined; getWindow on missing snapshot is empty", async () => {
        const service = makeService();
        const source = new FakeLiveSource("s1");
        service.registerLiveSource(source);
        await source.newRun([{ id: "rs1", rows: [[1]] }]);
        const lease = await service.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "x",
            sourceId: "s1",
            scope: { kind: "allCompleteResultSets" },
        });
        lease.dispose();
        expect(service.acquireSnapshot(lease.snapshotId, { kind: "pinnedDocument" })).to.equal(
            undefined,
        );
        const window = await service.getWindow({
            snapshotId: lease.snapshotId,
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 1,
            reason: "grid",
        });
        expect(window.rowCount).to.equal(0);
        source.close();
        service.dispose();
    });
});
