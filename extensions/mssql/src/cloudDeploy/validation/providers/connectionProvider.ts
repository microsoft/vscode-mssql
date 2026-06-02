/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `ConnectionProvider` abstraction.
 *
 * Host-agnostic seam for "open a SQL connection from an `Environment` and
 * execute a probe query." Validators that need a live connection
 * (`ConnectivityValidator`, `UnitTestsValidator`) take a `ConnectionProvider`
 * by injection so they can run against `FakeConnectionProvider` in unit
 * tests and against `LiveConnectionProvider` (wired by the service layer)
 * in production.
 *
 * The interface is deliberately narrow: `connect(env, signal)` returns a
 * `ConnectionHandle`; the handle exposes `execute(sql, signal)` for probe
 * queries and `dispose()` for cleanup. No transactions, no parameterized
 * queries, no result-set metadata — those live behind a wider abstraction
 * if a validator ever needs them.
 *
 * Failure modes are a closed `ConnectionFailureKind` union surfaced via
 * `ConnectionError`. Callers (validators) map that union onto
 * `ConnectivityFinding.outcome` directly.
 */

import { type Environment, SourceOfTruthKind } from "../../environments/types";

// =============================================================================
// Public types
// =============================================================================

/**
 * Closed enum of connection-failure modes. New modes ride the same union —
 * additive. Validators map these 1:1 onto `ConnectivityFinding.outcome`.
 */
export type ConnectionFailureKind =
    | "connection-refused"
    | "auth-failed"
    | "host-unreachable"
    | "timeout"
    | "unknown";

/**
 * Typed error thrown by `ConnectionProvider.connect()` and
 * `ConnectionHandle.execute()` on failure. The `kind` is the closed-union
 * discriminator the validator surfaces; `message` is a free-form human
 * description (not localized — consumed by the validator and stamped onto
 * the `ConnectivityFinding`).
 */
export class ConnectionError extends Error {
    public constructor(
        public readonly kind: ConnectionFailureKind,
        message?: string,
    ) {
        super(message ?? `Connection failed (${kind}).`);
        this.name = "ConnectionError";
    }
}

/**
 * An open connection. Validators call `execute()` to run probe queries and
 * `dispose()` (or rely on auto-disposal) when done. `dispose()` MUST be
 * idempotent — validators may call it on both success and failure paths.
 */
export interface ConnectionHandle {
    /**
     * Execute a probe query. Returns the raw row array; validators inspect
     * shape (e.g. read `row[0][0]` for a single scalar). Throws
     * `ConnectionError` on transport / auth / timeout failures.
     */
    execute(sql: string, signal: AbortSignal): Promise<unknown[][]>;
    /** Closes the underlying connection. Idempotent. */
    dispose(): Promise<void>;
}

/**
 * The provider contract. `connect()` opens a connection against the env's
 * target and returns a `ConnectionHandle`, or throws `ConnectionError`.
 *
 * Implementations MUST honor `signal`: if it aborts during the connect
 * attempt, the provider abandons the attempt and throws `ConnectionError`
 * with `kind: "timeout"`.
 */
export interface ConnectionProvider {
    connect(env: Environment, signal: AbortSignal): Promise<ConnectionHandle>;
}

// =============================================================================
// LiveConnectionProvider — strategy wrapper
// =============================================================================

/**
 * Strategy bundle injected into `LiveConnectionProvider`. The service layer
 * (commit 6) constructs the real strategy by wiring vscode-mssql's
 * `ConnectionManager` (or whatever the production connection surface is)
 * into a callable `connectFn`. Keeping the strategy injectable here means
 * commit 2 ships a real, functional `LiveConnectionProvider` class without
 * coupling D2 to the wider extension's connection plumbing.
 */
export interface LiveConnectionStrategy {
    /**
     * Open a live connection given a connection-profile id and a cancellation
     * signal. Implementations MUST throw `ConnectionError` (with the right
     * `kind`) on failure rather than letting other error shapes leak.
     */
    connectByProfileId(profileId: string, signal: AbortSignal): Promise<ConnectionHandle>;
}

/**
 * Production `ConnectionProvider`. Reads `env.sourceOfTruth`; for the
 * `Container` arm it delegates to the injected strategy. For non-container
 * envs (`SqlProj`, `Dacpac`) there is no live target — `connect()` throws
 * `ConnectionError("unknown")` with a deterministic message so the
 * connectivity validator surfaces it as a `Failed` result with
 * `outcome: "unknown"`.
 */
export class LiveConnectionProvider implements ConnectionProvider {
    public constructor(private readonly _strategy: LiveConnectionStrategy) {}

    public async connect(env: Environment, signal: AbortSignal): Promise<ConnectionHandle> {
        if (env.sourceOfTruth.kind !== SourceOfTruthKind.Container) {
            throw new ConnectionError(
                "unknown",
                `Environment "${env.id}" has no connection profile (source-of-truth kind is "${env.sourceOfTruth.kind}").`,
            );
        }
        return this._strategy.connectByProfileId(env.sourceOfTruth.connectionProfileId, signal);
    }
}

// =============================================================================
// FakeConnectionProvider — test double
// =============================================================================

/**
 * Per-env behavior selector for `FakeConnectionProvider`. Test files configure
 * one of these per env id before invoking the validator.
 *
 *   * `"success"` — `connect()` resolves to a configurable `FakeConnectionHandle`.
 *   * `"failure"` — `connect()` throws `ConnectionError(kind, message?)`.
 *   * `"timeout"` — `connect()` waits for `signal.aborted`, then throws
 *     `ConnectionError("timeout")`. Used to test cancellation mid-connect.
 */
export type FakeConnectionBehavior =
    | { mode: "success"; handle?: FakeConnectionHandleConfig }
    | { mode: "failure"; kind: ConnectionFailureKind; message?: string }
    | { mode: "timeout" };

/** Optional canned configuration for a `FakeConnectionHandle`. */
export interface FakeConnectionHandleConfig {
    /**
     * Canned responses keyed by SQL string (exact match). When `execute()`
     * is called with an unknown SQL, the handle returns `[[]]` (one empty
     * row) by default.
     */
    readonly executeResponses?: Readonly<Record<string, unknown[][]>>;
    /** If set, `execute()` throws this `ConnectionError` instead of returning. */
    readonly executeError?: ConnectionError;
}

/**
 * Test double. Records every `connect()` invocation and every per-handle
 * `execute()` invocation for assertion. Configurable per env id; envs
 * without configuration default to `{ mode: "success" }`.
 */
export class FakeConnectionProvider implements ConnectionProvider {
    public readonly invocations: Array<{ envId: string; signalAborted: boolean }> = [];
    /**
     * Handles created by `connect()`. Tests inspect the latest handle's
     * `executions` array to assert which probe queries ran.
     */
    public readonly handles: FakeConnectionHandle[] = [];

    private readonly _behaviors = new Map<string, FakeConnectionBehavior>();

    /** Registers a per-env behavior. Subsequent `connect()` calls honor it. */
    public configure(envId: string, behavior: FakeConnectionBehavior): void {
        this._behaviors.set(envId, behavior);
    }

    public async connect(env: Environment, signal: AbortSignal): Promise<ConnectionHandle> {
        this.invocations.push({ envId: env.id, signalAborted: signal.aborted });

        const behavior = this._behaviors.get(env.id) ?? { mode: "success" };

        switch (behavior.mode) {
            case "success": {
                const handle = new FakeConnectionHandle(behavior.handle);
                this.handles.push(handle);
                return handle;
            }
            case "failure":
                throw new ConnectionError(behavior.kind, behavior.message);
            case "timeout":
                await waitForAbort(signal);
                throw new ConnectionError("timeout", "Fake connection aborted before opening.");
        }
    }
}

/**
 * Test-double `ConnectionHandle`. Records every `execute()` call; returns
 * canned responses by exact SQL match or `[[]]` for unknown SQL.
 */
export class FakeConnectionHandle implements ConnectionHandle {
    public readonly executions: Array<{ sql: string; signalAborted: boolean }> = [];
    public disposed = false;

    public constructor(private readonly _config?: FakeConnectionHandleConfig) {}

    public async execute(sql: string, signal: AbortSignal): Promise<unknown[][]> {
        this.executions.push({ sql, signalAborted: signal.aborted });
        if (this._config?.executeError) {
            throw this._config.executeError;
        }
        const canned = this._config?.executeResponses?.[sql];
        return canned ?? [[]];
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
    }
}

// =============================================================================
// Internals
// =============================================================================

function waitForAbort(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
    });
}
