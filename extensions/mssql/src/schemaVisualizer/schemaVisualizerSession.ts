/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer session core (SV-R4). Pure extension-side data flow —
 * NO vscode imports, so the no-v1 tripwire and honesty suites drive the
 * REAL store against a scripted data plane. The webview controller is a
 * thin shell over this.
 *
 * Rules encoded here (addendum §3.2, §6):
 * - Reads come ONLY from a MetadataStore database lease over the SQL Data
 *   Plane. No ad-hoc SQL, no interactive session, no v1 anything.
 * - Pin ONE snapshot per response (§6.4): every result derives from a
 *   single `lease.current()` capture.
 * - DRIFT = visualizer fingerprint change; a bare generation bump with
 *   identical content updates freshness facts SILENTLY (§6.1/§6.4).
 * - Open uses the oeBrowse freshness preset (requireValidated, bounded
 *   wait); a stale retained snapshot is SERVED but labeled — never called
 *   current (§6.3).
 * - Large catalogs (addendum §11.3): above the rendered-table threshold the
 *   default response carries NO table payload (search-first mode); subsets
 *   arrive via explicit objectId filters. The FULL model still backs the
 *   fingerprint, so drift detection never depends on the rendered subset.
 */

import { CatalogSnapshot } from "../services/metadata/catalogModel";
import { MetadataPolicies } from "../services/metadata/cache/metadataFreshness";
import { DatabaseCatalogLease, MetadataStore } from "../services/metadata/metadataStore";
import { PreparedConnection } from "../services/metadata/profileAuthAdapter";
import { SchemaVisualizer } from "../sharedInterfaces/schemaVisualizer";
import { buildVisualizerModel } from "./model/catalogToVisualizerModel";
import { SchemaVisualizerCatalogModel } from "./model/schemaVisualizerModel";
import { computeVisualizerFingerprint } from "./model/visualizerFingerprint";

/**
 * Internal, measured policy (addendum §11.3) — NOT a public contract.
 * Above this many tables the visualizer opens search-first instead of an
 * unconditional all-table layout pass.
 */
export const LARGE_CATALOG_RENDER_THRESHOLD = 500;

// Serializable result shapes are DECLARED in the shared interface (the
// webview program must never import this node-typed module) — the session
// implements them.
export type VisualizerFreshnessFacts = SchemaVisualizer.VisualizerFreshnessFacts;
export type VisualizerModelResult = SchemaVisualizer.VisualizerModelResult;
export type VisualizerTableSearchItem = SchemaVisualizer.VisualizerTableSearchItem;

export interface VisualizerChangeEvent {
    /** True only when commit-relevant content actually changed (§6.1). */
    fingerprintChanged: boolean;
    fingerprint: string;
}

export interface SchemaVisualizerSessionOptions {
    prepared: PreparedConnection;
    database: string;
    renderThreshold?: number;
}

export class SchemaVisualizerSession {
    private lease: DatabaseCatalogLease | undefined;
    private leaseSubscription: { dispose(): void } | undefined;
    private listeners = new Set<(event: VisualizerChangeEvent) => void>();
    private lastServedFingerprint: string | undefined;
    private lastFreshness: VisualizerFreshnessFacts = {
        source: "none",
        freshness: "unavailable",
        validation: "notChecked",
    };
    private disposed = false;
    private readonly renderThreshold: number;

    constructor(
        private readonly store: MetadataStore,
        private readonly options: SchemaVisualizerSessionOptions,
    ) {
        this.renderThreshold = options.renderThreshold ?? LARGE_CATALOG_RENDER_THRESHOLD;
    }

    onDidChange(listener: (event: VisualizerChangeEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private async ensureLease(): Promise<DatabaseCatalogLease> {
        if (this.disposed) {
            throw new Error("SchemaVisualizerSession disposed");
        }
        if (!this.lease) {
            this.lease = await this.store.acquireDatabase(
                this.options.prepared,
                this.options.database,
                () => this.handleLeaseChange(),
            );
            this.leaseSubscription = this.lease.onDidChange(() => this.handleLeaseChange());
        }
        return this.lease;
    }

    /**
     * §6.4 change protocol: pin one snapshot, fingerprint it, compare with
     * the last SERVED fingerprint. Unchanged content → not drift.
     */
    private handleLeaseChange(): void {
        if (this.disposed || this.lease === undefined) {
            return;
        }
        const snapshot = this.lease.current();
        if (snapshot === undefined || this.lastServedFingerprint === undefined) {
            return; // nothing rendered yet — the open flow will serve facts
        }
        const fingerprint = this.fingerprintOf(snapshot);
        const event: VisualizerChangeEvent = {
            fingerprintChanged: fingerprint !== this.lastServedFingerprint,
            fingerprint,
        };
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch {
                /* listener isolation */
            }
        }
    }

    private fingerprintOf(snapshot: CatalogSnapshot): string {
        return computeVisualizerFingerprint(this.fullModelOf(snapshot)).hash;
    }

    private fullModelOf(snapshot: CatalogSnapshot): SchemaVisualizerCatalogModel {
        return buildVisualizerModel(snapshot, {
            serverFingerprint: this.options.prepared.serverFingerprint,
            database: this.options.database,
        });
    }

    /**
     * Acquire + browse-fresh + serve. `filter` narrows the table payload;
     * without it, catalogs above the threshold answer search-first.
     */
    async getModel(filter?: { objectIds?: number[] }): Promise<VisualizerModelResult> {
        const lease = await this.ensureLease();
        const fresh = await lease.ensureFresh(MetadataPolicies.oeBrowse);
        this.lastFreshness = {
            source: fresh.source,
            freshness: fresh.freshness,
            validation: fresh.validation?.tier ?? "notChecked",
        };
        const snapshot = lease.current();
        if (snapshot === undefined) {
            throw new SchemaVisualizerUnavailableError(this.lastFreshness);
        }
        return this.serve(snapshot, filter);
    }

    /** Explicit user refresh — bypasses the TTL by definition. */
    async refresh(filter?: { objectIds?: number[] }): Promise<VisualizerModelResult> {
        const lease = await this.ensureLease();
        await lease.refresh();
        return this.getModel(filter);
    }

    private serve(
        snapshot: CatalogSnapshot,
        filter?: { objectIds?: number[] },
    ): VisualizerModelResult {
        // ONE snapshot pin feeds full model, fingerprint, AND subset (§6.4).
        const full = this.fullModelOf(snapshot);
        const fingerprint = computeVisualizerFingerprint(full);
        this.lastServedFingerprint = fingerprint.hash;
        const totalTables = full.tables.length;

        let searchFirst = false;
        let model = full;
        if (filter?.objectIds !== undefined) {
            const include = new Set(filter.objectIds);
            model = {
                ...full,
                tables: full.tables.filter((t) => include.has(t.identity.objectId)),
                foreignKeys: full.foreignKeys.filter(
                    (fk) => include.has(fk.fromObjectId) || include.has(fk.toObjectId),
                ),
            };
        } else if (totalTables > this.renderThreshold) {
            searchFirst = true;
            model = { ...full, tables: [], foreignKeys: [] };
        }
        return {
            model,
            totalTables,
            renderedTables: model.tables.length,
            fingerprint: fingerprint.hash,
            fingerprintComplete: fingerprint.complete,
            searchFirst,
            freshness: this.lastFreshness,
        };
    }

    /** Case-folded substring search over table names (search-first mode). */
    async searchTables(query: string, limit = 100): Promise<VisualizerTableSearchItem[]> {
        const lease = await this.ensureLease();
        const snapshot = lease.current();
        if (snapshot === undefined) {
            return [];
        }
        const folded = query.trim().toLowerCase();
        const items: VisualizerTableSearchItem[] = [];
        for (const info of snapshot.listObjects(undefined, ["table"])) {
            if (
                folded.length > 0 &&
                !info.name.toLowerCase().includes(folded) &&
                !`${info.schema}.${info.name}`.toLowerCase().includes(folded)
            ) {
                continue;
            }
            items.push({
                objectId: info.objectId,
                schema: info.schema,
                name: info.name,
                columnCount: snapshot.getColumns(info.objectId).length,
            });
            if (items.length >= limit) {
                break;
            }
        }
        return items;
    }

    /** Objects one FK hop from the given tables (N-hop neighborhood UX). */
    async fkNeighborhood(objectIds: number[]): Promise<number[]> {
        const lease = await this.ensureLease();
        const snapshot = lease.current();
        if (snapshot === undefined) {
            return [];
        }
        const neighborhood = new Set<number>(objectIds);
        for (const id of objectIds) {
            for (const edge of snapshot.getForeignKeysFrom(id)) {
                neighborhood.add(edge.toObjectId);
            }
            for (const edge of snapshot.getForeignKeysTo(id)) {
                neighborhood.add(edge.fromObjectId);
            }
        }
        return [...neighborhood];
    }

    freshnessFacts(): VisualizerFreshnessFacts {
        return this.lastFreshness;
    }

    dispose(): void {
        this.disposed = true;
        this.leaseSubscription?.dispose();
        this.leaseSubscription = undefined;
        this.lease?.dispose();
        this.lease = undefined;
        this.listeners.clear();
    }
}

/** Typed honest failure: no snapshot AND hydrate failed (§15). */
export class SchemaVisualizerUnavailableError extends Error {
    constructor(public readonly freshness: VisualizerFreshnessFacts) {
        super("metadataUnavailable");
        this.name = "SchemaVisualizerUnavailableError";
        Object.setPrototypeOf(this, SchemaVisualizerUnavailableError.prototype);
    }
}
