/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
// eslint-disable-next-line custom-eslint-rules/banned-imports
import { selectionSummaryHelper } from "../../src/reactviews/pages/QueryResult/table/plugins/cellSelectionModel.plugin";
import { SelectionSummaryStats } from "../../src/sharedInterfaces/queryResult";

suite("Query Result Selection Stats", () => {
    let sandbox: sinon.SinonSandbox;
    let mockGrid: Slick.Grid<any>;
    let mockData: string[][];

    const createRange = (
        fromRow: number,
        toRow: number,
        fromCell: number,
        toCell: number,
    ): Slick.Range => ({
        fromRow,
        toRow,
        fromCell,
        toCell,
        isSingleRow: undefined,
        isSingleCell: undefined,
        contains: undefined,
    });

    setup(() => {
        sandbox = sinon.createSandbox();

        mockData = [
            ["1", "NULL", "NULL"],
            ["3", "Test", "Test"],
            ["8.7", "Test", "Other"],
        ];

        mockGrid = {
            getColumns: () => [{ id: "col1" }, { id: "col2" }],
            getCellNode: (row: number, col: number) => {
                return { innerText: mockData[row]?.[col] } as HTMLElement;
            },
        } as Slick.Grid<any>;
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
            count: 6,
            distinctCount: 3, // NULL, Test, Other
            nullCount: 2,
            removeSelectionStats: false,
        };

        const result = await selectionSummaryHelper([range], mockGrid, true);
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Mixed Range: numeric and non-numeric values handled correctly", async () => {
        const range = createRange(0, 2, 0, 2); // full grid
        const expectedResult: SelectionSummaryStats = {
            average: "4.233", // (1 + 3 + 8.7) / 3
            count: 9,
            distinctCount: 6,
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
            count: -1,
            distinctCount: -1,
            nullCount: -1,
            removeSelectionStats: false,
        };
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Missing Column: returns default summary", async () => {
        const gridWithNoColumns = {
            ...mockGrid,
            getColumns: () => [],
        } as Slick.Grid<any>;

        const range = createRange(0, 2, 0, 2); // full grid
        const result = await selectionSummaryHelper([range], gridWithNoColumns, true);
        const expectedResult: SelectionSummaryStats = {
            count: -1,
            distinctCount: -1,
            nullCount: -1,
            removeSelectionStats: false,
        };
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Clear stats when isSelection is false", async () => {
        const range = createRange(0, 2, 0, 2); // full grid
        const result = await selectionSummaryHelper([range], mockGrid, false);
        const expectedResult: SelectionSummaryStats = {
            count: -1,
            distinctCount: -1,
            nullCount: -1,
            removeSelectionStats: true,
        };
        assert.deepStrictEqual(result, expectedResult);
    });

    test("Grid cell is missing: should skip without crashing", async () => {
        mockGrid = {
            getColumns: () => [{ id: "col1" }, { id: "col2" }],
            getCellNode: (row: number, col: number) => undefined,
        } as Slick.Grid<any>;

        const range = createRange(0, 1, 0, 0);
        const result = await selectionSummaryHelper([range], mockGrid, true);
        const expectedResult: SelectionSummaryStats = {
            count: 0,
            distinctCount: 0,
            nullCount: 0,
            removeSelectionStats: false,
        };
        assert.deepStrictEqual(result, expectedResult);
    });
});
