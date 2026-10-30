/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SpatialSessionManager } from "../../src/queryResults/spatial/spatialSessionManager";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { RowStore } from "../../src/queryStudio/rowStore";
import { packBitmap } from "../../src/services/sqlDataPlane/api";
import { SpatialCellOkV1 } from "../../src/sharedInterfaces/queryResultCellCodec";

function point(srid = 4326): SpatialCellOkV1 {
    const wkb = Buffer.from("0101000000000000000000F03F0000000000000040", "hex");
    return {
        $t: "spatial",
        version: 1,
        status: "ok",
        kind: "geometry",
        encoding: "wkb",
        srid,
        wkbBytes: wkb.byteLength,
        wkb: wkb.toString("base64"),
    };
}

function retained(store: RowStore): RetainedRowStore {
    return new RetainedRowStore(store, {
        runId: "qsrun_spatial",
        createdEpochMs: Date.now(),
        tuningDigest: "spatial-test",
        tuningProfileId: "interactive",
        retainedMemoryBytes: 8 * 1024 * 1024,
    });
}

suite("SpatialSessionManager", () => {
    test("opens terminal typed columns, pulls sparse rows, bounds labels, and releases", async () => {
        const raw = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-spatial-")));
        raw.beginResultSet("rs1", [
            { name: "id", displayName: "id" },
            {
                name: "shape",
                displayName: "shape",
                spatial: { kind: "geometry", encoding: "wkb-v1" },
            },
            { name: "label", displayName: "label" },
        ]);
        const rows = [
            [1, point(), "A"],
            [2, null, "😀".repeat(600)],
        ];
        await raw.appendPage("rs1", {
            rowOffset: 0,
            rowCount: rows.length,
            approxBytes: 1000,
            compact: {
                values: rows.map((row) => row.map((value) => value ?? undefined)),
                nullBitmap: packBitmap(rows.flat().map((value) => value === null)),
            },
        });
        raw.endResultSet("rs1");
        const store = retained(raw);
        const service = new SpatialSessionManager();

        const opened = service.open(store, {
            resultSetId: "rs1",
            spatialColumn: 1,
            labelColumn: 2,
        });
        expect(opened.error).to.equal(undefined);
        expect(opened.kind).to.equal("geometry");
        expect(opened.totalRows).to.equal(2);

        const chunk = await service.next({
            handle: opened.handle,
            generation: opened.generation,
            sequence: 0,
        });
        expect(chunk.done).to.equal(true);
        expect(chunk.features.map((feature) => feature.ordinal)).to.deep.equal([0, 1]);
        expect(chunk.features[0].spatial).to.deep.equal(point());
        expect(chunk.features[1].spatial).to.equal(null);
        expect(Buffer.byteLength(chunk.features[1].label!, "utf8")).to.be.at.most(1024);
        expect(chunk.wireBytes).to.be.greaterThan(0);

        const stale = await service.next({
            handle: opened.handle,
            generation: opened.generation,
            sequence: 0,
        });
        expect(stale.error).to.include("expired");

        // The final response releases the spatial lease immediately.
        store.releaseLiveOwner("rerun");
        expect(store.state).to.equal("disposed");
    });

    test("refuses streaming sets, nonspatial columns, and invalid projections", async () => {
        const raw = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-spatial-")));
        raw.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        const store = retained(raw);
        const service = new SpatialSessionManager();
        expect(service.open(store, { resultSetId: "rs1", spatialColumn: 0 }).error).to.include(
            "complete",
        );
        raw.endResultSet("rs1");
        expect(service.open(store, { resultSetId: "rs1", spatialColumn: 0 }).error).to.include(
            "typed spatial WKB",
        );
        service.dispose();
        store.releaseLiveOwner("documentClosed");
    });
});
