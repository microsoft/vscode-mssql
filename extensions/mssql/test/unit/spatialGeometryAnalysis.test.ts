/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from "assert";
import { analyzeSpatialCoordinates } from "../../src/webviews/pages/QueryStudio/spatial/spatialGeometryAnalysis";

suite("Spatial geometry analysis", () => {
    test("computes polygon envelope, vertices, parts, and rings", () => {
        const result = analyzeSpatialCoordinates("Polygon", [
            [
                [2, 7, 100],
                [-1, 4, 200],
                [3, -5, 300],
                [2, 7, 100],
            ],
            [
                [0, 0],
                [1, 0],
                [0, 0],
            ],
        ]);
        assert.deepEqual(result, {
            vertices: 7,
            envelope: [-1, -5, 3, 7],
            parts: 1,
            rings: 2,
        });
    });

    test("counts multipolygon topology", () => {
        const result = analyzeSpatialCoordinates("MultiPolygon", [
            [
                [
                    [0, 0],
                    [1, 1],
                    [0, 0],
                ],
            ],
            [
                [
                    [10, 10],
                    [11, 11],
                    [10, 10],
                ],
                [
                    [10.2, 10.2],
                    [10.3, 10.3],
                    [10.2, 10.2],
                ],
            ],
        ]);
        assert.equal(result.parts, 2);
        assert.equal(result.rings, 3);
        assert.equal(result.vertices, 9);
        assert.deepEqual(result.envelope, [0, 0, 11, 11]);
    });

    test("ignores malformed and non-finite coordinate leaves", () => {
        const result = analyzeSpatialCoordinates("LineString", [
            [Number.NaN, 1],
            [1, Number.POSITIVE_INFINITY],
            ["secret", "value"],
            null,
            [4, 5],
        ]);
        assert.deepEqual(result, { vertices: 1, envelope: [4, 5, 4, 5], parts: 1, rings: 0 });
    });

    test("handles a large point batch iteratively at each collection level", () => {
        const coordinates = Array.from({ length: 100_000 }, (_, index) => [index, -index]);
        const result = analyzeSpatialCoordinates("MultiPoint", coordinates);
        assert.equal(result.vertices, 100_000);
        assert.equal(result.parts, 100_000);
        assert.deepEqual(result.envelope, [0, -99_999, 99_999, 0]);
    });
});
