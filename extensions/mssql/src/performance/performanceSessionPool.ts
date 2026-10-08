/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dedicated SQL data plane sessions for the performance service (application name
 * `vscode-mssql-performance`), so monitoring queries never wait behind the user's own queries.
 *
 * - One session for each connection identity (the profile's server fingerprint, never display
 *   properties), database, and purpose. `read` sessions run monitoring queries; `change`
 *   sessions run approved changes, such as forcing a plan, with their own session settings.
 * - A session opens on first use and reopens after it is lost or closed.
 * - A session that is not used for `idleTimeoutMs` (5 minutes) closes. The entry stays, so the
 *   next read opens a new session.
 * - `dispose` closes every session.
 */

import { SessionPurpose, SqlReadOptions, SqlReader } from "sql-core";
import {
    DataPlaneErrorCodes,
    ISqlConnectionService,
    ISqlSession,
    SqlDataPlaneError,
} from "../services/sqlDataPlane/api";
import {
    PreparedConnection,
    UnsupportedProfileAuthenticationError,
} from "../services/metadata/profileAuthAdapter";
import {
    PerformanceUnavailable,
    PerformanceUnavailableReason,
} from "../sharedInterfaces/performance";
import {
    DataPlaneResultSet,
    DataPlaneSessionSource,
    DataPlaneSqlReader,
    DataPlaneSqlReaderOptions,
} from "./dataPlaneSqlReader";

export const performanceApplicationName = "vscode-mssql-performance";
export const defaultIdleTimeoutMs = 5 * 60_000;

/** The settings that turn on the SQL data plane. Both must be on when the window loads. */
export const dataPlaneSettings: readonly string[] = [
    "mssql.enableExperimentalFeatures",
    "mssql.sqlDataPlane.enabled",
];

/** The extension host facts the pool needs. Tests supply fakes. */
export interface PerformanceDataPlaneHost {
    /** True when the data plane settings are on now. */
    isEnabled(): boolean;
    /**
     * True when the settings were on when the extension activated. SQL Tools Service starts the
     * data plane only at startup, so a later change needs a reload.
     */
    wasEnabledAtActivation(): boolean;
    /** Returns the data plane service for a profile. Starts the service on first use. */
    serviceForProfile(profileFingerprint: string): Promise<ISqlConnectionService>;
}

export interface PerformanceSessionPoolOptions {
    readonly idleTimeoutMs?: number;
    readonly openTimeoutMs?: number;
    readonly reader?: DataPlaneSqlReaderOptions;
}

/** A reader on a pooled session. Reads run one at a time. */
export interface PerformanceSession extends SqlReader {
    readonly database: string;
    readonly purpose: SessionPurpose;
    /**
     * Changes each time a data plane session opens or is dropped (lost, closed, or idle), so
     * callers can drop facts that they cached for an earlier session.
     */
    readonly generation: number;
    read(sql: string, options?: SqlReadOptions): Promise<DataPlaneResultSet[]>;
    /** Opens the session now. Returns why it cannot open, or `undefined` when it is open. */
    ensureOpen(): Promise<PerformanceUnavailable | undefined>;
}

export class PerformanceSessionPool {
    private readonly _sessions = new Map<string, PooledSession>();
    private _disposed = false;

    constructor(
        private readonly _host: PerformanceDataPlaneHost,
        private readonly _options: PerformanceSessionPoolOptions = {},
    ) {}

    /** Returns why the data plane cannot be used, or `undefined` when it can. */
    availability(): PerformanceUnavailable | undefined {
        if (!this._host.isEnabled()) {
            return unavailable("dataPlaneDisabled", { requiredSettings: dataPlaneSettings });
        }
        if (!this._host.wasEnabledAtActivation()) {
            return unavailable("reloadRequired", { requiredSettings: dataPlaneSettings });
        }
        return undefined;
    }

    /**
     * Returns the session for a connection, database, and purpose. The session opens on its first
     * read or `ensureOpen` call. A later call with the same key returns the same session and uses
     * the given connection's credentials for the next open.
     */
    session(
        connection: PreparedConnection,
        database: string,
        purpose: SessionPurpose,
    ): PerformanceSession {
        if (this._disposed) {
            throw new Error("The performance session pool is disposed.");
        }
        const key = sessionKey(connection.serverFingerprint, database, purpose);
        const existing = this._sessions.get(key);
        if (existing) {
            existing.update(connection);
            return existing;
        }
        const session = new PooledSession(connection, database, purpose, this._host, this._options);
        this._sessions.set(key, session);
        return session;
    }

    dispose(): void {
        this._disposed = true;
        for (const session of this._sessions.values()) {
            session.dispose();
        }
        this._sessions.clear();
    }
}

/** The pool key. Identity values are JSON-encoded so that no two keys can collide. */
export function sessionKey(
    connectionIdentity: string,
    database: string,
    purpose: SessionPurpose,
): string {
    return JSON.stringify([connectionIdentity, database, purpose]);
}

export function unavailable(
    reason: PerformanceUnavailableReason,
    extra: { requiredSettings?: readonly string[]; detail?: string } = {},
): PerformanceUnavailable {
    return {
        status: "unavailable",
        reason,
        ...(extra.requiredSettings ? { requiredSettings: [...extra.requiredSettings] } : {}),
        ...(extra.detail ? { detail: extra.detail } : {}),
    };
}

/** An open failure with the reason that callers report. */
export class SessionOpenError extends Error {
    constructor(
        readonly reason: PerformanceUnavailableReason,
        message: string,
    ) {
        super(message);
        this.name = "SessionOpenError";
    }
}

/** Maps a failure to open a session to the result that callers report. */
export function unavailableFromError(error: unknown): PerformanceUnavailable {
    const reason =
        error instanceof SessionOpenError
            ? error.reason
            : error instanceof UnsupportedProfileAuthenticationError
              ? "authenticationUnsupported"
              : "connectionFailed";
    return unavailable(reason, { detail: errorMessage(error) });
}

class PooledSession implements PerformanceSession, DataPlaneSessionSource {
    private _session: ISqlSession | undefined;
    private _stateListener: { dispose(): void } | undefined;
    private _opening: Promise<ISqlSession> | undefined;
    /** Bumped when the session is dropped, so that an open in progress discards its result. */
    private _epoch = 0;
    private _generation = 0;
    private _activeReads = 0;
    private _idleTimer: ReturnType<typeof setTimeout> | undefined;
    private _disposed = false;
    private readonly _reader: DataPlaneSqlReader;

    get generation(): number {
        return this._generation;
    }

    constructor(
        private _connection: PreparedConnection,
        readonly database: string,
        readonly purpose: SessionPurpose,
        private readonly _host: PerformanceDataPlaneHost,
        private readonly _options: PerformanceSessionPoolOptions,
    ) {
        this._reader = new DataPlaneSqlReader(this, _options.reader);
    }

    update(connection: PreparedConnection): void {
        this._connection = connection;
    }

    async read(sql: string, options?: SqlReadOptions): Promise<DataPlaneResultSet[]> {
        this._activeReads++;
        this.clearIdleTimer();
        try {
            return await this._reader.read(sql, options);
        } finally {
            this._activeReads--;
            this.scheduleIdleClose();
        }
    }

    async ensureOpen(): Promise<PerformanceUnavailable | undefined> {
        try {
            await this.open();
            return undefined;
        } catch (error) {
            return unavailableFromError(error);
        } finally {
            this.scheduleIdleClose();
        }
    }

    async open(): Promise<ISqlSession> {
        if (this._disposed) {
            throw new SessionOpenError(
                "dataPlaneUnavailable",
                "The performance session pool is disposed.",
            );
        }
        const current = this._session;
        if (current?.state === "open") {
            return current;
        }
        if (current) {
            this.release();
        }
        let opening = this._opening;
        if (!opening) {
            opening = this.openNew();
            this._opening = opening;
        }
        try {
            return await opening;
        } finally {
            if (this._opening === opening) {
                this._opening = undefined;
            }
        }
    }

    recycle(): void {
        this._epoch++;
        this._opening = undefined;
        this.release();
    }

    dispose(): void {
        this._disposed = true;
        this.clearIdleTimer();
        this.recycle();
    }

    private async openNew(): Promise<ISqlSession> {
        const epoch = this._epoch;
        const connection = this._connection;
        let service: ISqlConnectionService;
        try {
            service = await this._host.serviceForProfile(connection.profileRef.profileFingerprint);
        } catch (error) {
            throw new SessionOpenError("dataPlaneUnavailable", errorMessage(error));
        }
        let session: ISqlSession;
        try {
            session = await service.openSession({
                profile: connection.profileRef,
                ...(this.database ? { database: this.database } : {}),
                applicationName: performanceApplicationName,
                auth: connection.auth,
                ...(this._options.openTimeoutMs
                    ? { openTimeoutMs: this._options.openTimeoutMs }
                    : {}),
            });
        } catch (error) {
            throw new SessionOpenError(openFailureReason(service, error), errorMessage(error));
        }
        if (this._disposed || epoch !== this._epoch) {
            void disposeSession(session);
            throw new SessionOpenError("connectionFailed", "The session closed while it opened.");
        }
        this._session = session;
        this._generation++;
        this._stateListener = session.onDidChangeState((change) => {
            if (
                (change.current === "lost" || change.current === "closed") &&
                this._session === session
            ) {
                this.release();
            }
        });
        return session;
    }

    private release(): void {
        const session = this._session;
        if (!session) {
            return;
        }
        this._session = undefined;
        this._generation++;
        this._stateListener?.dispose();
        this._stateListener = undefined;
        if (session.state !== "closed" && session.state !== "closing") {
            void disposeSession(session);
        }
    }

    private scheduleIdleClose(): void {
        this.clearIdleTimer();
        if (this._disposed || this._activeReads > 0 || !this._session) {
            return;
        }
        const timer = setTimeout(() => {
            this._idleTimer = undefined;
            if (this._activeReads === 0) {
                this.recycle();
            }
        }, this._options.idleTimeoutMs ?? defaultIdleTimeoutMs);
        // An idle session must not keep the extension host alive.
        (timer as { unref?: () => void }).unref?.();
        this._idleTimer = timer;
    }

    private clearIdleTimer(): void {
        if (this._idleTimer !== undefined) {
            clearTimeout(this._idleTimer);
            this._idleTimer = undefined;
        }
    }
}

function openFailureReason(
    service: ISqlConnectionService,
    error: unknown,
): PerformanceUnavailableReason {
    if (
        error instanceof UnsupportedProfileAuthenticationError ||
        (error instanceof SqlDataPlaneError &&
            error.code === DataPlaneErrorCodes.capabilityUnsupported)
    ) {
        return "authenticationUnsupported";
    }
    // A backend reports most open failures as unavailable. Its availability tells a stopped
    // data plane apart from a server that cannot be reached.
    return service.availability.state === "unavailable"
        ? "dataPlaneUnavailable"
        : "connectionFailed";
}

async function disposeSession(session: ISqlSession): Promise<void> {
    try {
        await session.dispose();
    } catch {
        // The session is gone either way.
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
