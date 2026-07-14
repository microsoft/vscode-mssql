/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-10/11: vector + spatial transcoders. Spatial fixtures include the
 * EXACT bytes captured from live SQL Server 2025 (probe 2026-07-14) with the
 * server's own STAsBinary() as the expected WKB; crafted buffers cover
 * polygon/multi/Z/M/curves/malformed. Vector fixtures pin the observed
 * scientific-notation text format and the §6.8 no-guessing rule.
 */

import { expect } from "chai";
import { transcodeSpatial } from "../../../src/services/tsNative/spatialTranscoder";
import { transcodeVectorText } from "../../../src/services/tsNative/vectorTranscoder";

// ---------------------------------------------------------------------------
// Live-captured fixtures (SQL Server 2025, SRID 4326)
// ---------------------------------------------------------------------------

/** geometry::STGeomFromText('POINT(1 2)', 4326) — raw CLR payload. */
const GEOMETRY_POINT_CLR = Buffer.from("e6100000010c000000000000f03f0000000000000040", "hex");
/** ...and its server-side STAsBinary() (the golden WKB). */
const GEOMETRY_POINT_WKB = Buffer.from("0101000000000000000000f03f0000000000000040", "hex");

/** geography::STGeomFromText('LINESTRING(-122.36 47.65, -122.34 47.60)', 4326)
 *  — first 30 bytes captured verbatim; final double (-122.34) computed (the
 *  probe's hex display truncated at 30 bytes; total payload is 38). */
const GEOGRAPHY_LINE_CLR = (() => {
    const head = Buffer.from("e610000001143333333333d34740d7a3703d0a975ec0cdcccccccccc4740", "hex");
    const tail = Buffer.allocUnsafe(8);
    tail.writeDoubleLE(-122.34, 0);
    return Buffer.concat([head, tail]);
})();

// ---------------------------------------------------------------------------
// Crafted CLR builders (v1 layout)
// ---------------------------------------------------------------------------

function clr(options: {
    srid?: number;
    version?: number;
    flags: number;
    doubles?: number[];
    points?: [number, number][];
    zs?: number[];
    ms?: number[];
    figures?: [number, number][];
    shapes?: [number, number, number][];
    trailing?: Buffer;
}): Buffer {
    const chunks: Buffer[] = [];
    const srid = Buffer.allocUnsafe(4);
    srid.writeInt32LE(options.srid ?? 4326, 0);
    chunks.push(srid, Buffer.from([options.version ?? 1, options.flags]));
    const pushDouble = (value: number) => {
        const b = Buffer.allocUnsafe(8);
        b.writeDoubleLE(value, 0);
        chunks.push(b);
    };
    const pushUint32 = (value: number) => {
        const b = Buffer.allocUnsafe(4);
        b.writeUInt32LE(value, 0);
        chunks.push(b);
    };
    const pushInt32 = (value: number) => {
        const b = Buffer.allocUnsafe(4);
        b.writeInt32LE(value, 0);
        chunks.push(b);
    };
    for (const d of options.doubles ?? []) {
        pushDouble(d);
    }
    if (options.points) {
        pushUint32(options.points.length);
        for (const [x, y] of options.points) {
            pushDouble(x);
            pushDouble(y);
        }
        for (const z of options.zs ?? []) {
            pushDouble(z);
        }
        for (const m of options.ms ?? []) {
            pushDouble(m);
        }
        pushUint32(options.figures?.length ?? 0);
        for (const [attribute, pointOffset] of options.figures ?? []) {
            chunks.push(Buffer.from([attribute]));
            pushInt32(pointOffset);
        }
        pushUint32(options.shapes?.length ?? 0);
        for (const [parentOffset, figureOffset, type] of options.shapes ?? []) {
            pushInt32(parentOffset);
            pushInt32(figureOffset);
            chunks.push(Buffer.from([type]));
        }
    }
    if (options.trailing) {
        chunks.push(options.trailing);
    }
    return Buffer.concat(chunks);
}

function wkbType(buffer: Buffer): number {
    expect(buffer.readUInt8(0)).to.equal(1, "little-endian marker");
    return buffer.readUInt32LE(1);
}

suite("ts-native spatial transcoder (TSQ2-11)", () => {
    test("live geometry POINT: transcoded WKB is byte-identical to STAsBinary()", () => {
        const result = transcodeSpatial(GEOMETRY_POINT_CLR, "geometry");
        expect(result.status).to.equal("ok");
        if (result.status === "ok") {
            expect(result.srid).to.equal(4326);
            expect(result.wkb.equals(GEOMETRY_POINT_WKB)).to.equal(
                true,
                `expected ${GEOMETRY_POINT_WKB.toString("hex")}, got ${result.wkb.toString("hex")}`,
            );
        }
    });

    test("live geography LINESTRING: lat/long storage order swaps to WKB x=long", () => {
        const result = transcodeSpatial(GEOGRAPHY_LINE_CLR, "geography");
        expect(result.status).to.equal("ok");
        if (result.status === "ok") {
            expect(wkbType(result.wkb)).to.equal(2); // LineString
            expect(result.wkb.readUInt32LE(5)).to.equal(2); // 2 points
            // First point x = longitude -122.36, y = latitude 47.65
            expect(result.wkb.readDoubleLE(9)).to.be.closeTo(-122.36, 1e-9);
            expect(result.wkb.readDoubleLE(17)).to.be.closeTo(47.65, 1e-9);
        }
    });

    test("polygon with interior ring: rings and point counts survive", () => {
        const payload = clr({
            flags: 0x04, // valid, no Z/M, not single
            points: [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 0],
                [2, 2],
                [3, 2],
                [3, 3],
                [2, 2],
            ],
            figures: [
                [2, 0], // exterior ring at point 0
                [0, 4], // interior ring at point 4
            ],
            shapes: [[-1, 0, 3]], // polygon
        });
        const result = transcodeSpatial(payload, "geometry");
        expect(result.status).to.equal("ok");
        if (result.status === "ok") {
            expect(wkbType(result.wkb)).to.equal(3);
            expect(result.wkb.readUInt32LE(5)).to.equal(2, "two rings");
            expect(result.wkb.readUInt32LE(9)).to.equal(4, "exterior points");
        }
    });

    test("Z/M point: ISO type offsets and coordinate emission", () => {
        const payload = clr({
            flags: 0x04 | 0x01 | 0x02 | 0x08, // valid + Z + M + single point
            doubles: [1, 2, 30, 40], // x, y, z, m
        });
        const result = transcodeSpatial(payload, "geometry");
        expect(result.status).to.equal("ok");
        if (result.status === "ok") {
            expect(wkbType(result.wkb)).to.equal(3001); // Point ZM
            expect(result.wkb.readDoubleLE(5 + 16)).to.equal(30);
            expect(result.wkb.readDoubleLE(5 + 24)).to.equal(40);
        }
    });

    test("multipoint collection: child shapes nest", () => {
        const payload = clr({
            flags: 0x04,
            points: [
                [1, 1],
                [2, 2],
            ],
            figures: [
                [1, 0],
                [1, 1],
            ],
            shapes: [
                [-1, 0, 4], // multipoint root
                [0, 0, 1], // point child
                [0, 1, 1], // point child
            ],
        });
        const result = transcodeSpatial(payload, "geometry");
        expect(result.status).to.equal("ok");
        if (result.status === "ok") {
            expect(wkbType(result.wkb)).to.equal(4);
            expect(result.wkb.readUInt32LE(5)).to.equal(2, "two child points");
        }
    });

    test("curves (v2 segments) are unrenderable, never a wrong shape", () => {
        const payload = clr({
            version: 2,
            flags: 0x04,
            points: [
                [0, 0],
                [1, 1],
                [2, 0],
            ],
            figures: [[1, 0]],
            shapes: [[-1, 0, 8]], // CircularString
            trailing: Buffer.from([0x01, 0x02]), // segment table fragment
        });
        const result = transcodeSpatial(payload, "geometry");
        expect(result.status).to.equal("unrenderable");
        if (result.status === "unrenderable") {
            expect(result.reason).to.equal("unsupportedNativeValue");
        }
    });

    test("malformed/truncated buffers are conversionFailed, bounded counts enforced", () => {
        expect(transcodeSpatial(Buffer.from([1, 2, 3]), "geometry").status).to.equal(
            "unrenderable",
        );
        const truncated = GEOMETRY_POINT_CLR.subarray(0, 10);
        expect(transcodeSpatial(truncated, "geometry").status).to.equal("unrenderable");
        // implausible point count vs buffer size
        const bomb = clr({ flags: 0x04, points: [] });
        const patched = Buffer.from(bomb);
        patched.writeUInt32LE(0x7fffffff, 6); // pointCount field
        expect(transcodeSpatial(patched, "geometry").status).to.equal("unrenderable");
    });
});

suite("ts-native vector transcoder (TSQ2-10)", () => {
    test("live scientific-notation text parses to exact f32le", () => {
        // Exact text observed from SQL Server 2025 via tedious (probe).
        const result = transcodeVectorText("[1.5000000e+000,2.5000000e+000,3.5000000e+000]");
        expect(result.status).to.equal("ok");
        if (result.status === "ok") {
            expect(result.dimensions).to.equal(3);
            expect(result.data.readFloatLE(0)).to.equal(1.5);
            expect(result.data.readFloatLE(4)).to.equal(2.5);
            expect(result.data.readFloatLE(8)).to.equal(3.5);
        }
    });

    test("malformed inputs are unavailable, never guessed", () => {
        for (const bad of ["", "1,2,3", "[]", "[1,abc]", "[1;2]", "{1,2}"]) {
            const result = transcodeVectorText(bad);
            expect(result.status).to.equal("unavailable", JSON.stringify(bad));
        }
    });

    test("dimension bound enforced (cellLimit)", () => {
        const huge = `[${new Array(2000).fill("1").join(",")}]`;
        const result = transcodeVectorText(huge);
        expect(result.status).to.equal("unavailable");
        if (result.status === "unavailable") {
            expect(result.reason).to.equal("cellLimit");
        }
    });
});
