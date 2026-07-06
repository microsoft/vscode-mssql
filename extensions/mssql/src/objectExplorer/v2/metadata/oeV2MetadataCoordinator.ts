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
 */

import { MetadataStatus } from "../../../services/metadata/metadataService";
import { CatalogSnapshot } from "../../../services/metadata/catalogModel";
import {
    DatabaseCatalogLease,
    MetadataStore,
    ServerCatalogLease,
} from "../../../services/metadata/metadataStore";
import { PreparedConnection } from "../../../services/metadata/profileAuthAdapter";
import {
    IPinnedServerCatalogView,
    ServerCatalogStatus,
} from "../../../services/metadata/serverMetadataService";

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
