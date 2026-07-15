/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline world outline layer (SPA-10 / D-0023, addendum §4.4). Fetches the
 * bundled Natural Earth land asset from the webview resource origin — never a
 * remote host — and renders it as a subordinate OpenLayers vector layer under
 * the result features. Loaded lazily (dynamic import + lazy asset fetch) only
 * when the user selects the layer, so `None` keeps today's exact zero-cost
 * behavior.
 */

import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import VectorImageLayer from "ol/layer/VectorImage.js";
import VectorSource from "ol/source/Vector.js";
import { Fill, Stroke, Style } from "ol/style.js";
import { WORLD_OUTLINE_ASSET, worldOutlineGeoJson } from "./worldOutlineGeometry";

export type WorldOutlineLayer = VectorImageLayer<VectorSource<Feature>>;

/** Layer opacity keeps land subordinate to result features in every theme. */
const WORLD_OUTLINE_OPACITY = 0.35;

export async function loadWorldOutlineLayer(
    themeColor: (variable: string) => string,
    fetchImpl: typeof fetch = fetch,
): Promise<WorldOutlineLayer> {
    const response = await fetchImpl(new URL(WORLD_OUTLINE_ASSET, document.baseURI).toString());
    if (!response.ok) {
        throw new Error(`world outline asset unavailable (${response.status})`);
    }
    const collection = worldOutlineGeoJson(await response.json());
    const features = new GeoJSON().readFeatures(collection, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
    }) as Feature[];
    const source = new VectorSource<Feature>({ features });
    const layer = new VectorImageLayer({
        source,
        imageRatio: 1.25,
        opacity: WORLD_OUTLINE_OPACITY,
        style: new Style({
            fill: new Fill({ color: themeColor("--vscode-editor-inactiveSelectionBackground") }),
            stroke: new Stroke({
                color: themeColor("--vscode-editor-foreground"),
                width: 0.8,
            }),
        }),
    });
    // Result features always render above any map layer (addendum §6.5).
    layer.setZIndex(-10);
    return layer;
}
