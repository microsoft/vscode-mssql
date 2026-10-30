/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-4/5: ts-native engine lifecycle conformance over the fake TDS driver
 * (the N3-equivalent transcript gate). Mirrors the FakeBackend conformance
 * assertions: ordering, exactly-one-terminal, backpressure serialization,
 * sink containment, busy, dispose, loss, plus the addendum-specific gates —
 * timeout-after-first-response (§2.4), fidelity fail-closed (§6.3), and
 * bounded message-flood behavior (§5.7).
 */

import { expect } from "chai";
import {
    DataPlaneErrorCodes,
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    ResultSetMetadata,
    RowsPage,
    ServerMessage,
    SqlConnectionProfileRef,
    SqlDataPlaneError,
} from "../../../src/services/sqlDataPlane/api";
import { EngineIds, TdsColumn } from "../../../src/services/tsNative/driver/tdsDriver";
import {
    FakeTdsDriver,
    FakeTdsDriverOptions,
    VirtualClock,
} from "../../../src/services/tsNative/driver/fakeTdsDriver";
import { TsNativeBackend } from "../../../src/services/tsNative/tsNativeBackend";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp_tsn",
    server: "fakehost",
    database: "FakeDb",
    authKind: "sql",
    user: "sa",
};

function makeIds(): EngineIds {
    let n = 0;
    return { next: (prefix) => `${prefix}-${++n}` };
}

const INT_COL: TdsColumn = { name: "n", typeName: "int" };

class RecordingSink implements IQueryEventSink {
    readonly sequence: string[] = [];
    readonly pages: RowsPage[] = [];
    readonly messages: ServerMessage[] = [];
    readonly resultSets: ResultSetMetadata[] = [];
    summary: QueryCompleteSummary | undefined;
    throwOnPage = false;
    pageDelayMs = 0;
    messageDelayMs = 0;
    private inFlight = 0;
    maxConcurrentCallbacks = 0;

    constructor(private readonly clock: VirtualClock) {}

    private enter(label: string): void {
        this.inFlight++;
        this.maxConcurrentCallbacks = Math.max(this.maxConcurrentCallbacks, this.inFlight);
        this.sequence.push(label);
    }

    private async exitAfter(ms: number): Promise<void> {
        if (ms > 0) {
            await new Promise<void>((resolve) => this.clock.setTimeout(resolve, ms));
        }
        this.inFlight--;
    }

    onResultSetStarted(meta: ResultSetMetadata): void {
        this.enter(`start:${meta.columns.length}col`);
        this.resultSets.push(meta);
        this.inFlight--;
    }

    async onRowsPage(page: RowsPage): Promise<void> {
        this.enter(`page:${page.rowCount}`);
        this.pages.push(page);
        if (this.throwOnPage) {
            this.inFlight--;
            throw new Error("sink exploded");
        }
        await this.exitAfter(this.pageDelayMs);
    }

    async onMessage(msg: ServerMessage): Promise<void> {
        this.enter(`msg:${msg.kind}`);
        this.messages.push(msg);
        await this.exitAfter(this.messageDelayMs);
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

async function openSession(options: FakeTdsDriverOptions): Promise<{
    clock: VirtualClock;
    session: ISqlSession;
    backend: TsNativeBackend;
    driver: FakeTdsDriver;
}> {
    const clock = new VirtualClock();
    const driver = new FakeTdsDriver(clock, options);
    const backend = new TsNativeBackend({ driver, clock, ids: makeIds() });
    const opening = backend.openSession({
        profile: PROFILE,
        applicationName: "tsn-tests",
        auth: { passwordProvider: async () => "" },
    });
    await clock.flush();
    return { clock, session: await opening, backend, driver };
}

// ---------------------------------------------------------------------------

suite("ts-native engine conformance (TSQ2-4/5)", () => {
    test("multi-set transcript: ordering, structured rowsAffected, one terminal", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "GO",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "row", cells: [{ value: 1 }] },
                        { step: "row", cells: [{ value: 2 }] },
                        { step: "done", token: "done", rowCount: 2, more: true },
                        // DML statement between the SELECTs (no metadata)
                        { step: "done", token: "done", rowCount: 7, more: true },
                        { step: "metadata", columns: [{ name: "s", typeName: "varchar" }] },
                        { step: "row", cells: [{ value: "x" }] },
                        { step: "done", token: "done", rowCount: 1, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("GO", {}, sink);
        const acceptance = await handle.accepted;
        expect(acceptance.status).to.equal("accepted");
        await clock.advance(100);
        const summary = await handle.completion;

        expect(summary.status).to.equal("succeeded");
        expect(summary.resultSetCount).to.equal(2);
        expect(summary.totalRows).to.equal(3);
        expect(summary.rowsAffected).to.equal(7, "DML DONE with no open set");
        expect(sink.maxConcurrentCallbacks).to.equal(1, "one callback in flight");
        // metadata precedes rows; ends precede next start; one complete
        expect(sink.sequence.filter((s) => s.startsWith("complete"))).to.deep.equal([
            "complete:succeeded",
        ]);
        const startIdx = sink.sequence.indexOf("start:1col");
        const pageIdx = sink.sequence.findIndex((s) => s.startsWith("page:"));
        expect(startIdx).to.be.lessThan(pageIdx);
        // decoded cells round-trip through the compact page
        expect(sink.pages[0].compact.values).to.deep.equal([[1], [2]]);
        expect(sink.pages[0].compact.typeHints).to.deep.equal(["number"]);
        await session.close();
    });

    test("empty result set: started + ended(0), no pages, succeeded", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "EMPTY",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "done", token: "done", rowCount: 0, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("EMPTY", {}, sink);
        await clock.advance(50);
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(sink.pages.length).to.equal(0);
        expect(sink.sequence).to.include("end:0");
        await session.close();
    });

    test("server error without result sets fails with QueryFailed + server detail", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "BAD",
                    steps: [
                        {
                            step: "message",
                            message: {
                                number: 208,
                                severity: 16,
                                state: 1,
                                lineNumber: 3,
                                message: "Invalid object name 'nope'.",
                                isError: true,
                            },
                        },
                    ],
                    completion: {
                        ok: false,
                        error: {
                            category: "server",
                            message: "batch failed",
                            serverDetail: { number: 208, severity: 16, line: 3 },
                        },
                    },
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("BAD", {}, sink);
        await clock.advance(50);
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal(DataPlaneErrorCodes.queryFailed);
        expect(summary.error?.server?.number).to.equal(208);
        expect(summary.errorCount).to.equal(1);
        expect(sink.messages[0].line).to.equal(3);
        expect(summary.outcomeCertainty).to.equal("known");
        await session.close();
    });

    test("busy: second execute while active throws synchronously", async () => {
        const { clock, session } = await openSession({
            queries: [{ match: "HANG", steps: [{ step: "hangUntilCancel" }] }],
        });
        const sink = new RecordingSink(clock);
        const first = session.execute("HANG", {}, sink);
        let busy: SqlDataPlaneError | undefined;
        try {
            session.execute("HANG", {}, new RecordingSink(clock));
        } catch (error) {
            busy = error as SqlDataPlaneError;
        }
        expect(busy?.code).to.equal(DataPlaneErrorCodes.busy);
        await first.cancel();
        await clock.advance(100);
        await session.close();
    });

    test("backpressure: slow sink pauses the driver; pages stay ordered and bounded", async () => {
        const { clock, session } = await openSession({
            pauseOverrunRows: 1,
            queries: [
                {
                    match: "BIG",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "rows", count: 60, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 60, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        sink.pageDelayMs = 20;
        const handle = session.execute("BIG", { pageRows: 5 }, sink);
        await clock.advance(5000);
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(summary.totalRows).to.equal(60);
        expect(sink.maxConcurrentCallbacks).to.equal(1, "serialized callbacks");
        // 60 rows / 5 per page = 12 pages, offsets strictly monotonic
        expect(sink.pages.length).to.equal(12);
        const offsets = sink.pages.map((p) => p.rowOffset);
        expect(offsets).to.deep.equal([...offsets].sort((a, b) => a - b));
        await session.close();
    });

    test("sink throw is contained: SinkError terminal, completion settles, driver canceled", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "THROW",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "rows", count: 30, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 30, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        sink.throwOnPage = true;
        const handle = session.execute("THROW", { pageRows: 5 }, sink);
        await clock.advance(1000);
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal(DataPlaneErrorCodes.sinkError);
        expect(sink.pages.length).to.equal(1, "delivery stopped after the throw");
        await session.close();
    });

    test("cancel during rows: canceled terminal with uncertain outcome", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "LONG",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "rows", count: 1000, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 1000, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("LONG", { pageRows: 10 }, sink);
        await clock.advance(10);
        const ackPromise = handle.cancel();
        await clock.advance(100);
        const ack = await ackPromise;
        expect(ack.acknowledged).to.equal(true);
        const summary = await handle.completion;
        expect(summary.status).to.equal("canceled");
        expect(summary.outcomeCertainty).to.equal("unknown");
        expect(summary.outcomeReason).to.equal("cancelUncertain");
        await session.close();
    });

    test("timeout after first response: domain deadline, failed + Client.Timeout (§2.4)", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "STALL",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "row", cells: [{ value: 1 }] },
                        {
                            step: "message",
                            message: { number: 0, severity: 0, message: "started", isError: false },
                        },
                        { step: "hangUntilCancel" }, // server stalls AFTER early response
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("STALL", { timeoutMs: 500 }, sink);
        await clock.advance(499);
        expect(sink.summary).to.equal(undefined);
        await clock.advance(2000);
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal(DataPlaneErrorCodes.clientTimeout);
        expect(summary.outcomeCertainty).to.equal("unknown");
        await session.close();
    });

    test("dispose mid-stream: exactly one disposed terminal, sink delivery stops", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "DISP",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "rows", count: 1000, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 1000, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("DISP", { pageRows: 10 }, sink);
        await clock.advance(10);
        const disposePromise = handle.dispose();
        await clock.advance(500);
        await disposePromise;
        const summary = await handle.completion;
        expect(summary.status).to.equal("disposed");
        const deliveredAtDispose = sink.sequence.length;
        await clock.advance(500);
        expect(sink.sequence.length).to.equal(deliveredAtDispose, "no delivery after dispose");
        await session.close();
    });

    test("connection loss mid-stream: connectionLost terminal, session lost", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "SEV",
                    steps: [
                        { step: "metadata", columns: [INT_COL] },
                        { step: "row", cells: [{ value: 1 }] },
                        { step: "sever" },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const states: string[] = [];
        session.onDidChangeState((change) => states.push(change.current));
        const handle = session.execute("SEV", {}, sink);
        await clock.advance(100);
        const summary = await handle.completion;
        expect(summary.status).to.equal("connectionLost");
        expect(summary.outcomeCertainty).to.equal("unknown");
        expect(summary.outcomeReason).to.equal("transportLost");
        expect(session.state).to.equal("lost");
        expect(states).to.include("lost");
    });

    test("session close with active query: connectionLost synthesized, close completes", async () => {
        const { clock, session } = await openSession({
            queries: [{ match: "HANG", steps: [{ step: "hangUntilCancel" }] }],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("HANG", {}, sink);
        await clock.advance(5);
        const closing = session.close();
        await clock.advance(20_000);
        await closing;
        const summary = await handle.completion;
        expect(["connectionLost", "canceled"]).to.include(summary.status);
        expect(summary.synthesized ?? false).to.equal(summary.status === "connectionLost");
        expect(session.state).to.equal("closed");
    });

    test("fidelity fail-closed: decimal(38) column fails before any row (§6.3)", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "DEC",
                    steps: [
                        {
                            step: "metadata",
                            columns: [
                                { name: "big", typeName: "decimal", precision: 38, scale: 10 },
                            ],
                        },
                        { step: "rows", count: 5, make: (i) => [{ value: i * 1.5 }] },
                        { step: "done", token: "done", rowCount: 5, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("DEC", {}, sink);
        await clock.advance(1000);
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal(DataPlaneErrorCodes.capabilityUnsupported);
        expect(summary.error?.message).to.contain("types.decimalExact");
        expect(sink.resultSets.length).to.equal(0, "no result-set start delivered");
        expect(sink.pages.length).to.equal(0, "no rows delivered");
        await session.close();
    });

    test("small decimal (p<=15) passes exact mode and renders fixed scale", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "SMALLDEC",
                    steps: [
                        {
                            step: "metadata",
                            columns: [{ name: "d", typeName: "decimal", precision: 9, scale: 2 }],
                        },
                        { step: "row", cells: [{ value: 1.5 }] },
                        { step: "done", token: "done", rowCount: 1, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("SMALLDEC", {}, sink);
        await clock.advance(100);
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(sink.pages[0].compact.values).to.deep.equal([["1.50"]]);
        expect(sink.pages[0].compact.typeHints).to.deep.equal(["number:approx"]);
        await session.close();
    });

    test("message flood stays bounded: driver paused, all messages delivered", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "MSGS",
                    steps: [
                        ...Array.from({ length: 200 }, (_, i) => ({
                            step: "message" as const,
                            message: {
                                number: 0,
                                severity: 0,
                                message: `print ${i}`,
                                isError: false,
                            },
                        })),
                        { step: "done", token: "done" as const, rowCount: 0, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        sink.messageDelayMs = 1;
        const handle = session.execute("MSGS", {}, sink);
        await clock.advance(5000);
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(sink.messages.length).to.equal(200, "no silent message drops");
        await session.close();
    });

    test("protocol violation: row before metadata fails typed", async () => {
        const { clock, session } = await openSession({
            queries: [
                {
                    match: "ROGUE",
                    steps: [
                        { step: "row", cells: [{ value: 1 }] },
                        { step: "done", token: "done", rowCount: 1, more: false },
                    ],
                },
            ],
        });
        const sink = new RecordingSink(clock);
        const handle = session.execute("ROGUE", {}, sink);
        await clock.advance(100);
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal(DataPlaneErrorCodes.protocolViolation);
        await session.close();
    });

    test("open failures map typed: auth non-retryable, timeout retryable, deadline honored", async () => {
        const clock = new VirtualClock();
        const ids = makeIds();
        const authDriver = new FakeTdsDriver(clock, { opens: [{ outcome: "authFail" }] });
        const authBackend = new TsNativeBackend({ driver: authDriver, clock, ids });
        let authError: SqlDataPlaneError | undefined;
        const authOpen = authBackend
            .openSession({
                profile: PROFILE,
                applicationName: "t",
                auth: { passwordProvider: async () => "" },
            })
            .catch((error) => (authError = error as SqlDataPlaneError));
        await clock.advance(10);
        await authOpen;
        expect(authError?.code).to.equal(DataPlaneErrorCodes.auth);
        expect(authError?.retryable).to.equal(false);

        const hangDriver = new FakeTdsDriver(clock, { opens: [{ outcome: "hang" }] });
        const hangBackend = new TsNativeBackend({ driver: hangDriver, clock, ids });
        let hangError: SqlDataPlaneError | undefined;
        const hangOpen = hangBackend
            .openSession({
                profile: PROFILE,
                applicationName: "t",
                openTimeoutMs: 1000,
                auth: { passwordProvider: async () => "" },
            })
            .catch((error) => (hangError = error as SqlDataPlaneError));
        await clock.advance(1500);
        await hangOpen;
        expect(hangError?.code).to.equal(DataPlaneErrorCodes.clientTimeout);
    });

    test("integrated auth is a typed capability failure (no reinterpretation)", async () => {
        const clock = new VirtualClock();
        const driver = new FakeTdsDriver(clock, {});
        const backend = new TsNativeBackend({ driver, clock, ids: makeIds() });
        let error: SqlDataPlaneError | undefined;
        await backend
            .openSession({
                profile: { ...PROFILE, authKind: "integrated" },
                applicationName: "t",
            })
            .catch((e) => (error = e as SqlDataPlaneError));
        expect(error?.code).to.equal(DataPlaneErrorCodes.capabilityUnsupported);
    });
});
