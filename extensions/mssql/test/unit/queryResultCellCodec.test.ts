/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed vector cell codec (STS2 D-0019, SPEC §7.7): strict structural guards
 * (shape AND arithmetic), little-endian float32 decode round-trips, bounded
 * prefix decode, shortest-round-trip float32 formatting parity with the
 * engine's JSON text, purpose-aware cell text, and column-length dimension
 * derivation. Encoding is done test-locally (independent of the codec) so a
 * decode bug cannot cancel out an encode bug.
 */

import { expect } from "chai";
import {
    SPATIAL_MAX_WKB_BYTES,
    SPATIAL_TYPE_HINT_V1,
    SpatialCellOkV1,
    SpatialCellUnavailableV1,
    VECTOR_MAX_DIMENSIONS,
    VectorCellOkV1,
    VectorCellUnavailableV1,
    base64ByteLength,
    decodeBase64,
    decodeSpatialWkb,
    decodeVectorFloat32,
    decodeVectorPrefix,
    formatFloat32Shortest,
    isVectorCellEncodingV1,
    isVectorCellOkV1,
    isVectorCellUnavailableV1,
    isSpatialCellEncodingV1,
    isSpatialCellOkV1,
    isSpatialCellUnavailableV1,
    spatialCellText,
    typedCellTextForPurpose,
    vectorCellText,
    vectorDimensionsFromColumnLength,
} from "../../src/sharedInterfaces/queryResultCellCodec";

/** Independent little-endian float32 encode (never uses the codec under test). */
function f32leBase64(values: number[]): string {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, /* littleEndian */ true));
    return Buffer.from(bytes).toString("base64");
}

/** Wire-shaped ok cell for the given components (overridable per test). */
function okCell(values: number[], overrides: Record<string, unknown> = {}): VectorCellOkV1 {
    return {
        $t: "vector",
        version: 1,
        status: "ok",
        dimensions: values.length,
        baseType: "float32",
        encoding: "f32le",
        byteLength: values.length * 4,
        data: f32leBase64(values),
        ...overrides,
    } as VectorCellOkV1;
}

function unavailableCell(overrides: Record<string, unknown> = {}): VectorCellUnavailableV1 {
    return {
        $t: "vector",
        version: 1,
        status: "unavailable",
        reason: "cellLimit",
        ...overrides,
    } as VectorCellUnavailableV1;
}

const POINT_WKB_HEX = "0101000000000000000000F03F0000000000000040";
const POINT_ZM_WKB_HEX =
    "01B90B0000000000000000F03F000000000000004000000000000008400000000000001040";

function spatialCell(
    overrides: Record<string, unknown> = {},
    hex = POINT_WKB_HEX,
): SpatialCellOkV1 {
    const bytes = Buffer.from(hex, "hex");
    return {
        $t: "spatial",
        version: 1,
        status: "ok",
        kind: "geometry",
        encoding: "wkb",
        srid: 0,
        wkbBytes: bytes.byteLength,
        wkb: bytes.toString("base64"),
        ...overrides,
    } as SpatialCellOkV1;
}

function unavailableSpatialCell(overrides: Record<string, unknown> = {}): SpatialCellUnavailableV1 {
    return {
        $t: "spatial",
        version: 1,
        status: "unrenderable",
        kind: "geometry",
        reason: "maxCellBytes",
        ...overrides,
    } as SpatialCellUnavailableV1;
}

suite("Query result cell codec (typed vector cells, D-0019)", () => {
    suite("strict guards", () => {
        test("valid ok cell passes all three guards correctly", () => {
            const cell = okCell([1, 2, 3]);
            expect(isVectorCellOkV1(cell)).to.equal(true);
            expect(isVectorCellEncodingV1(cell)).to.equal(true);
            expect(isVectorCellUnavailableV1(cell)).to.equal(false);
        });

        test("engine-maximum dimensions (1998) is accepted", () => {
            expect(VECTOR_MAX_DIMENSIONS).to.equal(1998);
            expect(isVectorCellOkV1(okCell(new Array(1998).fill(0)))).to.equal(true);
        });

        test("wrong version is rejected", () => {
            expect(isVectorCellOkV1(okCell([1], { version: 2 }))).to.equal(false);
            expect(isVectorCellOkV1(okCell([1], { version: "1" }))).to.equal(false);
            expect(isVectorCellUnavailableV1(unavailableCell({ version: 2 }))).to.equal(false);
        });

        test("missing data is rejected", () => {
            expect(isVectorCellOkV1(okCell([1], { data: undefined }))).to.equal(false);
            expect(isVectorCellOkV1(okCell([1], { data: 42 }))).to.equal(false);
        });

        test("byteLength that disagrees with dimensions*4 is rejected", () => {
            expect(isVectorCellOkV1(okCell([1, 2, 3], { byteLength: 8 }))).to.equal(false);
            expect(isVectorCellOkV1(okCell([1, 2, 3], { byteLength: "12" }))).to.equal(false);
        });

        test("base64 whose decoded length disagrees with byteLength is rejected", () => {
            // Data for 2 floats on a 3-dimension cell: shape holds, bytes don't.
            expect(isVectorCellOkV1(okCell([1, 2, 3], { data: f32leBase64([1, 2]) }))).to.equal(
                false,
            );
            // Non-canonical base64 length (not a multiple of 4).
            expect(isVectorCellOkV1(okCell([1], { data: "AAAAA" }))).to.equal(false);
            expect(isVectorCellOkV1(okCell([1], { data: "" }))).to.equal(false);
        });

        test("dimensions 0, above the engine max, or non-integer are rejected", () => {
            expect(
                isVectorCellOkV1(okCell([], { dimensions: 0, byteLength: 0, data: "" })),
            ).to.equal(false);
            const overMax = okCell(new Array(1999).fill(0));
            expect(isVectorCellOkV1(overMax)).to.equal(false);
            // Arithmetic consistent (byteLength = 1.5*4 = 6, data decodes to 6
            // bytes) so ONLY the integer check can reject.
            const fractional = okCell([], {
                dimensions: 1.5,
                byteLength: 6,
                data: Buffer.alloc(6).toString("base64"),
            });
            expect(isVectorCellOkV1(fractional)).to.equal(false);
        });

        test("baseType float16 is rejected on an ok cell (float32-only v1)", () => {
            expect(isVectorCellOkV1(okCell([1], { baseType: "float16" }))).to.equal(false);
            expect(isVectorCellEncodingV1(okCell([1], { baseType: "float16" }))).to.equal(false);
        });

        test("wrong encoding is rejected", () => {
            expect(isVectorCellOkV1(okCell([1], { encoding: "f64le" }))).to.equal(false);
        });

        test("generic {$t, v} scalar wrappers are never vector cells", () => {
            expect(isVectorCellEncodingV1({ $t: "decimal", v: "1.5" })).to.equal(false);
            expect(isVectorCellEncodingV1({ $t: "binary", v: "AQ==" })).to.equal(false);
            // The payload field is `data`, never `v` — a {$t:"vector", v} shape
            // is a scalar wrapper, not the typed encoding.
            expect(isVectorCellEncodingV1({ $t: "vector", v: "[1,2,3]" })).to.equal(false);
        });

        test("truncated markers are never vector cells", () => {
            expect(isVectorCellEncodingV1({ $t: "truncated", of: "string", v: "prefix" })).to.equal(
                false,
            );
        });

        test("null, undefined, strings, and numbers are rejected", () => {
            expect(isVectorCellEncodingV1(null)).to.equal(false);
            expect(isVectorCellEncodingV1(undefined)).to.equal(false);
            expect(isVectorCellEncodingV1("[1,2,3]")).to.equal(false);
            expect(isVectorCellEncodingV1("vector")).to.equal(false);
            expect(isVectorCellEncodingV1(42)).to.equal(false);
        });

        test("unavailable sentinel: minimal and fact-carrying forms pass; malformed ones fail", () => {
            const minimal = unavailableCell();
            expect(isVectorCellUnavailableV1(minimal)).to.equal(true);
            expect(isVectorCellEncodingV1(minimal)).to.equal(true);
            expect(isVectorCellOkV1(minimal)).to.equal(false);

            const withFacts = unavailableCell({ dimensions: 1536, baseType: "float16" });
            expect(isVectorCellUnavailableV1(withFacts)).to.equal(true);

            expect(isVectorCellUnavailableV1(unavailableCell({ reason: undefined }))).to.equal(
                false,
            );
            expect(isVectorCellUnavailableV1(unavailableCell({ dimensions: 1.5 }))).to.equal(false);
            expect(isVectorCellUnavailableV1(unavailableCell({ baseType: 32 }))).to.equal(false);
        });
    });

    suite("decodeVectorFloat32", () => {
        test("round-trips negative, denormal, NaN, and Infinity components exactly", () => {
            const components = [
                0.5,
                -1.25,
                Math.fround(0.1),
                1e-45, // rounds to the smallest positive float32 denormal
                NaN,
                Infinity,
                -Infinity,
                0,
                -0,
                3.4028234663852886e38, // float32 max
            ];
            const decoded = decodeVectorFloat32(okCell(components));
            expect(decoded).to.not.equal(null);
            expect(decoded!.dimensions).to.equal(components.length);
            expect(decoded!.values).to.have.length(components.length);
            for (let i = 0; i < components.length; i++) {
                const expected = Math.fround(components[i]);
                if (Number.isNaN(expected)) {
                    expect(Number.isNaN(decoded!.values[i]), `component ${i}`).to.equal(true);
                } else {
                    // Object.is distinguishes -0 from 0 (exact bit-level parity).
                    expect(Object.is(decoded!.values[i], expected), `component ${i}`).to.equal(
                        true,
                    );
                }
            }
        });

        test("rejects values that fail the structural guard (defense in depth)", () => {
            expect(decodeVectorFloat32(null)).to.equal(null);
            expect(decodeVectorFloat32("[1,2,3]")).to.equal(null);
            expect(decodeVectorFloat32(okCell([1], { version: 2 }))).to.equal(null);
            expect(decodeVectorFloat32(unavailableCell())).to.equal(null);
        });

        test("rejects malformed base64 that passes the length pre-check", () => {
            // 8 chars with two '=' → claimed 4 bytes, but '!' is not in the
            // alphabet: guard passes on arithmetic, decode must return null.
            const cell = okCell([1], { data: "!!!!!A==" });
            expect(isVectorCellOkV1(cell)).to.equal(true);
            expect(decodeVectorFloat32(cell)).to.equal(null);
        });
    });

    suite("decodeVectorPrefix", () => {
        const cell8 = okCell([1, 2, 3, 4, 5, 6, 7, 8]);

        test("fewer components than dimensions decodes only the prefix", () => {
            expect(decodeVectorPrefix(cell8, 3)).to.deep.equal([1, 2, 3]);
            expect(decodeVectorPrefix(cell8, 5)).to.deep.equal([1, 2, 3, 4, 5]);
        });

        test("more components than dimensions clamps to the full vector", () => {
            expect(decodeVectorPrefix(okCell([1, 2, 3]), 10)).to.deep.equal([1, 2, 3]);
            expect(decodeVectorPrefix(cell8, 8)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
        });

        test("partial base64 quantum re-pads correctly (non-multiple-of-3 byte prefix)", () => {
            expect(decodeVectorPrefix(okCell([1.5, -2.5]), 1)).to.deep.equal([1.5]);
        });

        test("zero components yields an empty prefix, not a decode failure", () => {
            expect(decodeVectorPrefix(cell8, 0)).to.deep.equal([]);
        });

        test("negative bound and non-cells return null", () => {
            expect(decodeVectorPrefix(cell8, -1)).to.equal(null);
            expect(decodeVectorPrefix("[1,2]", 4)).to.equal(null);
            expect(decodeVectorPrefix(unavailableCell(), 4)).to.equal(null);
        });
    });

    suite("formatFloat32Shortest", () => {
        test("shortest decimal parity for common fractions", () => {
            expect(formatFloat32Shortest(Math.fround(0.1))).to.equal("0.1");
            expect(formatFloat32Shortest(1.5)).to.equal("1.5");
            expect(formatFloat32Shortest(Math.fround(0.3))).to.equal("0.3");
            expect(formatFloat32Shortest(1)).to.equal("1");
            expect(formatFloat32Shortest(-2.5)).to.equal("-2.5");
        });

        test("zero keeps its sign", () => {
            expect(formatFloat32Shortest(0)).to.equal("0");
            expect(formatFloat32Shortest(-0)).to.equal("-0");
        });

        test("non-finite values render as visible tokens", () => {
            expect(formatFloat32Shortest(NaN)).to.equal("NaN");
            expect(formatFloat32Shortest(Infinity)).to.equal("Infinity");
            expect(formatFloat32Shortest(-Infinity)).to.equal("-Infinity");
        });

        test("Math.fround round-trip property over sampled float32 bit patterns", () => {
            // Deterministic xorshift32: random 32-bit patterns reinterpreted as
            // float32 cover denormals, extremes, and both signs.
            let seed = 0x2f6e2b19;
            const nextUint = () => {
                seed ^= seed << 13;
                seed >>>= 0;
                seed ^= seed >>> 17;
                seed ^= seed << 5;
                seed >>>= 0;
                return seed;
            };
            const view = new DataView(new ArrayBuffer(4));
            const samples: number[] = [
                Math.fround(1 / 3),
                2 ** -149, // smallest denormal
                2 ** -126, // smallest normal
                1.1754943508222875e-38,
                3.4028234663852886e38, // float32 max
                65504,
                Math.fround(3.14159265),
                Math.fround(123456789),
            ];
            for (let i = 0; i < 256; i++) {
                view.setUint32(0, nextUint());
                const value = view.getFloat32(0);
                if (Number.isFinite(value)) {
                    samples.push(value);
                }
            }
            for (const value of samples) {
                const text = formatFloat32Shortest(value);
                expect(
                    Object.is(Math.fround(Number(text)), value),
                    `${value} → "${text}" must round-trip through fround`,
                ).to.equal(true);
            }
        });
    });

    suite("vectorCellText per purpose", () => {
        const cell6 = okCell([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);

        test("gridPreview is bounded to 4 components with the dimension/baseType suffix", () => {
            expect(vectorCellText(cell6, "gridPreview")).to.equal(
                "[0.1, 0.2, 0.3, 0.4, …] · 6D float32",
            );
        });

        test("gridPreview shows the whole vector without ellipsis at ≤4 dimensions", () => {
            expect(vectorCellText(okCell([1, -2.5, 3]), "gridPreview")).to.equal(
                "[1, -2.5, 3] · 3D float32",
            );
        });

        test("copy and cellDocument carry the FULL array (engine JSON parity)", () => {
            const full = "[0.1,0.2,0.3,0.4,0.5,0.6]";
            expect(vectorCellText(cell6, "copy")).to.equal(full);
            expect(vectorCellText(cell6, "cellDocument")).to.equal(full);
            expect(vectorCellText(cell6, "textView")).to.equal(full);
            expect(vectorCellText(cell6, "csvExport")).to.equal(full);
            expect(vectorCellText(cell6, "jsonExport")).to.equal(full);
        });

        test("insertExport produces the CAST shape", () => {
            expect(vectorCellText(cell6, "insertExport")).to.equal(
                "CAST('[0.1,0.2,0.3,0.4,0.5,0.6]' AS VECTOR(6))",
            );
        });

        test("toolSummary is compact", () => {
            expect(vectorCellText(cell6, "toolSummary")).to.equal("VECTOR(6) float32");
        });

        test("non-finite components render as honest tokens in full text", () => {
            expect(vectorCellText(okCell([NaN, Infinity]), "copy")).to.equal("[NaN,Infinity]");
        });

        test("unavailable sentinel: empty for copy/csv/json, visible sentinel elsewhere", () => {
            const cell = unavailableCell({
                reason: "providerValueMismatch",
                dimensions: 1536,
                baseType: "float16",
            });
            expect(vectorCellText(cell, "copy")).to.equal("");
            expect(vectorCellText(cell, "csvExport")).to.equal("");
            expect(vectorCellText(cell, "jsonExport")).to.equal("");
            const sentinel = "<vector unavailable: 1536D float16, providerValueMismatch>";
            expect(vectorCellText(cell, "gridPreview")).to.equal(sentinel);
            expect(vectorCellText(cell, "cellDocument")).to.equal(sentinel);
            expect(vectorCellText(cell, "textView")).to.equal(sentinel);
            expect(vectorCellText(cell, "toolSummary")).to.equal(sentinel);
        });

        test("unavailable sentinel without facts shows the reason alone", () => {
            expect(
                vectorCellText(unavailableCell({ reason: "decodeFailed" }), "gridPreview"),
            ).to.equal("<vector unavailable: decodeFailed>");
        });
    });

    suite("typedCellTextForPurpose chokepoint", () => {
        test("routes typed vector cells and returns null for everything else", () => {
            expect(typedCellTextForPurpose(okCell([1]), "toolSummary")).to.equal(
                "VECTOR(1) float32",
            );
            expect(typedCellTextForPurpose(unavailableCell(), "copy")).to.equal("");
            expect(typedCellTextForPurpose({ $t: "decimal", v: "1.5" }, "copy")).to.equal(null);
            expect(typedCellTextForPurpose("plain text", "copy")).to.equal(null);
            expect(typedCellTextForPurpose(null, "copy")).to.equal(null);
        });
    });

    suite("vectorDimensionsFromColumnLength", () => {
        test("derives dimensions from wire length (length = 8 + 4*dims)", () => {
            expect(vectorDimensionsFromColumnLength(20)).to.equal(3);
            expect(vectorDimensionsFromColumnLength(12)).to.equal(1);
            expect(vectorDimensionsFromColumnLength(8 + 4 * 1536)).to.equal(1536);
            expect(vectorDimensionsFromColumnLength(8 + 4 * 1998)).to.equal(1998);
        });

        test("rejects headers-only, misaligned, absent, and over-max lengths", () => {
            expect(vectorDimensionsFromColumnLength(8)).to.equal(undefined);
            expect(vectorDimensionsFromColumnLength(9)).to.equal(undefined);
            expect(vectorDimensionsFromColumnLength(21)).to.equal(undefined);
            expect(vectorDimensionsFromColumnLength(undefined)).to.equal(undefined);
            expect(vectorDimensionsFromColumnLength(0)).to.equal(undefined);
            expect(vectorDimensionsFromColumnLength(8 + 4 * 1999)).to.equal(undefined);
        });
    });

    suite("base64 helpers", () => {
        test("base64ByteLength: exact byte counts for canonical input, -1 otherwise", () => {
            expect(base64ByteLength("AAAA")).to.equal(3);
            expect(base64ByteLength("AAA=")).to.equal(2);
            expect(base64ByteLength("AA==")).to.equal(1);
            expect(base64ByteLength("")).to.equal(-1);
            expect(base64ByteLength("AAA")).to.equal(-1);
        });

        test("decodeBase64: round-trips bytes and rejects malformed input", () => {
            expect(Array.from(decodeBase64("3q2+7w==") ?? [])).to.deep.equal([
                0xde, 0xad, 0xbe, 0xef,
            ]);
            expect(decodeBase64("!!!!")).to.equal(null);
            expect(decodeBase64("AA")).to.equal(null);
        });
    });
});

suite("Query result cell codec (typed spatial cells, D-0020)", () => {
    test("exports the lockstep spatial type hint and pinned WKB ceiling", () => {
        expect(SPATIAL_TYPE_HINT_V1).to.equal("spatial:wkb:v1");
        expect(SPATIAL_MAX_WKB_BYTES).to.equal(1024 * 1024);
    });

    test("strict success guard accepts complete XY and ISO ZM WKB", () => {
        expect(isSpatialCellOkV1(spatialCell())).to.equal(true);
        expect(isSpatialCellEncodingV1(spatialCell())).to.equal(true);
        expect(isSpatialCellOkV1(spatialCell({}, POINT_ZM_WKB_HEX))).to.equal(true);
    });

    test("strict success guard rejects collision, malformed base64, size, SRID and version", () => {
        expect(isSpatialCellEncodingV1({ $t: "spatial", v: "AAAA" })).to.equal(false);
        expect(isSpatialCellOkV1(spatialCell({ version: 2 }))).to.equal(false);
        expect(isSpatialCellOkV1(spatialCell({ srid: 1.5 }))).to.equal(false);
        expect(isSpatialCellOkV1(spatialCell({ wkb: "!!!!" }))).to.equal(false);
        expect(isSpatialCellOkV1(spatialCell({ wkbBytes: 20 }))).to.equal(false);
        expect(
            isSpatialCellOkV1(
                spatialCell({
                    wkbBytes: SPATIAL_MAX_WKB_BYTES + 1,
                    wkb: Buffer.alloc(SPATIAL_MAX_WKB_BYTES + 1).toString("base64"),
                }),
            ),
        ).to.equal(false);
    });

    test("unavailable guard validates reason, digest, bytes and optional SRID", () => {
        const valid = unavailableSpatialCell({
            kind: "geography",
            srid: 4326,
            sourceBytes: 2_000_000,
            sourceDigest: `sha256:${"a".repeat(64)}`,
        });
        expect(isSpatialCellUnavailableV1(valid)).to.equal(true);
        expect(isSpatialCellEncodingV1(valid)).to.equal(true);
        expect(
            isSpatialCellUnavailableV1(unavailableSpatialCell({ reason: "vertexBudget" })),
        ).to.equal(false);
        expect(isSpatialCellUnavailableV1(unavailableSpatialCell({ sourceBytes: -1 }))).to.equal(
            false,
        );
        expect(
            isSpatialCellUnavailableV1(unavailableSpatialCell({ sourceDigest: "sha256:xyz" })),
        ).to.equal(false);
    });

    test("decode returns complete bytes and preserves ISO ZM payload", () => {
        const decoded = decodeSpatialWkb(
            spatialCell({ kind: "geography", srid: 4326 }, POINT_ZM_WKB_HEX),
        );
        expect(decoded).to.not.equal(null);
        expect(decoded!.kind).to.equal("geography");
        expect(decoded!.srid).to.equal(4326);
        expect(Buffer.from(decoded!.bytes).toString("hex").toUpperCase()).to.equal(
            POINT_ZM_WKB_HEX,
        );
        expect(decodeSpatialWkb(unavailableSpatialCell())).to.equal(null);
    });

    test("purpose formatting never exposes base64 or raw tagged JSON", () => {
        const cell = spatialCell({ kind: "geography", srid: 4326 });
        expect(spatialCellText(cell, "gridPreview")).to.equal(
            "GEOGRAPHY · SRID 4326 · 21 WKB bytes",
        );
        expect(spatialCellText(cell, "toolSummary")).to.equal(
            "GEOGRAPHY · SRID 4326 · 21 WKB bytes",
        );
        expect(spatialCellText(cell, "copy")).to.equal(`0x${POINT_WKB_HEX}`);
        expect(spatialCellText(cell, "cellDocument")).to.equal(`0x${POINT_WKB_HEX}`);
        expect(spatialCellText(cell, "csvExport")).to.equal(`0x${POINT_WKB_HEX}`);
        expect(spatialCellText(cell, "jsonExport")).to.equal(`0x${POINT_WKB_HEX}`);
        expect(spatialCellText(cell, "insertExport")).to.equal(
            `geography::STGeomFromWKB(0x${POINT_WKB_HEX}, 4326)`,
        );
        for (const purpose of ["gridPreview", "copy", "cellDocument"] as const) {
            const text = spatialCellText(cell, purpose);
            expect(text).to.not.include(cell.wkb);
            expect(text).to.not.include('"$t"');
            expect(text).to.not.include("[object Object]");
        }
    });

    test("unavailable values remain honest in text and valid SQL in INSERT export", () => {
        const cell = unavailableSpatialCell({ sourceBytes: 2_000_000, srid: 0 });
        expect(spatialCellText(cell, "copy")).to.equal(
            "<spatial unavailable: GEOMETRY, SRID 0, 2000000 source bytes, maxCellBytes>",
        );
        expect(spatialCellText(cell, "insertExport")).to.equal("NULL");
    });

    test("typed chokepoint routes spatial cells without changing scalar behavior", () => {
        expect(typedCellTextForPurpose(spatialCell(), "copy")).to.equal(`0x${POINT_WKB_HEX}`);
        expect(typedCellTextForPurpose({ $t: "spatial", v: "AAAA" }, "copy")).to.equal(null);
        expect(typedCellTextForPurpose("plain", "copy")).to.equal(null);
    });
});
