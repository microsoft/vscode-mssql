/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * First-run basemap setup offer. The sources setting is user-level JSON that
 * nobody will hand-author: when the spatial UI first shows and the basemap is
 * disabled (or enabled with no usable sources), offer a one-click
 * OpenStreetMap setup. Accepting writes BOTH user settings (enabled +
 * sources) and records consent for exactly the entry it wrote — the offer
 * text carries the same tile-coordinate disclosure as the consent modal, so
 * the user is never asked twice for the same fact. Declining "don't ask
 * again" persists in globalState; a plain dismiss re-offers next session.
 * VS Code seams stay injected so the decision logic is unit-testable.
 */

import { validateSpatialBasemapSources } from "./spatialBasemapConfig";

/** The stock entry the offer writes — must pass validateSpatialBasemapSources. */
export const SPATIAL_BASEMAP_OSM_SOURCE = {
    id: "osm-standard",
    displayName: "OpenStreetMap",
    kind: "xyzRaster",
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: {
        text: "© OpenStreetMap contributors",
        termsUrl: "https://www.openstreetmap.org/copyright",
    },
    minZoom: 0,
    maxZoom: 19,
} as const;

export const SPATIAL_BASEMAP_OFFER_DISMISSED_KEY = "mssql.spatialBasemap.setupOffer.dismissed.v1";

export type SpatialBasemapSetupOutcome = "added" | "declined" | "skipped";

export interface SpatialBasemapSetupOfferDeps {
    memento: {
        get<T>(key: string, defaultValue: T): T;
        update(key: string, value: unknown): Thenable<void>;
    };
    isEnabled(): boolean;
    /** USER-level (global) sources value — never workspace inspection results. */
    globalSources(): unknown;
    /** Persist both user settings (sources first so enabling never races an empty list). */
    updateSettings(sources: readonly unknown[]): Promise<void>;
    prompt(): Promise<"add" | "never" | "dismiss">;
    /** Post-add pointer to the Layers dropdown. */
    confirm(): void;
    recordConsent(fingerprint: string): Promise<void>;
}

export interface SpatialBasemapSetupOffer {
    maybeOffer(): Promise<SpatialBasemapSetupOutcome>;
}

export function createSpatialBasemapSetupOffer(
    deps: SpatialBasemapSetupOfferDeps,
): SpatialBasemapSetupOffer {
    let offeredThisSession = false;
    return {
        async maybeOffer() {
            if (offeredThisSession) {
                return "skipped";
            }
            if (deps.memento.get(SPATIAL_BASEMAP_OFFER_DISMISSED_KEY, false)) {
                return "skipped";
            }
            if (
                deps.isEnabled() &&
                validateSpatialBasemapSources(deps.globalSources()).sources.length > 0
            ) {
                return "skipped";
            }
            offeredThisSession = true;
            const choice = await deps.prompt();
            if (choice === "never") {
                await deps.memento.update(SPATIAL_BASEMAP_OFFER_DISMISSED_KEY, true);
                return "declined";
            }
            if (choice !== "add") {
                return "declined";
            }
            const raw = deps.globalSources();
            const sources = Array.isArray(raw) ? [...raw] : [];
            const hasOsm = sources.some(
                (entry) =>
                    typeof entry === "object" &&
                    entry !== null &&
                    typeof (entry as { id?: unknown }).id === "string" &&
                    (entry as { id: string }).id.toLowerCase() === SPATIAL_BASEMAP_OSM_SOURCE.id,
            );
            if (!hasOsm) {
                // Detached JSON clone: settings writes must never share the
                // frozen module constant.
                sources.push(JSON.parse(JSON.stringify(SPATIAL_BASEMAP_OSM_SOURCE)));
            }
            await deps.updateSettings(sources);
            const added = validateSpatialBasemapSources(sources).sources.find(
                (source) => source.config.id.toLowerCase() === SPATIAL_BASEMAP_OSM_SOURCE.id,
            );
            if (added) {
                await deps.recordConsent(added.fingerprint);
            }
            deps.confirm();
            return "added";
        },
    };
}
