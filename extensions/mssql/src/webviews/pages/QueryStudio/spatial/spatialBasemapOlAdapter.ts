/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OpenLayers adapter for host-proxied XYZ tiles (SPA-10, addendum §6.5).
 * The tile load function converts each viewport tile coordinate into one
 * bounded `qs/spatial.basemap.tile` RPC and assigns the returned LOCAL
 * webview URI. It never fetches, never sees a remote URL, bounds its own
 * in-flight set, abandons stale generations, and treats tile failure as a
 * layer state — never a feature-render failure.
 */

import TileLayer from "ol/layer/Tile.js";
import XYZ from "ol/source/XYZ.js";
import type Tile from "ol/Tile.js";
import type ImageTile from "ol/ImageTile.js";
import type { QsSpatialBasemapTileResult } from "../../../../sharedInterfaces/spatialBasemap";

export interface SpatialBasemapAdapterSession {
    readonly handle: string;
    readonly generation: number;
    readonly minZoom: number;
    readonly maxZoom: number;
}

export interface SpatialBasemapAdapterEvents {
    onFirstTile(outcome: "ok" | "unavailable"): void;
}

/** Adapter-side in-flight bound; the host enforces its own limits too. */
const MAX_INFLIGHT_TILES = 4;

export type SpatialBasemapTileRequester = (coords: {
    z: number;
    x: number;
    y: number;
}) => Promise<QsSpatialBasemapTileResult>;

export function createSpatialBasemapTileLayer(
    requestTile: SpatialBasemapTileRequester,
    session: SpatialBasemapAdapterSession,
    events: SpatialBasemapAdapterEvents,
): TileLayer<XYZ> {
    let inFlight = 0;
    const queue: (() => void)[] = [];
    let firstTileReported = false;
    let disposed = false;
    const reportFirst = (outcome: "ok" | "unavailable") => {
        if (!firstTileReported) {
            firstTileReported = true;
            events.onFirstTile(outcome);
        }
    };
    const pump = () => {
        while (inFlight < MAX_INFLIGHT_TILES && queue.length > 0) {
            queue.shift()!();
        }
    };
    const source = new XYZ({
        // The url template is a REQUIRED placeholder for OpenLayers' tile
        // grid arithmetic only; tileLoadFunction below is the sole loader and
        // never dereferences it.
        url: "local://{z}/{x}/{y}",
        projection: "EPSG:3857",
        minZoom: session.minZoom,
        maxZoom: session.maxZoom,
        tileLoadFunction: (tile: Tile, src: string) => {
            const run = () => {
                inFlight++;
                const [z, x, y] = tile.getTileCoord();
                void requestTile({ z, x, y })
                    .then((result) => {
                        if (disposed) {
                            tile.setState(3 /* TileState.ERROR */);
                            return;
                        }
                        if (result.status === "ready" && result.localUri) {
                            ((tile as ImageTile).getImage() as HTMLImageElement).src =
                                result.localUri;
                            reportFirst("ok");
                        } else {
                            // Honest empty tile; features keep rendering above.
                            tile.setState(3 /* TileState.ERROR */);
                            if (result.status !== "cancelled") {
                                reportFirst("unavailable");
                            }
                        }
                    })
                    .catch(() => {
                        tile.setState(3 /* TileState.ERROR */);
                        reportFirst("unavailable");
                    })
                    .finally(() => {
                        inFlight--;
                        pump();
                    });
            };
            void src;
            queue.push(run);
            pump();
        },
    });
    const layer = new TileLayer({ source, opacity: 0.9 });
    layer.setZIndex(-10);
    layer.once("change", () => undefined);
    (layer as TileLayer<XYZ> & { __qsDispose?: () => void }).__qsDispose = () => {
        disposed = true;
        queue.length = 0;
    };
    return layer;
}

export function disposeSpatialBasemapTileLayer(layer: TileLayer<XYZ>): void {
    (layer as TileLayer<XYZ> & { __qsDispose?: () => void }).__qsDispose?.();
    layer.dispose();
}
