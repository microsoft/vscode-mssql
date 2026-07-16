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
    ExecuteOptions,
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
import { diag } from "../../src/diagnostics/diagnosticsCore";
import type { DiagEvent } from "../../src/sharedInterfaces/debugConsole";

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
    readonly metas: ResultSetMetadata[] = [];
    readonly pages: RowsPage[] = [];
    readonly messages: ServerMessage[] = [];
    summary: QueryCompleteSummary | undefined;
    pageDelayMs = 0;
    onResultSetStarted(meta: ResultSetMetadata): void {
        this.metas.push(meta);
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
    opts: ExecuteOptions = {},
) {
    const backend = new Sts2Backend(rpc, deadlines);
    await backend.start();
    const session = await backend.openSession({
        profile: PROFILE,
        applicationName: "test",
        auth: { passwordProvider: async () => "pw-canary-x" },
    });
    const handle = session.execute("select 1", opts, sink);
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

    test("a wedged initialize FAILS within its deadline and stays retryable", async () => {
        const rpc = new ScriptedRpc();
        // A responder that never settles — the wedged-service case that left
        // OE v2 spinning forever (journal: rpc.v2/initialize.begin, no end).
        let wedged = true;
        rpc.responders.set(STS2_METHODS.initialize, () =>
            wedged ? new Promise(() => undefined) : { specVersion: "2.0.0-preview.1" },
        );
        const backend = new Sts2Backend(rpc, { ...DEFAULT_DEADLINES, initializeMs: 30 });
        const availability = await backend.start();
        expect(availability.state).to.equal("unavailable");
        expect((availability as { reason: string }).reason).to.include("timed out");
        expect((availability as { retryable?: boolean }).retryable).to.equal(true);
        // canOpen re-attempts the bounded handshake once the service recovers
        // — a transient wedge must not poison every later open.
        wedged = false;
        expect((await backend.canOpen()).ok).to.equal(true);
    });

    test("concurrent starts share one initialize (single flight)", async () => {
        const rpc = standardRpc();
        const backend = new Sts2Backend(rpc);
        await Promise.all([backend.start(), backend.start(), backend.start()]);
        expect(rpc.requests.filter((r) => r.method === STS2_METHODS.initialize)).to.have.length(1);
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

    test("multi-result-set pages ack with PER-QUERY ordinals — no credit deadlock (D-0015)", async () => {
        // Wire pageSeq restarts at 0 per result set; the service credit ledger
        // counts pages per query. Acking the per-set seq froze the high-water
        // after set 0 and stalled 100-result-set queries at the 4-page window
        // (found by querystudio-query-100-resultsets). Every set's page must
        // ack with a strictly increasing per-query ordinal.
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        for (let set = 0; set < 6; set++) {
            rpc.push(STS2_METHODS.queryResultSet, {
                queryId: "q-1",
                resultSetId: set,
                columns: [{ name: "n", engineType: "int" }],
            });
            rpc.push(STS2_METHODS.queryRows, {
                queryId: "q-1",
                resultSetId: set,
                pageSeq: 0, // per-set seq restarts every set
                rowOffset: 0,
                rows: [[set]],
            });
        }
        await new Promise((r) => setTimeout(r, 20));
        const acks = rpc.notificationsSent
            .filter((n) => n.method === STS2_METHODS.queryAck)
            .map((n) => (n.params as { throughPageSeq: number }).throughPageSeq);
        expect(acks).to.deep.equal([0, 1, 2, 3, 4, 5]);
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(summary.totalRows).to.equal(6);
    });

    test("compact wire pages skip the client rebuild and use service-measured bytes (QO-5)", async () => {
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
            compact: {
                values: [
                    [1, "a"],
                    [2, null],
                ],
                nullBitmap: "CA==", // bit 3 set: row 1 col 1 null (LSB-first)
                typeHints: ["number", "string"],
            },
            approxBytes: 24,
            encodedBytes: 31,
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        const summary = await handle.completion;
        expect(summary.status).to.equal("succeeded");
        expect(summary.totalRows).to.equal(2);
        const page = sink.pages[0];
        // Service-computed facts pass through verbatim; nulls normalize to
        // the binding's undefined convention in place.
        expect(page.compact.nullBitmap).to.equal("CA==");
        expect(page.compact.typeHints).to.deep.equal(["number", "string"]);
        expect(page.compact.values[1][1]).to.equal(undefined);
        expect(page.approxBytes).to.equal(31);
    });

    test("compactRows opt-in rides execute options only when negotiated (QO-5)", async () => {
        const rpc = standardRpc();
        rpc.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: { compactRows: true },
        }));
        const sink = new RecordingSink();
        await openAndExecute(rpc, sink);
        const execute = rpc.requests.find((r) => r.method === STS2_METHODS.queryExecute);
        expect(
            (execute?.params as { options?: { compactRows?: boolean } }).options,
        ).to.deep.include({ compactRows: true });
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

    test("cancel waits for the execute response instead of sending an empty query id", async () => {
        const rpc = standardRpc();
        let resolveExecute!: (value: { queryId: string }) => void;
        rpc.responders.set(
            STS2_METHODS.queryExecute,
            () =>
                new Promise<{ queryId: string }>((resolve) => {
                    resolveExecute = resolve;
                }),
        );
        const sink = new RecordingSink();
        const backend = new Sts2Backend(rpc, { ...DEFAULT_DEADLINES, cancelAckMs: 1000 });
        await backend.start();
        const session = await backend.openSession({
            profile: PROFILE,
            applicationName: "test",
            auth: { passwordProvider: async () => "pw-canary-x" },
        });
        const handle = session.execute("WAITFOR DELAY '00:00:20'", {}, sink);

        const cancel = handle.cancel();
        await Promise.resolve();
        expect(rpc.requests.some((r) => r.method === STS2_METHODS.queryCancel)).to.equal(false);

        resolveExecute({ queryId: "q-late" });
        expect((await cancel).acknowledged).to.equal(true);
        const request = rpc.requests.find((r) => r.method === STS2_METHODS.queryCancel);
        expect(request?.params).to.deep.equal({ queryId: "q-late" });
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
        const events: DiagEvent[] = [];
        const sinkId = `sts2-open-privacy-${Date.now()}`;
        diag.addSink({ id: sinkId, tryWrite: (event) => events.push(event) });
        rpc.responders.set(STS2_METHODS.connectionOpen, () => {
            const error = new Error("login failed for account-canary@example.test");
            (error as { data?: unknown }).data = { code: "Sts2.ConnectionFailed.Auth" };
            throw error;
        });
        const backend = new Sts2Backend(rpc);
        await backend.start();
        try {
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
            const diagnosticJson = JSON.stringify(events);
            expect(diagnosticJson).to.not.include("account-canary@example.test");
            expect(diagnosticJson).to.not.include("pw-canary-x");
            expect(diagnosticJson).to.include("SqlDataPlane.Auth");
        } finally {
            diag.removeSink(sinkId);
        }
    });

    test("AzureMFA profile resolves one token and sends canonical accessToken auth", async () => {
        const rpc = standardRpc();
        const backend = new Sts2Backend(rpc);
        await backend.start();
        let tokenLookups = 0;
        await backend.openSession({
            profile: { ...PROFILE, authKind: "aad", user: "ninja@example.test" },
            applicationName: "test",
            auth: { tokenProvider: async () => (tokenLookups++, "token-canary-x") },
        });

        expect(tokenLookups).to.equal(1);
        const open = rpc.requests.find((request) => request.method === STS2_METHODS.connectionOpen);
        const auth = (
            open!.params as {
                profile: {
                    auth: { kind: string; token?: string; password?: string; user?: string };
                };
            }
        ).profile.auth;
        expect(auth).to.deep.equal({ kind: "accessToken", token: "token-canary-x" });
        expect(auth.password).to.equal(undefined);
    });

    test("missing AzureMFA token fails locally as SqlDataPlane.Auth before RPC", async () => {
        const rpc = standardRpc();
        const backend = new Sts2Backend(rpc);
        await backend.start();
        try {
            await backend.openSession({
                profile: { ...PROFILE, authKind: "aad" },
                applicationName: "test",
                auth: { tokenProvider: async () => undefined },
            });
            expect.fail("open should throw");
        } catch (error) {
            const dataPlaneError = error as { code: string; message: string };
            expect(dataPlaneError.code).to.equal("SqlDataPlane.Auth");
            expect(dataPlaneError.message).to.not.include("undefined");
        }
        expect(
            rpc.requests.filter((request) => request.method === STS2_METHODS.connectionOpen),
        ).to.have.length(0);
    });

    test("AzureMFA token-provider failure is classified as SqlDataPlane.Auth before RPC", async () => {
        const rpc = standardRpc();
        const backend = new Sts2Backend(rpc);
        await backend.start();
        try {
            await backend.openSession({
                profile: { ...PROFILE, authKind: "aad" },
                applicationName: "test",
                auth: {
                    tokenProvider: async () => {
                        throw new Error("Selected Microsoft Entra account is unavailable.");
                    },
                },
            });
            expect.fail("open should throw");
        } catch (error) {
            const dataPlaneError = error as { code: string; message: string };
            expect(dataPlaneError.code).to.equal("SqlDataPlane.Auth");
            expect(dataPlaneError.message).to.include("account is unavailable");
        }
        expect(
            rpc.requests.filter((request) => request.method === STS2_METHODS.connectionOpen),
        ).to.have.length(0);
    });

    test("AzureMFA token acquisition shares the open deadline and cannot send a late open", async () => {
        const rpc = standardRpc();
        const backend = new Sts2Backend(rpc);
        await backend.start();
        let release!: (token: string) => void;
        const token = new Promise<string>((resolve) => (release = resolve));
        try {
            await backend.openSession({
                profile: { ...PROFILE, authKind: "aad" },
                applicationName: "test",
                openTimeoutMs: 15,
                auth: { tokenProvider: async () => token },
            });
            expect.fail("token acquisition should time out");
        } catch (error) {
            expect((error as { code?: string }).code).to.equal("SqlDataPlane.Client.Timeout");
        }
        expect(
            rpc.requests.filter((request) => request.method === STS2_METHODS.connectionOpen),
        ).to.have.length(0);

        release("late-token");
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(
            rpc.requests.filter((request) => request.method === STS2_METHODS.connectionOpen),
        ).to.have.length(0);
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

    test("page limits and timeout ride the execute params inside options (QO-3)", async () => {
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { session, handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        rpc.responders.set(STS2_METHODS.queryExecute, () => ({ queryId: "q-2" }));
        const handle2 = session.execute(
            "select 2",
            { pageRows: 512, pageBytes: 131_072, maxCellBytes: 65_536, timeoutMs: 30_000 },
            new RecordingSink(),
        );
        await new Promise((r) => setTimeout(r, 5));
        const executes = rpc.requests.filter((r) => r.method === STS2_METHODS.queryExecute);
        expect(executes).to.have.length(2);
        expect((executes[1].params as { options?: unknown }).options).to.deep.equal({
            pageRows: 512,
            pageBytes: 131_072,
            maxCellBytes: 65_536,
            queryTimeoutMs: 30_000,
        });
        // pageRows no longer rides top-level (the service only honors options.*).
        expect(executes[1].params).to.not.have.property("pageRows");
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-2",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle2.completion;
    });

    test("page/timeout capabilities derive from the initialize result (QO-3)", async () => {
        const yes = standardRpc();
        yes.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: {
                maxCellBytesHonored: true,
                pageRowsHonored: true,
                pageBytesHonored: true,
                queryTimeoutHonored: true,
            },
        }));
        const availability = await new Sts2Backend(yes).start();
        expect(availability.state).to.equal("available");
        if (availability.state === "available") {
            expect(availability.capabilities.pageRowsHonored).to.equal(true);
            expect(availability.capabilities.pageBytesHonored).to.equal(true);
            expect(availability.capabilities.queryTimeoutHonored).to.equal(true);
        }

        // Absent capability object → honestly false for all three.
        const absent = await new Sts2Backend(standardRpc()).start();
        if (absent.state === "available") {
            expect(absent.capabilities.pageRowsHonored).to.equal(false);
            expect(absent.capabilities.pageBytesHonored).to.equal(false);
            expect(absent.capabilities.queryTimeoutHonored).to.equal(false);
        }
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

suite("STS2 binding: spatial WKB negotiation and column typing (D-0020)", () => {
    function spatialRpc(): ScriptedRpc {
        const rpc = standardRpc();
        rpc.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: { spatialWkbV1: true },
        }));
        return rpc;
    }

    test("capability is strict and execute option requires caller plus service opt-in", async () => {
        const yes = new Sts2Backend(spatialRpc());
        const availability = await yes.start();
        expect(availability.state).to.equal("available");
        expect(yes.spatialWkbNegotiated).to.equal(true);

        const rpc = spatialRpc();
        await openAndExecute(rpc, new RecordingSink(), DEFAULT_DEADLINES, {
            spatialEncoding: "wkb-v1",
        });
        const execute = rpc.requests.find((r) => r.method === STS2_METHODS.queryExecute);
        expect((execute?.params as { options?: unknown }).options).to.deep.equal({
            spatialEncoding: "wkb-v1",
        });

        const absentRpc = standardRpc();
        await openAndExecute(absentRpc, new RecordingSink(), DEFAULT_DEADLINES, {
            spatialEncoding: "wkb-v1",
        });
        const absentExecute = absentRpc.requests.find(
            (r) => r.method === STS2_METHODS.queryExecute,
        );
        expect(absentExecute?.params).to.not.have.property("options");
    });

    test("negotiated metadata and cell become spatial facts plus typed hint", async () => {
        const rpc = spatialRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink, DEFAULT_DEADLINES, {
            spatialEncoding: "wkb-v1",
        });
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [
                {
                    name: "shape",
                    type: "SpatialLab.sys.geometry",
                    spatial: { kind: "geometry", encoding: "wkb-v1" },
                },
            ],
        });
        const wireCell = {
            $t: "spatial",
            version: 1,
            status: "ok",
            kind: "geometry",
            encoding: "wkb",
            srid: 4326,
            wkbBytes: 21,
            wkb: "AQEAAAAAAAAAAADwPwAAAAAAAABA",
        };
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[wireCell]],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;

        expect(sink.metas[0].columns[0].spatial).to.deep.equal({
            kind: "geometry",
            encoding: "wkb-v1",
        });
        expect(sink.pages[0].compact.typeHints).to.deep.equal(["spatial:wkb:v1"]);
        expect(sink.pages[0].compact.values[0][0]).to.deep.equal(wireCell);
    });

    test("non-opted and malformed spatial metadata never claim eligibility", async () => {
        const rpc = spatialRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [
                {
                    name: "shape",
                    type: "geometry",
                    spatial: { kind: "geometry", encoding: "wkb-v2" },
                },
            ],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        expect(sink.metas[0].columns[0].spatial).to.equal(undefined);
    });
});

/** Typed vector cells (D-0019) + column typing over the scripted wire. */
suite("STS2 binding: vector encoding negotiation and column typing", () => {
    /** standardRpc whose initialize also negotiates vectorBinaryV1. */
    function vectorRpc(): ScriptedRpc {
        const rpc = standardRpc();
        rpc.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: { vectorBinaryV1: true },
        }));
        return rpc;
    }

    const EMBEDDING_COLUMN = { name: "embedding", type: "vector", length: 6152 };

    test("capability vectorBinaryV1 derives from the initialize result (both ways)", async () => {
        const yes = new Sts2Backend(vectorRpc());
        const availability = await yes.start();
        expect(availability.state).to.equal("available");
        if (availability.state === "available") {
            expect(availability.capabilities.vectorBinaryV1).to.equal(true);
        }
        expect(yes.vectorBinaryNegotiated).to.equal(true);

        // Absent capability object → honestly false.
        const no = new Sts2Backend(standardRpc());
        const absent = await no.start();
        if (absent.state === "available") {
            expect(absent.capabilities.vectorBinaryV1).to.equal(false);
        }
        expect(no.vectorBinaryNegotiated).to.equal(false);

        // Truthy-but-not-true stays false (only `=== true` counts).
        const stringy = standardRpc();
        stringy.responders.set(STS2_METHODS.initialize, () => ({
            specVersion: "2.0.0-preview.1",
            capabilities: { vectorBinaryV1: "true" },
        }));
        const notReally = new Sts2Backend(stringy);
        await notReally.start();
        expect(notReally.vectorBinaryNegotiated).to.equal(false);
    });

    test("vectorEncoding rides execute options when requested AND negotiated", async () => {
        const rpc = vectorRpc();
        await openAndExecute(rpc, new RecordingSink(), DEFAULT_DEADLINES, {
            vectorEncoding: "binary-v1",
        });
        const execute = rpc.requests.find((r) => r.method === STS2_METHODS.queryExecute);
        expect((execute?.params as { options?: unknown }).options).to.deep.equal({
            vectorEncoding: "binary-v1",
        });
    });

    test("vectorEncoding is absent when the service did not negotiate it", async () => {
        const rpc = standardRpc(); // no vectorBinaryV1 capability
        await openAndExecute(rpc, new RecordingSink(), DEFAULT_DEADLINES, {
            vectorEncoding: "binary-v1",
        });
        const execute = rpc.requests.find((r) => r.method === STS2_METHODS.queryExecute);
        expect(execute?.params).to.not.have.property("options");
    });

    test("vectorEncoding is absent when the caller did not opt in, even when negotiated", async () => {
        const rpc = vectorRpc();
        await openAndExecute(rpc, new RecordingSink()); // opts = {}
        const execute = rpc.requests.find((r) => r.method === STS2_METHODS.queryExecute);
        expect(execute?.params).to.not.have.property("options");
    });

    test("vector column on a binary-v1 query: sqlType/maxLength/vector facts + typed hint", async () => {
        const rpc = vectorRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink, DEFAULT_DEADLINES, {
            vectorEncoding: "binary-v1",
        });
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [EMBEDDING_COLUMN],
        });
        // The typed cell payload must pass through the page untouched.
        const wireCell = {
            $t: "vector",
            version: 1,
            status: "ok",
            dimensions: 1,
            baseType: "float32",
            encoding: "f32le",
            byteLength: 4,
            data: "AACAPw==", // 1.0f LE
        };
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[wireCell]],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        const column = sink.metas[0].columns[0];
        expect(column.name).to.equal("embedding");
        expect(column.sqlType).to.equal("vector");
        expect(column.maxLength).to.equal(6152);
        // dims from wire length: (6152 - 8) / 4 = 1536.
        expect(column.vector).to.deep.equal({ transport: "binary-v1", dimensions: 1536 });
        expect(sink.pages[0].compact.typeHints).to.deep.equal(["vector:f32le:v1"]);
        expect(sink.pages[0].compact.values[0][0]).to.deep.equal(wireCell);
    });

    test("vector column on a NON-opted query says textFallback and hints string", async () => {
        // Negotiated but not requested — the harder truth-telling case.
        const rpc = vectorRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink); // opts = {}
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [EMBEDDING_COLUMN],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [["[1.0, 2.0]"]], // D-0018 JSON-array text fallback
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        const column = sink.metas[0].columns[0];
        expect(column.vector).to.deep.equal({ transport: "textFallback", dimensions: 1536 });
        expect(sink.pages[0].compact.typeHints).to.deep.equal(["string"]);
    });

    test("vector column with a misaligned wire length omits dimensions", async () => {
        const rpc = vectorRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink, DEFAULT_DEADLINES, {
            vectorEncoding: "binary-v1",
        });
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [{ name: "embedding", type: "vector", length: 6153 }],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        expect(sink.metas[0].columns[0].vector).to.deep.equal({ transport: "binary-v1" });
    });

    test("wireColumnType falls back to the service's `type` field (sqlType no longer silently undefined)", async () => {
        // The service serializes the engine type as `type` (D-0018); before
        // the fallback landed, sqlType was silently undefined on the STS2
        // path because only engineType/EngineType were read.
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [
                { name: "n", type: "int" },
                { name: "s", Type: "nvarchar", Length: 200 },
                { name: "d", type: "decimal", precision: 18, scale: 4 },
            ],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[1, "a", "1.0000"]],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        const columns = sink.metas[0].columns;
        expect(columns[0].sqlType).to.equal("int");
        expect(columns[1].sqlType).to.equal("nvarchar");
        expect(columns[1].maxLength).to.equal(200);
        expect(columns[2].sqlType).to.equal("decimal");
        expect(columns[2].precision).to.equal(18);
        expect(columns[2].scale).to.equal(4);
        expect(sink.pages[0].compact.typeHints).to.deep.equal([
            "number",
            "string",
            "number:approx",
        ]);
    });

    test("timestamp/rowversion hint binary, not datetime (QO-5 server lockstep)", async () => {
        // The service's SerializeTypeHints always said "binary" for
        // timestamp/rowversion; the client's startsWith("time") branch used
        // to run first and wrongly hinted "datetime". Taxonomy order is now
        // fixed to match the service — this pins the lockstep.
        const rpc = standardRpc();
        const sink = new RecordingSink();
        const { handle } = await openAndExecute(rpc, sink);
        rpc.push(STS2_METHODS.queryResultSet, {
            queryId: "q-1",
            resultSetId: 0,
            columns: [
                { name: "ts", engineType: "timestamp" },
                { name: "rv", engineType: "rowversion" },
                { name: "dt", engineType: "datetime2" },
                { name: "t", engineType: "time" },
                { name: "sdt", engineType: "smalldatetime" },
            ],
        });
        rpc.push(STS2_METHODS.queryRows, {
            queryId: "q-1",
            resultSetId: 0,
            pageSeq: 0,
            rowOffset: 0,
            rows: [[null, null, null, null, null]],
        });
        rpc.push(STS2_METHODS.queryComplete, {
            queryId: "q-1",
            status: "succeeded",
            rowsAffected: null,
        });
        await handle.completion;
        expect(sink.pages[0].compact.typeHints).to.deep.equal([
            "binary",
            "binary",
            "datetime",
            "datetime",
            "datetime",
        ]);
    });
});
