/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `VsCodeMssqlEphemeralConnector` — the host-glue `EphemeralConnector`
 * that bridges Cloud Deploy's ephemeral-database seam (Scope 2, decision D-C)
 * to vscode-mssql's `ConnectionManager`. Covers owner-URI lifecycle, signal
 * cancellation, error mapping, the shared `VsCodeMssqlConnectionHandle`'s
 * row-mapping, and idempotent dispose.
 *
 * The `ConnectionManager` itself is stubbed via `FakeConnectionManager`: the
 * connector only touches a tiny public surface (`connect`, `disconnect`,
 * `client.sendRequest`), so a typed shim suffices.
 */

import { expect } from "chai";

import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionError } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { VsCodeMssqlEphemeralConnector } from "../../src/cloudDeploy/host/vscodeMssqlConnectionStrategy";
import type { EphemeralConnectionParams } from "../../src/cloudDeploy/validation/providers/ephemeralDatabaseProvider";

interface ConnectCall {
    readonly ownerUri: string;
    readonly server: string;
}

interface SimpleExecuteRow {
    readonly displayValue: string;
    readonly isNull: boolean;
}

const PARAMS: EphemeralConnectionParams = {
    host: "localhost",
    port: 11433,
    user: "sa",
    password: "p@ss",
    database: "CloudDeployValidation",
    trustServerCertificate: true,
};

class FakeConnectionManager {
    public connectResult: boolean | (() => boolean | Promise<boolean>) = true;
    public connectThrow: Error | undefined;
    public sendRequestImpl:
        | ((sql: string, ownerUri: string) => SimpleExecuteRow[][] | Promise<SimpleExecuteRow[][]>)
        | undefined;
    public sendRequestThrow: Error | undefined;
    public disconnectThrow: Error | undefined;

    public connectCalls: ConnectCall[] = [];
    public disconnectCalls: string[] = [];
    public executeCalls: Array<{ sql: string; ownerUri: string }> = [];

    public get client() {
        return {
            sendRequest: async (
                _type: unknown,
                params: { ownerUri: string; queryString: string },
            ) => {
                this.executeCalls.push({ sql: params.queryString, ownerUri: params.ownerUri });
                if (this.sendRequestThrow) {
                    throw this.sendRequestThrow;
                }
                const rows = this.sendRequestImpl
                    ? await this.sendRequestImpl(params.queryString, params.ownerUri)
                    : [];
                return { rowCount: rows.length, columnInfo: [], rows, messages: [] };
            },
        };
    }

    public async connect(
        ownerUri: string,
        credentials: { server: string },
        _options: { connectionSource?: string; shouldHandleErrors?: boolean },
    ): Promise<boolean> {
        this.connectCalls.push({ ownerUri, server: credentials.server });
        if (this.connectThrow) {
            throw this.connectThrow;
        }
        return typeof this.connectResult === "function" ? this.connectResult() : this.connectResult;
    }

    public async disconnect(ownerUri: string): Promise<boolean> {
        this.disconnectCalls.push(ownerUri);
        if (this.disconnectThrow) {
            throw this.disconnectThrow;
        }
        return true;
    }
}

function asConnectionManager(fake: FakeConnectionManager): ConnectionManager {
    return fake as unknown as ConnectionManager;
}

suite("CloudDeploy VsCodeMssqlEphemeralConnector", () => {
    test("throws ConnectionError(timeout) when signal is pre-aborted; never connects", async () => {
        const fake = new FakeConnectionManager();
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));
        const ctrl = new AbortController();
        ctrl.abort();

        try {
            await connector.connect(PARAMS, ctrl.signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("timeout");
        }
        expect(fake.connectCalls).to.have.length(0);
    });

    test("connects with host,port credentials and returns a usable handle", async () => {
        const fake = new FakeConnectionManager();
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));

        const handle = await connector.connect(PARAMS, new AbortController().signal);

        expect(handle).to.not.be.undefined;
        expect(fake.connectCalls).to.have.length(1);
        expect(fake.connectCalls[0].server).to.equal("localhost,11433");
    });

    test("throws ConnectionError(unknown) when ConnectionManager.connect returns false", async () => {
        const fake = new FakeConnectionManager();
        fake.connectResult = false;
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));

        try {
            await connector.connect(PARAMS, new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
        }
        expect(fake.connectCalls).to.have.length(1);
    });

    test("wraps connect() exception as ConnectionError(unknown)", async () => {
        const fake = new FakeConnectionManager();
        fake.connectThrow = new Error("login refused");
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));

        try {
            await connector.connect(PARAMS, new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
            expect((err as ConnectionError).message).to.contain("login refused");
        }
    });

    test("execute maps DbCellValue rows to (string|null)[][] and reuses the owner URI", async () => {
        const fake = new FakeConnectionManager();
        fake.sendRequestImpl = (sql) => {
            expect(sql).to.equal("SELECT @@VERSION");
            return [
                [
                    { displayValue: "Microsoft SQL Server 2022", isNull: false },
                    { displayValue: "", isNull: true },
                ],
            ];
        };
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));

        const handle = await connector.connect(PARAMS, new AbortController().signal);
        const rows = await handle.execute("SELECT @@VERSION", new AbortController().signal);

        expect(rows).to.deep.equal([["Microsoft SQL Server 2022", null]]);
        expect(fake.executeCalls).to.have.length(1);
        expect(fake.executeCalls[0].ownerUri).to.equal(fake.connectCalls[0].ownerUri);
    });

    test("execute() throws ConnectionError(timeout) when signal aborted before send", async () => {
        const fake = new FakeConnectionManager();
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));
        const handle = await connector.connect(PARAMS, new AbortController().signal);

        const ctrl = new AbortController();
        ctrl.abort();
        try {
            await handle.execute("SELECT 1", ctrl.signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("timeout");
        }
        expect(fake.executeCalls).to.have.length(0);
    });

    test("execute() wraps sendRequest errors as ConnectionError(unknown)", async () => {
        const fake = new FakeConnectionManager();
        fake.sendRequestThrow = new Error("query timed out on server");
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));
        const handle = await connector.connect(PARAMS, new AbortController().signal);

        try {
            await handle.execute("SELECT 1", new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
            expect((err as ConnectionError).message).to.contain("query timed out on server");
        }
    });

    test("dispose() disconnects exactly once even when called repeatedly", async () => {
        const fake = new FakeConnectionManager();
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));
        const handle = await connector.connect(PARAMS, new AbortController().signal);

        await handle.dispose();
        await handle.dispose();
        await handle.dispose();

        expect(fake.disconnectCalls).to.have.length(1);
        expect(fake.disconnectCalls[0]).to.equal(fake.connectCalls[0].ownerUri);
    });

    test("dispose() swallows disconnect errors", async () => {
        const fake = new FakeConnectionManager();
        fake.disconnectThrow = new Error("server already gone");
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));
        const handle = await connector.connect(PARAMS, new AbortController().signal);

        // Must not throw.
        await handle.dispose();
        expect(fake.disconnectCalls).to.have.length(1);
    });

    test("execute() after dispose() throws ConnectionError(unknown)", async () => {
        const fake = new FakeConnectionManager();
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));
        const handle = await connector.connect(PARAMS, new AbortController().signal);
        await handle.dispose();

        try {
            await handle.execute("SELECT 1", new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
        }
        expect(fake.executeCalls).to.have.length(0);
    });

    test("aborts after a successful connect: tears down and throws ConnectionError(timeout)", async () => {
        const ctrl = new AbortController();
        const fake = new FakeConnectionManager();
        // Abort the signal while connect() is in flight so the post-connect
        // check observes an aborted signal.
        fake.connectResult = () => {
            ctrl.abort();
            return true;
        };
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));

        try {
            await connector.connect(PARAMS, ctrl.signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("timeout");
        }
        expect(fake.connectCalls).to.have.length(1);
        expect(fake.disconnectCalls).to.have.length(1);
        expect(fake.disconnectCalls[0]).to.equal(fake.connectCalls[0].ownerUri);
    });

    test("owner URIs are unique per connect attempt", async () => {
        const fake = new FakeConnectionManager();
        const connector = new VsCodeMssqlEphemeralConnector(asConnectionManager(fake));

        const h1 = await connector.connect(PARAMS, new AbortController().signal);
        const h2 = await connector.connect(PARAMS, new AbortController().signal);
        await h1.dispose();
        await h2.dispose();

        expect(fake.connectCalls).to.have.length(2);
        expect(fake.connectCalls[0].ownerUri).to.not.equal(fake.connectCalls[1].ownerUri);
        expect(fake.connectCalls[0].ownerUri).to.match(
            /^cloud-deploy-ephemeral:\/\/CloudDeployValidation\//,
        );
    });
});
