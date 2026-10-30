/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import {
    SpatialDecodeRequest,
    SpatialDecodeResponse,
} from "../../src/webviews/pages/QueryStudio/spatial/spatialWorkerProtocol";

suite("Spatial decoder production worker", () => {
    test("the bundled decoder counts GeometryCollections and applies both budgets", () => {
        // WKB GeometryCollection(Point(1,2), LineString(50000 points)).
        const header = Buffer.alloc(9);
        header[0] = 1;
        header.writeUInt32LE(7, 1);
        header.writeUInt32LE(2, 5);
        const point = Buffer.alloc(21);
        point[0] = 1;
        point.writeUInt32LE(1, 1);
        point.writeDoubleLE(1, 5);
        point.writeDoubleLE(2, 13);
        const line = Buffer.alloc(9 + 50000 * 16);
        line[0] = 1;
        line.writeUInt32LE(2, 1);
        line.writeUInt32LE(50000, 5);
        for (let i = 0; i < 50000; i++) {
            line.writeDoubleLE(i, 9 + i * 16);
            line.writeDoubleLE(i, 17 + i * 16);
        }
        const wkb = Buffer.concat([header, point, line]);
        const responses: SpatialDecodeResponse[] = [];
        const worker = {
            onmessage: undefined as unknown as (event: { data: SpatialDecodeRequest }) => void,
            postMessage: (response: SpatialDecodeResponse) => responses.push(response),
        };
        vm.runInNewContext(
            fs.readFileSync(
                path.resolve(__dirname, "../../../dist/views/spatialDecodeWorker.js"),
                "utf8",
            ),
            { self: worker, atob, performance, TextDecoder, TextEncoder },
            { timeout: 5000 },
        );
        const request: SpatialDecodeRequest = {
            type: "decode",
            generation: 1,
            sequence: 0,
            remainingVertices: 100000,
            remainingDerivedBytes: 64000000,
            features: [
                {
                    ordinal: 0,
                    spatial: {
                        $t: "spatial",
                        version: 1,
                        status: "ok",
                        kind: "geometry",
                        encoding: "wkb",
                        srid: 0,
                        wkbBytes: wkb.length,
                        wkb: wkb.toString("base64"),
                    },
                },
            ],
        };
        worker.onmessage({ data: request });
        expect(responses[0].decoded).to.equal(1);
        expect(responses[0].vertices).to.equal(50001);
        expect(Array.from(responses[0].features[0].envelope!)).to.deep.equal([0, 0, 49999, 49999]);
        worker.onmessage({ data: { ...request, remainingVertices: 1000 } });
        expect(responses[1].budgetReason).to.equal("vertexBudget");
        expect(responses[1].features).to.be.empty;
        worker.onmessage({ data: { ...request, remainingDerivedBytes: 10000 } });
        expect(responses[2].budgetReason).to.equal("derivedMemoryBudget");
        expect(responses[2].features).to.be.empty;
    });
});
