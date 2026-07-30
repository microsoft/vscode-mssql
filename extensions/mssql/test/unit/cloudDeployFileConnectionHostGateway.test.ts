/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the headless `FileConnectionHostGateway` and `loadConnectionsFile`
 * (Scope 2): the CLI-side host glue that resolves a connection-profile id from
 * an injected `id -> connection string` map (no `ConnectionManager`, no secret
 * store). A fake `SqlSession` factory is injected so the gateway's
 * orchestration is exercised without a live SQL Server.
 *   * missing / empty entries surface as `ConnectionError("unknown")`.
 *   * `buildConnectionString` returns the string as-is for an undefined database
 *     and re-targets the catalog for a concrete one.
 *   * `connect` re-targets the catalog, opens a session, and wraps it in a
 *     working handle; an aborted signal short-circuits before opening.
 *   * `seedScriptFile` runs each `GO` batch on ONE handle and disposes it.
 *   * `loadConnectionsFile` accepts a valid object and rejects mis-shaped files.
 */

import { expect } from "chai";

import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import {
    ConnectionStringSessionFactory,
    FileConnectionHostGateway,
    loadConnectionsFile,
} from "../../src/cloudDeploy/host/fileConnectionHostGateway";
import { ConnectionError } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { SqlSession } from "../../src/cloudDeploy/host/nodeMssqlConnection";

const CONN = "Server=dev,1433;User ID=sa;Password=pw;Database=AppDb;TrustServerCertificate=true";

/** Records the commands run against it; never touches a real driver. */
class FakeSqlSession implements SqlSession {
    public readonly queries: string[] = [];
    public closed = false;

    public async query(command: string): Promise<unknown[][]> {
        this.queries.push(command);
        return [[]];
    }

    public cancel(): void {
        // no-op: cancellation is exercised by the handle's own unit tests
    }

    public async close(): Promise<void> {
        this.closed = true;
    }
}

interface RecordingFactory {
    readonly factory: ConnectionStringSessionFactory;
    /** The connection strings the gateway opened sessions with, in order. */
    readonly connectionStrings: string[];
    /** The fake sessions handed back, in order. */
    readonly sessions: FakeSqlSession[];
}

/** A session factory that records the connection strings it is asked to open. */
function recordingFactory(): RecordingFactory {
    const connectionStrings: string[] = [];
    const sessions: FakeSqlSession[] = [];
    return {
        connectionStrings,
        sessions,
        factory: async (connectionString: string): Promise<SqlSession> => {
            connectionStrings.push(connectionString);
            const session = new FakeSqlSession();
            sessions.push(session);
            return session;
        },
    };
}

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

function abortedSignal(): AbortSignal {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
}

/** Awaits `promise`, asserting it rejects with an error message matching `pattern`. */
async function expectRejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    let caught: unknown;
    try {
        await promise;
    } catch (err) {
        caught = err;
    }
    expect(caught, "expected the promise to reject").to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(pattern);
}

suite("CloudDeploy FileConnectionHostGateway", () => {
    suite("missing entries", () => {
        test("connect throws ConnectionError('unknown') for an unknown profile id", async () => {
            const gateway = new FileConnectionHostGateway(new Map(), recordingFactory().factory);

            let caught: unknown;
            try {
                await gateway.connect("missing", "master", newSignal());
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(ConnectionError);
            expect((caught as ConnectionError).kind).to.equal("unknown");
        });

        test("connect throws ConnectionError for an empty connection string", async () => {
            const gateway = new FileConnectionHostGateway(
                new Map([["dev", ""]]),
                recordingFactory().factory,
            );

            let caught: unknown;
            try {
                await gateway.connect("dev", "master", newSignal());
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(ConnectionError);
        });

        test("buildConnectionString throws ConnectionError for an unknown profile id", async () => {
            const gateway = new FileConnectionHostGateway(new Map(), recordingFactory().factory);

            let caught: unknown;
            try {
                await gateway.buildConnectionString("missing", undefined, newSignal());
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(ConnectionError);
        });
    });

    suite("buildConnectionString", () => {
        test("returns the injected string as-is when the database is undefined", async () => {
            const gateway = new FileConnectionHostGateway(
                new Map([["dev", CONN]]),
                recordingFactory().factory,
            );

            const result = await gateway.buildConnectionString("dev", undefined, newSignal());
            expect(result).to.equal(CONN);
        });

        test("re-targets the catalog when a concrete database is given", async () => {
            const gateway = new FileConnectionHostGateway(
                new Map([["dev", CONN]]),
                recordingFactory().factory,
            );

            const result = await gateway.buildConnectionString(
                "dev",
                "CloudDeployValidation_x",
                newSignal(),
            );
            expect(result).to.contain("Database=CloudDeployValidation_x");
            expect(result).to.not.contain("Database=AppDb");
        });

        test("throws ConnectionError('timeout') when the signal is already aborted", async () => {
            const gateway = new FileConnectionHostGateway(
                new Map([["dev", CONN]]),
                recordingFactory().factory,
            );

            let caught: unknown;
            try {
                await gateway.buildConnectionString("dev", undefined, abortedSignal());
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(ConnectionError);
            expect((caught as ConnectionError).kind).to.equal("timeout");
        });
    });

    suite("connect", () => {
        test("re-targets the catalog and returns a handle over the opened session", async () => {
            const rec = recordingFactory();
            const gateway = new FileConnectionHostGateway(new Map([["dev", CONN]]), rec.factory);

            const handle = await gateway.connect("dev", "master", newSignal());

            expect(rec.connectionStrings[0]).to.contain("Database=master");
            expect(rec.connectionStrings[0]).to.not.contain("Database=AppDb");

            // The returned handle forwards execute() to the opened session and
            // dispose() closes it.
            await handle.execute("SELECT 1", newSignal());
            expect(rec.sessions[0].queries).to.deep.equal(["SELECT 1"]);
            await handle.dispose();
            expect(rec.sessions[0].closed).to.equal(true);
        });

        test("throws ConnectionError('timeout') and never opens when already aborted", async () => {
            const rec = recordingFactory();
            const gateway = new FileConnectionHostGateway(new Map([["dev", CONN]]), rec.factory);

            let caught: unknown;
            try {
                await gateway.connect("dev", "master", abortedSignal());
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(ConnectionError);
            expect((caught as ConnectionError).kind).to.equal("timeout");
            expect(rec.connectionStrings).to.have.length(0);
        });
    });

    suite("seedScriptFile", () => {
        let dir: string;

        setup(async () => {
            dir = await fs.mkdtemp(path.join(os.tmpdir(), "cd-gateway-"));
        });

        teardown(async () => {
            await fs.rm(dir, { recursive: true, force: true });
        });

        test("runs each GO-separated batch on one handle re-targeted at the database", async () => {
            const rec = recordingFactory();
            const gateway = new FileConnectionHostGateway(new Map([["dev", CONN]]), rec.factory);
            const scriptPath = path.join(dir, "seed.sql");
            await fs.writeFile(
                scriptPath,
                "CREATE TABLE t(id INT)\nGO\nINSERT INTO t VALUES (1)\n",
                "utf8",
            );

            await gateway.seedScriptFile("dev", "CloudDeployValidation_x", scriptPath, newSignal());

            // One session for the whole script (session-scoped temp objects must
            // survive across GO), re-targeted at the throwaway, closed at the end.
            expect(rec.sessions).to.have.length(1);
            expect(rec.connectionStrings[0]).to.contain("Database=CloudDeployValidation_x");
            expect(rec.sessions[0].queries).to.deep.equal([
                "CREATE TABLE t(id INT)",
                "INSERT INTO t VALUES (1)",
            ]);
            expect(rec.sessions[0].closed).to.equal(true);
        });
    });

    suite("loadConnectionsFile", () => {
        let dir: string;

        setup(async () => {
            dir = await fs.mkdtemp(path.join(os.tmpdir(), "cd-connfile-"));
        });

        teardown(async () => {
            await fs.rm(dir, { recursive: true, force: true });
        });

        async function write(name: string, content: string): Promise<string> {
            const filePath = path.join(dir, name);
            await fs.writeFile(filePath, content, "utf8");
            return filePath;
        }

        test("parses a valid id -> connection string object into a Map", async () => {
            const filePath = await write(
                "c.json",
                JSON.stringify({ dev: CONN, staging: "Server=s" }),
            );

            const map = await loadConnectionsFile(filePath);
            expect(map.get("dev")).to.equal(CONN);
            expect(map.get("staging")).to.equal("Server=s");
            expect(map.size).to.equal(2);
        });

        test("rejects a top-level JSON array", async () => {
            const filePath = await write("arr.json", JSON.stringify([CONN]));
            await expectRejects(loadConnectionsFile(filePath), /must be a JSON object/);
        });

        test("rejects a non-object top-level value", async () => {
            const filePath = await write("str.json", JSON.stringify("nope"));
            await expectRejects(loadConnectionsFile(filePath), /must be a JSON object/);
        });

        test("rejects a non-string entry value", async () => {
            const filePath = await write("num.json", JSON.stringify({ dev: 123 }));
            await expectRejects(loadConnectionsFile(filePath), /non-string or empty/);
        });

        test("rejects an empty-string entry value", async () => {
            const filePath = await write("empty.json", JSON.stringify({ dev: "" }));
            await expectRejects(loadConnectionsFile(filePath), /non-string or empty/);
        });

        test("rejects invalid JSON", async () => {
            const filePath = await write("bad.json", "{ not json");
            await expectRejects(loadConnectionsFile(filePath), /Failed to parse/);
        });

        test("rejects a missing file", async () => {
            await expectRejects(
                loadConnectionsFile(path.join(dir, "does-not-exist.json")),
                /Failed to read/,
            );
        });
    });
});
