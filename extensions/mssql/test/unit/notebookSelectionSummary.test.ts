/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { SelectionSummaryMetrics } from "../../src/sharedInterfaces/queryResult";
import {
    summarizeSelectionCells,
    type SelectionCell,
} from "../../src/sharedInterfaces/selectionSummary";

suite("Notebook Selection Summary", () => {
    const value = (text: string): SelectionCell => ({ isNull: false, text });
    const nullValue = (): SelectionCell => ({ isNull: true, text: "" });

    test("Numeric selection: computes average, sum, min, and max", () => {
        const result = summarizeSelectionCells([value("2"), value("4"), value("6")]);
        const expected: SelectionSummaryMetrics = {
            count: 3,
            distinctCount: 3,
            nullCount: 0,
            average: 4,
            sum: 12,
            min: 2,
            max: 6,
        };
        expect(result).to.deep.equal(expected);
    });

    test("Non-numeric selection: only count, distinct, and null metrics are produced", () => {
        const result = summarizeSelectionCells([value("Test"), value("Other"), value("Test")]);
        const expected: SelectionSummaryMetrics = {
            count: 3,
            distinctCount: 2,
            nullCount: 0,
        };
        expect(result).to.deep.equal(expected);
    });

    test("Mixed selection: numeric, non-numeric, and null cells are handled together", () => {
        const result = summarizeSelectionCells([
            value("2"),
            value("Test"),
            nullValue(),
            value("4"),
            nullValue(),
        ]);
        const expected: SelectionSummaryMetrics = {
            count: 5,
            distinctCount: 3,
            nullCount: 2,
            average: 3,
            sum: 6,
            min: 2,
            max: 4,
        };
        expect(result).to.deep.equal(expected);
    });

    test("Null cells are excluded from the distinct count", () => {
        const result = summarizeSelectionCells([nullValue(), nullValue(), value("A")]);
        const expected: SelectionSummaryMetrics = {
            count: 3,
            distinctCount: 1,
            nullCount: 2,
        };
        expect(result).to.deep.equal(expected);
    });

    test("Blank text is treated as non-numeric so it does not skew the average", () => {
        const result = summarizeSelectionCells([value("   "), value("7")]);
        const expected: SelectionSummaryMetrics = {
            count: 2,
            distinctCount: 2,
            nullCount: 0,
            average: 7,
            sum: 7,
            min: 7,
            max: 7,
        };
        expect(result).to.deep.equal(expected);
    });

    test("A two-cell numeric selection is summarized", () => {
        const result = summarizeSelectionCells([value("5"), value("5")]);
        const expected: SelectionSummaryMetrics = {
            count: 2,
            distinctCount: 1,
            nullCount: 0,
            average: 5,
            sum: 10,
            min: 5,
            max: 5,
        };
        expect(result).to.deep.equal(expected);
    });

    test("A single-cell selection is summarized (matching the .sql grid)", () => {
        const result = summarizeSelectionCells([value("5")]);
        const expected: SelectionSummaryMetrics = {
            count: 1,
            distinctCount: 1,
            nullCount: 0,
            average: 5,
            sum: 5,
            min: 5,
            max: 5,
        };
        expect(result).to.deep.equal(expected);
    });

    test("An empty selection is not summarized", () => {
        expect(summarizeSelectionCells([])).to.equal(undefined);
    });

    test("Accepts a lazy iterable of cells without materializing an array", () => {
        function* cells(): Generator<SelectionCell> {
            yield value("2");
            yield value("4");
        }
        const result = summarizeSelectionCells(cells());
        const expected: SelectionSummaryMetrics = {
            count: 2,
            distinctCount: 2,
            nullCount: 0,
            average: 3,
            sum: 6,
            min: 2,
            max: 4,
        };
        expect(result).to.deep.equal(expected);
    });
});
