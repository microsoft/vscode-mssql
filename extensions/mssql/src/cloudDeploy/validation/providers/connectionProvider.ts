/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `ConnectionHandle` abstraction.
 *
 * Host-agnostic seam for "execute a probe query against an open SQL
 * connection." The runner provisions a per-run ephemeral database
 * and hands validators a `ConnectionHandle` to it via
 * `ValidatorRunOptions.ephemeralConnection`; the handle exposes
 * `execute(sql, signal)` for probe queries and `dispose()` for cleanup. No
 * transactions, no parameterized queries, no result-set metadata — those live
 * behind a wider abstraction if a validator ever needs them.
 *
 * Failure modes are a closed `ConnectionFailureKind` union surfaced via
 * `ConnectionError`. Callers (validators) map that union onto
 * `ConnectivityFinding.outcome` directly.
 */

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

// =============================================================================
// FakeConnectionHandle — test double
// =============================================================================

/**
 * Per-handle canned-response selector for `FakeConnectionHandle`. Test files
 * seed canned rows (or a thrown `ConnectionError`) keyed by SQL string.
 */

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
