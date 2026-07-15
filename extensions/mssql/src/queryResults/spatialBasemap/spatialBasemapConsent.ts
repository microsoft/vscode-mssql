/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-source consent records (SPA-10 / D-0027, addendum §4.2). Consent binds
 * to the source FINGERPRINT (id + template + attribution identity): changing
 * any of those invalidates it. Stored in extension globalState; cleared by the
 * `MS SQL: Spatial Map Layers: Clear Layer Consent` command. Consent state is
 * host-only — the webview sees only open() outcomes.
 */

export interface SpatialBasemapConsentStore {
    has(fingerprint: string): boolean;
    record(fingerprint: string): Promise<void>;
    clearAll(): Promise<void>;
}

interface MementoLike {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

const CONSENT_KEY = "mssql.spatialBasemap.consent.v1";

export function createSpatialBasemapConsentStore(memento: MementoLike): SpatialBasemapConsentStore {
    return {
        has(fingerprint) {
            const record = memento.get<Record<string, number>>(CONSENT_KEY, {});
            return typeof record[fingerprint] === "number";
        },
        async record(fingerprint) {
            const record = memento.get<Record<string, number>>(CONSENT_KEY, {});
            await memento.update(CONSENT_KEY, { ...record, [fingerprint]: Date.now() });
        },
        async clearAll() {
            await memento.update(CONSENT_KEY, undefined);
        },
    };
}
