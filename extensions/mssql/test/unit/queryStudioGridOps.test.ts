/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure grid client ops (classic in-memory sort/filter parity): comparator
 * NULL/numeric/string ordering, filter+sort composition over original row
 * indices, distinct-values capping, and display clamping boundaries.
 */

import { expect } from "chai";
import {
    QS_CELL_DISPLAY_CLAMP,
    QS_CELL_DOCUMENT_PARSE_LIMIT,
    QS_DISTINCT_VALUES_CAP,
    applyFilterSort,
    cellDocumentLanguage,
    cellDisplayText,
    cellTextForPurpose,
    clampDisplay,
    compareCells,
    distinctValues,
} from "../../src/sharedInterfaces/queryStudioGridOps";
import {
    VECTOR_TYPE_HINT_V1,
    VectorCellOkV1,
} from "../../src/sharedInterfaces/queryResultCellCodec";

/** Wire-shaped typed vector ok-cell (D-0019) encoded test-locally. */
function vectorCell(values: number[]): VectorCellOkV1 {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, /* littleEndian */ true));
    return {
        $t: "vector",
        version: 1,
        status: "ok",
        dimensions: values.length,
        baseType: "float32",
        encoding: "f32le",
        byteLength: values.length * 4,
        data: Buffer.from(bytes).toString("base64"),
    };
}

suite("Query Studio grid client ops", () => {
    suite("compareCells", () => {
        test("numbers compare numerically under the numeric hint", () => {
            expect(compareCells(9, 10, true)).to.be.lessThan(0);
            expect(compareCells(10, 9, true)).to.be.greaterThan(0);
            expect(compareCells(7, 7, true)).to.equal(0);
        });

        test("numeric strings compare numerically under the numeric hint", () => {
            expect(compareCells("9", "10", true)).to.be.lessThan(0);
            expect(compareCells("-2", "1", true)).to.be.lessThan(0);
        });

        test("strings compare case-insensitively without the hint", () => {
            expect(compareCells("apple", "Banana", false)).to.be.lessThan(0);
            expect(compareCells("ABC", "abc", false)).to.equal(0);
            expect(compareCells("10", "9", false)).to.be.lessThan(0); // lexicographic
        });

        test("NULLs sort first ascending (SQL Server semantics)", () => {
            expect(compareCells(null, "a", false)).to.be.lessThan(0);
            expect(compareCells("a", null, false)).to.be.greaterThan(0);
            expect(compareCells(null, undefined, false)).to.equal(0);
            expect(compareCells(null, -5, true)).to.be.lessThan(0);
        });

        test("unparseable values in a numeric column fall back to string order", () => {
            // "abc" is NaN — compares as text against "5" ("5" < "abc").
            expect(compareCells("abc", 5, true)).to.be.greaterThan(0);
            expect(compareCells(5, "abc", true)).to.be.lessThan(0);
        });
    });

    suite("applyFilterSort", () => {
        const rows = [
            ["b", 2],
            [null, 10],
            ["A", 9],
            ["b", 1],
        ];

        test("sort asc puts NULLs first; desc puts them last", () => {
            expect(applyFilterSort(rows, { column: 0, direction: "asc" }, [])).to.deep.equal([
                1, 2, 0, 3,
            ]);
            expect(applyFilterSort(rows, { column: 0, direction: "desc" }, [])).to.deep.equal([
                0, 3, 2, 1,
            ]);
        });

        test("numeric hint sorts 9 before 10; without it lexicographic", () => {
            expect(
                applyFilterSort(rows, { column: 1, direction: "asc" }, [], [undefined, "number"]),
            ).to.deep.equal([3, 0, 2, 1]); // 1, 2, 9, 10
            expect(applyFilterSort(rows, { column: 1, direction: "asc" }, [])).to.deep.equal([
                3, 1, 0, 2,
            ]); // "1", "10", "2", "9"
        });

        test("ties keep original order (stable) in both directions", () => {
            const tied = [["x"], ["X"], ["x"]];
            expect(applyFilterSort(tied, { column: 0, direction: "asc" }, [])).to.deep.equal([
                0, 1, 2,
            ]);
            expect(applyFilterSort(tied, { column: 0, direction: "desc" }, [])).to.deep.equal([
                0, 1, 2,
            ]);
        });

        test("contains filter is case-insensitive over display text", () => {
            expect(applyFilterSort(rows, undefined, [{ column: 0, contains: "B" }])).to.deep.equal([
                0, 3,
            ]);
        });

        test("values filter matches display text including NULL", () => {
            expect(
                applyFilterSort(rows, undefined, [{ column: 0, values: ["NULL", "A"] }]),
            ).to.deep.equal([1, 2]);
        });

        test("filter + sort compose and return ORIGINAL row indices", () => {
            expect(
                applyFilterSort(
                    rows,
                    { column: 1, direction: "desc" },
                    [{ column: 0, contains: "b" }],
                    [undefined, "number"],
                ),
            ).to.deep.equal([0, 3]); // "b" rows only, values 2 then 1
        });

        test("multiple column filters AND together", () => {
            expect(
                applyFilterSort(rows, undefined, [
                    { column: 0, contains: "b" },
                    { column: 1, values: ["1"] },
                ]),
            ).to.deep.equal([3]);
        });

        test("no sort and no filters returns identity order", () => {
            expect(applyFilterSort(rows, undefined, [])).to.deep.equal([0, 1, 2, 3]);
        });
    });

    suite("distinctValues", () => {
        test("dedupes, sorts case-insensitively, and includes NULL display text", () => {
            const rows = [["b"], [null], ["a"], ["b"], ["B"]];
            expect(distinctValues(rows, 0)).to.deep.equal({
                values: ["a", "b", "B", "NULL"],
                hasMore: false,
            });
        });

        test("caps at the limit and reports more", () => {
            const rows = Array.from({ length: 30 }, (_v, i) => [`v${String(i).padStart(2, "0")}`]);
            const capped = distinctValues(rows, 0, 10);
            expect(capped.values).to.have.length(10);
            expect(capped.hasMore).to.equal(true);
            expect(distinctValues(rows, 0, 30).hasMore).to.equal(false);
        });

        test("default cap is 200", () => {
            const rows = Array.from({ length: QS_DISTINCT_VALUES_CAP + 50 }, (_v, i) => [i]);
            const result = distinctValues(rows, 0);
            expect(result.values).to.have.length(QS_DISTINCT_VALUES_CAP);
            expect(result.hasMore).to.equal(true);
        });
    });

    suite("clampDisplay", () => {
        test("returns text unchanged at or below the limit", () => {
            expect(clampDisplay("abc", 3)).to.equal("abc");
            expect(clampDisplay("", 5)).to.equal("");
        });

        test("clamps above the limit with a trailing ellipsis", () => {
            expect(clampDisplay("abcdef", 3)).to.equal("abc…");
            const huge = "x".repeat(QS_CELL_DISPLAY_CLAMP + 5);
            const clamped = clampDisplay(huge, QS_CELL_DISPLAY_CLAMP);
            expect(clamped).to.have.length(QS_CELL_DISPLAY_CLAMP + 1);
            expect(clamped.endsWith("…")).to.equal(true);
        });

        test("boundary: exactly the limit is not clamped", () => {
            const exact = "y".repeat(QS_CELL_DISPLAY_CLAMP);
            expect(clampDisplay(exact, QS_CELL_DISPLAY_CLAMP)).to.equal(exact);
        });
    });

    suite("cellDisplayText", () => {
        test("NULL for null/undefined; JSON for objects; String otherwise", () => {
            expect(cellDisplayText(null)).to.equal("NULL");
            expect(cellDisplayText(undefined)).to.equal("NULL");
            expect(cellDisplayText({ a: 1 })).to.equal('{"a":1}');
            expect(cellDisplayText(42)).to.equal("42");
        });

        test("bit columns render 0/1 (SSMS parity), not true/false", () => {
            expect(cellDisplayText(true)).to.equal("1");
            expect(cellDisplayText(false)).to.equal("0");
        });

        test("datetime2 wrapper renders SSMS-style, trimming fraction to a 3-digit floor", () => {
            expect(cellDisplayText({ $t: "datetime2", v: "2003-04-08T09:13:36.3900000" })).to.equal(
                "2003-04-08 09:13:36.390",
            );
            expect(cellDisplayText({ $t: "datetime2", v: "2003-04-08T09:13:36.1234567" })).to.equal(
                "2003-04-08 09:13:36.1234567",
            );
            expect(cellDisplayText({ $t: "datetime2", v: "2003-04-08T09:13:36.0000000" })).to.equal(
                "2003-04-08 09:13:36.000",
            );
            expect(cellDisplayText({ $t: "datetime2", v: "2003-04-08T09:13:36" })).to.equal(
                "2003-04-08 09:13:36",
            );
        });

        test("datetimeoffset wrapper keeps its offset", () => {
            expect(
                cellDisplayText({ $t: "datetimeoffset", v: "2003-04-08T09:13:36.3900000+02:00" }),
            ).to.equal("2003-04-08 09:13:36.390 +02:00");
        });

        test("binary wrapper renders 0x-hex from base64", () => {
            expect(cellDisplayText({ $t: "binary", v: "AQ==" })).to.equal("0x01");
            expect(cellDisplayText({ $t: "binary", v: "AAEC" })).to.equal("0x000102");
            expect(cellDisplayText({ $t: "binary", v: "" })).to.equal("0x");
        });

        test("oversized binary elides past the display cap", () => {
            // 300 bytes of zeros → 400 base64 chars; cap is 256 bytes.
            const big = "A".repeat(400);
            const text = cellDisplayText({ $t: "binary", v: big });
            expect(text.startsWith("0x")).to.equal(true);
            expect(text.endsWith("…")).to.equal(true);
            expect(text).to.have.length(2 + 256 * 2 + 1);
        });

        test("decimal/guid/time/double/provider wrappers render their invariant text", () => {
            expect(cellDisplayText({ $t: "decimal", v: "123.4500" })).to.equal("123.4500");
            expect(
                cellDisplayText({ $t: "guid", v: "0e984725-c51c-4bf4-9960-e1c80e27aba0" }),
            ).to.equal("0e984725-c51c-4bf4-9960-e1c80e27aba0");
            expect(cellDisplayText({ $t: "time", v: "09:13:36.1234567" })).to.equal(
                "09:13:36.1234567",
            );
            expect(cellDisplayText({ $t: "double", v: "1.7976931348623157E+308" })).to.equal(
                "1.7976931348623157E+308",
            );
        });
    });

    suite("compareCells with typed wrappers", () => {
        test("decimal wrappers compare numerically under the numeric hint", () => {
            const nine = { $t: "decimal", v: "9" };
            const ten = { $t: "decimal", v: "10" };
            expect(compareCells(nine, ten, true)).to.be.lessThan(0);
            expect(compareCells(ten, nine, true)).to.be.greaterThan(0);
        });

        test("datetime wrappers order chronologically as display text", () => {
            const early = { $t: "datetime2", v: "2003-04-08T09:13:36.0000000" };
            const late = { $t: "datetime2", v: "2003-04-09T00:00:00.0000000" };
            expect(compareCells(early, late, false)).to.be.lessThan(0);
        });
    });

    suite("applyFilterSort numeric hint", () => {
        test("number:approx hints numeric ordering (bigint/decimal/money)", () => {
            const rows = [[{ $t: "decimal", v: "10" }], [{ $t: "decimal", v: "9" }]];
            const order = applyFilterSort(
                rows,
                { column: 0, direction: "asc" },
                [],
                ["number:approx"],
            );
            expect(order).to.deep.equal([1, 0]);
        });
    });

    suite("cellDocumentLanguage", () => {
        test("metadata and type hints classify XML/JSON without sniffing display text", () => {
            expect(cellDocumentLanguage("not xml", { sqlType: "xml" })).to.equal("xml");
            expect(cellDocumentLanguage("not json", { typeHint: "json" })).to.equal("json");
            expect(cellDocumentLanguage("x", { isJson: true })).to.equal("json");
            expect(cellDocumentLanguage("x", { isXml: true })).to.equal("xml");
        });

        test("small JSON must be parseable", () => {
            expect(cellDocumentLanguage('{"a":1}')).to.equal("json");
            expect(cellDocumentLanguage("{not json}")).to.equal(undefined);
        });

        test("large JSON-shaped text is linkable without a full parse", () => {
            const text = `{"payload":"${"x".repeat(QS_CELL_DOCUMENT_PARSE_LIMIT + 1)}"}`;
            expect(cellDocumentLanguage(text)).to.equal("json");
        });

        test("typed wrappers are never sniffed as JSON (dates are dates, not links)", () => {
            expect(
                cellDocumentLanguage({ $t: "datetime2", v: "2003-04-08T09:13:36.3900000" }),
            ).to.equal(undefined);
            expect(cellDocumentLanguage({ $t: "binary", v: "AQ==" })).to.equal(undefined);
            expect(cellDocumentLanguage({ $t: "decimal", v: "1.5" })).to.equal(undefined);
        });

        test("truncated string cells do not claim JSON/XML without metadata", () => {
            expect(cellDocumentLanguage({ $t: "truncated", of: "string", v: '{"a":' })).to.equal(
                undefined,
            );
            expect(
                cellDocumentLanguage(
                    { $t: "truncated", of: "string", v: "<root>" },
                    { sqlType: "xml" },
                ),
            ).to.equal("xml");
        });
    });

    suite("typed vector cells (D-0019)", () => {
        test("cellDisplayText renders the bounded preview, never raw tag JSON", () => {
            const cell = vectorCell([1, 2, 3, 4, 5, 6]);
            const text = cellDisplayText(cell);
            expect(text).to.equal("[1, 2, 3, 4, …] · 6D float32");
            expect(text).to.not.include("$t");
            expect(text).to.not.equal(JSON.stringify(cell));
        });

        test("cellDisplayText shows the unavailable sentinel text", () => {
            expect(
                cellDisplayText({
                    $t: "vector",
                    version: 1,
                    status: "unavailable",
                    reason: "cellLimit",
                    dimensions: 4,
                }),
            ).to.equal("<vector unavailable: 4D, cellLimit>");
        });

        test("applyFilterSort: sorting a vector-hinted column is a no-op", () => {
            const rows = [
                [vectorCell([9]), "a"],
                [vectorCell([1]), "b"],
                [vectorCell([5]), "ab"],
            ];
            const hints = [VECTOR_TYPE_HINT_V1, undefined];
            // Without the hint the desc pass WOULD reorder by preview text —
            // proving the hint (not a tie) is what freezes the order.
            expect(applyFilterSort(rows, { column: 0, direction: "desc" }, [])).to.deep.equal([
                0, 2, 1,
            ]);
            expect(
                applyFilterSort(rows, { column: 0, direction: "desc" }, [], hints),
            ).to.deep.equal([0, 1, 2]);
            expect(applyFilterSort(rows, { column: 0, direction: "asc" }, [], hints)).to.deep.equal(
                [0, 1, 2],
            );
        });

        test("applyFilterSort: filters still apply while the vector sort no-ops", () => {
            const rows = [
                [vectorCell([9]), "a"],
                [vectorCell([1]), "b"],
                [vectorCell([5]), "ab"],
            ];
            expect(
                applyFilterSort(
                    rows,
                    { column: 0, direction: "desc" },
                    [{ column: 1, contains: "a" }],
                    [VECTOR_TYPE_HINT_V1, undefined],
                ),
            ).to.deep.equal([0, 2]); // filtered, original order kept
        });

        test("cellDocumentLanguage classifies vector cells as JSON documents", () => {
            expect(cellDocumentLanguage(vectorCell([1, 2, 3]))).to.equal("json");
            // sqlType "vector" alone says nothing; the typed cell decides.
            expect(cellDocumentLanguage(vectorCell([1]), { sqlType: "vector" })).to.equal("json");
        });

        test("cellTextForPurpose expands vectors fully and falls back for scalars", () => {
            const cell = vectorCell([1.5, -2.5, 3]);
            expect(cellTextForPurpose(cell, "copy")).to.equal("[1.5,-2.5,3]");
            expect(cellTextForPurpose(cell, "insertExport")).to.equal(
                "CAST('[1.5,-2.5,3]' AS VECTOR(3))",
            );
            expect(cellTextForPurpose("abc", "copy")).to.equal("abc");
            expect(cellTextForPurpose(null, "csvExport")).to.equal("NULL");
            expect(
                cellTextForPurpose({ $t: "truncated", of: "string", v: "prefix" }, "copy"),
            ).to.equal("prefix");
        });
    });
});
