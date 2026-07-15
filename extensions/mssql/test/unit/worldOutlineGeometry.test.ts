/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SPA-10 / D-0023: world outline topology decode. Proves the bundled Natural
 * Earth land asset decodes to plausible EPSG:4326 geometry and that malformed
 * assets are refused (honest `unavailable` state, never a guessed map).
 */

import { expect } from "chai";
import { worldOutlineGeoJson } from "../../src/webviews/pages/QueryStudio/spatial/worldOutlineGeometry";

/** Minimal valid land topology: one triangle island. */
const MINI_TOPOLOGY = {
    type: "Topology",
    objects: {
        land: {
            type: "GeometryCollection",
            geometries: [{ type: "Polygon", arcs: [[0]] }],
        },
    },
    arcs: [
        [
            [0, 0],
            [10, 0],
            [0, 10],
            [-10, -10],
        ],
    ],
    transform: undefined,
};

suite("spatial world outline geometry (SPA-10)", () => {
    test("decodes a land topology to GeoJSON", () => {
        const decoded = worldOutlineGeoJson(MINI_TOPOLOGY) as unknown as {
            type: string;
            features?: unknown[];
        };
        expect(["FeatureCollection", "Feature"]).to.include(decoded.type);
    });

    test("decodes the real bundled asset with lon/lat-range coordinates", () => {
        // world-atlas is the dev dependency the bundle step copies verbatim.

        const topology = require("world-atlas/land-110m.json") as unknown;
        const decoded = worldOutlineGeoJson(topology) as unknown as {
            type: string;
            geometry?: { type: string; coordinates: unknown };
            features?: { geometry: { type: string; coordinates: unknown } }[];
        };
        const geometry =
            decoded.type === "Feature"
                ? (decoded.geometry ?? undefined)
                : decoded.features?.[0]?.geometry;
        expect(geometry, "land geometry").to.not.equal(undefined);
        // Walk to the first coordinate pair and require plausible EPSG:4326.
        let position: unknown = geometry!.coordinates;
        while (Array.isArray(position) && Array.isArray(position[0])) {
            position = position[0];
        }
        const [lon, lat] = position as [number, number];
        expect(Math.abs(lon)).to.be.at.most(180);
        expect(Math.abs(lat)).to.be.at.most(90);
    });

    test("refuses non-topology and empty-arc shapes", () => {
        expect(() => worldOutlineGeoJson(undefined)).to.throw();
        expect(() => worldOutlineGeoJson({ type: "FeatureCollection" })).to.throw();
        expect(() => worldOutlineGeoJson({ type: "Topology", objects: {}, arcs: [[]] })).to.throw();
        expect(() =>
            worldOutlineGeoJson({
                type: "Topology",
                objects: { land: { type: "GeometryCollection", geometries: [] } },
                arcs: [],
            }),
        ).to.throw();
    });
});
