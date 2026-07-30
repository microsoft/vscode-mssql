/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — headless `ConnectionHostGateway` backed by an injected file.
 *
 * The Node twin of `host/vscodeMssqlConnectionStrategy.ts`'s
 * `VsCodeMssqlConnectionHostGateway`: it turns a connection-profile id into the
 * capabilities the `ConnectionEphemeralDatabaseProvider` needs (admin /
 * throwaway connection handles, a `sqlpackage` connection string, and
 * single-session script seeding) — but instead of resolving saved profiles
 * through `ConnectionManager` and the VS Code secret store, it looks each id up
 * in a caller-supplied `id -> ADO.NET connection string` map. This is the one
 * piece the CI / CLI path needs so the `connection` runtime host (and a
 * live-database source of truth) runs outside VS Code.
 *
 * The map is loaded by `loadConnectionsFile` from the JSON file the CLI is
 * pointed at (`--connections` / `MSSQL_CD_CONNECTIONS`): a flat object of
 * `{ "<connectionProfileId>": "<SQL-auth connection string>" }`. Only SQL-auth
 * strings work headlessly — `mssql` / `tedious` is the pure-JS transport the
 * bundle ships — and the SAME string satisfies both `mssql` (handles / seeding)
 * and `sqlpackage` (publish / extract), so one entry per profile is enough. The
 * catalog inside each entry is re-targeted per operation via
 * `withDatabaseInConnectionString`, so the entry can point at any database on
 * the server.
 */

import { promises as fs } from "fs";

import { ConnectionError, ConnectionHandle } from "../validation/providers/connectionProvider";
import { ConnectionHostGateway } from "../validation/providers/connectionEphemeralDatabaseProvider";
import { splitSqlBatches } from "../validation/dataGenerator";
import { withDatabaseInConnectionString } from "./connectionStringUtils";
import {
    NodeMssqlConnectionHandle,
    SqlSession,
    makeMssqlSessionFromConnectionString,
} from "./nodeMssqlConnection";

/** Opens a driver-backed `SqlSession` from a full ADO.NET connection string. */
export type ConnectionStringSessionFactory = (connectionString: string) => Promise<SqlSession>;

/**
 * `ConnectionHostGateway` that resolves connection-profile ids from an injected
 * `id -> connection string` map. Production passes the module session factory
 * (`makeMssqlSessionFromConnectionString`); tests inject a fake so the gateway's
 * orchestration is exercised without a live SQL Server.
 */
export class FileConnectionHostGateway implements ConnectionHostGateway {
    public constructor(
        private readonly _connections: ReadonlyMap<string, string>,
        private readonly _makeSession: ConnectionStringSessionFactory = makeMssqlSessionFromConnectionString,
    ) {}

    public async connect(
        connectionProfileId: string,
        database: string,
        signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Connection attempt cancelled before opening.");
        }
        const connectionString = withDatabaseInConnectionString(
            this._lookup(connectionProfileId),
            database,
        );

        let session: SqlSession;
        try {
            session = await this._makeSession(connectionString);
        } catch (err) {
            throw new ConnectionError(
                "unknown",
                `Failed to connect to "${connectionProfileId}": ${messageOf(err)}`,
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

    public async buildConnectionString(
        connectionProfileId: string,
        database: string | undefined,
        signal: AbortSignal,
    ): Promise<string> {
        if (signal.aborted) {
            throw new ConnectionError(
                "timeout",
                "Connection attempt cancelled before building a connection string.",
            );
        }
        const connectionString = this._lookup(connectionProfileId);
        // `undefined` means "use the profile's own database as-is" (the
        // live-database source-extract case); a concrete name overrides it (the
        // publish-target case).
        return database === undefined
            ? connectionString
            : withDatabaseInConnectionString(connectionString, database);
    }

    public async seedScriptFile(
        connectionProfileId: string,
        database: string,
        scriptPath: string,
        signal: AbortSignal,
    ): Promise<void> {
        const script = await fs.readFile(scriptPath, { encoding: "utf8" });
        const batches = splitSqlBatches(script);
        // Run the whole script on ONE handle so session-scoped temp objects
        // survive across `GO` batches (required by installers like tSQLt) — the
        // headless equivalent of `sqlcmd -i` on a single session.
        const handle = await this.connect(connectionProfileId, database, signal);
        try {
            for (const batch of batches) {
                await handle.execute(batch, signal);
            }
        } finally {
            await handle.dispose();
        }
    }

    /**
     * Resolves a profile id to its injected connection string, throwing a
     * `ConnectionError` when the id has no (or an empty) entry — an actionable
     * error rather than a cryptic downstream failure.
     */
    private _lookup(connectionProfileId: string): string {
        const connectionString = this._connections.get(connectionProfileId);
        if (connectionString === undefined || connectionString.length === 0) {
            throw new ConnectionError(
                "unknown",
                `No connection string was provided for connection profile "${connectionProfileId}". Add it to the connections file (MSSQL_CD_CONNECTIONS).`,
            );
        }
        return connectionString;
    }
}

/**
 * Reads and validates the connections file the CLI is pointed at: a flat JSON
 * object of `{ "<connectionProfileId>": "<connection string>" }`. Throws a
 * plain `Error` with an actionable message when the file is missing, is not
 * valid JSON, is not an object, or has a non-string / empty value — so a
 * mis-shaped file fails fast at composition time rather than mid-run.
 */
export async function loadConnectionsFile(absPath: string): Promise<Map<string, string>> {
    let raw: string;
    try {
        raw = await fs.readFile(absPath, { encoding: "utf8" });
    } catch (err) {
        throw new Error(`Failed to read the connections file "${absPath}": ${messageOf(err)}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Failed to parse the connections file "${absPath}": ${messageOf(err)}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
            `The connections file "${absPath}" must be a JSON object of connectionProfileId -> connection string.`,
        );
    }

    const connections = new Map<string, string>();
    for (const [id, value] of Object.entries(parsed)) {
        if (typeof value !== "string" || value.length === 0) {
            throw new Error(
                `The connections file "${absPath}" has a non-string or empty value for "${id}"; each entry must be a connection string.`,
            );
        }
        connections.set(id, value);
    }
    return connections;
}

/** Normalizes an unknown thrown value to a message string. */
function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
