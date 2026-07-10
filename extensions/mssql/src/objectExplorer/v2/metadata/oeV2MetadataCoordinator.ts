/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OeV2MetadataCoordinator (oe_view_design §8.2): one per connected OE v2
 * connection — holds the server catalog lease and lazily-acquired database
 * catalog leases from the SHARED MetadataStore (injected instance, never a
 * singleton import). Rules: pin once per expand; never mix generations in
 * one response; database catalogs acquire lazily on database expand only.
 *
 * Browse freshness (CACHE-5, addendum §7.2 — block-with-loading): expands
 * route through ensureFresh with the oeBrowse preset (requireValidated,
 * TTL 120s, wait budget 5s). Within the TTL the memory tier answers
 * instantly with zero SQL; the first expand beyond it runs the T1 digest
 * (server scope: validation ≡ re-hydration, §4.4) while the tree shows its
 * loading child. The verdict rides back to the pure render layer as plain
 * facts — lease access stays HERE, never in tree/ modules.
 */

import { AuxiliaryCatalog } from "../../../services/metadata/auxiliaryCatalog";
import { MetadataStatus } from "../../../services/metadata/metadataService";
import { CatalogSnapshot } from "../../../services/metadata/catalogModel";
import {
    DatabaseCatalogLease,
    MetadataStore,
    ServerCatalogLease,
} from "../../../services/metadata/metadataStore";
import { PreparedConnection } from "../../../services/metadata/profileAuthAdapter";
import {
    FreshCatalogResult,
    FreshServerCatalogResult,
    MetadataPolicies,
} from "../../../services/metadata/cache/metadataFreshness";
import {
    IPinnedServerCatalogView,
    ServerCatalogStatus,
} from "../../../services/metadata/serverMetadataService";

/** Test/dogfood seam over the oeBrowse preset knobs (defaults win in prod). */
export interface OeV2FreshnessOverrides {
    readonly validationTtlMs?: number;
    readonly timeoutMs?: number;
}

export class OeV2MetadataCoordinator {
    private serverLease: ServerCatalogLease | undefined;
    private serverPending: Promise<ServerCatalogLease> | undefined;
    private databaseLeases = new Map<string, DatabaseCatalogLease>();
    private databasePending = new Map<string, Promise<DatabaseCatalogLease>>();
    private subscriptions: { dispose(): void }[] = [];
    private listeners = new Set<() => void>();
    private disposed = false;

    constructor(
        private readonly store: MetadataStore,
        private readonly prepared: PreparedConnection,
        private readonly freshnessOverrides?: OeV2FreshnessOverrides,
    ) {}

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

    // -- server catalog -------------------------------------------------------

    async ensureServer(): Promise<ServerCatalogLease> {
        if (this.serverLease) {
            return this.serverLease;
        }
        if (!this.serverPending) {
            this.serverPending = this.store.acquireServer(this.prepared).then((lease) => {
                if (this.disposed) {
                    lease.dispose();
                    throw new Error("coordinator disposed");
                }
                this.serverLease = lease;
                this.subscriptions.push(lease.onDidChange(() => this.notify()));
                return lease;
            });
        }
        return this.serverPending;
    }

    serverStatus(): ServerCatalogStatus | undefined {
        return this.serverLease?.status();
    }

    /** Pin once per expand — callers hold the view for one response only. */
    serverView(): IPinnedServerCatalogView | undefined {
        return this.serverLease?.pin();
    }

    async refreshServer(): Promise<void> {
        await (await this.ensureServer()).refresh();
    }

    /** Lazy server-scoped aux sections (B23) — undefined until connected. */
    serverAuxiliary(): AuxiliaryCatalog | undefined {
        return this.serverLease?.auxiliary;
    }

    /** Ensure the server lease exists, then lazily hydrate one aux section. */
    async ensureAuxSection(sectionKey: string): Promise<void> {
        const lease = await this.ensureServer();
        await lease.auxiliary.ensureSection(sectionKey);
    }

    /**
     * §7.2/§4.4 browse freshness at server scope: requireValidated with the
     * oeBrowse TTL — re-hydrates when the catalog is older than the TTL
     * (validation ≡ re-hydration at server scope), returns instantly
     * within it. Explicit refresh commands keep using refreshServer().
     */
    async ensureServerFresh(): Promise<FreshServerCatalogResult> {
        const lease = await this.ensureServer();
        return lease.ensureFresh({
            mode: "requireValidated",
            reason: "oeBrowse",
            validationTtlMs:
                this.freshnessOverrides?.validationTtlMs ??
                MetadataPolicies.oeBrowse.validationTtlMs,
            timeoutMs: this.freshnessOverrides?.timeoutMs ?? MetadataPolicies.oeBrowse.timeoutMs,
        });
    }

    // -- database catalogs ----------------------------------------------------

    async ensureDatabase(database: string): Promise<DatabaseCatalogLease> {
        const existing = this.databaseLeases.get(database);
        if (existing) {
            return existing;
        }
        let pending = this.databasePending.get(database);
        if (!pending) {
            pending = this.store
                .acquireDatabase(this.prepared, database, () => this.notify())
                .then((lease) => {
                    if (this.disposed) {
                        lease.dispose();
                        throw new Error("coordinator disposed");
                    }
                    this.databaseLeases.set(database, lease);
                    this.databasePending.delete(database);
                    return lease;
                });
            this.databasePending.set(database, pending);
        }
        return pending;
    }

    databaseLease(database: string): DatabaseCatalogLease | undefined {
        return this.databaseLeases.get(database);
    }

    databaseStatus(database: string): MetadataStatus | undefined {
        return this.databaseLeases.get(database)?.status();
    }

    /** Pinned snapshot for one response (undefined while absent/loading). */
    databaseSnapshot(database: string): CatalogSnapshot | undefined {
        return this.databaseLeases.get(database)?.current();
    }

    async refreshDatabase(database: string): Promise<void> {
        await (await this.ensureDatabase(database)).refresh();
    }

    /**
     * §7.2 browse freshness (block-with-loading): requireValidated with the
     * oeBrowse preset. Within the TTL the validated generation answers
     * instantly (T0 memory tier — no SQL); the first expand beyond it runs
     * the T1 digest, bounded by the preset's 5s wait budget (a race, never
     * a cancellation — C-9). Explicit refresh keeps using refreshDatabase()
     * (lease.refresh() bypasses the TTL by definition).
     */
    async ensureDatabaseFresh(database: string): Promise<FreshCatalogResult> {
        const lease = await this.ensureDatabase(database);
        return lease.ensureFresh({
            ...MetadataPolicies.oeBrowse,
            ...(this.freshnessOverrides?.validationTtlMs !== undefined
                ? { validationTtlMs: this.freshnessOverrides.validationTtlMs }
                : {}),
            ...(this.freshnessOverrides?.timeoutMs !== undefined
                ? { timeoutMs: this.freshnessOverrides.timeoutMs }
                : {}),
        });
    }

    dispose(): void {
        this.disposed = true;
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions = [];
        for (const lease of this.databaseLeases.values()) {
            lease.dispose();
        }
        this.databaseLeases.clear();
        this.databasePending.clear();
        this.serverLease?.dispose();
        this.serverLease = undefined;
        this.serverPending = undefined;
        this.listeners.clear();
    }
}
