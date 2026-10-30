/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { get as getProjection } from "ol/proj.js";
import {
    createSpatialBasemapTileLayer,
    disposeSpatialBasemapTileLayer,
} from "../../src/webviews/pages/QueryStudio/spatial/spatialBasemapOlAdapter";
import type ImageTile from "ol/ImageTile.js";

suite("spatial basemap OpenLayers adapter", () => {
    test("wrapped worlds request canonical X coordinates and images allow canvas export", async () => {
        const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
        Object.defineProperty(globalThis, "Image", {
            configurable: true,
            value: class {
                crossOrigin: string;
                src: string;
            },
        });
        const request = sinon
            .stub()
            .resolves({ status: "ready", localUri: "https://local-resource.example/tile.png" });
        const layer = createSpatialBasemapTileLayer(
            request,
            { handle: "test", generation: 1, minZoom: 0, maxZoom: 5 },
            { onFirstTile: () => undefined },
        );
        try {
            const source = layer.getSource()!;
            for (const [x, normalized] of [
                [-1, 3],
                [4, 0],
                [9, 1],
            ]) {
                const tile = source.getTile(2, x, 1, 1, getProjection("EPSG:3857")!) as ImageTile;
                source.getTileLoadFunction()(tile, "local://2/ignored/1");
                await new Promise<void>((resolve) => setImmediate(resolve));
                expect(request.lastCall.args[0]).to.deep.equal({ z: 2, x: normalized, y: 1 });
                expect((tile.getImage() as HTMLImageElement).crossOrigin).to.equal("anonymous");
                expect((tile.getImage() as HTMLImageElement).src).to.equal(
                    "https://local-resource.example/tile.png",
                );
            }
        } finally {
            disposeSpatialBasemapTileLayer(layer);
            if (originalImage) Object.defineProperty(globalThis, "Image", originalImage);
            else Reflect.deleteProperty(globalThis, "Image");
        }
    });
});
