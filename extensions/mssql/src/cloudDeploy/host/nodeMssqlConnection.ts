/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — headless SQL connection.
 *
 * The Node twin of `host/vscodeMssqlConnectionStrategy.ts`'s ephemeral
 * connector: it opens a `ConnectionHandle` to a freshly-provisioned ephemeral
 * database using a real Node SQL driver (`mssql` → `tedious`, pure JS) instead
 * of VS Code's `ConnectionManager`. This is the one piece the CI / CLI path
 * needs that the extension host provided for free — once it exists, the
 * `DockerEphemeralDatabaseProvider` runs headlessly unchanged (the connector is
 * its only injection point), so the runtime validators (connectivity, unit
 * tests, workload) run outside VS Code.
 *
 * The driver is isolated behind a tiny `SqlSession` seam: `makeMssqlSession` is
 * the ONLY function that imports `mssql`, and `NodeMssqlConnectionHandle`'s
 * logic (row normalization, cancellation, error translation) is exercised in
 * unit tests against a fake `SqlSession` with no real SQL Server. Rows come
 * back positionally via the driver's `arrayRowMode`, matching the
 * `ConnectionHandle` contract (`unknown[][]`) directly.
 */

import * as sql from "mssql";

import {
    ConnectionError,
    ConnectionFailureKind,
    ConnectionHandle,
} from "../validation/providers/connectionProvider";
import {
    EphemeralConnectionParams,
    EphemeralConnector,
} from "../validation/providers/ephemeralDatabaseProvider";

const CONNECT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;

// =============================================================================
// SqlSession seam — the only surface the handle depends on
// =============================================================================

/**
 * Minimal driver surface the connection handle needs: run a command and get
 * positional rows, cancel the in-flight request, and close the connection.
 * Keeps `mssql` out of the handle so the handle is unit-testable with a fake.
 */
export interface SqlSession {
    /** Runs `command` and returns its rows as positional cell arrays (empty for a no-result-set command). */
    query(command: string): Promise<unknown[][]>;
    /** Cancels the currently-executing request, if any. */
    cancel(): void;
    /** Closes the underlying connection. Idempotent at the caller. */
    close(): Promise<void>;
}

/** Opens a driver-backed `SqlSession` for a set of connection params. */
export type SqlSessionFactory = (params: EphemeralConnectionParams) => Promise<SqlSession>;

// =============================================================================
// NodeMssqlConnectionHandle
// =============================================================================

/**
 * `ConnectionHandle` over a `SqlSession`. `execute()` forwards the query and
 * normalizes `undefined` cells to `null`; cancellation wires the run's
 * `AbortSignal` to the session's `cancel()` and surfaces aborts as
 * `ConnectionError("timeout")` — the validator-facing convention. `dispose()`
 * is idempotent and never lets a teardown failure mask the originating error.
 */
export class NodeMssqlConnectionHandle implements ConnectionHandle {
    private _disposed = false;

    public constructor(private readonly _session: SqlSession) {}

    public async execute(sqlText: string, signal: AbortSignal): Promise<unknown[][]> {
        if (this._disposed) {
            throw new ConnectionError("unknown", "Cannot execute on a disposed connection handle.");
        }
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Query cancelled before execution.");
        }

        const onAbort = (): void => this._session.cancel();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            const rows = await this._session.query(sqlText);
            return rows.map((row) => row.map((cell) => (cell === undefined ? null : cell)));
        } catch (err) {
            if (signal.aborted) {
                throw new ConnectionError("timeout", "Query cancelled during execution.");
            }
            throw new ConnectionError("unknown", `Query execution failed: ${messageOf(err)}`);
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        try {
            await this._session.close();
        } catch {
            // Idempotent dispose: never let teardown mask the originating error.
        }
    }
}

// =============================================================================
// NodeMssqlEphemeralConnector
// =============================================================================

/**
 * Production `EphemeralConnector` for headless contexts. Opens an `mssql` pool
 * to the freshly-provisioned ephemeral database (the throwaway container ships
 * a self-signed cert, so `trustServerCertificate` rides through from the
 * provider) and wraps it in a `NodeMssqlConnectionHandle`. Honors `signal`
 * before and after opening, mirroring the VS Code connector.
 */
export class NodeMssqlEphemeralConnector implements EphemeralConnector {
    public constructor(private readonly _makeSession: SqlSessionFactory = makeMssqlSession) {}

    public async connect(
        params: EphemeralConnectionParams,
        signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Connection attempt cancelled before opening.");
        }

        let session: SqlSession;
        try {
            session = await this._makeSession(params);
        } catch (err) {
            throw new ConnectionError(
                classifyConnectError(err),
                `Failed to connect to the ephemeral database: ${messageOf(err)}`,
            );
        }

        if (signal.aborted) {
            await session.close().catch(() => undefined);
            throw new ConnectionError(
                "timeout",
                "Connection cancelled after opening; session has been disposed.",
            );
        }
        return new NodeMssqlConnectionHandle(session);
    }
}

// =============================================================================
// makeMssqlSession — the ONLY mssql-touching code
// =============================================================================

/**
 * Opens an `mssql` connection pool from the ephemeral connection params and
 * adapts it to the `SqlSession` seam. `arrayRowMode` makes the driver return
 * rows as positional arrays, which the handle forwards as `unknown[][]`. The
 * pool is sized to one connection (a per-run ephemeral database has a single
 * consumer). The current request is tracked so `cancel()` can abort it.
 */
async function makeMssqlSession(params: EphemeralConnectionParams): Promise<SqlSession> {
    const pool = new sql.ConnectionPool({
        server: params.host,
        port: params.port,
        user: params.user,
        password: params.password,
        database: params.database,
        options: {
            encrypt: true,
            trustServerCertificate: params.trustServerCertificate,
        },
        pool: { max: 1, min: 0 },
        connectionTimeout: CONNECT_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
    });
    await pool.connect();

    let current: sql.Request | undefined;
    return {
        async query(command: string): Promise<unknown[][]> {
            const request = pool.request();
            request.arrayRowMode = true;
            current = request;
            try {
                const result = await request.query(command);
                return (result.recordset as unknown as unknown[][] | undefined) ?? [];
            } finally {
                current = undefined;
            }
        },
        cancel(): void {
            current?.cancel();
        },
        async close(): Promise<void> {
            await pool.close();
        },
    };
}

// =============================================================================
// Helpers
// =============================================================================

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Maps a driver connect failure onto the closed `ConnectionFailureKind` union. */
function classifyConnectError(err: unknown): ConnectionFailureKind {
    const message = messageOf(err).toLowerCase();
    if (message.includes("login failed") || message.includes("password")) {
        return "auth-failed";
    }
    if (message.includes("econnrefused")) {
        return "connection-refused";
    }
    if (message.includes("getaddrinfo") || message.includes("enotfound")) {
        return "host-unreachable";
    }
    if (message.includes("timeout")) {
        return "timeout";
    }
    return "unknown";
}
