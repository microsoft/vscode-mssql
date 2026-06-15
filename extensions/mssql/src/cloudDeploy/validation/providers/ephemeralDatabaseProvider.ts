/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `EphemeralDatabaseProvider` abstraction (Scope 2, decision D-C).
 *
 * Host-agnostic seam for "build a throwaway database from a schema, hand back a
 * connection to it, then destroy it." This is the shift decision D-C locked: the
 * user no longer maintains a live container; instead each run *conjures* a
 * database from the schema, validates against it, and disposes it. The same flow
 * runs locally (Docker present) and in CI (the platform provides the SQL host),
 * which is the "reduce code differences" payoff.
 *
 * The runner provisions ONE ephemeral database per run (decision M6), seeds it
 * with the data-generator script (decision M5, a runner step — NOT done here),
 * then hands the connection to the runtime validators. The provider's only job
 * is `provision()` → an `EphemeralDatabase` whose `dispose()` tears everything
 * down.
 *
 * Two implementations:
 *   * `DockerEphemeralDatabaseProvider` — production. Spins up a throwaway SQL
 *     Server container, deploys the schema into it, returns a handle, and on
 *     `dispose()` removes the container. Drives `docker` + `dotnet build` +
 *     `sqlpackage` through the injected `ProcessProvider`; produces the
 *     `ConnectionHandle` through an injected `EphemeralConnector` (the host wires
 *     the real vscode-mssql connection). Handles `RuntimeHostConfig.kind ===
 *     "docker"` only; the `connection` host is a future provider.
 *   * `FakeEphemeralDatabaseProvider` — test double. Records provision calls and
 *     returns a canned `ConnectionHandle`, so the runner and validators can be
 *     exercised without Docker.
 */

import { randomUUID } from "crypto";
import * as path from "path";

import { SourceOfTruth, SourceOfTruthKind, RuntimeHostConfig } from "../../environments/types";
import { ConnectionError, ConnectionHandle } from "./connectionProvider";
import { ProcessProvider, ProcessResult } from "./processProvider";

// =============================================================================
// Public types
// =============================================================================

/**
 * A throwaway database, alive only for the duration of one run. The runner
 * seeds it (datagen) then hands `connection` to the runtime validators.
 * `dispose()` MUST be idempotent and tear down BOTH the connection and any host
 * resources (the container), best-effort, without masking a prior error.
 */
export interface EphemeralDatabase {
    /** Open connection to the freshly-built database. */
    readonly connection: ConnectionHandle;
    /** Name of the database created for this run (diagnostics / logging). */
    readonly databaseName: string;
    /**
     * Seeds the database by running a whole SQL script file on ONE session
     * (full `sqlcmd` semantics: `GO` batch separators, session-scoped temp
     * objects that span batches, etc.). Present only for hosts that can run a
     * script file natively (the Docker provider runs it via in-container
     * `sqlcmd -i`). When absent, the runner falls back to the connection-based
     * `DataGenerator`. `scriptPath` is resolved against the workspace root the
     * provider was configured with. Idempotent in neither direction — the
     * caller invokes it at most once per run.
     */
    seedFromScriptFile?(scriptPath: string, signal: AbortSignal): Promise<void>;
    /** Tears down the connection and the host resources. Idempotent. */
    dispose(): Promise<void>;
}

/**
 * Provider contract. `provision()` builds a database from `sourceOfTruth` on the
 * given `host`, deploys the schema, and returns an `EphemeralDatabase`, or throws
 * `EphemeralProvisionError` on any failure. Implementations MUST honor `signal`:
 * an abort during provisioning abandons the attempt and tears down whatever was
 * created so far.
 */
export interface EphemeralDatabaseProvider {
    provision(
        sourceOfTruth: SourceOfTruth,
        host: RuntimeHostConfig,
        signal: AbortSignal,
    ): Promise<EphemeralDatabase>;
}

/**
 * Connection params for a freshly-provisioned database. The provider knows how
 * it stood the server up (host/port/credentials); the `EphemeralConnector`
 * turns those into a `ConnectionHandle` using the host's real connection stack.
 */
export interface EphemeralConnectionParams {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly trustServerCertificate: boolean;
}

/**
 * Host seam that opens a `ConnectionHandle` to a provisioned database. Kept
 * separate from the provider so the Docker orchestration stays host-agnostic and
 * the production connection stack (vscode-mssql) is injected at wire time.
 */
export interface EphemeralConnector {
    connect(params: EphemeralConnectionParams, signal: AbortSignal): Promise<ConnectionHandle>;
}

/** Thrown when provisioning the ephemeral database fails. */
export class EphemeralProvisionError extends Error {
    public constructor(
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "EphemeralProvisionError";
    }
}

// =============================================================================
// DockerEphemeralDatabaseProvider — production
// =============================================================================

/** Injectable knobs for the Docker provider. Production wires resolved paths. */
export interface DockerEphemeralDatabaseOptions {
    /** SQL Server container image. */
    readonly image?: string;
    /** `docker` executable (resolved off PATH by default). */
    readonly dockerCommand?: string;
    /** `dotnet` executable, used to build a `.sqlproj` into a `.dacpac`. */
    readonly dotnetCommand?: string;
    /** `sqlpackage` executable, used to publish the dacpac into the container. */
    readonly sqlpackageCommand?: string;
    /** Host port mapped to the container's 1433. Production may pick a free port. */
    readonly hostPort?: number;
    /** Directory the schema build writes its dacpac into. */
    readonly buildOutputDirectory?: string;
    /**
     * Workspace root used to resolve a workspace-relative source-of-truth path
     * (and the build output) to an absolute path before spawning the build, so
     * the build does not depend on the spawned process's working directory.
     */
    readonly workspaceRoot?: string;
    /** Milliseconds to wait for the container to accept connections. */
    readonly readinessTimeoutMs?: number;
    /** Milliseconds between readiness probes. */
    readonly readinessIntervalMs?: number;
}

const DEFAULT_IMAGE = "mcr.microsoft.com/mssql/server:2022-latest";
const DEFAULT_DOCKER_COMMAND = "docker";
const DEFAULT_DOTNET_COMMAND = "dotnet";
const DEFAULT_SQLPACKAGE_COMMAND = "sqlpackage";
const DEFAULT_HOST_PORT = 11433;
const DEFAULT_READINESS_TIMEOUT_MS = 60_000;
const DEFAULT_READINESS_INTERVAL_MS = 1_000;
const CONTAINER_SQL_PORT = 1433;
const SA_USER = "sa";
const READINESS_PROBE_SQL = "SELECT 1";
/** In-container sqlcmd path for the readiness probe (mssql-tools18 ships in the image). */
const IN_CONTAINER_SQLCMD = "/opt/mssql-tools18/bin/sqlcmd";

/**
 * Production `EphemeralDatabaseProvider` backed by a throwaway Docker container.
 *
 * `provision()` flow (decision D-C): generate a unique container name + strong
 * password → `docker run` the SQL image on `hostPort` → poll until the server
 * accepts connections → create the target database → build the schema into a
 * dacpac (for a `.sqlproj`) or use the dacpac directly → `sqlpackage publish`
 * the dacpac into the database → open a `ConnectionHandle` via the injected
 * connector. `dispose()` force-removes the container (and disposes the
 * connection), idempotently.
 *
 * Only `RuntimeHostConfig.kind === "docker"` is handled; `connection` hosts are
 * a future provider behind the same seam.
 */
export class DockerEphemeralDatabaseProvider implements EphemeralDatabaseProvider {
    public constructor(
        private readonly _processes: ProcessProvider,
        private readonly _connector: EphemeralConnector,
        private readonly _opts: DockerEphemeralDatabaseOptions = {},
    ) {}

    public async provision(
        sourceOfTruth: SourceOfTruth,
        host: RuntimeHostConfig,
        signal: AbortSignal,
    ): Promise<EphemeralDatabase> {
        if (host.kind !== "docker") {
            throw new EphemeralProvisionError(
                `DockerEphemeralDatabaseProvider only supports the "docker" runtime host (got "${host.kind}").`,
            );
        }
        throwIfAborted(signal);

        const dockerCommand = this._opts.dockerCommand ?? DEFAULT_DOCKER_COMMAND;
        const image = this._opts.image ?? DEFAULT_IMAGE;
        const hostPort = this._opts.hostPort ?? DEFAULT_HOST_PORT;
        const containerName = `cloud-deploy-ephemeral-${randomUUID()}`;
        const password = generatePassword();
        const databaseName = "CloudDeployValidation";

        let containerStarted = false;
        try {
            await this._run(
                dockerCommand,
                [
                    "run",
                    "-d",
                    "--name",
                    containerName,
                    "-e",
                    "ACCEPT_EULA=Y",
                    "-e",
                    `MSSQL_SA_PASSWORD=${password}`,
                    "-p",
                    `${hostPort}:${CONTAINER_SQL_PORT}`,
                    image,
                ],
                signal,
                "start the SQL Server container",
            );
            containerStarted = true;

            await this._waitForReady(dockerCommand, containerName, password, signal);
            await this._execInContainer(
                dockerCommand,
                containerName,
                password,
                `CREATE DATABASE [${databaseName}]`,
                signal,
                "create the validation database",
            );

            const dacpacPath = await this._resolveDacpac(sourceOfTruth, signal);
            await this._publishDacpac(dacpacPath, hostPort, password, databaseName, signal);

            const connection = await this._connector.connect(
                {
                    host: "localhost",
                    port: hostPort,
                    user: SA_USER,
                    password,
                    database: databaseName,
                    trustServerCertificate: true,
                },
                signal,
            );

            return new DockerEphemeralDatabase(
                connection,
                databaseName,
                () => this._removeContainer(dockerCommand, containerName),
                (scriptPath, sig) =>
                    this._seedViaContainer(
                        dockerCommand,
                        containerName,
                        password,
                        databaseName,
                        scriptPath,
                        sig,
                    ),
            );
        } catch (err) {
            if (containerStarted) {
                // Best-effort teardown of a partially-provisioned container.
                await this._removeContainer(dockerCommand, containerName).catch(() => undefined);
            }
            if (err instanceof EphemeralProvisionError) {
                throw err;
            }
            throw new EphemeralProvisionError(
                `Failed to provision the ephemeral database: ${errorMessage(err)}`,
                err,
            );
        }
    }

    /** Polls the container until it accepts a trivial query or the deadline passes. */
    private async _waitForReady(
        dockerCommand: string,
        containerName: string,
        password: string,
        signal: AbortSignal,
    ): Promise<void> {
        const timeoutMs = this._opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
        const intervalMs = this._opts.readinessIntervalMs ?? DEFAULT_READINESS_INTERVAL_MS;
        const deadline = Date.now() + timeoutMs;

        for (;;) {
            throwIfAborted(signal);
            const result = await this._processes.spawn(
                dockerCommand,
                sqlcmdArgs(containerName, password, READINESS_PROBE_SQL),
                { signal },
            );
            if (result.exitCode === 0) {
                return;
            }
            if (Date.now() >= deadline) {
                throw new EphemeralProvisionError(
                    `SQL Server container did not become ready within ${timeoutMs}ms.`,
                );
            }
            await delay(intervalMs, signal);
        }
    }

    /** Runs a SQL statement inside the container via the bundled sqlcmd. */
    private async _execInContainer(
        dockerCommand: string,
        containerName: string,
        password: string,
        sql: string,
        signal: AbortSignal,
        action: string,
    ): Promise<void> {
        const result = await this._processes.spawn(
            dockerCommand,
            sqlcmdArgs(containerName, password, sql),
            { signal },
        );
        if (result.exitCode !== 0) {
            throw new EphemeralProvisionError(
                `Failed to ${action}: ${processFailureDetail(result)}`,
            );
        }
    }

    /**
     * Seeds the database from a whole SQL script file run on ONE in-container
     * `sqlcmd` session: `docker cp` the file in, then `sqlcmd -i ... -b`. Unlike
     * the connection-based `DataGenerator` (one `query/simpleexecute` per `GO`
     * batch, which loses session-scoped temp objects between batches), this runs
     * the entire script on a single session — required by installers like tSQLt
     * whose early batches create `#temp` procedures that later batches call.
     * `-b` makes sqlcmd exit non-zero on the first SQL error so it surfaces here.
     */
    private async _seedViaContainer(
        dockerCommand: string,
        containerName: string,
        password: string,
        databaseName: string,
        scriptPath: string,
        signal: AbortSignal,
    ): Promise<void> {
        const localPath = this._resolveAgainstWorkspace(scriptPath);
        const inContainerPath = "/tmp/cloud-deploy-seed.sql";
        await this._run(
            dockerCommand,
            ["cp", localPath, `${containerName}:${inContainerPath}`],
            signal,
            "copy the seed script into the container",
        );
        await this._run(
            dockerCommand,
            sqlcmdFileArgs(containerName, password, databaseName, inContainerPath),
            signal,
            "run the seed script in the container",
        );
    }

    /**
     * Resolves a `.dacpac` to publish: builds a `.sqlproj` into one, or returns a
     * pre-built dacpac's path directly.
     */
    private async _resolveDacpac(
        sourceOfTruth: SourceOfTruth,
        signal: AbortSignal,
    ): Promise<string> {
        if (sourceOfTruth.kind === SourceOfTruthKind.Dacpac) {
            return this._resolveAgainstWorkspace(sourceOfTruth.path);
        }
        // Only `SqlProj` remains — build it into a dacpac.
        const dotnetCommand = this._opts.dotnetCommand ?? DEFAULT_DOTNET_COMMAND;
        // Resolve to an absolute path so the build never depends on the spawned
        // process's working directory (a relative path produced MSB1009
        // "project file does not exist" when the cwd was not the workspace root).
        const projectPath = this._resolveAgainstWorkspace(sourceOfTruth.path);
        const outputDir =
            this._opts.buildOutputDirectory ??
            path.join(path.dirname(projectPath), "bin", "CloudDeploy");
        await this._run(
            dotnetCommand,
            ["build", projectPath, "/nologo", "/p:NetCoreBuild=true", "-o", outputDir],
            signal,
            "build the SQL project into a dacpac",
        );
        return dacpacPathFor(projectPath, outputDir);
    }

    /** Resolves a (possibly workspace-relative) path to absolute when a
     * workspace root is configured; leaves already-absolute paths untouched. */
    private _resolveAgainstWorkspace(p: string): string {
        if (path.isAbsolute(p) || this._opts.workspaceRoot === undefined) {
            return p;
        }
        return path.resolve(this._opts.workspaceRoot, p);
    }

    /** Publishes a dacpac into the container's database via sqlpackage. */
    private async _publishDacpac(
        dacpacPath: string,
        hostPort: number,
        password: string,
        databaseName: string,
        signal: AbortSignal,
    ): Promise<void> {
        const sqlpackageCommand = this._opts.sqlpackageCommand ?? DEFAULT_SQLPACKAGE_COMMAND;
        await this._run(
            sqlpackageCommand,
            [
                "/Action:Publish",
                `/SourceFile:${dacpacPath}`,
                `/TargetServerName:localhost,${hostPort}`,
                `/TargetDatabaseName:${databaseName}`,
                `/TargetUser:${SA_USER}`,
                `/TargetPassword:${password}`,
                "/TargetTrustServerCertificate:True",
            ],
            signal,
            "publish the schema into the database",
        );
    }

    /** Force-removes the container; best-effort, never throws. */
    private async _removeContainer(dockerCommand: string, containerName: string): Promise<void> {
        const controller = new AbortController();
        await this._processes
            .spawn(dockerCommand, ["rm", "-f", containerName], { signal: controller.signal })
            .catch(() => undefined);
    }

    /** Spawns a command and turns a non-zero exit into an `EphemeralProvisionError`. */
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
                `Failed to ${action}: ${processFailureDetail(result)}`,
            );
        }
        return result;
    }
}

/** `EphemeralDatabase` produced by the Docker provider. */
class DockerEphemeralDatabase implements EphemeralDatabase {
    private _disposed = false;

    public constructor(
        public readonly connection: ConnectionHandle,
        public readonly databaseName: string,
        private readonly _removeContainer: () => Promise<void>,
        private readonly _seedScriptFile: (
            scriptPath: string,
            signal: AbortSignal,
        ) => Promise<void>,
    ) {}

    public seedFromScriptFile(scriptPath: string, signal: AbortSignal): Promise<void> {
        return this._seedScriptFile(scriptPath, signal);
    }

    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        // Dispose the connection first, then remove the container; both
        // best-effort so teardown never masks the originating error.
        try {
            await this.connection.dispose();
        } catch {
            // ignore — container removal below is what frees real resources
        }
        await this._removeContainer();
    }
}

// =============================================================================
// FakeEphemeralDatabaseProvider — test double
// =============================================================================

/** One recorded `provision()` call, for test assertions. */
export interface FakeProvisionInvocation {
    readonly sourceOfTruthKind: string;
    readonly hostKind: string;
    readonly signalAborted: boolean;
}

/**
 * Test double. Returns a configurable `ConnectionHandle` and records every
 * `provision()` call so the runner / validators can be tested without Docker.
 * Configure `failWith` to make `provision()` reject.
 */
export class FakeEphemeralDatabaseProvider implements EphemeralDatabaseProvider {
    public readonly invocations: FakeProvisionInvocation[] = [];
    public readonly databases: FakeEphemeralDatabase[] = [];
    public failWith?: Error;

    public constructor(private readonly _connection?: ConnectionHandle) {}

    public async provision(
        sourceOfTruth: SourceOfTruth,
        host: RuntimeHostConfig,
        signal: AbortSignal,
    ): Promise<EphemeralDatabase> {
        this.invocations.push({
            sourceOfTruthKind: sourceOfTruth.kind,
            hostKind: host.kind,
            signalAborted: signal.aborted,
        });
        if (this.failWith) {
            throw this.failWith;
        }
        const db = new FakeEphemeralDatabase(this._connection ?? new NoopConnectionHandle());
        this.databases.push(db);
        return db;
    }
}

/** `EphemeralDatabase` returned by the fake provider; records disposal. */
export class FakeEphemeralDatabase implements EphemeralDatabase {
    public disposed = false;
    public readonly databaseName = "FakeValidationDb";

    public constructor(public readonly connection: ConnectionHandle) {}

    public async dispose(): Promise<void> {
        this.disposed = true;
        await this.connection.dispose();
    }
}

/** Minimal `ConnectionHandle` used when the fake provider isn't given one. */
class NoopConnectionHandle implements ConnectionHandle {
    public async execute(): Promise<unknown[][]> {
        return [];
    }
    public async dispose(): Promise<void> {
        // nothing to release
    }
}

// =============================================================================
// Helpers
// =============================================================================

/** `docker exec <name> sqlcmd ... -Q <sql>` argument vector for an in-container query. */
function sqlcmdArgs(containerName: string, password: string, sql: string): string[] {
    return [
        "exec",
        containerName,
        IN_CONTAINER_SQLCMD,
        "-S",
        "localhost",
        "-U",
        SA_USER,
        "-P",
        password,
        "-C",
        "-Q",
        sql,
    ];
}

/**
 * `docker exec <name> sqlcmd ... -d <db> -b -i <file>` argument vector for
 * running a whole script file on one in-container session. `-b` exits non-zero
 * on the first SQL error so the provider surfaces it; `-d` runs the script in
 * the validation database (where tSQLt installs its schema).
 */
function sqlcmdFileArgs(
    containerName: string,
    password: string,
    databaseName: string,
    inContainerPath: string,
): string[] {
    return [
        "exec",
        containerName,
        IN_CONTAINER_SQLCMD,
        "-S",
        "localhost",
        "-U",
        SA_USER,
        "-P",
        password,
        "-C",
        "-d",
        databaseName,
        "-b",
        "-i",
        inContainerPath,
    ];
}

/** Throws a `ConnectionError`-shaped cancellation if the signal is already aborted. */
function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new EphemeralProvisionError("Provisioning was cancelled before it started.");
    }
}

/** Resolves after `ms`, or rejects early if the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new EphemeralProvisionError("Provisioning was cancelled."));
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/** A short, complexity-satisfying password for the throwaway container. */
function generatePassword(): string {
    return `Cd_${randomUUID().replace(/-/g, "")}_9`;
}

/** Expected dacpac path for a built `.sqlproj` in `outputDir`. Uses native path
 * joins so the resulting path is valid for both the build `-o` argument and the
 * sqlpackage `/SourceFile:` argument. */
function dacpacPathFor(sqlprojPath: string, outputDir: string): string {
    const base = path.basename(sqlprojPath).replace(/\.sqlproj$/i, "");
    return path.join(outputDir, `${base}.dacpac`);
}

/** A concise, surfaceable detail string from a failed process result. */
function processFailureDetail(result: ProcessResult): string {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const detail = stderr.length > 0 ? stderr : stdout;
    const exit =
        result.exitCode === null
            ? `signal ${result.signal ?? "unknown"}`
            : `exit ${result.exitCode}`;
    return detail.length > 0 ? `${exit}: ${detail}` : exit;
}

/** Normalizes an unknown thrown value to a message string. */
function errorMessage(err: unknown): string {
    if (err instanceof ConnectionError) {
        return err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
