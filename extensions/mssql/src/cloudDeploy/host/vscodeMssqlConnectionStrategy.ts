/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — host glue: vscode-mssql `LiveConnectionStrategy`.
 *
 * Bridges the strategy seam declared in
 * `validation/providers/connectionProvider.ts` to the running extension's
 * `ConnectionManager`. This is the only place under `cloudDeploy/` that
 * imports controller-level types, by design — the rest of the package
 * stays host-agnostic and unit-testable in isolation.
 *
 * Resolution flow for `connectByProfileId(profileId, signal)`:
 *   1. Look up the profile by stable id via
 *      `connectionStore.connectionConfig.getConnectionById`, then fall back
 *      to a `profileName` match so hand-authored `environments.json` files
 *      can reference a connection by its user-facing name. If neither
 *      matches, throw `ConnectionError("unknown", ...)` — connectivity
 *      validators surface this as a `Failed` result with a deterministic
 *      message.
 *   2. Mint a per-attempt owner URI (a uuid) and call
 *      `ConnectionManager.connect(ownerUri, profile, { shouldHandleErrors: false })`.
 *      `shouldHandleErrors: false` keeps the call non-interactive: failures
 *      return `false` rather than prompting the user.
 *   3. On `false` / exception, throw `ConnectionError`. On success, return
 *      a `ConnectionHandle` whose `execute()` issues `query/simpleexecute`
 *      against the owner URI and `dispose()` disconnects (idempotently).
 *
 * Cancellation: `signal` is checked before connect, before each execute,
 * and after a successful connect. Aborts surface as
 * `ConnectionError("timeout", ...)`, which is the validator-facing
 * convention for any pre-emptive shutdown.
 */

import { randomUUID } from "crypto";
import { RequestType } from "vscode-languageclient";

import { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";

import ConnectionManager from "../../controllers/connectionManager";
import { AuthenticationType } from "../../sharedInterfaces/connectionDialog";
import {
    ConnectionError,
    ConnectionHandle,
    LiveConnectionStrategy,
} from "../validation/providers/connectionProvider";
import {
    EphemeralConnectionParams,
    EphemeralConnector,
} from "../validation/providers/ephemeralDatabaseProvider";

/** Wire-format params for the SQL Tools Service `query/simpleexecute` request. */
interface SimpleExecuteParams {
    readonly ownerUri: string;
    readonly queryString: string;
}

const SimpleExecuteRequest = new RequestType<SimpleExecuteParams, SimpleExecuteResult, void, void>(
    "query/simpleexecute",
);

/**
 * Production `LiveConnectionStrategy` backed by vscode-mssql's
 * `ConnectionManager`. Constructed once during extension activation and
 * passed to `CloudDeployService` via `CloudDeployServiceOptions`.
 */
export class VsCodeMssqlConnectionStrategy implements LiveConnectionStrategy {
    public constructor(private readonly _connectionManager: ConnectionManager) {}

    public async connectByProfileId(
        profileId: string,
        signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        if (signal.aborted) {
            throw new ConnectionError("timeout", "Connection attempt cancelled before opening.");
        }

        const connectionConfig = this._connectionManager.connectionStore.connectionConfig;
        let profile = await connectionConfig.getConnectionById(profileId);
        if (profile === undefined) {
            // Fall back to a user-facing name match so environments.json can
            // reference a connection by its profile name rather than its GUID.
            const all = await connectionConfig.getConnections();
            profile = all.find((candidate) => candidate.profileName === profileId);
        }
        if (profile === undefined) {
            throw new ConnectionError(
                "unknown",
                `Connection profile "${profileId}" was not found in vscode-mssql.`,
            );
        }

        const ownerUri = `cloud-deploy://${profileId}/${randomUUID()}`;

        let connected: boolean;
        try {
            connected = await this._connectionManager.connect(ownerUri, profile, {
                connectionSource: "cloudDeploy",
                shouldHandleErrors: false,
            });
        } catch (err) {
            throw new ConnectionError(
                "unknown",
                `Failed to open connection for profile "${profileId}": ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        if (!connected) {
            throw new ConnectionError(
                "unknown",
                `Failed to open connection for profile "${profileId}".`,
            );
        }

        if (signal.aborted) {
            // Connected, but the caller cancelled; tear the session down before surfacing.
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
