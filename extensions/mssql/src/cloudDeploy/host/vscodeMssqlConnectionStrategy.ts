/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — host glue: vscode-mssql `EphemeralConnector`.
 *
 * Bridges the connector seam declared in
 * `validation/providers/ephemeralDatabaseProvider.ts` to the running
 * extension's `ConnectionManager`. This is the only place under
 * `cloudDeploy/` that imports controller-level types, by design — the rest of
 * the package stays host-agnostic and unit-testable in isolation.
 *
 * `VsCodeMssqlEphemeralConnector.connect(params, signal)` opens a
 * `ConnectionHandle` to a freshly-provisioned per-run ephemeral database
 * (Scope 2, decision D-C) by raw connection parameters (host / port / sa
 * credentials), rather than a saved connection profile — the ephemeral
 * container has no profile. It mints a per-attempt owner URI and calls
 * `ConnectionManager.connect(..., { shouldHandleErrors: false })`
 * (non-interactive). The returned handle's `execute()` issues
 * `query/simpleexecute` against the owner URI; `dispose()` disconnects
 * idempotently.
 *
 * Cancellation: `signal` is checked before connect, before each execute,
 * and after a successful connect. Aborts surface as
 * `ConnectionError("timeout", ...)`, the validator-facing convention for any
 * pre-emptive shutdown.
 */

import { randomUUID } from "crypto";
import { RequestType } from "vscode-languageclient";

import { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";

import ConnectionManager from "../../controllers/connectionManager";
import { IConnectionProfile } from "../../models/interfaces";
import { AuthenticationType } from "../../sharedInterfaces/connectionDialog";
import { ConnectionError, ConnectionHandle } from "../validation/providers/connectionProvider";
import { ConnectionHostGateway } from "../validation/providers/connectionEphemeralDatabaseProvider";
import {
    EphemeralConnectionParams,
    EphemeralConnector,
} from "../validation/providers/ephemeralDatabaseProvider";
import { ProcessProvider } from "../validation/providers/processProvider";
import { ensureDatabaseInConnectionString } from "./connectionStringUtils";

/** Wire-format params for the SQL Tools Service `query/simpleexecute` request. */
interface SimpleExecuteParams {
    readonly ownerUri: string;
    readonly queryString: string;
}

const SimpleExecuteRequest = new RequestType<SimpleExecuteParams, SimpleExecuteResult, void, void>(
    "query/simpleexecute",
);

/**
 * Production `EphemeralConnector` (Scope 2, decision D-C) backed by vscode-mssql's
 * `ConnectionManager`. Opens a `ConnectionHandle` to a freshly-provisioned
 * ephemeral database by raw connection parameters (host / port / sa credentials),
 * rather than a saved connection profile — the ephemeral container has no profile.
 * Constructed alongside `VsCodeMssqlConnectionStrategy` and handed to the
 * `DockerEphemeralDatabaseProvider` so the Docker orchestration stays
 * host-agnostic while the real connection stack is injected here.
 */
export class VsCodeMssqlEphemeralConnector implements EphemeralConnector {
    public constructor(private readonly _connectionManager: ConnectionManager) {}

    public async connect(
        params: EphemeralConnectionParams,
        signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Connection attempt cancelled before opening.");
        }

        const ownerUri = `cloud-deploy-ephemeral://${params.database}/${randomUUID()}`;
        const credentials = buildEphemeralCredentials(params);

        let connected: boolean;
        try {
            connected = await this._connectionManager.connect(ownerUri, credentials, {
                connectionSource: "cloudDeploy",
                shouldHandleErrors: false,
            });
        } catch (err) {
            throw new ConnectionError(
                "unknown",
                `Failed to connect to the ephemeral database: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        if (!connected) {
            throw new ConnectionError("unknown", "Failed to connect to the ephemeral database.");
        }

        if (signal.aborted) {
            try {
                await this._connectionManager.disconnect(ownerUri);
            } catch {
                // best-effort; cancellation supersedes disconnect failures
            }
            throw new ConnectionError(
                "timeout",
                "Connection cancelled after opening; session has been disposed.",
            );
        }

        return new VsCodeMssqlConnectionHandle(this._connectionManager, ownerUri);
    }
}

/**
 * Builds the `IConnectionInfo` for an ephemeral SQL login connection. The
 * ephemeral container is local and short-lived, so encryption is optional and
 * the server certificate is trusted (the container ships a self-signed cert).
 */
function buildEphemeralCredentials(params: EphemeralConnectionParams): IConnectionInfo {
    return {
        server: `${params.host},${params.port}`,
        database: params.database,
        user: params.user,
        password: params.password,
        authenticationType: AuthenticationType.SqlLogin,
        encrypt: "Optional",
        trustServerCertificate: params.trustServerCertificate,
        port: params.port,
        email: undefined,
        accountId: undefined,
        tenantId: undefined,
        azureAccountToken: undefined,
        expiresOn: undefined,
        hostNameInCertificate: undefined,
        persistSecurityInfo: undefined,
        secureEnclaves: undefined,
        connectionString: undefined,
        applicationName: "vscode-mssql",
        connectTimeout: 30,
    } as unknown as IConnectionInfo;
}

/**
 * `ConnectionHandle` backed by a single owner URI. `execute()` routes through
 * `query/simpleexecute`; `dispose()` is idempotent and swallows disconnect
 * errors so cleanup paths in validators don't mask the primary failure. Shared
 * by both the profile-based strategy and the ephemeral connector.
 */
class VsCodeMssqlConnectionHandle implements ConnectionHandle {
    private _disposed = false;

    public constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _ownerUri: string,
    ) {}

    public async execute(sql: string, signal: AbortSignal): Promise<unknown[][]> {
        if (this._disposed) {
            throw new ConnectionError("unknown", "Cannot execute on a disposed connection handle.");
        }
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Query cancelled before execution.");
        }

        let result: SimpleExecuteResult;
        try {
            result = await this._connectionManager.client.sendRequest(SimpleExecuteRequest, {
                ownerUri: this._ownerUri,
                queryString: sql,
            });
        } catch (err) {
            throw new ConnectionError(
                "unknown",
                `Query execution failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        // Validators inspect raw row values; coerce `DbCellValue` to either
        // `null` (when the cell is SQL NULL) or its display string. Numeric
        // / temporal coercion is left to the validator since the wire format
        // exposes only string display values.
        return result.rows.map((row) =>
            row.map((cell) => (cell.isNull ? null : cell.displayValue)),
        );
    }

    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        try {
            await this._connectionManager.disconnect(this._ownerUri);
        } catch {
            // Idempotent dispose: never let teardown mask the originating error.
        }
    }
}

const DEFAULT_SQLCMD_COMMAND = "sqlcmd";

/**
 * Production `ConnectionHostGateway` (Scope 2): the host glue the connection
 * runtime host depends on. Turns a saved connection-profile id into the
 * concrete capabilities `ConnectionEphemeralDatabaseProvider` needs — a live
 * `ConnectionHandle` (to `master` and to the throwaway database), a connection
 * string for `sqlpackage`, and single-session script seeding via local
 * `sqlcmd`. Every server / credential / auth detail lives here so the provider
 * stays host-agnostic and unit-testable.
 *
 * Connections are opened from the saved profile OBJECT (database overridden),
 * not from a connection string, so the Server Name field STS validates is
 * always populated — a connection-string open would fail that check.
 */
export class VsCodeMssqlConnectionHostGateway implements ConnectionHostGateway {
    public constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _processes: ProcessProvider,
        private readonly _sqlcmdCommand: string = DEFAULT_SQLCMD_COMMAND,
    ) {}

    public async connect(
        connectionProfileId: string,
        database: string,
        signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Connection attempt cancelled before opening.");
        }
        const credentials = await this._resolveProfile(connectionProfileId, database);
        const ownerUri = `cloud-deploy-runtime-host://${database}/${randomUUID()}`;

        let connected: boolean;
        try {
            connected = await this._connectionManager.connect(ownerUri, credentials, {
                connectionSource: "cloudDeploy",
                shouldHandleErrors: false,
            });
        } catch (err) {
            throw new ConnectionError(
                "unknown",
                `Failed to connect to "${connectionProfileId}": ${messageOf(err)}`,
            );
        }
        if (!connected) {
            throw new ConnectionError("unknown", `Failed to connect to "${connectionProfileId}".`);
        }
        if (signal.aborted) {
            await this._connectionManager.disconnect(ownerUri).catch(() => undefined);
            throw new ConnectionError(
                "timeout",
                "Connection cancelled after opening; session has been disposed.",
            );
        }
        return new VsCodeMssqlConnectionHandle(this._connectionManager, ownerUri);
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
        const credentials = await this._resolveProfile(connectionProfileId, database);
        // The target database must be known: for a live-database source of truth
        // it comes from the profile, so an unset profile database is a usable,
        // actionable error rather than a cryptic sqlpackage failure downstream.
        if (credentials.database === undefined || credentials.database.length === 0) {
            throw new ConnectionError(
                "unknown",
                `Connection profile "${connectionProfileId}" does not specify a database. A live-database source of truth must point at a specific database to extract.`,
            );
        }
        // Open a real connection so ConnectionManager resolves the secret-store
        // password (the config-store profile carries none), then read that live
        // connection's full string — STS includes the resolved password. Building
        // the string from offline ConnectionDetails leaves `Password=` empty and
        // sqlpackage fails to authenticate (or hangs).
        const ownerUri = `cloud-deploy-connstr://${credentials.database ?? "master"}/${randomUUID()}`;
        let connected: boolean;
        try {
            connected = await this._connectionManager.connect(ownerUri, credentials, {
                connectionSource: "cloudDeploy",
                shouldHandleErrors: false,
            });
        } catch (err) {
            throw new ConnectionError(
                "unknown",
                `Failed to connect to "${connectionProfileId}" to build a connection string: ${messageOf(err)}`,
            );
        }
        if (!connected) {
            throw new ConnectionError(
                "unknown",
                `Failed to connect to "${connectionProfileId}" to build a connection string.`,
            );
        }
        try {
            const connectionString = await this._connectionManager.getConnectionString(
                ownerUri,
                true, // includePassword — sqlpackage needs the full credential
                false, // do not include the application name
            );
            // sqlpackage requires the target database to live INSIDE the connection
            // string (it rejects /SourceDatabaseName or /TargetDatabaseName
            // alongside a connection string). Defensive: ensure the catalog is set.
            return ensureDatabaseInConnectionString(connectionString, credentials.database);
        } finally {
            await this._connectionManager.disconnect(ownerUri).catch(() => undefined);
        }
    }

    public async seedScriptFile(
        connectionProfileId: string,
        database: string,
        scriptPath: string,
        signal: AbortSignal,
    ): Promise<void> {
        const profile = await this._getProfile(connectionProfileId);
        const args = await this._buildSqlcmdArgs(profile, database, scriptPath);
        const result = await this._processes.spawn(this._sqlcmdCommand, args, { signal });
        if (result.aborted) {
            throw new ConnectionError(
                "timeout",
                "Cancelled while seeding the validation database.",
            );
        }
        if (result.exitCode !== 0) {
            const detail =
                result.stderr.trim().length > 0 ? result.stderr.trim() : result.stdout.trim();
            throw new ConnectionError(
                "unknown",
                `Failed to seed the validation database (sqlcmd exit ${result.exitCode ?? "killed"}): ${detail}`,
            );
        }
    }

    /** Looks up a saved profile by id or profile name, throwing a
     * `ConnectionError` when none matches. Accepting the friendly profile name
     * (not just the GUID id) lets `environments.json` reference connections by a
     * readable name, matching how the source-of-truth / runtime-host examples
     * are written. */
    private async _getProfile(connectionProfileId: string): Promise<IConnectionProfile> {
        const connections =
            await this._connectionManager.connectionStore.connectionConfig.getConnections();
        const profile = connections.find(
            (c) => c.id === connectionProfileId || c.profileName === connectionProfileId,
        );
        if (profile === undefined) {
            throw new ConnectionError(
                "unknown",
                `Connection profile "${connectionProfileId}" was not found (by id or name).`,
            );
        }
        return profile;
    }

    /** Resolves a saved profile to an `IConnectionInfo`, overriding the database
     * when one is given (a concrete name) and leaving the profile's own database
     * when it is `undefined` (the source-extract case). */
    private async _resolveProfile(
        connectionProfileId: string,
        database: string | undefined,
    ): Promise<IConnectionInfo> {
        const profile = await this._getProfile(connectionProfileId);
        // Clone so overriding the database never mutates the cached profile.
        return database === undefined ? { ...profile } : { ...profile, database };
    }

    /** Builds the local `sqlcmd` argument vector to run a script on one session. */
    private async _buildSqlcmdArgs(
        profile: IConnectionProfile,
        database: string,
        scriptPath: string,
    ): Promise<string[]> {
        // `-b` exits non-zero on the first SQL error; `-C` trusts the server
        // certificate (parity with the connect path); `-i` runs the whole script
        // on ONE session so session-scoped temp objects survive across `GO`
        // batches (required by installers like tSQLt).
        const base = ["-S", profile.server, "-d", database, "-C", "-b", "-i", scriptPath];

        if (profile.authenticationType === AuthenticationType.Integrated) {
            return ["-E", ...base];
        }
        if (profile.authenticationType === AuthenticationType.SqlLogin) {
            const password =
                profile.password && profile.password.length > 0
                    ? profile.password
                    : await this._connectionManager.connectionStore.lookupPassword(profile);
            return ["-U", profile.user, "-P", password ?? "", ...base];
        }
        throw new ConnectionError(
            "auth-failed",
            `Seeding the validation database over a connection currently supports SQL login or Integrated authentication (got "${profile.authenticationType}").`,
        );
    }
}

/** Normalizes an unknown thrown value to a message string. */
function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
