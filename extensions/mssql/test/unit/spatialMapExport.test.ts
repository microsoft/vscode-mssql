/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * "Copy image" compositing math: each OpenLayers layer canvas maps onto the
 * export canvas via its CSS matrix transform, or a style/pixel-size scale
 * fallback — and a malformed transform must degrade to identity, never NaN.
 */

import { expect } from "chai";
import { canvasCompositeMatrix } from "../../src/webviews/pages/QueryStudio/spatial/spatialMapExport";

suite("spatial map export compositing", () => {
    test("CSS matrix transforms are used verbatim", () => {
        expect(
            canvasCompositeMatrix("matrix(0.5, 0, 0, 0.5, 10, -4)", "", "", 800, 600),
        ).to.deep.equal([0.5, 0, 0, 0.5, 10, -4]);
        // Whitespace variants parse; devicePixelRatio-style downscales survive.
        expect(
            canvasCompositeMatrix("  matrix(0.5,0,0,0.5,0,0)  ", "", "", 1600, 1200),
        ).to.deep.equal([0.5, 0, 0, 0.5, 0, 0]);
    });

    test("falls back to the style/pixel size scale when no transform is set", () => {
        expect(canvasCompositeMatrix("", "400px", "300px", 800, 600)).to.deep.equal([
            0.5, 0, 0, 0.5, 0, 0,
        ]);
    });

    test("malformed inputs degrade to identity, never NaN", () => {
        expect(canvasCompositeMatrix("matrix(a, b, c, d, e, f)", "", "", 800, 600)).to.deep.equal([
            1, 0, 0, 1, 0, 0,
        ]);
        expect(canvasCompositeMatrix("translate(4px, 2px)", "", "", 800, 600)).to.deep.equal([
            1, 0, 0, 1, 0, 0,
        ]);
        expect(canvasCompositeMatrix("", "", "", 800, 600)).to.deep.equal([1, 0, 0, 1, 0, 0]);
        expect(canvasCompositeMatrix("", "0px", "0px", 800, 600)).to.deep.equal([1, 0, 0, 1, 0, 0]);
    });
});
