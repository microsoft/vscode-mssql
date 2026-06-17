/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — connection-backed `EphemeralDatabaseProvider` (Scope 2).
 *
 * The non-Docker runtime host: instead of spinning up a throwaway SQL Server
 * container, this provider borrows a SQL engine the developer already has
 * (reached by a saved connection profile) and creates a uniquely-named
 * throwaway database on it, publishes the schema in, hands validators a
 * connection to it, then DROPs it. The developer's server is never the
 * validation target — only the throwaway `CloudDeployValidation_<uuid>`
 * database we create and destroy is.
 *
 * The provider is pure orchestration over two injected seams so it is fully
 * unit-testable without a live server:
 *   * `ProcessProvider` — spawns `sqlpackage` to publish the dacpac.
 *   * `ConnectionHostGateway` — the host glue that turns a saved profile id
 *     into the things this provider needs: connection handles (to `master`
 *     for CREATE/DROP, and to the throwaway for validators), a connection
 *     string for `sqlpackage`, and single-session script seeding. All
 *     server/credential/auth detail lives behind this seam; production wires
 *     `VsCodeMssqlConnectionHostGateway` (under `cloudDeploy/host/`).
 *
 * The schema is resolved to a dacpac through the shared `resolveSchemaToDacpac`
 * — the same chokepoint the Docker provider uses — so a `.sqlproj`, a
 * pre-built `.dacpac`, or a live-database source all work on this host too.
 */

import { randomUUID } from "crypto";
import * as path from "path";

import { SourceOfTruth, RuntimeHostConfig } from "../../environments/types";
import { ConnectionHandle } from "./connectionProvider";
import {
    EphemeralDatabase,
    EphemeralDatabaseProvider,
    EphemeralProvisionError,
} from "./ephemeralDatabaseProvider";
import { ProcessProvider, ProcessResult, describeProcessFailure } from "./processProvider";
import {
    ResolvedSchema,
    SchemaResolutionError,
    SourceConnectionStringResolver,
    resolveSchemaToDacpac,
} from "./schemaResolver";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SQLPACKAGE_COMMAND = "sqlpackage";
/** Database the CREATE / DROP statements run against (never the throwaway itself). */
const ADMIN_DATABASE = "master";

// =============================================================================
// ConnectionHostGateway seam
// =============================================================================

/**
 * Host glue the connection runtime host depends on. Turns a saved connection
 * profile id into the concrete capabilities the provider needs, keeping every
 * server / credential / auth detail out of the provider (which stays pure
 * orchestration). Production implementation: `VsCodeMssqlConnectionHostGateway`
 * under `cloudDeploy/host/`; tests inject a fake.
 */
export interface ConnectionHostGateway {
    /**
     * Opens a `ConnectionHandle` to `database` on the profile's server, using
     * the profile's credentials with the database overridden. Used for the
     * `master` admin connection (CREATE / DROP) and for the throwaway database
     * the validators run against. Throws `ConnectionError` on failure.
     */
    connect(
        connectionProfileId: string,
        database: string,
        signal: AbortSignal,
    ): Promise<ConnectionHandle>;

    /**
     * Builds a connection string (password included) for `sqlpackage`,
     * targeting `database` on the profile's server. When `database` is
     * `undefined`, the profile's own database is used as-is (the live-DB
     * source-extract case); a concrete name overrides it (the publish-target
     * case).
     */
    buildConnectionString(
        connectionProfileId: string,
        database: string | undefined,
        signal: AbortSignal,
    ): Promise<string>;

    /**
     * Seeds `database` on the profile's server by running an entire SQL script
     * file on ONE session (full `sqlcmd` semantics: `GO` batches, session-scoped
     * temp objects that span batches — required by installers like tSQLt). The
     * host glue builds and spawns a local `sqlcmd` against the profile's server.
     * `scriptPath` is already resolved to an absolute path by the caller.
     */
    seedScriptFile(
        connectionProfileId: string,
        database: string,
        scriptPath: string,
        signal: AbortSignal,
    ): Promise<void>;
}

// =============================================================================
// Options
// =============================================================================

/** Injectable knobs for the connection provider. Production wires resolved paths. */
export interface ConnectionEphemeralDatabaseOptions {
    /** `sqlpackage` executable (resolved off PATH by default). */
    readonly sqlpackageCommand?: string;
    /** `dotnet` executable, used to build a `.sqlproj` source into a dacpac. */
    readonly dotnetCommand?: string;
    /** Workspace root used to resolve workspace-relative source / script paths. */
    readonly workspaceRoot?: string;
    /**
     * Resolves a saved connection profile to a source connection string, used
     * when a live-database source of truth feeds this host (extract the live
     * schema, then publish it into the throwaway database).
     */
    readonly sourceConnectionStringResolver?: SourceConnectionStringResolver;
}

// =============================================================================
// ConnectionEphemeralDatabaseProvider
// =============================================================================

/**
 * Production `EphemeralDatabaseProvider` backed by an existing SQL engine
 * reached through a saved connection profile.
 *
 * `provision()` flow: generate a unique throwaway database name → open an admin
 * (`master`) connection and `CREATE DATABASE` → resolve the schema to a dacpac →
 * `sqlpackage publish` it into the throwaway via a profile connection string →
 * open a connection to the throwaway for the validators → return a handle whose
 * `dispose()` drops the throwaway database (best-effort, idempotent). A failure
 * after the database is created drops it before surfacing, so a half-provisioned
 * run never leaves a stray database behind.
 *
 * Only `RuntimeHostConfig.kind === "connection"` is handled; the `docker` host
 * is `DockerEphemeralDatabaseProvider` behind the same seam.
 */
export class ConnectionEphemeralDatabaseProvider implements EphemeralDatabaseProvider {
    public constructor(
        private readonly _processes: ProcessProvider,
        private readonly _gateway: ConnectionHostGateway,
        private readonly _opts: ConnectionEphemeralDatabaseOptions = {},
    ) {}

    public async provision(
        sourceOfTruth: SourceOfTruth,
        host: RuntimeHostConfig,
        signal: AbortSignal,
    ): Promise<EphemeralDatabase> {
        if (host.kind !== "connection") {
            throw new EphemeralProvisionError(
                `ConnectionEphemeralDatabaseProvider only supports the "connection" runtime host (got "${host.kind}").`,
            );
        }
        throwIfAborted(signal);

        const profileId = host.connectionProfileId;
        const databaseName = `CloudDeployValidation_${randomUUID().replace(/-/g, "")}`;

        await this._createDatabase(profileId, databaseName, signal);

        // From here the database exists; any failure must drop it before surfacing.
        try {
            const resolved = await this._resolveSchema(sourceOfTruth, signal);
            try {
                await this._publishDacpac(resolved.dacpacPath, profileId, databaseName, signal);
            } finally {
                await resolved.dispose();
            }

            const connection = await this._gateway.connect(profileId, databaseName, signal);
            return new ConnectionEphemeralDatabase(
                connection,
                databaseName,
                this._gateway,
                profileId,
                this._opts.workspaceRoot,
            );
        } catch (err) {
            await this._dropDatabase(profileId, databaseName).catch(() => undefined);
            if (err instanceof EphemeralProvisionError) {
                throw err;
            }
            throw new EphemeralProvisionError(
                `Failed to provision the ephemeral database: ${errorMessage(err)}`,
                err,
            );
        }
    }

    /** Opens an admin connection and creates the throwaway database. */
    private async _createDatabase(
        profileId: string,
        databaseName: string,
        signal: AbortSignal,
    ): Promise<void> {
        let admin: ConnectionHandle;
        try {
            admin = await this._gateway.connect(profileId, ADMIN_DATABASE, signal);
        } catch (err) {
            throw new EphemeralProvisionError(
                `Failed to connect to "${profileId}" to create the validation database: ${errorMessage(err)}`,
                err,
            );
        }
        try {
            await admin.execute(`CREATE DATABASE [${databaseName}]`, signal);
        } catch (err) {
            throw new EphemeralProvisionError(
                `Failed to create the validation database: ${errorMessage(err)}`,
                err,
            );
        } finally {
            await admin.dispose().catch(() => undefined);
        }
    }

    /** Resolves the source of truth to a dacpac, wrapping resolver failures. */
    private async _resolveSchema(
        sourceOfTruth: SourceOfTruth,
        signal: AbortSignal,
    ): Promise<ResolvedSchema> {
        try {
            return await resolveSchemaToDacpac(
                sourceOfTruth,
                this._processes,
                {
                    dotnetCommand: this._opts.dotnetCommand,
                    sqlpackageCommand: this._opts.sqlpackageCommand,
                    workspaceRoot: this._opts.workspaceRoot,
                    sourceConnectionStringResolver: this._opts.sourceConnectionStringResolver,
                },
                signal,
            );
        } catch (err) {
            if (err instanceof EphemeralProvisionError) {
                throw err;
            }
            throw new EphemeralProvisionError(
                err instanceof SchemaResolutionError
                    ? err.message
                    : `Failed to resolve the schema: ${errorMessage(err)}`,
                err,
            );
        }
    }

    /** Publishes the dacpac into the throwaway database via a profile connection string. */
    private async _publishDacpac(
        dacpacPath: string,
        profileId: string,
        databaseName: string,
        signal: AbortSignal,
    ): Promise<void> {
        let connectionString: string;
        try {
            connectionString = await this._gateway.buildConnectionString(
                profileId,
                databaseName,
                signal,
            );
        } catch (err) {
            throw new EphemeralProvisionError(
                `Failed to build a connection string for "${profileId}": ${errorMessage(err)}`,
                err,
            );
        }
        const sqlpackageCommand = this._opts.sqlpackageCommand ?? DEFAULT_SQLPACKAGE_COMMAND;
        await this._run(
            sqlpackageCommand,
            [
                "/Action:Publish",
                `/SourceFile:${dacpacPath}`,
                `/TargetConnectionString:${connectionString}`,
            ],
            signal,
            "publish the schema into the validation database",
        );
    }

    /** Drops the throwaway database via a fresh admin connection. Best-effort. */
    private async _dropDatabase(profileId: string, databaseName: string): Promise<void> {
        const controller = new AbortController();
        const admin = await this._gateway.connect(profileId, ADMIN_DATABASE, controller.signal);
        try {
            // SINGLE_USER WITH ROLLBACK IMMEDIATE evicts any lingering sessions so
            // the DROP cannot be blocked by a connection we did not open.
            await admin.execute(
                `ALTER DATABASE [${databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${databaseName}]`,
                controller.signal,
            );
        } finally {
            await admin.dispose().catch(() => undefined);
        }
    }

    /** Spawns a command and turns a non-zero exit / abort into an `EphemeralProvisionError`. */
    private async _run(
        command: string,
        args: readonly string[],
        signal: AbortSignal,
        action: string,
    ): Promise<ProcessResult> {
        let result: ProcessResult;
        try {
            result = await this._processes.spawn(command, args, { signal });
        } catch (err) {
            throw new EphemeralProvisionError(`Failed to ${action}: ${errorMessage(err)}`, err);
        }
        if (result.aborted) {
            throw new EphemeralProvisionError(`Cancelled while trying to ${action}.`);
        }
        if (result.exitCode !== 0) {
            throw new EphemeralProvisionError(
                `Failed to ${action}: ${describeProcessFailure(result)}`,
            );
        }
        return result;
    }
}

/** `EphemeralDatabase` produced by the connection provider. */
class ConnectionEphemeralDatabase implements EphemeralDatabase {
    private _disposed = false;

    public constructor(
        public readonly connection: ConnectionHandle,
        public readonly databaseName: string,
        private readonly _gateway: ConnectionHostGateway,
        private readonly _profileId: string,
        private readonly _workspaceRoot: string | undefined,
    ) {}

    public seedFromScriptFile(scriptPath: string, signal: AbortSignal): Promise<void> {
        const absolutePath =
            path.isAbsolute(scriptPath) || this._workspaceRoot === undefined
                ? scriptPath
                : path.resolve(this._workspaceRoot, scriptPath);
        return this._gateway.seedScriptFile(
            this._profileId,
            this.databaseName,
            absolutePath,
            signal,
        );
    }

    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        // Disconnect from the throwaway first (a database cannot be dropped while
        // we hold a connection to it), then drop it through a fresh admin
        // connection. Both best-effort so teardown never masks the run's outcome.
        try {
            await this.connection.dispose();
        } catch {
            // ignore — the DROP below is what frees the real resource
        }
        const controller = new AbortController();
        let admin: ConnectionHandle;
        try {
            admin = await this._gateway.connect(this._profileId, ADMIN_DATABASE, controller.signal);
        } catch {
            // Could not reach the server to clean up; nothing more we can do.
            return;
        }
        try {
            await admin.execute(
                `ALTER DATABASE [${this.databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${this.databaseName}]`,
                controller.signal,
            );
        } catch {
            // best-effort cleanup
        } finally {
            await admin.dispose().catch(() => undefined);
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

/** Throws an `EphemeralProvisionError`-shaped cancellation if already aborted. */
function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new EphemeralProvisionError("Provisioning was cancelled before it started.");
    }
}

/** Normalizes an unknown thrown value to a message string. */
function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
