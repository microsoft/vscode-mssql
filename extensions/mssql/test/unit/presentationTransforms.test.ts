/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    applyTransformPipeline,
    validateTransformPipeline,
} from "../../src/runbookStudio/presentation/presentationTransforms";

suite("presentationTransforms", () => {
    test("filters, stably sorts, limits, selects, and renames bounded rows", () => {
        const result = applyTransformPipeline(
            {
                columns: ["suite", "durationMs", "status"],
                rows: [
                    ["B", 15, "pass"],
                    ["A", 20, "pass"],
                    ["C", 5, "fail"],
                    ["D", 20, "fail"],
                ],
            },
            {
                steps: [
                    { op: "filter", predicate: { op: "gte", field: "durationMs", value: 15 } },
                    { op: "sort", by: [{ field: "durationMs", direction: "desc" }] },
                    { op: "limit", count: 2 },
                    { op: "select", columns: ["suite", "durationMs"] },
                    { op: "rename", columns: { durationMs: "elapsed" } },
                ],
            },
        );
        expect(result).to.deep.equal({
            ok: true,
            table: {
                columns: ["suite", "elapsed"],
                rows: [
                    ["A", 20],
                    ["D", 20],
                ],
            },
        });
    });

    test("aggregates and pivots without mutating the input", () => {
        const input = {
            columns: ["suite", "metric", "value"],
            rows: [
                ["A", "duration", 10],
                ["A", "duration", 20],
                ["A", "failures", 1],
                ["B", "duration", 5],
                ["B", "failures", 0],
            ] as Array<Array<string | number | boolean | null>>,
        };
        const aggregate = applyTransformPipeline(input, {
            steps: [
                {
                    op: "aggregate",
                    by: ["metric"],
                    measures: [
                        { field: "value", fn: "sum", as: "total" },
                        { fn: "count", as: "samples" },
                    ],
                },
            ],
        });
        expect(aggregate).to.deep.equal({
            ok: true,
            table: {
                columns: ["metric", "total", "samples"],
                rows: [
                    ["duration", 35, 3],
                    ["failures", 1, 2],
                ],
            },
        });

        const pivot = applyTransformPipeline(input, {
            steps: [
                {
                    op: "pivot",
                    index: ["suite"],
                    column: "metric",
                    value: "value",
                    reducer: "sum",
                },
            ],
        });
        expect(pivot).to.deep.equal({
            ok: true,
            table: {
                columns: ["suite", "duration", "failures"],
                rows: [
                    ["A", 30, 1],
                    ["B", 5, 0],
                ],
            },
        });
        expect(input.rows[0]).to.deep.equal(["A", "duration", 10]);
    });

    test("returns exact failures for shape drift and numeric mismatches", () => {
        expect(
            applyTransformPipeline(
                { columns: ["name"], rows: [["test"]] },
                { steps: [{ op: "select", columns: ["missing"] }] },
            ),
        ).to.deep.equal({ ok: false, reason: "fieldMissing" });
        expect(
            applyTransformPipeline(
                { columns: ["group", "value"], rows: [["A", "not-number"]] },
                {
                    steps: [
                        {
                            op: "aggregate",
                            by: ["group"],
                            measures: [{ field: "value", fn: "avg", as: "average" }],
                        },
                    ],
                },
            ),
        ).to.deep.equal({ ok: false, reason: "typeMismatch" });
    });

    test("validator rejects executable, unbounded, and malformed operations", () => {
        expect(
            validateTransformPipeline({ steps: [{ op: "javascript", code: "alert(1)" }] }),
        ).to.equal(false);
        expect(validateTransformPipeline({ steps: [{ op: "limit", count: 10_001 }] })).to.equal(
            false,
        );
        expect(
            validateTransformPipeline({
                steps: [{ op: "filter", predicate: { op: "eq", field: "x", value: Number.NaN } }],
            }),
        ).to.equal(false);
        expect(
            validateTransformPipeline({
                steps: [
                    {
                        op: "aggregate",
                        by: [],
                        measures: [{ fn: "sum", as: "total" }],
                    },
                ],
            }),
        ).to.equal(false);
        expect(
            validateTransformPipeline({ steps: Array(21).fill({ op: "limit", count: 1 }) }),
        ).to.equal(false);
    });
});
