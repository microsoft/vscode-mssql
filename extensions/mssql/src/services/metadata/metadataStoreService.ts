/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Composition root for the SHARED MetadataStore (one per extension host,
 * MD-4): Query Studio, the native language service, and Object Explorer v2
 * all acquire catalog leases from this instance so warm catalogs are shared
 * across features instead of re-hydrated per consumer.
 */

import { SqlDataPlaneService } from "../sqlDataPlane/sqlDataPlaneService";
import { MetadataStore } from "./metadataStore";

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

    store(): MetadataStore {
        if (!this.storeInstance) {
            this.storeInstance = new MetadataStore(() => SqlDataPlaneService.get().service());
        }
        return this.storeInstance;
    }

    dispose(): void {
        this.storeInstance?.dispose();
        this.storeInstance = undefined;
    }
}
