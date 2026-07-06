/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * STS2 binding conformance (AD-2): the protocol engine against a scripted
 * wire. Proves what the FakeBackend suite could only document: high-water
 * acks strictly after durable sink acceptance, invariant rejections
 * (rows-before-metadata, pageSeq gaps), duplicate-terminal drops, deadline
 * synthesis (the completion ALWAYS settles), and fatal → connectionLost.
 */

import { expect } from "chai";
import {
    DataPlaneAvailability,
    IQueryEventSink,
    QueryCompleteSummary,
    ResultSetMetadata,
    RowsPage,
    ServerMessage,
    SqlConnectionProfileRef,
    decodeCell,
} from "../../src/services/sqlDataPlane/api";
import { DEFAULT_DEADLINES, Sts2Backend, Sts2Rpc } from "../../src/services/sts2/sts2Backend";
import { STS2_METHODS } from "../../src/services/sts2/wire/v2";

const PROFILE: SqlConnectionProfileRef = {
    profileFingerprint: "fp",
    server: "localhost",
    database: "Sts2TestDb",
    authKind: "sql",
    user: "sa",
};

/** Scripted wire: requests answered from a table; notifications pushed manually. */
class ScriptedRpc implements Sts2Rpc {
    readonly requests: Array<{ method: string; params: unknown }> = [];
    readonly notificationsSent: Array<{ method: string; params: unknown }> = [];
    private handlers = new Map<string, (params: unknown) => void>();
    responders = new Map<string, (params: unknown) => unknown | Promise<unknown>>();

    async sendRequest<R>(method: string, params: unknown): Promise<R> {
        this.requests.push({ method, params });
        const responder = this.responders.get(method);
        if (!responder) {
            throw Object.assign(new Error(`Unhandled method ${method}`), {});
        }
        return (await responder(params)) as R;
    }

    sendNotification(method: string, params: unknown): void {
        this.notificationsSent.push({ method, params });
    }

    onNotification(method: string, handler: (params: unknown) => void): { dispose(): void } {
        this.handlers.set(method, handler);
        return { dispose: () => this.handlers.delete(method) };
    }

    push(method: string, params: unknown): void {
        this.handlers.get(method)?.(params);
    }
}

class RecordingSink implements IQueryEventSink {
    readonly sequence: string[] = [];
    readonly pages: RowsPage[] = [];
    readonly messages: ServerMessage[] = [];
    summary: QueryCompleteSummary | undefined;
    pageDelayMs = 0;
    onResultSetStarted(meta: ResultSetMetadata): void {
        this.sequence.push(`start:${meta.columns.map((c) => c.name).join(",")}`);
    }
    async onRowsPage(page: RowsPage): Promise<void> {
        this.sequence.push(`rows:${page.rowOffset}+${page.rowCount}`);
        if (this.pageDelayMs) {
            await new Promise((r) => setTimeout(r, this.pageDelayMs));
        }
        this.pages.push(page);
    }
    onMessage(msg: ServerMessage): void {
        this.sequence.push(`msg:${msg.kind}`);
        this.messages.push(msg);
    }
    onComplete(summary: QueryCompleteSummary): void {
        this.sequence.push(`complete:${summary.status}`);
        this.summary = summary;
    }
}

function standardRpc(): ScriptedRpc {
    const rpc = new ScriptedRpc();
    rpc.responders.set(STS2_METHODS.initialize, () => ({ specVersion: "2.0.0-preview.1" }));
    rpc.responders.set(STS2_METHODS.connectionOpen, (p) => ({
        connectionId: "conn-1",
        openId: (p as { openId: string }).openId,
        serverInfo: { product: "SQL Server", version: "17.0", dialect: "tsql" },
    }));
    rpc.responders.set(STS2_METHODS.queryExecute, () => ({ queryId: "q-1" }));
    rpc.responders.set(STS2_METHODS.queryCancel, () => ({}));
    rpc.responders.set(STS2_METHODS.queryDispose, () => ({}));
    rpc.responders.set(STS2_METHODS.connectionClose, () => ({}));
    return rpc;
}

async function openAndExecute(
    rpc: ScriptedRpc,
    sink: RecordingSink,
    deadlines = DEFAULT_DEADLINES,
) {
    const backend = new Sts2Backend(rpc, deadlines);
    await backend.start();
    const session = await backend.openSession({
        profile: PROFILE,
        applicationName: "test",
        auth: { passwordProvider: async () => "pw-canary-x" },
    });
    const handle = session.execute("select 1", {}, sink);
    // Let the execute request settle and the lane register.
    await new Promise((r) => setTimeout(r, 5));
    return { backend, session, handle };
}

suite("STS2 binding conformance (scripted wire)", () => {
    test("initialize unavailable → notEnabledOnService reason", async () => {
        const rpc = new ScriptedRpc(); // no responders at all
        const backend = new Sts2Backend(rpc);
        const availability = await backend.start();
        expect(availability.state).to.equal("unavailable");
        expect((availability as { reason: string }).reason).to.include("notEnabledOnService");
    });

    test("happy path: ordered sink events, structured rowsAffected, one terminal", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [
                { name: "n", engineType: "int" },
                { name: "s", engineType: "nvarchar" },
            ],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [
                [1, "a"],
                [2, null],
            ],
            last: false,
        });
        rpc.push(STS2_METHODS.queryMessage, {
            queryId: "q-1",
            messageClass: "info",
            number: 0,
            severity: 0,
            text: "(2 rows affected)",
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: [2],
        });
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(summary.totalRows).to.equal(2);
        expect(summary.rowsAffected).to.equal(2);
        expect(summary.synthesized).to.not.equal(true);
        expect(sink.sequence[0]).to.equal("start:n,s");
        expect(sink.sequence[sink.sequence.length - 1]).to.equal("complete:succeeded");
        // NULL → bitmap; typeHints from engineType.
        const page = sink.pages[0];
        expect(page.compact.typeHints).to.deep.equal(["number", "string"]);
        expect(page.compact.nullBitmap).to.be.a("string");
    });

    test("complete carrying a DIFFERENT database fires onDidChangeDatabase (backend truth)", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { session, handle } = await openAndExecute(rpc, sink);
        const changes: { database: string; source: string }[] = [];
        session.onDidChangeDatabase((change) =>
            changes.push({ database: change.database, source: change.source }),
        );
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: 0,
            database: "OtherDb",
        });
        await handle.completion;
        expect(changes).to.deep.equal([{ database: "OtherDb", source: "backend" }]);
        expect(session.info.database).to.equal("OtherDb");

        // Same database on a later complete: no spurious event.
        rpc.responders.set(STS2_METHODS.queryExecute, () => ({ queryId: "q-2" }));
        const sink2 = new RecordingSink();
        const handle2 = session.execute("select 2", {}, sink2);
        await new Promise((r) => setTimeout(r, 5));
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-2",
            status: "succeeded",
            rowsAffected: 0,
            database: "OtherDb",
        });
        await handle2.completion;
        expect(changes).to.have.length(1);
    });

    test("high-water ack is sent only AFTER the sink durably accepts the page", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        sink.pageDelayMs = 25;
        await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [{ name: "n", engineType: "int" }],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[1]],
        });
        // Immediately after push: sink is still sleeping — no ack yet.
        await new Promise((r) => setTimeout(r, 5));
        expect(
            rpc.notificationsSent.filter((n) => n.method === STS2_METHODS.queryAck),
        ).to.have.length(0);
        await new Promise((r) => setTimeout(r, 40));
        const acks = rpc.notificationsSent.filter((n) => n.method === STS2_METHODS.queryAck);
        expect(acks).to.have.length(1);
        expect((acks[0].params as { throughPageSeq: number }).throughPageSeq).to.equal(0);
    });

    test("rows before metadata → ProtocolViolation failure, backend cancel attempted", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 7,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[1]],
        });
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal("SqlDataPlane.Client.ProtocolViolation");
        expect(rpc.requests.some((r) => r.method === STS2_METHODS.queryCancel)).to.equal(true);
    });

    test("pageSeq gap → ProtocolViolation; partial rows are not presented as truth", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [{ name: "n", engineType: "int" }],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[1]],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 5, // gap!
            rowOffset: 1,
            rows: [[2]],
        });
        const summary = await handle.completion;
        expect(summary.status).to.equal("failed");
        expect(summary.error?.code).to.equal("SqlDataPlane.Client.ProtocolViolation");
    });

    test("duplicate terminal is dropped (exactly one completion)", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "error",
            rowsAffected: null,
        });
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(sink.sequence.filter((s) => s.startsWith("complete:"))).to.have.length(1);
    });

    test("cancel: ack bounded; missing terminal is SYNTHESIZED at the deadline", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink, {
            ...DEFAULT_DEADLINES,
            completeAfterCancelMs: 30,
        });
        const ack = await handle.cancel();
        expect(ack.acknowledged).to.equal(true);
        // Service never sends complete → synthesized canceled terminal.
        const summary = await handle.completion;
        expect(summary.status).to.equal("canceled");
        expect(summary.synthesized).to.equal(true);
        expect(summary.error?.message).to.include("no terminal within");
    });

    test("dispose settles the completion even when the wire stays silent (D-0011 drain)", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink, {
            ...DEFAULT_DEADLINES,
            disposeDrainMs: 20,
        });
        await handle.dispose();
        const summary = await handle.completion;
        expect(summary.status).to.equal("disposed");
    });

    test("fatal mid-stream: session lost, active query completes connectionLost, availability unavailable", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { backend, session, handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.fatal, { reason: "pump died" });
        const summary = await handle.completion;
        expect(summary.status).to.equal("connectionLost");
        expect(summary.synthesized).to.equal(true);
        expect(session.state).to.equal("lost");
        expect(backend.availability.state).to.equal("unavailable");
    });

    test("busy: second execute on one session throws Busy", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { session } = await openAndExecute(rpc, sink);
        expect(() => session.execute("select 2", {}, new RecordingSink())).to.throw(
            /one active query/,
        );
    });

    test("open failure maps Sts2.ConnectionFailed.Auth → SqlDataPlane.Auth; secrets never in the error", async () => {
        const rpc = standardRpc();
        rpc.responders.set(STS2_METHODS.connectionOpen, () => {
            const error = new Error("login failed for user");
            (error as { data?: unknown }).data = { code: "Sts2.ConnectionFailed.Auth" };
            throw error;
        });
        const backend = new Sts2Backend(rpc);
        await backend.start();
        try {
            await backend.openSession({
                profile: PROFILE,
                applicationName: "test",
                auth: { passwordProvider: async () => "pw-canary-x" },
            });
            expect.fail("open should throw");
        } catch (error) {
            const dpError = error as { code: string; message: string };
            expect(dpError.code).to.equal("SqlDataPlane.Auth");
            expect(JSON.stringify(dpError.message)).to.not.include("pw-canary-x");
        }
    });

    test("orphan buffer: notifications arriving before the execute result registers are replayed in order", async () => {
        const rpc = standardRpc();
        // Delay the execute response so notifications land first.
        rpc.responders.set(STS2_METHODS.queryExecute, async () => {
            setTimeout(() => {
                rpc.push(STS2_METHODS.queryResultSet, {
                    queryId: "q-1",
                    resultSetId: 0,
                    columns: [{ name: "n", engineType: "int" }],
                });
                rpc.push(STS2_METHODS.queryComplete, {
                    queryId: "q-1",
                    status: "succeeded",
                    rowsAffected: null,
                });
            }, 0);
            await new Promise((r) => setTimeout(r, 15));
            return { queryId: "q-1" };
        });
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(sink.sequence[0]).to.equal("start:n");
    });

    test("truncated string cell decodes to CellValue.truncated (prefix + digest, never '[object Object]')", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [{ name: "doc", engineType: "nvarchar" }],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [
                [
                    {
                        $t: "truncated",
                        of: "string",
                        bytes: 5_242_880,
                        digest: "sha256:0f2a",
                        v: "lorem ipsum prefix",
                    },
                ],
            ],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        const cell = decodeCell(sink.pages[0].compact, 0, 0, 1);
        expect(cell).to.deep.equal({
            kind: "string",
            value: "lorem ipsum prefix",
            truncated: { originalBytes: 5_242_880, digest: "sha256:0f2a", reason: "maxCellBytes" },
        });
    });

    test("truncated binary cell decodes to binary CellValue with base64 prefix + byteLength", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [{ name: "payload", engineType: "varbinary" }],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [
                [
                    {
                        $t: "truncated",
                        of: "binary",
                        bytes: 262_144,
                        digest: "sha256:9c",
                        v: "3q2+7w==",
                    },
                ],
            ],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        // The marker is NOT a null cell (bitmap stays clear for it).
        const cell = decodeCell(sink.pages[0].compact, 0, 0, 1);
        expect(cell).to.deep.equal({
            kind: "binary",
            base64: "3q2+7w==",
            byteLength: 262_144,
            truncated: { originalBytes: 262_144, digest: "sha256:9c", reason: "maxCellBytes" },
        });
    });

    test("maxCellBytes rides the execute params as options.maxCellBytes (absent when unset)", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { session, handle } = await openAndExecute(rpc, sink);
        const first = rpc.requests.find((r) => r.method === STS2_METHODS.queryExecute);
        expect(first?.params).to.not.have.property("options");
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        rpc.responders.set(STS2_METHODS.queryExecute, () => ({ queryId: "q-2" }));
        const handle2 = session.execute("select 2", { maxCellBytes: 65_536 }, new RecordingSink());
        await new Promise((r) => setTimeout(r, 5));
        const executes = rpc.requests.filter((r) => r.method === STS2_METHODS.queryExecute);
        expect(executes).to.have.length(2);
        expect(
            (executes[1].params as { options?: { maxCellBytes?: number } }).options,
        ).to.deep.equal({ maxCellBytes: 65_536 });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-2",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle2.completion;
    });

    test("capability maxCellBytesHonored derives from the initialize result (both ways)", async () => {
        const capabilityOf = (availability: DataPlaneAvailability) =>
            availability.state === "available"
                ? availability.capabilities.maxCellBytesHonored
                : undefined;

        const yes = standardRpc();
        yes.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: { maxCellBytesHonored: true },
        }));
        expect(capabilityOf(await new Sts2Backend(yes).start())).to.equal(true);

        // Absent capability object → honestly false.
        expect(capabilityOf(await new Sts2Backend(standardRpc()).start())).to.equal(false);

        // Truthy-but-not-true stays false (only `=== true` counts).
        const stringy = standardRpc();
        stringy.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: { maxCellBytesHonored: "true" },
        }));
        expect(capabilityOf(await new Sts2Backend(stringy).start())).to.equal(false);
    });

    test("close cancels the active query's future honestly and is idempotent", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { session, handle } = await openAndExecute(rpc, sink);
        await session.close();
        await session.close();
        const summary = await handle.completion;
        expect(summary.status).to.equal("connectionLost");
        expect(session.state).to.equal("closed");
    });
});
