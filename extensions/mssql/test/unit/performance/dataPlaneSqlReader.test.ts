/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { SqlReadError } from "sql-core";
import {
    DataPlaneErrorCodes,
    OpenSessionParams,
    packBitmap,
} from "../../../src/services/sqlDataPlane/api";
import {
    DataPlaneSqlReader,
    DataPlaneSqlReaderOptions,
    TruncationRecorder,
} from "../../../src/performance/dataPlaneSqlReader";
import { FakeSession, QueryResponder, flushPromises } from "./dataPlaneFakes";

chai.use(sinonChai);

async function readError(promise: Promise<unknown>): Promise<SqlReadError> {
    try {
        await promise;
    } catch (error) {
        expect(error).to.be.instanceOf(SqlReadError);
        return error as SqlReadError;
    }
    throw new Error("Expected the read to fail.");
}

suite("Performance DataPlaneSqlReader", () => {
    let sandbox: sinon.SinonSandbox;
    let respond: QueryResponder;
    let session: FakeSession;
    let source: { open: sinon.SinonStub; recycle: sinon.SinonStub };

    setup(() => {
        sandbox = sinon.createSandbox();
        respond = () => ({});
        session = new FakeSession({} as OpenSessionParams, (text, options) =>
            respond(text, options),
        );
        source = { open: sandbox.stub().resolves(session), recycle: sandbox.stub() };
    });

    teardown(() => {
        sandbox.restore();
    });

    function createReader(options?: DataPlaneSqlReaderOptions): DataPlaneSqlReader {
        return new DataPlaneSqlReader(source, options);
    }

    suite("values", () => {
        test("maps data plane cells to sql-core values", async () => {
            const nulls = new Array<boolean>(14).fill(false);
            nulls[12] = true;
            respond = () => ({
                resultSets: [
                    {
                        columns: [
                            "int",
                            "bigint",
                            "decimal",
                            "datetime",
                            "datetimeoffset",
                            "time",
                            "xml",
                            "binary",
                            "hexBinary",
                            "guid",
                            "bit",
                            "missing",
                            "nullBit",
                            "approx",
                        ],
                        values: [
                            [
                                42,
                                { $t: "int64", v: "9223372036854775807" },
                                { $t: "decimal", v: "12.50" },
                                "2026-07-04 12:00:00.123",
                                { $t: "datetimeoffset", v: "2026-06-12 08:30:00.0000000 +02:00" },
                                { $t: "time", v: "12:30:00" },
                                "<ShowPlanXML/>",
                                { $t: "binary", v: "3q2+7w==" },
                                "0xdeadbeef",
                                { $t: "guid", v: "ef3aa10c-a8f4-4c43-88ea-73ea15c03245" },
                                true,
                                undefined,
                                "hidden by the null bitmap",
                                "9999999999999999999",
                            ],
                        ],
                        typeHints: [
                            "number",
                            "number:approx",
                            "number:approx",
                            "datetime",
                            "datetime",
                            "datetime",
                            "xml",
                            "binary",
                            "binary",
                            "string",
                            "boolean",
                            "string",
                            "string",
                            "number:approx",
                        ],
                        nullBitmap: packBitmap(nulls),
                    },
                    { columns: ["name"], values: [["first"], ["second"]] },
                ],
            });

            const resultSets = await createReader().read("SELECT values");

            expect(resultSets).to.have.length(2);
            expect(resultSets[0].rows).to.deep.equal([
                [
                    42,
                    "9223372036854775807",
                    "12.50",
                    "2026-07-04T12:00:00.123",
                    "2026-06-12T08:30:00.0000000+02:00",
                    "12:30:00",
                    "<ShowPlanXML/>",
                    "0xDEADBEEF",
                    "0xDEADBEEF",
                    "ef3aa10c-a8f4-4c43-88ea-73ea15c03245",
                    true,
                    // eslint-disable-next-line no-restricted-syntax -- sql-core NULL
                    null,
                    // eslint-disable-next-line no-restricted-syntax -- sql-core NULL
                    null,
                    "9999999999999999999",
                ],
            ]);
            expect(resultSets[0].truncatedCells).to.deep.equal([]);
            expect(resultSets[1]).to.deep.equal({
                columns: ["name"],
                rows: [["first"], ["second"]],
                truncatedCells: [],
            });
        });

        test("returns the prefix of a shortened value and reports it", async () => {
            const planPrefix = "<ShowPlanXML xmlns=";
            respond = () => ({
                resultSets: [
                    { columns: ["id"], values: [[1]], truncatedReason: "rowLimit" },
                    {
                        columns: ["query_plan", "plan_handle"],
                        values: [
                            [
                                {
                                    $t: "truncated",
                                    of: "string",
                                    bytes: 2_000_000,
                                    digest: "sha256:abc",
                                    v: planPrefix,
                                },
                                { $t: "truncated", of: "binary", bytes: 64, v: "3q2+7w==" },
                            ],
                        ],
                        typeHints: ["xml", "binary"],
                    },
                ],
            });
            const recorder = new TruncationRecorder(createReader({ maxCellBytes: 1024 }));

            const resultSets = await recorder.read("SELECT plan");

            expect(session.queries[0].options.maxCellBytes).to.equal(1024);
            expect(resultSets[1].rows).to.deep.equal([[planPrefix, "0xDEADBEEF"]]);
            expect(recorder.truncated).to.deep.equal([
                { resultSet: 0, reason: "rowLimit" },
                {
                    resultSet: 1,
                    row: 0,
                    column: "query_plan",
                    returnedLength: planPrefix.length,
                    originalBytes: 2_000_000,
                    reason: "maxCellBytes",
                },
                {
                    resultSet: 1,
                    row: 0,
                    column: "plan_handle",
                    returnedLength: 8,
                    originalBytes: 64,
                    reason: "maxCellBytes",
                },
            ]);
        });
    });

    suite("errors", () => {
        test("rejects a SQL error with its number", async () => {
            respond = () => ({
                status: "failed",
                messages: [{ kind: "error", text: "Invalid object name 'x'.", number: 208 }],
                error: {
                    code: DataPlaneErrorCodes.queryFailed,
                    message: "query failed",
                    retryable: false,
                    server: { number: 208 },
                },
            });

            const error = await readError(createReader().read("SELECT * FROM x"));

            expect(error.kind).to.equal("server");
            expect(error.errorNumber).to.equal(208);
            expect(error.message).to.equal("Invalid object name 'x'.");
            expect(source.recycle).to.not.have.been.called;
        });

        test("rejects a batch that completed with errors", async () => {
            respond = () => ({
                status: "completedWithErrors",
                messages: [
                    { kind: "error", text: "Lock request time out period exceeded.", number: 1222 },
                ],
            });

            const error = await readError(createReader().read("SELECT 1; SELECT 2"));

            expect(error.kind).to.equal("server");
            expect(error.errorNumber).to.equal(1222);
        });

        test("maps a data plane timeout to a timeout error", async () => {
            respond = () => ({
                status: "failed",
                error: {
                    code: DataPlaneErrorCodes.clientTimeout,
                    message: "deadline",
                    retryable: true,
                },
            });
            expect((await readError(createReader().read("SELECT 1"))).kind).to.equal("timeout");

            respond = () => ({
                status: "failed",
                messages: [{ kind: "error", text: "Execution Timeout Expired.", number: -2 }],
            });
            const error = await readError(createReader().read("SELECT 1"));
            expect(error.kind).to.equal("timeout");
            expect(error.errorNumber).to.equal(-2);
        });

        test("maps a lost connection to a connection error and replaces the session", async () => {
            respond = () => ({ status: "connectionLost" });
            expect((await readError(createReader().read("SELECT 1"))).kind).to.equal("connection");
            expect(source.recycle).to.have.been.calledOnce;

            respond = () => ({
                status: "failed",
                error: {
                    code: DataPlaneErrorCodes.transportClosed,
                    message: "transport closed",
                    retryable: true,
                },
            });
            expect((await readError(createReader().read("SELECT 1"))).kind).to.equal("connection");
            expect(source.recycle).to.have.been.calledTwice;
        });

        test("maps a session that does not open to a connection error", async () => {
            source.open.rejects(new Error("Login failed."));

            const error = await readError(createReader().read("SELECT 1"));

            expect(error.kind).to.equal("connection");
            expect(error.message).to.equal("Login failed.");
        });

        test("replaces a session that rejects the query", async () => {
            session.state = "lost";

            const error = await readError(createReader().read("SELECT 1"));

            expect(error.kind).to.equal("connection");
            expect(source.recycle).to.have.been.calledOnce;
        });
    });

    suite("deadlines and cancellation", () => {
        let clock: sinon.SinonFakeTimers;

        setup(() => {
            clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true });
        });

        test("cancels a query at the deadline and keeps the session when it stops", async () => {
            respond = () => ({ hang: true });
            const reader = createReader({ defaultTimeoutMs: 1_000 });

            const read = readError(reader.read("WAITFOR DELAY '01:00:00'"));
            await clock.tickAsync(1_000);
            const error = await read;

            expect(error.kind).to.equal("timeout");
            expect(session.queries[0].options.timeoutMs).to.equal(1_000);
            expect(session.queries[0].cancelCount).to.equal(1);
            expect(source.recycle).to.not.have.been.called;

            respond = () => ({
                resultSets: [{ columns: ["one"], values: [[1]], typeHints: ["number"] }],
            });
            expect((await reader.read("SELECT 1"))[0].rows).to.deep.equal([[1]]);
        });

        test("uses the caller's timeout over the default", async () => {
            respond = () => ({ hang: true });

            const read = readError(createReader().read("SELECT 1", { timeoutMs: 250 }));
            await clock.tickAsync(250);

            expect((await read).kind).to.equal("timeout");
        });

        test("replaces the session when a canceled query does not stop", async () => {
            respond = () => ({ hang: true, honorsCancel: false });
            const reader = createReader({ defaultTimeoutMs: 1_000, cancelGraceMs: 500 });

            const read = readError(reader.read("SELECT 1"));
            await clock.tickAsync(1_000);
            expect(source.recycle).to.not.have.been.called;
            await clock.tickAsync(500);

            expect((await read).kind).to.equal("timeout");
            expect(session.queries[0].disposeCount).to.equal(1);
            expect(source.recycle).to.have.been.calledOnce;
        });

        test("cancels a running query when the signal aborts", async () => {
            respond = () => ({ hang: true });
            const controller = new AbortController();

            const read = readError(createReader().read("SELECT 1", { signal: controller.signal }));
            await flushPromises();
            controller.abort();

            expect((await read).kind).to.equal("canceled");
            expect(session.queries[0].cancelCount).to.equal(1);
        });

        test("does not run a read whose signal already aborted", async () => {
            const controller = new AbortController();
            controller.abort();

            const error = await readError(
                createReader().read("SELECT 1", { signal: controller.signal }),
            );

            expect(error.kind).to.equal("canceled");
            expect(source.open).to.not.have.been.called;
        });
    });

    suite("serialization", () => {
        test("runs reads one at a time in call order", async () => {
            respond = (text) => (text === "first" ? { hang: true } : {});
            const reader = createReader();

            const first = reader.read("first");
            const second = reader.read("second");
            await flushPromises();
            expect(session.queries.map((query) => query.text)).to.deep.equal(["first"]);

            await session.queries[0].complete();
            await Promise.all([first, second]);

            expect(session.queries.map((query) => query.text)).to.deep.equal(["first", "second"]);
            expect(session.maxActive).to.equal(1);
        });

        test("drops a queued read that is canceled before it starts", async () => {
            respond = (text) => (text === "running" ? { hang: true } : {});
            const reader = createReader();
            const controller = new AbortController();

            const running = reader.read("running");
            const queued = readError(reader.read("queued", { signal: controller.signal }));
            await flushPromises();
            controller.abort();

            expect((await queued).kind).to.equal("canceled");
            await session.queries[0].complete();
            await running;
            await flushPromises();
            expect(session.queries.map((query) => query.text)).to.deep.equal(["running"]);
        });

        test("drops a queued read whose deadline passes before it starts", async () => {
            const clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true });
            respond = (text) => (text === "running" ? { hang: true } : {});
            const reader = createReader({ defaultTimeoutMs: 10_000 });

            const running = reader.read("running");
            const queued = readError(reader.read("queued", { timeoutMs: 100 }));
            await clock.tickAsync(100);

            expect((await queued).kind).to.equal("timeout");
            await session.queries[0].complete();
            await running;
            await flushPromises();
            expect(session.queries.map((query) => query.text)).to.deep.equal(["running"]);
        });
    });
});
