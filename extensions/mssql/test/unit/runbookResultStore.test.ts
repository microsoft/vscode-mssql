/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Result-store persistence: write-through payload spill with a versioned
 * per-run index, lazy rehydration on fetch miss after "restart" (a fresh
 * store over the same directory), honest byte-cap truncation marking, and
 * retention deletion. The handle minted at put time is the durable name —
 * the ledger's DataHandleRefs must resolve in a later session.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    boundPayload,
    RESULT_INDEX_SCHEMA_VERSION,
    RunbookResultStore,
} from "../../src/runbookStudio/runbookResultStore";

suite("runbookResultStore", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-results-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const rowset = (rows: number) => ({
        contract: "rowset/1",
        columns: ["id", "name"],
        rows: Array.from({ length: rows }, (_, i) => [i, `row-${i}`] as [number, string]),
    });

    test("payloads spill write-through and rehydrate in a fresh store", () => {
        const first = new RunbookResultStore(root);
        const ref = first.put("run_1", "query", rowset(5));
        expect(ref.expired).to.equal(undefined);
        // "Restart": a brand-new store over the same directory must serve
        // the SAME handle id from disk on a fetch miss.
        const restarted = new RunbookResultStore(root);
        const page = restarted.fetchPage(ref.handleId, 0, 10);
        expect(page?.columns).to.deep.equal(["id", "name"]);
        expect(page?.rows).to.have.length(5);
        expect(page?.totalRows).to.equal(5);
        expect(page?.truncated).to.equal(undefined);
        // Paging still bounded after rehydration.
        const pageTwo = restarted.fetchPage(ref.handleId, 3, 10);
        expect(pageTwo?.rows).to.deep.equal([
            [3, "row-3"],
            [4, "row-4"],
        ]);
    });

    test("index round-trips versioned entries mapping handleId to file", () => {
        const store = new RunbookResultStore(root);
        const refA = store.put("run_2", "query", rowset(2));
        const refB = store.put("run_2", "report", { contract: "markdown/1", text: "done" });
        const index = JSON.parse(fs.readFileSync(path.join(root, "run_2", "index.json"), "utf8"));
        expect(index.schemaVersion).to.equal(RESULT_INDEX_SCHEMA_VERSION);
        expect(index.runId).to.equal("run_2");
        const handleIds = index.entries.map((e: { handleId: string }) => e.handleId);
        expect(handleIds).to.deep.equal([refA.handleId, refB.handleId]);
        for (const entry of index.entries) {
            expect(fs.existsSync(path.join(root, "run_2", entry.file))).to.equal(true);
            expect(entry.contract).to.be.a("string");
            expect(entry.bytes).to.be.greaterThan(0);
        }
    });

    test("a corrupt index resolves handles as expired, never invented", () => {
        const store = new RunbookResultStore(root);
        const ref = store.put("run_3", "query", rowset(2));
        fs.writeFileSync(path.join(root, "run_3", "index.json"), "{not json");
        const restarted = new RunbookResultStore(root);
        expect(restarted.fetchPage(ref.handleId, 0, 10)).to.equal(undefined);
    });

    test("oversize rowsets truncate at the byte cap with honest marking", () => {
        const store = new RunbookResultStore(root, { maxPayloadBytes: 400 });
        const ref = store.put("run_4", "query", rowset(200));
        expect(ref.truncated).to.equal(true);
        expect(ref.rows).to.be.lessThan(200);
        expect(ref.rows).to.be.greaterThan(0);
        expect(ref.bytes).to.be.at.most(400);
        const page = store.fetchPage(ref.handleId, 0, 500);
        expect(page?.truncated).to.equal(true);
        expect(page?.totalRows).to.equal(ref.rows);
        // The truncation mark survives restart with the payload.
        const restarted = new RunbookResultStore(root, { maxPayloadBytes: 400 });
        expect(restarted.fetchPage(ref.handleId, 0, 500)?.truncated).to.equal(true);
    });

    test("oversize text truncates to a bounded prefix", () => {
        const store = new RunbookResultStore(root, { maxPayloadBytes: 300 });
        const ref = store.put("run_5", "report", {
            contract: "markdown/1",
            text: "x".repeat(5000),
        });
        expect(ref.truncated).to.equal(true);
        const page = store.fetchPage(ref.handleId, 0, 10);
        expect(page?.truncated).to.equal(true);
        const text = page?.rows?.[0]?.[0] as string;
        expect(text.length).to.be.greaterThan(0);
        expect(text.length).to.be.lessThan(5000);
    });

    test("trusted text reads require an exact contract and retain truncation", () => {
        const store = new RunbookResultStore(root, { maxPayloadBytes: 300 });
        const complete = store.put("run_text", "evidence", {
            contract: "evidenceBundle/1",
            text: "complete",
        });
        expect(store.readTextPayload(complete.handleId, "evidenceBundle/1")).to.deep.equal({
            text: "complete",
            truncated: false,
        });
        expect(store.readTextPayload(complete.handleId, "markdown/1")).to.equal(undefined);

        const truncated = store.put("run_text", "large", {
            contract: "evidenceBundle/1",
            text: "x".repeat(5000),
        });
        expect(store.readTextPayload(truncated.handleId, "evidenceBundle/1")?.truncated).to.equal(
            true,
        );
        const restarted = new RunbookResultStore(root, { maxPayloadBytes: 300 });
        expect(restarted.readTextPayload(complete.handleId, "evidenceBundle/1")).to.deep.equal({
            text: "complete",
            truncated: false,
        });
    });

    test("a payload that cannot be bounded is refused as expired", () => {
        const store = new RunbookResultStore(root, { maxPayloadBytes: 64 });
        const scalars: Record<string, number> = {};
        for (let i = 0; i < 100; i++) {
            scalars[`metric-with-a-long-name-${i}`] = i;
        }
        const ref = store.put("run_6", "stats", { contract: "scalarSet/1", scalars });
        expect(ref.expired).to.equal(true);
        expect(store.fetchPage(ref.handleId, 0, 10)).to.equal(undefined);
        // Nothing spilled for a refused payload.
        expect(fs.existsSync(path.join(root, "run_6"))).to.equal(false);
    });

    test("deleteRunResults drops memory and disk; listPersistedRunIds tracks dirs", () => {
        const store = new RunbookResultStore(root);
        const ref = store.put("run_7", "query", rowset(2));
        store.put("run_8", "query", rowset(2));
        expect(store.listPersistedRunIds().sort()).to.deep.equal(["run_7", "run_8"]);
        store.deleteRunResults("run_7");
        expect(store.listPersistedRunIds()).to.deep.equal(["run_8"]);
        expect(store.fetchPage(ref.handleId, 0, 10)).to.equal(undefined);
    });

    test("memory-only mode (no directory) still serves this session", () => {
        const store = new RunbookResultStore();
        const ref = store.put("run_9", "query", rowset(3));
        expect(store.fetchPage(ref.handleId, 0, 10)?.totalRows).to.equal(3);
        expect(store.listPersistedRunIds()).to.deep.equal([]);
    });

    test("derived pages transform retained data lazily and survive restart", () => {
        const store = new RunbookResultStore(root);
        const ref = store.put("run_derived", "query", {
            contract: "rowset/1",
            columns: ["suite", "durationMs"],
            rows: [
                ["A", 10],
                ["A", 20],
                ["B", 5],
            ],
        });
        const pipeline = {
            steps: [
                {
                    op: "aggregate" as const,
                    by: ["suite"],
                    measures: [{ field: "durationMs", fn: "avg" as const, as: "averageMs" }],
                },
                { op: "sort" as const, by: [{ field: "averageMs", direction: "desc" as const }] },
            ],
        };
        const first = store.fetchTransformedPage(ref.handleId, pipeline, 0, 1);
        expect(first).to.deep.equal({
            columns: ["suite", "averageMs"],
            rows: [["A", 15]],
            totalRows: 2,
        });

        const restarted = new RunbookResultStore(root);
        expect(restarted.fetchTransformedPage(ref.handleId, pipeline, 1, 10)).to.deep.equal({
            columns: ["suite", "averageMs"],
            rows: [["B", 5]],
            totalRows: 2,
        });
        expect(
            restarted.fetchTransformedPage(
                ref.handleId,
                { steps: [{ op: "select", columns: ["missing"] }] },
                0,
                10,
            ),
        ).to.deep.equal({ transformError: "fieldMissing" });
        expect(restarted.fetchPage(ref.handleId, 0, 10)?.rows).to.deep.equal([
            ["A", 10],
            ["A", 20],
            ["B", 5],
        ]);
    });

    test("boundPayload is pure and honest at the edges", () => {
        const small = { contract: "rowset/1", columns: ["a"], rows: [[1]] as Array<Array<number>> };
        const bounded = boundPayload(small, 10_000);
        expect(bounded?.truncated).to.equal(undefined);
        expect(bounded?.payload).to.equal(small);
        const big = rowset(1000);
        const truncated = boundPayload(big, 500);
        expect(truncated?.truncated).to.equal(true);
        expect(truncated?.bytes).to.be.at.most(500);
        // The source payload is never mutated.
        expect(big.rows).to.have.length(1000);
        expect(
            boundPayload({ contract: "scalarSet/1", scalars: { k: "v".repeat(500) } }, 64),
        ).to.equal(undefined);
    });
});
