/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Composition root for the SHARED MetadataStore (one per extension host,
 * MD-4): Query Studio, the native language service, and Object Explorer v2
 * all acquire catalog leases from this instance so warm catalogs are shared
 * across features instead of re-hydrated per consumer.
 *
 * CACHE-3: when the host configures the persistent cache (globalStorage
 * path + live settings), the store loads disk snapshots on fresh acquires
 * and saves live generations back — all behind
 * mssql.metadataCache.enabled (default false).
 */

import { SqlDataPlaneService } from "../sqlDataPlane/sqlDataPlaneService";
import { MetadataCacheCoordinator } from "./cache/metadataCacheCoordinator";
import { MetadataCacheSettings } from "./cache/metadataCacheSettings";
import { MetadataCacheStore, NodeFsLike } from "./cache/metadataCacheStore";
import { MetadataStore } from "./metadataStore";

export interface MetadataCacheInit {
    /** e.g. <globalStorage>/metadata-cache — the cache root directory. */
    readonly cacheRootPath: string;
    /** Live settings read (config changes flow without restart). */
    readonly settings: () => MetadataCacheSettings;
    readonly producer?: {
        readonly extensionVersion?: string;
        readonly appVersion?: string;
    };
}

export class MetadataStoreService {
    private static instance: MetadataStoreService | undefined;

    static get(): MetadataStoreService {
        if (!MetadataStoreService.instance) {
            MetadataStoreService.instance = new MetadataStoreService();
        }
        return MetadataStoreService.instance;
    }

    /** Test seam: replace/reset the singleton. */
    static setForTests(instance: MetadataStoreService | undefined): void {
        MetadataStoreService.instance?.dispose();
        MetadataStoreService.instance = instance;
    }

    private storeInstance: MetadataStore | undefined;
    private coordinator: MetadataCacheCoordinator | undefined;
    private cacheInit: MetadataCacheInit | undefined;

    /**
     * Configure the persistent cache BEFORE the first store() call (the
     * host activation path). Idempotent; a second call replaces the init
     * only when the store has not been built yet.
     */
    configureCache(init: MetadataCacheInit): void {
        if (this.storeInstance) {
            return; // store already composed — a restart picks up changes
        }
        this.cacheInit = init;
    }

    store(): MetadataStore {
        if (!this.storeInstance) {
            const init = this.cacheInit;
            if (init) {
                const diskStore = new MetadataCacheStore(new NodeFsLike(), init.cacheRootPath);
                this.coordinator = new MetadataCacheCoordinator(diskStore, init.settings, {
                    ...(init.producer ? { producer: init.producer } : {}),
                });
            }
            this.storeInstance = new MetadataStore(
                () => SqlDataPlaneService.get().service(),
                this.coordinator
                    ? {
                          cache: {
                              coordinator: this.coordinator,
                              offlineMode: () => this.cacheInit?.settings().offlineMode === true,
                          },
                      }
                    : {},
            );
        }
        return this.storeInstance;
    }

    /** The cache surface for commands/status UI (undefined when off). */
    cache(): MetadataCacheCoordinator | undefined {
        this.store();
        return this.coordinator;
    }

    /** H-10: eviction hygiene, called AFTER activation completes — never
     *  inside mssql.activate timings. */
    async maintenance(): Promise<void> {
        if (this.storeInstance && this.coordinator) {
            await this.coordinator.runMaintenance();
        }
    }

    dispose(): void {
        this.coordinator?.dispose?.();
        this.coordinator = undefined;
        this.storeInstance?.dispose();
        this.storeInstance = undefined;
    }
}
