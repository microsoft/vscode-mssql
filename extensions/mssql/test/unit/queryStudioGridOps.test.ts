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
    QS_DISTINCT_VALUES_CAP,
    applyFilterSort,
    cellDisplayText,
    clampDisplay,
    compareCells,
    distinctValues,
} from "../../src/sharedInterfaces/queryStudioGridOps";

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
    });
});
