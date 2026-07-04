/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Data Plane conformance — core transcripts (doc 03 §18.1) against the
 * FakeBackend. The same recording-sink assertions run against every binding
 * (STS2 JSON-RPC lands in AD-2 and reuses these helpers). The suite grows
 * with each adapter milestone; provocations that require ADAPTER machinery
 * (deadline synthesis for chaos:noTerminal, invariant rejection for
 * gapped/duplicate pages) are marked and land with the protocol engine.
 */

import { expect } from "chai";
import {
    cellDisplay,
    decodeCell,
    IQueryEventSink,
    packBitmap,
    bitmapHasBit,
    QueryCompleteSummary,
    ResultSetMetadata,
    RowsPage,
    ServerMessage,
    SqlConnectionProfileRef,
} from "../../src/services/sqlDataPlane/api";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";

const PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp_test",
    server: "localhost",
    database: "FakeDb",
    authKind: "sql",
    user: "sa",
};

/** Records every sink callback in order for transcript assertions. */
class RecordingSink implements IQueryEventSink {
    readonly sequence: string[] = [];
    readonly pages: RowsPage[] = [];
    readonly messages: ServerMessage[] = [];
    readonly resultSets: ResultSetMetadata[] = [];
    summary: QueryCompleteSummary | undefined;
    /** Set to throw from the next rows page (sink-error scenario). */
    throwOnPage = false;
    /** Per-page delay to prove backpressure serialization. */
    pageDelayMs = 0;
    private inFlight = 0;
    maxConcurrentCallbacks = 0;

    private enter(label: string): void {
        this.inFlight++;
        this.maxConcurrentCallbacks = Math.max(this.maxConcurrentCallbacks, this.inFlight);
        this.sequence.push(label);
    }

    onResultSetStarted(meta: ResultSetMetadata): void {
        this.enter(`start:${meta.columns.length}col`);
        this.resultSets.push(meta);
        this.inFlight--;
    }

    async onRowsPage(page: RowsPage): Promise<void> {
        this.enter(`rows:${page.rowOffset}+${page.rowCount}`);
        if (this.throwOnPage) {
            this.inFlight--;
            throw new Error("sink rejected page");
        }
        if (this.pageDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.pageDelayMs));
        }
        this.pages.push(page);
        this.inFlight--;
    }

    onMessage(msg: ServerMessage): void {
        this.enter(`msg:${msg.kind}`);
        this.messages.push(msg);
        this.inFlight--;
    }

    onResultSetEnded(info: { resultSetId: string; rowCount: number }): void {
        this.enter(`end:${info.rowCount}`);
        this.inFlight--;
    }

    onComplete(summary: QueryCompleteSummary): void {
        this.enter(`complete:${summary.status}`);
        this.summary = summary;
        this.inFlight--;
    }
}

function backendWith(scripts: FakeScript[]): FakeBackend {
    return new FakeBackend({ scripts });
}

async function run(
    backend: FakeBackend,
    text: string,
    sink: RecordingSink,
): Promise<QueryCompleteSummary> {
    const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
    const handle = session.execute(text, {}, sink);
    return handle.completion;
}

suite("SQL Data Plane conformance (FakeBackend)", () => {
    test("happy single result set: ordered events, one terminal, settled completion", async () => {
        const backend = backendWith([
            {
                match: "select 1",
                events: [
                    { type: "accepted" },
                    {
                        type: "resultSet",
                        columns: ["a", "b"],
                        rows: [
                            [1, "x"],
                            [2, null],
                        ],
                    },
                    { type: "message", kind: "info", text: "(2 rows affected)", rowsAffected: 2 },
                    { type: "complete", status: "succeeded", rowsAffected: 2 },
                ],
            },
        ]);
        const sink = new RecordingSink();
        const summary = await run(backend, "select 1", sink);
        expect(summary.status).to.equal("succeeded");
        expect(summary.totalRows).to.equal(2);
        expect(summary.rowsAffected).to.equal(2);
        // Metadata precedes rows; exactly one terminal, last.
        expect(sink.sequence[0]).to.equal("start:2col");
        expect(sink.sequence.filter((s) => s.startsWith("complete:"))).to.deep.equal([
            "complete:succeeded",
        ]);
        expect(sink.sequence[sink.sequence.length - 1]).to.equal("complete:succeeded");
        // NULL survived the compact encoding.
        const page = sink.pages[0];
        expect(decodeCell(page.compact, 1, 1, 2)).to.deep.equal({ kind: "null" });
        expect(cellDisplay(decodeCell(page.compact, 1, 1, 2))).to.equal("NULL");
        expect(cellDisplay(decodeCell(page.compact, 0, 1, 2))).to.equal("x");
    });

    test("multiple result sets stay ordered and counted", async () => {
        const backend = backendWith([
            {
                match: "multi",
                events: [
                    { type: "resultSet", columns: ["x"], rows: [[1], [2], [3]] },
                    { type: "resultSet", columns: ["y"], rows: [[4]] },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        const summary = await run(backend, "multi", sink);
        expect(summary.resultSetCount).to.equal(2);
        expect(summary.totalRows).to.equal(4);
        expect(sink.resultSets.map((r) => r.columns[0].name)).to.deep.equal(["x", "y"]);
    });

    test("empty result set and no-row execution complete honestly", async () => {
        const backend = backendWith([
            {
                match: "empty",
                events: [
                    { type: "resultSet", columns: ["a"], rows: [] },
                    { type: "message", kind: "info", text: "(0 rows affected)", rowsAffected: 0 },
                    { type: "complete", status: "succeeded", rowsAffected: 0 },
                ],
            },
        ]);
        const sink = new RecordingSink();
        const summary = await run(backend, "empty", sink);
        expect(summary.totalRows).to.equal(0);
        expect(summary.rowsAffected).to.equal(0);
    });

    test("server error is a query RESULT (message + failed terminal), never a throw", async () => {
        const backend = backendWith([
            {
                match: "bad",
                events: [
                    {
                        type: "message",
                        kind: "error",
                        text: "Invalid object name 'missing_table'.",
                        line: 2,
                    },
                    { type: "complete", status: "failed" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        const summary = await run(backend, "bad", sink);
        expect(summary.status).to.equal("failed");
        expect(summary.errorCount).to.equal(1);
        expect(sink.messages[0].line).to.equal(2);
    });

    test("cancel during rows: partial pages retained, canceled terminal, completion settles", async () => {
        const backend = backendWith([
            {
                match: "big",
                events: [
                    {
                        type: "resultSet",
                        columns: ["n"],
                        rows: Array.from({ length: 100 }, (_, i) => [i]),
                        pageSize: 10,
                        delayMs: 1,
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        sink.pageDelayMs = 5;
        const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
        const handle = session.execute("big", {}, sink);
        // Cancel after the first page lands.
        await new Promise((resolve) => setTimeout(resolve, 12));
        const ack = await handle.cancel();
        expect(ack.acknowledged).to.equal(true);
        const summary = await handle.completion;
        expect(summary.status).to.equal("canceled");
        expect(sink.pages.length).to.be.greaterThan(0);
        expect(sink.pages.length).to.be.lessThan(10);
    });

    test("backpressure: sink page acceptance is awaited (callbacks never overlap)", async () => {
        const backend = backendWith([
            {
                match: "paged",
                events: [
                    {
                        type: "resultSet",
                        columns: ["n"],
                        rows: Array.from({ length: 30 }, (_, i) => [i]),
                        pageSize: 5,
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        sink.pageDelayMs = 3;
        await run(backend, "paged", sink);
        expect(sink.maxConcurrentCallbacks).to.equal(1);
        // Pages arrive in offset order, gapless.
        expect(sink.pages.map((p) => p.rowOffset)).to.deep.equal([0, 5, 10, 15, 20, 25]);
        expect(sink.pages.map((p) => p.pageSeq)).to.deep.equal([0, 1, 2, 3, 4, 5]);
    });

    test("sink throw fails the query locally with SinkError; sink is not called again", async () => {
        const backend = backendWith([
            {
                match: "sinkboom",
                events: [
                    {
                        type: "resultSet",
                        columns: ["n"],
                        rows: [[1], [2], [3]],
                        pageSize: 1,
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        sink.throwOnPage = true;
        const summary = await run(backend, "sinkboom", sink);
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal("SqlDataPlane.Client.SinkError");
        // Only the first page attempt reached the sink.
        expect(sink.sequence.filter((s) => s.startsWith("rows:"))).to.have.length(1);
    });

    test("fatal mid-stream: session lost, query terminal connectionLost, completion settles", async () => {
        const backend = backendWith([
            {
                match: "fatality",
                events: [
                    { type: "resultSet", columns: ["n"], rows: [[1]], pageSize: 1 },
                    { type: "chaos:fatal" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
        const handle = session.execute("fatality", {}, sink);
        const summary = await handle.completion;
        expect(summary.status).to.equal("connectionLost");
        expect(session.state).to.equal("lost");
    });

    test("dispose of an active query yields exactly one 'disposed' terminal (D-0011 mirror)", async () => {
        const backend = backendWith([
            {
                match: "dispose-me",
                events: [
                    {
                        type: "resultSet",
                        columns: ["n"],
                        rows: Array.from({ length: 50 }, (_, i) => [i]),
                        pageSize: 5,
                        delayMs: 5,
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const sink = new RecordingSink();
        sink.pageDelayMs = 5;
        const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
        const handle = session.execute("dispose-me", {}, sink);
        await new Promise((resolve) => setTimeout(resolve, 8));
        await handle.dispose();
        const summary = await handle.completion;
        expect(["disposed", "canceled"]).to.include(summary.status);
        expect(sink.sequence.filter((s) => s.startsWith("complete:"))).to.have.length(1);
    });

    test("one active query per session is enforced (Busy)", async () => {
        const backend = backendWith([
            {
                match: "slow",
                events: [
                    { type: "resultSet", columns: ["n"], rows: [[1]], delayMs: 50 },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
        const first = session.execute("slow", {}, new RecordingSink());
        expect(() => session.execute("slow", {}, new RecordingSink())).to.throw(/one active query/);
        await first.completion;
    });

    test("close is idempotent and terminates an active query as connectionLost", async () => {
        const backend = backendWith([
            {
                match: "closing",
                events: [
                    { type: "resultSet", columns: ["n"], rows: [[1]], delayMs: 100 },
                    { type: "complete", status: "succeeded" },
                ],
            },
        ]);
        const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
        const handle = session.execute("closing", {}, new RecordingSink());
        await session.close();
        await session.close(); // idempotent
        const summary = await handle.completion;
        expect(summary.status).to.equal("connectionLost");
        expect(session.state).to.equal("closed");
    });

    test("chaos:noTerminal leaves completion pending — the ADAPTER deadline machinery owns synthesis (AD-2)", async () => {
        const backend = backendWith([
            { match: "hang", events: [{ type: "accepted" }, { type: "chaos:noTerminal" }] },
        ]);
        const sink = new RecordingSink();
        const session = await backend.openSession({ profile: PROFILE, applicationName: "test" });
        const handle = session.execute("hang", {}, sink);
        const settled = await Promise.race([
            handle.completion.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
        ]);
        // Documenting the raw-backend truth: the fake does NOT settle; the
        // domain adapter's synthesized terminals (doc 03 §8.7) close this.
        expect(settled).to.equal(false);
        await handle.dispose(); // dispose still settles it
        const summary = await handle.completion;
        expect(summary.status).to.equal("disposed");
    });
});

suite("SQL Data Plane cell model", () => {
    test("bitmap pack/read round-trip", () => {
        const bits = [true, false, false, true, false, true, true, false, true, false];
        const packed = packBitmap(bits);
        for (let i = 0; i < bits.length; i++) {
            expect(bitmapHasBit(packed, i), `bit ${i}`).to.equal(bits[i]);
        }
        expect(bitmapHasBit(packed, 999)).to.equal(false);
        expect(bitmapHasBit(undefined, 0)).to.equal(false);
    });

    test("decodeCell honors type hints and exactness", () => {
        const page = {
            values: [[42, "9999999999999999999", "2026-07-04T12:00:00", "abc"]],
            typeHints: ["number", "number:approx", "datetime", "string"],
        };
        expect(decodeCell(page, 0, 0, 4)).to.deep.equal({ kind: "number", value: 42, exact: true });
        expect(decodeCell(page, 0, 1, 4)).to.deep.equal({
            kind: "number",
            value: "9999999999999999999",
            exact: false,
        });
        expect(decodeCell(page, 0, 2, 4).kind).to.equal("datetime");
        expect(cellDisplay(decodeCell(page, 0, 3, 4))).to.equal("abc");
    });
});
