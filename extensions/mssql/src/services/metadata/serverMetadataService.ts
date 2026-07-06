/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ServerMetadataService (MetadataStore design §7): the server-scoped catalog
 * — visible databases + server facts — as a first-class service beside the
 * database catalogs. Consumers pin an immutable generation view; failure is
 * NEVER an empty database list.
 *
 * Database visibility (plan worksheet #1, answered): sys.databases rows are
 * NOT filtered by HAS_DBACCESS — inaccessible databases are listed with
 * accessState "inaccessible" (SSMS shows them; hiding them lies about the
 * server). NULL HAS_DBACCESS maps to "unknown".
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import { ISqlSession } from "../sqlDataPlane/api";
import { FreshServerCatalogResult, ServerMetadataFreshnessPolicy } from "./cache/metadataFreshness";
import { MetadataSessionSource, runMetadataQuery } from "./metadataService";

export interface ServerDatabaseInfo {
    readonly databaseId?: number;
    readonly name: string;
    readonly state?: string;
    readonly isReadOnly?: boolean;
    readonly userAccess?: string;
    readonly compatibilityLevel?: number;
    readonly isSystem?: boolean;
    readonly accessState: "accessible" | "inaccessible" | "unknown";
}

export interface ServerInfoSummary {
    readonly serverVersion?: string;
    readonly engineEdition?: string;
    readonly serverDisplayName?: string;
    readonly loginName?: string;
}

export type ServerCatalogReadiness = "absent" | "loading" | "ready" | "failed";

export interface ServerCatalogStatus {
    readonly readiness: ServerCatalogReadiness;
    readonly generation: number;
    readonly databaseCount?: number;
    /** Sanitized error class (message text, no endpoints) when failed. */
    readonly errorMessage?: string;
}

export interface IPinnedServerCatalogView {
    readonly generation: number;
    readonly readiness: ServerCatalogReadiness;
    readonly serverInfo?: ServerInfoSummary;
    /** undefined while loading/failed — NOT an empty list (design §7.1). */
    listDatabases(): readonly ServerDatabaseInfo[] | undefined;
    getDatabase(name: string): ServerDatabaseInfo | undefined;
}

const SERVER_DATABASES =
    "SELECT d.database_id, d.name, d.state_desc, d.is_read_only, d.user_access_desc, " +
    "d.compatibility_level, HAS_DBACCESS(d.name) AS has_dbaccess " +
    "FROM sys.databases AS d ORDER BY d.name;";

interface CatalogState {
    readiness: ServerCatalogReadiness;
    generation: number;
    databases: ServerDatabaseInfo[] | undefined;
    serverInfo: ServerInfoSummary | undefined;
    errorMessage: string | undefined;
}

export class ServerMetadataService {
    private state: CatalogState = {
        readiness: "absent",
        generation: 0,
        databases: undefined,
        serverInfo: undefined,
        errorMessage: undefined,
    };
    private hydrating: Promise<void> | undefined;
    private lastHydratedAtMs: number | undefined;
    private listeners = new Set<() => void>();

    constructor(private readonly sessions: MetadataSessionSource) {}

    onDidChange(listener: () => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                /* listener isolation */
            }
        }
    }

    status(): ServerCatalogStatus {
        return {
            readiness: this.state.readiness,
            generation: this.state.generation,
            ...(this.state.databases ? { databaseCount: this.state.databases.length } : {}),
            ...(this.state.errorMessage ? { errorMessage: this.state.errorMessage } : {}),
        };
    }

    /** Immutable view of the current generation (pin once per response). */
    pin(): IPinnedServerCatalogView {
        const snapshot = this.state;
        const list = snapshot.databases ? [...snapshot.databases] : undefined;
        const byName = list ? new Map(list.map((db) => [db.name, db])) : undefined;
        return {
            generation: snapshot.generation,
            readiness: snapshot.readiness,
            ...(snapshot.serverInfo ? { serverInfo: snapshot.serverInfo } : {}),
            listDatabases: () => list,
            getDatabase: (name: string) => byName?.get(name),
        };
    }

    /** Hydrate if absent/failed; coalesces concurrent calls. */
    ensureHydrated(): Promise<void> {
        if (this.state.readiness === "ready" || this.state.readiness === "loading") {
            return this.hydrating ?? Promise.resolve();
        }
        return this.refresh();
    }

    refresh(): Promise<void> {
        if (this.hydrating) {
            return this.hydrating;
        }
        const run = this.hydrateCore().finally(() => {
            this.hydrating = undefined;
        });
        this.hydrating = run;
        return run;
    }

    private async hydrateCore(): Promise<void> {
        this.state = { ...this.state, readiness: "loading" };
        this.notify();
        const span = diag.startSpan({
            feature: "metadata",
            kind: "span",
            type: "metadataStore.hydrate.server",
            fields: {
                generation: { raw: String(this.state.generation + 1), cls: "diagnostic.metadata" },
            },
        });
        try {
            const session = await this.sessions.open();
            const rows = await runMetadataQuery(session, SERVER_DATABASES, "metadataStore:server");
            const databases = rows.map((row) => toDatabaseInfo(row));
            this.state = {
                readiness: "ready",
                generation: this.state.generation + 1,
                databases,
                serverInfo: toServerInfo(session),
                errorMessage: undefined,
            };
            this.lastHydratedAtMs = Date.now();
            span.end("ok", {
                databases: { raw: databases.length, cls: "diagnostic.metadata" },
            });
        } catch (error) {
            // Failure keeps any previous generation's list out of the state:
            // a failed catalog must not masquerade as a (stale) ready one.
            this.state = {
                readiness: "failed",
                generation: this.state.generation,
                databases: undefined,
                serverInfo: this.state.serverInfo,
                errorMessage: error instanceof Error ? error.message : String(error),
            };
            span.fail(error);
        }
        this.notify();
    }

    /**
     * §4.4: no digest exists at server scope — validation ≡ re-hydration.
     * requireValidated re-hydrates when older than the TTL (OE default
     * 120s); requireLive always re-hydrates; allowStale returns whatever
     * generation exists and never blocks on a hydrated catalog. Waits are
     * races (C-9): a timed-out caller leaves the refresh running.
     */
    async ensureFresh(policy: ServerMetadataFreshnessPolicy): Promise<FreshServerCatalogResult> {
        const startedAt = Date.now();
        const result = (
            freshness: FreshServerCatalogResult["freshness"],
            backgroundRefreshStarted?: boolean,
        ): FreshServerCatalogResult => ({
            generation: this.state.generation,
            readiness: this.state.readiness,
            freshness,
            waitedMs: Date.now() - startedAt,
            ...(backgroundRefreshStarted ? { backgroundRefreshStarted } : {}),
        });
        const hydratedWithin = (ttlMs: number): boolean =>
            this.lastHydratedAtMs !== undefined && Date.now() - this.lastHydratedAtMs <= ttlMs;
        const race = (work: Promise<void>): Promise<"done" | "timeout"> => {
            if (policy.timeoutMs === undefined && !policy.signal) {
                return work.then(
                    () => "done" as const,
                    () => "done" as const,
                );
            }
            return new Promise((resolve) => {
                let settled = false;
                const settle = (value: "done" | "timeout") => {
                    if (!settled) {
                        settled = true;
                        if (timer !== undefined) {
                            clearTimeout(timer);
                        }
                        resolve(value);
                    }
                };
                const timer =
                    policy.timeoutMs !== undefined
                        ? setTimeout(() => settle("timeout"), policy.timeoutMs)
                        : undefined;
                (timer as { unref?: () => void } | undefined)?.unref?.();
                if (policy.signal?.aborted) {
                    settle("timeout");
                } else {
                    policy.signal?.addEventListener("abort", () => settle("timeout"), {
                        once: true,
                    });
                }
                work.then(
                    () => settle("done"),
                    () => settle("done"),
                );
            });
        };
        switch (policy.mode) {
            case "allowStale": {
                if (this.state.databases) {
                    const freshness = this.hydrating
                        ? "refreshing"
                        : hydratedWithin(policy.validationTtlMs ?? 120_000)
                          ? "validated"
                          : "stale";
                    return result(freshness);
                }
                const outcome = await race(this.ensureHydrated());
                if (outcome === "done" && this.state.readiness === "ready") {
                    return result("live");
                }
                return result("unavailable");
            }
            case "requireValidated": {
                if (this.state.databases && hydratedWithin(policy.validationTtlMs ?? 120_000)) {
                    return result("validated");
                }
                const outcome = await race(this.refresh());
                if (outcome === "done" && this.state.readiness === "ready") {
                    return result("live");
                }
                return result(this.state.databases ? "stale" : "unavailable");
            }
            case "requireLive": {
                const outcome = await race(this.refresh());
                if (outcome === "done" && this.state.readiness === "ready") {
                    return result("live");
                }
                return result("unavailable");
            }
            case "offlineSnapshot": {
                return result(this.state.databases ? "stale" : "unavailable");
            }
        }
    }

    dispose(): void {
        this.listeners.clear();
    }
}

function toDatabaseInfo(row: unknown[]): ServerDatabaseInfo {
    const databaseId = Number.isFinite(Number(row[0])) ? Number(row[0]) : undefined;
    const hasAccessRaw = row[6];
    const accessState =
        hasAccessRaw === null || hasAccessRaw === undefined
            ? ("unknown" as const)
            : hasAccessRaw === true || Number(hasAccessRaw) === 1
              ? ("accessible" as const)
              : ("inaccessible" as const);
    return {
        ...(databaseId !== undefined ? { databaseId } : {}),
        name: String(row[1]),
        ...(row[2] !== null && row[2] !== undefined ? { state: String(row[2]) } : {}),
        ...(row[3] !== null && row[3] !== undefined
            ? { isReadOnly: row[3] === true || Number(row[3]) === 1 }
            : {}),
        ...(row[4] !== null && row[4] !== undefined ? { userAccess: String(row[4]) } : {}),
        ...(Number.isFinite(Number(row[5])) ? { compatibilityLevel: Number(row[5]) } : {}),
        ...(databaseId !== undefined ? { isSystem: databaseId <= 4 } : {}),
        accessState,
    };
}

function toServerInfo(session: ISqlSession): ServerInfoSummary | undefined {
    const info = session.info;
    if (!info.serverVersion && !info.serverDisplayName && !info.loginName) {
        return undefined;
    }
    return {
        ...(info.serverVersion ? { serverVersion: info.serverVersion } : {}),
        ...(info.engineEdition ? { engineEdition: info.engineEdition } : {}),
        ...(info.serverDisplayName ? { serverDisplayName: info.serverDisplayName } : {}),
        ...(info.loginName ? { loginName: info.loginName } : {}),
    };
}
