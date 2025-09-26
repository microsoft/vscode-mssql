/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
// eslint-disable-next-line custom-eslint-rules/banned-imports
import { SelectionSummaryStats, ISlickRange } from "../../src/sharedInterfaces/queryResult";
import { selectionSummaryHelper } from "../../src/queryResult/utils";

suite("Query Result Selection Stats", () => {
    let sandbox: sinon.SinonSandbox;
    let mockGrid: {
        getCellNode: (row: number, col: number) => HTMLElement | undefined;
        getColumns: () => any[];
    };
    let mockData: string[][];

    const createRange = (
        fromRow: number,
        toRow: number,
        fromCell: number,
        toCell: number,
    ): ISlickRange => ({
        fromRow,
        toRow,
        fromCell,
        toCell,
    });

    setup(() => {
        sandbox = sinon.createSandbox();

        mockData = [
            ["1", "NULL", "NULL"],
            ["3", "Test", "Test"],
            ["8.7", "Test", "Other"],
        ];

        mockGrid = {
            getColumns: () => [{ id: "col1" }, { id: "col2" }, { id: "col3" }],
            getCellNode: (row: number, col: number) => {
                return { innerText: mockData[row]?.[col] } as HTMLElement;
            },
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Numeric Range: correct numeric stats are calculated", async () => {
        const range = createRange(0, 2, 0, 0); // selects first column
        const expectedResult: SelectionSummaryStats = {
            average: "4.233",
            count: 3,
            distinctCount: 3,
            max: 8.7,
            min: 1,
            nullCount: 0,
            sum: 12.7,
            removeSelectionStats: false,
        };

        const result = await selectionSummaryHelper([range], mockGrid, true);
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Non-numeric Range: only count/distinct/null stats are calculated", async () => {
        const range = createRange(0, 2, 1, 2); // rows 0-2, cols 1-2
        const expectedResult: SelectionSummaryStats = {
            average: "",
            count: 6,
            distinctCount: 2, // Test, Other (NULL doesn't count in distinct)
            max: 0,
            min: 0,
            nullCount: 2,
            removeSelectionStats: false,
            sum: 0,
        };

        const result = await selectionSummaryHelper([range], mockGrid, true);
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Mixed Range: numeric and non-numeric values handled correctly", async () => {
        const range = createRange(0, 2, 0, 2); // full grid
        const expectedResult: SelectionSummaryStats = {
            average: "4.233", // (1 + 3 + 8.7) / 3
            count: 9,
            distinctCount: 5, // 1, 3, 8.7, Test, Other (NULL doesn't count in distinct)
            max: 8.7,
            min: 1,
            nullCount: 2,
            sum: 12.7,
            removeSelectionStats: false,
        };

        const result = await selectionSummaryHelper([range], mockGrid, true);
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Empty Range: returns default summary", async () => {
        const result = await selectionSummaryHelper([], mockGrid, true);
        const expectedResult: SelectionSummaryStats = {
            average: "",
            count: -1,
            distinctCount: -1,
            max: 0,
            min: 0,
            nullCount: -1,
            removeSelectionStats: false,
            sum: 0,
        };
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Missing Column: returns default summary", async () => {
        const gridWithNoColumns = {
            ...mockGrid,
            getColumns: () => [],
        };

        const range = createRange(0, 2, 0, 2); // full grid
        const result = await selectionSummaryHelper([range], gridWithNoColumns, true);
        const expectedResult: SelectionSummaryStats = {
            average: "",
            count: -1,
            distinctCount: -1,
            max: 0,
            min: 0,
            nullCount: -1,
            removeSelectionStats: false,
            sum: 0,
        };
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Clear stats when isSelection is false", async () => {
        const range = createRange(0, 2, 0, 2); // full grid
        const result = await selectionSummaryHelper([range], mockGrid, false);
        const expectedResult: SelectionSummaryStats = {
            average: "",
            count: -1,
            distinctCount: -1,
            max: 0,
            min: 0,
            nullCount: -1,
            removeSelectionStats: true,
            sum: 0,
        };
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Grid cell is missing: should skip without crashing", async () => {
        const gridWithMissingCells = {
            getColumns: () => [{ id: "col1" }, { id: "col2" }],
            getCellNode: (row: number, col: number) => undefined,
        };

        const range = createRange(0, 1, 0, 0);
        const result = await selectionSummaryHelper([range], gridWithMissingCells, true);
        const expectedResult: SelectionSummaryStats = {
            average: "",
            count: 0,
            distinctCount: 0,
            max: 0,
            min: 0,
            nullCount: 0,
            removeSelectionStats: false,
            sum: 0,
        };
        assert.deepStrictEqual(result, expectedResult);
    });
});
