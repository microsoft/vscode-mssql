/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { ConnectionError } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { EphemeralConnectionParams } from "../../src/cloudDeploy/validation/providers/ephemeralDatabaseProvider";
import {
    NodeMssqlConnectionHandle,
    NodeMssqlEphemeralConnector,
    SqlSession,
} from "../../src/cloudDeploy/host/nodeMssqlConnection";

/** Controllable fake `SqlSession`: canned rows or a thrown error, with call counts. */
class FakeSqlSession implements SqlSession {
    public closed = 0;
    public cancelled = 0;
    public readonly queries: string[] = [];

    public constructor(
        private readonly _behavior: {
            rows?: unknown[][];
            error?: Error;
            onQuery?: () => void;
        } = {},
    ) {}

    public async query(command: string): Promise<unknown[][]> {
        this.queries.push(command);
        this._behavior.onQuery?.();
        if (this._behavior.error !== undefined) {
            throw this._behavior.error;
        }
        return this._behavior.rows ?? [];
    }

    public cancel(): void {
        this.cancelled += 1;
    }

    public async close(): Promise<void> {
        this.closed += 1;
    }
}

const PARAMS: EphemeralConnectionParams = {
    host: "localhost",
    port: 11433,
    user: "sa",
    password: "pw",
    database: "db",
    trustServerCertificate: true,
};

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (err) {
        return err;
    }
    return undefined;
}

suite("CloudDeploy NodeMssqlConnection", () => {
    suite("NodeMssqlConnectionHandle.execute", () => {
        test("returns the session's positional rows", async () => {
            const handle = new NodeMssqlConnectionHandle(
                new FakeSqlSession({
                    rows: [
                        ["a", 1],
                        ["b", 2],
                    ],
                }),
            );
            const rows = await handle.execute("SELECT x", new AbortController().signal);
            expect(rows).to.deep.equal([
                ["a", 1],
                ["b", 2],
            ]);
        });

        test("normalizes undefined cells to null", async () => {
            const handle = new NodeMssqlConnectionHandle(
                new FakeSqlSession({ rows: [[undefined, "x"]] }),
            );
            const rows = await handle.execute("SELECT x", new AbortController().signal);
            expect(rows[0][0]).to.be.null;
            expect(rows[0][1]).to.equal("x");
        });

        test("throws ConnectionError when the handle is disposed", async () => {
            const handle = new NodeMssqlConnectionHandle(new FakeSqlSession());
            await handle.dispose();
            const caught = await rejection(() =>
                handle.execute("SELECT 1", new AbortController().signal),
            );
            expect(caught).to.be.instanceOf(ConnectionError);
        });

        test("throws ConnectionError(timeout) when the signal is already aborted", async () => {
            const controller = new AbortController();
            controller.abort();
            const handle = new NodeMssqlConnectionHandle(new FakeSqlSession());
            const caught = await rejection(() => handle.execute("SELECT 1", controller.signal));
            expect(caught).to.be.instanceOf(ConnectionError);
            expect((caught as ConnectionError).kind).to.equal("timeout");
        });

        test("cancels the session and reports timeout when aborted mid-query", async () => {
            const controller = new AbortController();
            const session = new FakeSqlSession({
                onQuery: () => controller.abort(),
                error: new Error("request cancelled"),
            });
            const handle = new NodeMssqlConnectionHandle(session);
            const caught = await rejection(() => handle.execute("SELECT 1", controller.signal));
            expect(caught).to.be.instanceOf(ConnectionError);
            expect((caught as ConnectionError).kind).to.equal("timeout");
            expect(session.cancelled).to.be.greaterThan(0);
        });

        test("wraps a query failure as ConnectionError", async () => {
            const handle = new NodeMssqlConnectionHandle(
                new FakeSqlSession({ error: new Error("boom") }),
            );
            const caught = await rejection(() =>
                handle.execute("SELECT 1", new AbortController().signal),
            );
            expect(caught).to.be.instanceOf(ConnectionError);
        });
    });

    suite("NodeMssqlConnectionHandle.dispose", () => {
        test("closes the session exactly once across repeated calls", async () => {
            const session = new FakeSqlSession();
            const handle = new NodeMssqlConnectionHandle(session);
            await handle.dispose();
            await handle.dispose();
            expect(session.closed).to.equal(1);
        });
    });

    suite("NodeMssqlEphemeralConnector.connect", () => {
        test("returns a working handle from the session factory", async () => {
            const connector = new NodeMssqlEphemeralConnector(
                async () => new FakeSqlSession({ rows: [[1]] }),
            );
            const handle = await connector.connect(PARAMS, new AbortController().signal);
            const rows = await handle.execute("SELECT 1", new AbortController().signal);
            expect(rows).to.deep.equal([[1]]);
        });

        test("throws ConnectionError(timeout) without opening when aborted first", async () => {
            const controller = new AbortController();
            controller.abort();
            let factoryCalled = false;
            const connector = new NodeMssqlEphemeralConnector(async () => {
                factoryCalled = true;
                return new FakeSqlSession();
            });
            const caught = await rejection(() => connector.connect(PARAMS, controller.signal));
            expect(caught).to.be.instanceOf(ConnectionError);
            expect((caught as ConnectionError).kind).to.equal("timeout");
            expect(factoryCalled).to.equal(false);
        });

        test("classifies a login failure as auth-failed", async () => {
            const connector = new NodeMssqlEphemeralConnector(async () => {
                throw new Error("Login failed for user 'sa'.");
            });
            const caught = await rejection(() =>
                connector.connect(PARAMS, new AbortController().signal),
            );
            expect((caught as ConnectionError).kind).to.equal("auth-failed");
        });

        test("disposes the session and reports timeout when aborted after opening", async () => {
            const controller = new AbortController();
            const session = new FakeSqlSession();
            const connector = new NodeMssqlEphemeralConnector(async () => {
                controller.abort();
                return session;
            });
            const caught = await rejection(() => connector.connect(PARAMS, controller.signal));
            expect((caught as ConnectionError).kind).to.equal("timeout");
            expect(session.closed).to.equal(1);
        });
    });
});
