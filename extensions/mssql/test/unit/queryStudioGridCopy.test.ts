/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    mergeQueryStudioGridCopyIntervals,
    planQueryStudioGridCopy,
    queryStudioGridCopyColumnRuns,
} from "../../src/sharedInterfaces/queryStudioGridCopy";

suite("Query Studio grid copy planning", () => {
    test("merges overlapping and adjacent intervals", () => {
        expect(
            mergeQueryStudioGridCopyIntervals([
                { from: 20, to: 25 },
                { from: 1, to: 3 },
                { from: 4, to: 8 },
                { from: 22, to: 30 },
            ]),
        ).to.deep.equal([
            { from: 1, to: 8 },
            { from: 20, to: 30 },
        ]);
    });

    test("rejects a huge row range without enumerating it", () => {
        const result = planQueryStudioGridCopy(
            [{ fromRow: 0, toRow: 99_999_999, fromCell: 0, toCell: 0 }],
            100_000_000,
            1,
        );
        expect(result).to.deep.equal({ kind: "tooLarge", reason: "rows" });
    });

    test("rejects an adversarial number of selection rectangles", () => {
        const selection = Array.from({ length: 1_025 }, (_, index) => ({
            fromRow: index,
            toRow: index,
            fromCell: 0,
            toCell: 0,
        }));
        expect(planQueryStudioGridCopy(selection, 2_000, 1)).to.deep.equal({
            kind: "tooLarge",
            reason: "ranges",
        });
    });

    test("rejects 100k x 300 by output-cell budget", () => {
        const result = planQueryStudioGridCopy(
            [{ fromRow: 0, toRow: 99_999, fromCell: 0, toCell: 299 }],
            100_000,
            300,
        );
        expect(result).to.deep.equal({ kind: "tooLarge", reason: "cells" });
    });

    test("keeps distant selected columns as separate projected fetch runs", () => {
        const result = planQueryStudioGridCopy(
            [
                { fromRow: 10, toRow: 19, fromCell: 0, toCell: 0 },
                { fromRow: 10, toRow: 19, fromCell: 299, toCell: 299 },
            ],
            1_000,
            300,
        );
        expect(result.kind).to.equal("ok");
        if (result.kind !== "ok") {
            return;
        }
        expect(result.plan.columnRuns).to.deep.equal([
            { from: 0, to: 0 },
            { from: 299, to: 299 },
        ]);
        expect(result.plan.rowRuns).to.deep.equal([{ from: 10, to: 19 }]);
        expect(result.plan.outputCellCount).to.equal(20);
    });

    test("builds row bands for sparse SSMS-style union semantics", () => {
        const result = planQueryStudioGridCopy(
            [
                { fromRow: 1, toRow: 3, fromCell: 0, toCell: 1 },
                { fromRow: 3, toRow: 5, fromCell: 4, toCell: 4 },
            ],
            10,
            10,
        );
        expect(result.kind).to.equal("ok");
        if (result.kind !== "ok") {
            return;
        }
        expect(result.plan.rowBands).to.deep.equal([
            { fromRow: 1, toRow: 2, columnRuns: [{ from: 0, to: 1 }] },
            {
                fromRow: 3,
                toRow: 3,
                columnRuns: [
                    { from: 0, to: 1 },
                    { from: 4, to: 4 },
                ],
            },
            { fromRow: 4, toRow: 5, columnRuns: [{ from: 4, to: 4 }] },
        ]);
        expect(result.plan.rowRuns).to.deep.equal([{ from: 1, to: 5 }]);
        expect(result.plan.columnCount).to.equal(3);
        expect(result.plan.outputCellCount).to.equal(15);
    });

    test("normalizes reversed ranges and clamps them to result bounds", () => {
        const result = planQueryStudioGridCopy(
            [{ fromRow: 9, toRow: -5, fromCell: 8, toCell: 2 }],
            5,
            6,
        );
        expect(result.kind).to.equal("ok");
        if (result.kind !== "ok") {
            return;
        }
        expect(result.plan.ranges).to.deep.equal([
            { fromRow: 0, toRow: 4, fromCell: 2, toCell: 5 },
        ]);
        expect(result.plan.outputCellCount).to.equal(20);
    });

    test("drops wholly out-of-bounds and non-finite ranges", () => {
        expect(
            planQueryStudioGridCopy(
                [
                    { fromRow: 10, toRow: 12, fromCell: 0, toCell: 1 },
                    { fromRow: Number.NaN, toRow: 1, fromCell: 0, toCell: 1 },
                ],
                5,
                5,
            ),
        ).to.deep.equal({ kind: "empty" });
    });

    test("plans an under-budget wide selection exactly", () => {
        const result = planQueryStudioGridCopy(
            [{ fromRow: 0, toRow: 999, fromCell: 0, toCell: 299 }],
            1_000,
            300,
        );
        expect(result.kind).to.equal("ok");
        if (result.kind === "ok") {
            expect(result.plan.outputCellCount).to.equal(300_000);
        }
    });

    test("headers-only column planning is bounded and deduplicated", () => {
        expect(
            queryStudioGridCopyColumnRuns(
                [
                    { fromRow: 0, toRow: 100_000_000, fromCell: 4, toCell: 6 },
                    { fromRow: 0, toRow: 0, fromCell: 2, toCell: 4 },
                    { fromRow: 0, toRow: 0, fromCell: 99, toCell: 100 },
                ],
                10,
            ),
        ).to.deep.equal([{ from: 2, to: 6 }]);
    });
});
