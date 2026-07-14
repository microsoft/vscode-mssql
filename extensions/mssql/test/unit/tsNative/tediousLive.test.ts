/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-3 live lane: TediousDriver + TsNativeBackend against a real SQL
 * Server. Gated on STS2_SQLSERVER_CONNSTRING (skip-not-fail, the STS2
 * EngineGate convention). The connection string is parsed in-host and never
 * displayed, logged, or persisted.
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
    decodeCell,
} from "../../../src/services/sqlDataPlane/api";
import { productionClock } from "../../../src/services/tsNative/driver/tdsDriver";
import { TediousDriver } from "../../../src/services/tsNative/driver/tediousDriver";
import { TsNativeBackend } from "../../../src/services/tsNative/tsNativeBackend";

// ---------------------------------------------------------------------------
// Connection-string lane (parsed in-host; never logged)
// ---------------------------------------------------------------------------

interface LiveTarget {
    server: string;
    database?: string;
    user?: string;
    password?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
}

function parseConnString(raw: string | undefined): LiveTarget | undefined {
    if (!raw) {
        return undefined;
    }
    const target: LiveTarget = { server: "" };
    for (const part of raw.split(";")) {
        const eq = part.indexOf("=");
        if (eq <= 0) {
            continue;
        }
        const key = part.slice(0, eq).trim().toLowerCase();
        const value = part.slice(eq + 1).trim();
        switch (key) {
            case "server":
            case "data source":
                target.server = value.replace(/^tcp:/i, "");
                break;
            case "database":
            case "initial catalog":
                target.database = value;
                break;
            case "user id":
            case "uid":
            case "user":
                target.user = value;
                break;
            case "password":
            case "pwd":
                target.password = value;
                break;
            case "encrypt":
                target.encrypt = value.toLowerCase();
                break;
            case "trustservercertificate":
                target.trustServerCertificate = value.toLowerCase() === "true";
                break;
        }
    }
    // SQL-login lane only (integrated is a ts-native capability gap).
    if (!target.server || !target.user || target.password === undefined) {
        return undefined;
    }
    return target;
}

const TARGET = parseConnString(process.env.STS2_SQLSERVER_CONNSTRING);

function liveProfile(target: LiveTarget): SqlConnectionProfileRef {
    return {
        profileFingerprint: "fp_live_tsn",
        server: target.server,
        ...(target.database ? { database: target.database } : {}),
        authKind: "sql",
        user: target.user ?? "",
        ...(target.encrypt !== undefined ? { encrypt: target.encrypt } : {}),
        trustServerCertificate: target.trustServerCertificate !== false,
    };
}

class CollectingSink implements IQueryEventSink {
    readonly resultSets: ResultSetMetadata[] = [];
    readonly pages: RowsPage[] = [];
    readonly messages: ServerMessage[] = [];
    summary: QueryCompleteSummary | undefined;
    onResultSetStarted(meta: ResultSetMetadata): void {
        this.resultSets.push(meta);
    }
    onRowsPage(page: RowsPage): void {
        this.pages.push(page);
    }
    onMessage(msg: ServerMessage): void {
        this.messages.push(msg);
    }
    onComplete(summary: QueryCompleteSummary): void {
        this.summary = summary;
    }
    cell(setIndex: number, row: number, col: number): ReturnType<typeof decodeCell> {
        const setId = this.resultSets[setIndex].resultSetId;
        const pages = this.pages.filter((p) => p.resultSetId === setId);
        const columnCount = this.resultSets[setIndex].columns.length;
        let offset = row;
        for (const page of pages) {
            if (offset < page.rowCount) {
                return decodeCell(page.compact, offset, col, columnCount);
            }
            offset -= page.rowCount;
        }
        throw new Error("row out of range");
    }
}

async function openLive(): Promise<{ backend: TsNativeBackend; session: ISqlSession }> {
    const target = TARGET!;
    let n = 0;
    const backend = new TsNativeBackend({
        driver: new TediousDriver(),
        clock: productionClock(),
        ids: { next: (p) => `${p}-live-${++n}` },
    });
    const session = await backend.openSession({
        profile: liveProfile(target),
        applicationName: "vscode-mssql-tsn-live-tests",
        auth: { passwordProvider: async () => target.password },
    });
    return { backend, session };
}

async function run(
    session: ISqlSession,
    sql: string,
    opts: Parameters<ISqlSession["execute"]>[1] = {},
): Promise<{ sink: CollectingSink; summary: QueryCompleteSummary }> {
    const sink = new CollectingSink();
    const handle = session.execute(sql, opts, sink);
    const summary = await handle.completion;
    return { sink, summary };
}

// ---------------------------------------------------------------------------

suite("ts-native live engine (STS2_SQLSERVER_CONNSTRING lane)", function () {
    this.timeout(60_000);

    suiteSetup(function () {
        if (!TARGET) {
            this.skip();
        }
    });

    test("SELECT 1: transcript, typed cell, session facts", async () => {
        const { session } = await openLive();
        try {
            expect(session.info.backendKind).to.equal("ts-native");
            const { sink, summary } = await run(session, "SELECT 1 AS one");
            expect(summary.status).to.equal("succeeded");
            expect(summary.resultSetCount).to.equal(1);
            expect(summary.totalRows).to.equal(1);
            expect(sink.resultSets[0].columns[0].name).to.equal("one");
            expect(sink.resultSets[0].columns[0].sqlType).to.equal("int");
            const cell = sink.cell(0, 0, 0);
            expect(cell).to.deep.include({ kind: "number", value: 1 });
        } finally {
            await session.close();
        }
    });

    test("multi-set batch with PRINT and RAISERROR: order, severity, line numbers", async () => {
        const { session } = await openLive();
        try {
            const { sink, summary } = await run(
                session,
                "SELECT 1 AS a\nPRINT 'hello from tsn'\nSELECT 'x' AS b\nRAISERROR('tsn boom', 16, 3)",
            );
            expect(summary.status).to.equal("completedWithErrors");
            expect(summary.resultSetCount).to.equal(2);
            expect(summary.errorCount).to.equal(1);
            const printMsg = sink.messages.find((m) => m.text === "hello from tsn");
            expect(printMsg?.kind).to.equal("info");
            const boom = sink.messages.find((m) => m.text === "tsn boom");
            expect(boom?.kind).to.equal("error");
            expect(boom?.severity).to.equal(16);
            expect(boom?.state).to.equal(3);
            expect(boom?.line).to.be.a("number");
        } finally {
            await session.close();
        }
    });

    test("DML rows affected are structured; SELECT row counts are not rowsAffected", async () => {
        const { session } = await openLive();
        try {
            const { summary } = await run(
                session,
                "SET NOCOUNT OFF\nCREATE TABLE #tsn (n int)\nINSERT INTO #tsn VALUES (1),(2),(3)\nSELECT * FROM #tsn\nDROP TABLE #tsn",
            );
            expect(summary.status).to.equal("succeeded");
            expect(summary.totalRows).to.equal(3);
            expect(summary.rowsAffected).to.equal(3, "insert count only");
        } finally {
            await session.close();
        }
    });

    test("cancel during WAITFOR: canceled terminal, session reusable", async () => {
        const { session } = await openLive();
        try {
            const sink = new CollectingSink();
            const handle = session.execute("WAITFOR DELAY '00:00:25'", {}, sink);
            await new Promise((resolve) => setTimeout(resolve, 300));
            const ack = await handle.cancel();
            expect(ack.acknowledged).to.equal(true);
            const summary = await handle.completion;
            expect(summary.status).to.equal("canceled");
            // post-cancel the connection is reusable (attention semantics)
            const again = await run(session, "SELECT 2 AS two");
            expect(again.summary.status).to.equal("succeeded");
        } finally {
            await session.close();
        }
    });

    test("timeout after early response: domain deadline fires (§2.4)", async () => {
        const { session } = await openLive();
        try {
            const sink = new CollectingSink();
            const handle = session.execute(
                "SELECT 1 AS early\nWAITFOR DELAY '00:00:25'",
                { timeoutMs: 1500 },
                sink,
            );
            const summary = await handle.completion;
            expect(summary.status).to.equal("failed");
            expect(summary.error?.code).to.equal(DataPlaneErrorCodes.clientTimeout);
        } finally {
            await session.close();
        }
    });

    test("USE database surfaces onDidChangeDatabase from ENVCHANGE", async () => {
        const { session } = await openLive();
        try {
            const changes: string[] = [];
            session.onDidChangeDatabase((change) => changes.push(change.database));
            const { summary } = await run(session, "USE tempdb");
            expect(summary.status).to.equal("succeeded");
            expect(changes).to.include("tempdb");
        } finally {
            await session.close();
        }
    });

    test("exact-mode: decimal(38) fails closed pre-rows; decimal(9,2) renders fixed scale", async () => {
        const { session } = await openLive();
        try {
            const big = await run(session, "SELECT CAST(1.5 AS decimal(38,10)) AS d");
            expect(big.summary.status).to.equal("failed");
            expect(big.summary.error?.code).to.equal(DataPlaneErrorCodes.capabilityUnsupported);
            expect(big.sink.pages.length).to.equal(0);

            const small = await run(session, "SELECT CAST(1.5 AS decimal(9,2)) AS d");
            expect(small.summary.status).to.equal("succeeded");
            const cell = small.sink.cell(0, 0, 0);
            expect(cell).to.deep.include({ kind: "number", value: "1.50", exact: false });
        } finally {
            await session.close();
        }
    });

    test("varchar(max) over cell cap arrives as truncation marker with digest", async () => {
        const { session } = await openLive();
        try {
            const { sink, summary } = await run(
                session,
                "SELECT REPLICATE(CAST('a' AS varchar(max)), 100000) AS big",
                { maxCellBytes: 4096 },
            );
            expect(summary.status).to.equal("succeeded");
            const cell = sink.cell(0, 0, 0);
            expect(cell.kind).to.equal("string");
            if (cell.kind === "string") {
                expect(cell.truncated?.originalBytes).to.equal(100000);
                expect(cell.truncated?.digest).to.match(/^sha256:[0-9a-f]{64}$/);
            }
        } finally {
            await session.close();
        }
    });

    test("bad password maps to SqlDataPlane.Auth (non-retryable)", async () => {
        const target = TARGET!;
        let n = 0;
        const backend = new TsNativeBackend({
            driver: new TediousDriver(),
            clock: productionClock(),
            ids: { next: (p) => `${p}-bad-${++n}` },
        });
        let error: SqlDataPlaneError | undefined;
        await backend
            .openSession({
                profile: liveProfile(target),
                applicationName: "tsn-bad-auth",
                openTimeoutMs: 20_000,
                auth: { passwordProvider: async () => "definitely-wrong-password-1!" },
            })
            .catch((e) => (error = e as SqlDataPlaneError));
        expect(error?.code).to.equal(DataPlaneErrorCodes.auth);
        expect(error?.retryable).to.equal(false);
    });
});
