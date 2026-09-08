/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DiagnosticsPort,
    SqlDiagEvents,
    nullDiagnostics,
    objectName,
    serverName,
    sys,
} from "../core/diagnostics";
import { ServerCapabilities, xeventCatalog } from "../core/platform";
import { SqlRunner } from "../core/types";

/**
 * Creates, starts, stops, lists and drops Extended Events sessions.
 *
 * The client owns the session object; the service only streams from it. Because a
 * CREATE EVENT SESSION leaves a durable object holding server memory, this module also tracks
 * which sessions it created so an interrupted run can be cleaned up rather than leaking.
 */

export interface SessionInfo {
    readonly name: string;
    readonly isRunning: boolean;
    /** True when this client created the session, per the registry. */
    readonly ownedByThisClient: boolean;
    /** When the owning client last renewed its claim; absent for sessions we do not own. */
    readonly leaseExpiresAt?: number;
}

/** A session this client created, persisted so a later run can reconcile it. */
export interface SessionClaim {
    readonly name: string;
    readonly server: string;
    readonly createdAt: number;
    leaseExpiresAt: number;
}

/**
 * Persists claims across restarts. The extension backs this with workspace state; tests use
 * an in-memory implementation.
 */
export interface ClaimStore {
    read(): Promise<readonly SessionClaim[]>;
    write(claims: readonly SessionClaim[]): Promise<void>;
}

export interface SessionManagerOptions {
    readonly runner: SqlRunner;
    readonly capabilities: ServerCapabilities;
    readonly claims: ClaimStore;
    /** Identifies this server in the claim registry. */
    readonly serverKey: string;
    readonly diagnostics?: DiagnosticsPort;
    /** How long a claim stays fresh without renewal. Defaults to 10 minutes. */
    readonly leaseMs?: number;
}

const DEFAULT_LEASE_MS = 10 * 60 * 1000;

export class ProfilerSessionManager {
    private readonly _diag: DiagnosticsPort;
    private readonly _leaseMs: number;

    constructor(private readonly _options: SessionManagerOptions) {
        this._diag = _options.diagnostics ?? nullDiagnostics;
        this._leaseMs = _options.leaseMs ?? DEFAULT_LEASE_MS;
    }

    /** Lists sessions on the server, marking the ones this client created. */
    async list(): Promise<readonly SessionInfo[]> {
        const catalog = xeventCatalog(this._options.capabilities);
        const result = await this._options.runner.query(
            `SELECT s.name,
                    CASE WHEN r.name IS NULL THEN 0 ELSE 1 END AS is_running
             FROM ${catalog.sessions} AS s
             LEFT JOIN ${catalog.runningSessions} AS r ON r.name = s.name
             ORDER BY s.name`,
            { tag: "profiler.listSessions" },
        );

        const claims = await this.claimsForThisServer();
        const byName = new Map(claims.map((c) => [c.name, c]));

        return result.rows.map((row) => {
            const name = String(row.name ?? "");
            const claim = byName.get(name);
            return {
                name,
                isRunning: Number(row.is_running) === 1,
                ownedByThisClient: claim !== undefined,
                leaseExpiresAt: claim?.leaseExpiresAt,
            };
        });
    }

    /**
     * Creates a session from a CREATE EVENT SESSION statement and records a claim on it, so a
     * crash leaves evidence of what to clean up rather than an anonymous running session.
     */
    async create(name: string, createStatement: string): Promise<void> {
        const span = this._diag.startSpan(SqlDiagEvents.profilerSessionCreated, {
            session: objectName(name),
            platform: sys(this._options.capabilities.platform),
        });
        try {
            await this._options.runner.query(createStatement, { tag: "profiler.createSession" });
            await this.claim(name);
            span.end("ok");
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    async start(name: string): Promise<void> {
        if (await this.isRunning(name)) {
            return;
        }
        await this.alterState(name, "START");
        await this.renew(name);
        this._diag.emit({
            type: SqlDiagEvents.profilerSessionStarted,
            status: "ok",
            fields: { session: objectName(name) },
        });
    }

    async stop(name: string): Promise<void> {
        if (!(await this.isRunning(name))) {
            return;
        }
        await this.alterState(name, "STOP");
        this._diag.emit({
            type: SqlDiagEvents.profilerSessionStopped,
            status: "ok",
            fields: { session: objectName(name) },
        });
    }

    /** Drops the session if it exists and releases this client's claim on it. */
    async drop(name: string): Promise<void> {
        const catalog = xeventCatalog(this._options.capabilities);
        await this._options.runner.query(
            `IF EXISTS (SELECT 1 FROM ${catalog.sessions} WHERE name = ${literal(name)})
                 DROP EVENT SESSION ${quoteName(name)} ON ${catalog.scope}`,
            { tag: "profiler.dropSession" },
        );
        await this.release(name);
        this._diag.emit({
            type: SqlDiagEvents.profilerSessionDropped,
            status: "ok",
            fields: { session: objectName(name) },
        });
    }

    async isRunning(name: string): Promise<boolean> {
        const catalog = xeventCatalog(this._options.capabilities);
        const result = await this._options.runner.query(
            `SELECT TOP (1) 1 AS running FROM ${catalog.runningSessions} WHERE name = ${literal(name)}`,
            { tag: "profiler.isRunning" },
        );
        return result.rows.length > 0;
    }

    /**
     * Finds sessions this client created in an earlier run that are still on the server. A
     * claim whose lease has expired means the owning client is gone, so the session is a leak.
     */
    async findOrphans(): Promise<readonly SessionInfo[]> {
        const now = Date.now();
        const sessions = await this.list();
        const orphans = sessions.filter(
            (s) => s.ownedByThisClient && (s.leaseExpiresAt ?? 0) < now,
        );

        if (orphans.length > 0) {
            this._diag.emit({
                type: SqlDiagEvents.profilerOrphansFound,
                status: "ok",
                fields: { count: sys(orphans.length), server: serverName(this._options.serverKey) },
            });
        }
        return orphans;
    }

    /** Refreshes this client's claim so a live session is not mistaken for a leak. */
    async renew(name: string): Promise<void> {
        const claims = [...(await this._options.claims.read())];
        const existing = claims.find(
            (c) => c.name === name && c.server === this._options.serverKey,
        );
        if (existing) {
            existing.leaseExpiresAt = Date.now() + this._leaseMs;
        } else {
            claims.push({
                name,
                server: this._options.serverKey,
                createdAt: Date.now(),
                leaseExpiresAt: Date.now() + this._leaseMs,
            });
        }
        await this._options.claims.write(claims);
    }

    private async claim(name: string): Promise<void> {
        await this.renew(name);
    }

    private async release(name: string): Promise<void> {
        const claims = await this._options.claims.read();
        await this._options.claims.write(
            claims.filter((c) => !(c.name === name && c.server === this._options.serverKey)),
        );
    }

    private async claimsForThisServer(): Promise<readonly SessionClaim[]> {
        const claims = await this._options.claims.read();
        return claims.filter((c) => c.server === this._options.serverKey);
    }

    private async alterState(name: string, state: "START" | "STOP"): Promise<void> {
        const catalog = xeventCatalog(this._options.capabilities);
        await this._options.runner.query(
            `ALTER EVENT SESSION ${quoteName(name)} ON ${catalog.scope} STATE = ${state}`,
            { tag: `profiler.${state.toLowerCase()}` },
        );
    }
}

/**
 * Wraps an identifier in brackets, doubling any closing bracket. Session names come from users,
 * and without this a name containing "]" would close the identifier and run as statement text.
 */
export function quoteName(identifier: string): string {
    if (!identifier.trim()) {
        throw new Error("Session name must not be empty.");
    }
    return `[${identifier.replace(/]/g, "]]")}]`;
}

/** Renders a value as a quoted Unicode literal, doubling embedded quotes. */
export function literal(value: string): string {
    return `N'${value.replace(/'/g, "''")}'`;
}

/** An in-memory claim store, for tests and for callers with no persistence. */
export class MemoryClaimStore implements ClaimStore {
    private _claims: readonly SessionClaim[] = [];

    async read(): Promise<readonly SessionClaim[]> {
        return this._claims;
    }

    async write(claims: readonly SessionClaim[]): Promise<void> {
        this._claims = [...claims];
    }
}
