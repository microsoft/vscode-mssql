/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * World outline topology decode (SPA-10 / D-0023). Pure: converts the bundled
 * Natural Earth land TopoJSON (world-atlas land-110m) into a GeoJSON feature
 * collection in EPSG:4326. Contains no OpenLayers, DOM, or network concerns so
 * the decode is unit-testable and the asset stays interchangeable.
 */

import { feature as topologyToFeature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

export const WORLD_OUTLINE_ASSET = "spatial-world-land-110m.json";

export interface WorldOutlineGeoJson {
    readonly type: "FeatureCollection" | "Feature";
    readonly [key: string]: unknown;
}

/**
 * Decode the land topology into GeoJSON. Throws on any shape mismatch — the
 * caller reports an honest `unavailable` layer state, never a guessed map.
 */
export function worldOutlineGeoJson(topology: unknown): WorldOutlineGeoJson {
    const candidate = topology as Topology | undefined;
    const land = candidate?.objects?.["land"];
    if (
        candidate?.type !== "Topology" ||
        land === undefined ||
        !Array.isArray(candidate.arcs) ||
        candidate.arcs.length === 0
    ) {
        throw new Error("world outline asset is not a land topology");
    }
    const decoded = topologyToFeature(candidate, land as GeometryCollection);
    if (decoded.type !== "FeatureCollection" && decoded.type !== "Feature") {
        throw new Error("world outline asset decoded to an unexpected shape");
    }
    return decoded as unknown as WorldOutlineGeoJson;
}
