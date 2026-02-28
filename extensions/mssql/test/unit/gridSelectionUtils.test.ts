/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    convertDisplayedSelectionToActual,
    tryCombineSelections,
    tryCombineSelectionsForResults,
    SLICKGRID_ROW_ID_PROP,
} from "../../src/reactviews/pages/QueryResult/table/utils";
import { ISlickRange, SortProperties } from "../../src/sharedInterfaces/queryResult";

/**
 * Creates a minimal mock Slick.Grid that returns:
 *  - columns with optional sort/filter state
 *  - data items with _mssqlRowId mapping display rows → actual rows
 */
function createMockGrid(options: {
    actualRowIds: number[];
    hasSortOrFilter: boolean;
    columnCount?: number;
}): Slick.Grid<any> {
    const { actualRowIds, hasSortOrFilter, columnCount = 3 } = options;

    const columns = Array.from({ length: columnCount }, (_, i) => ({
        id: `col${i}`,
        name: `Column ${i}`,
        field: `col${i}`,
        sorted: hasSortOrFilter ? SortProperties.ASC : SortProperties.NONE,
        filterValues: [],
    }));

    const data = actualRowIds.map((actualId) => ({
        [SLICKGRID_ROW_ID_PROP]: actualId,
    }));

    return {
        getColumns: () => columns,
        getDataItem: (index: number) => data[index],
    } as unknown as Slick.Grid<any>;
}

suite("Grid Selection Utils", () => {
    suite("convertDisplayedSelectionToActual", () => {
        test("returns selections unchanged when no sort/filter is applied", () => {
            const grid = createMockGrid({
                actualRowIds: [0, 1, 2, 3, 4],
                hasSortOrFilter: false,
            });
            const selections: ISlickRange[] = [
                { fromRow: 2, toRow: 4, fromCell: 0, toCell: 2 },
                { fromRow: 0, toRow: 1, fromCell: 0, toCell: 2 },
            ];
            const result = convertDisplayedSelectionToActual(grid, selections);
            expect(result).to.deep.equal(selections);
        });

        test("preserves display order when sort is applied (reversed data)", () => {
            // Display order maps to reversed actual rows:
            // display 0 → actual 4, display 1 → actual 3, ..., display 4 → actual 0
            const grid = createMockGrid({
                actualRowIds: [4, 3, 2, 1, 0],
                hasSortOrFilter: true,
            });
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 4, fromCell: 1, toCell: 2 }];
            const result = convertDisplayedSelectionToActual(grid, selections);
            // Each display row maps to a non-consecutive-ascending actual row,
            // so each should be its own range, preserving display order.
            expect(result).to.deep.equal([
                { fromRow: 4, toRow: 4, fromCell: 1, toCell: 2 },
                { fromRow: 3, toRow: 3, fromCell: 1, toCell: 2 },
                { fromRow: 2, toRow: 2, fromCell: 1, toCell: 2 },
                { fromRow: 1, toRow: 1, fromCell: 1, toCell: 2 },
                { fromRow: 0, toRow: 0, fromCell: 1, toCell: 2 },
            ]);
        });

        test("preserves display order for non-sequential actual rows", () => {
            // Simulates the user's scenario: grid sorted by Email showing
            // actual rows [2, 1, 0, 4, 3] as display rows [0, 1, 2, 3, 4]
            const grid = createMockGrid({
                actualRowIds: [2, 1, 0, 4, 3],
                hasSortOrFilter: true,
            });
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 4, fromCell: 1, toCell: 1 }];
            const result = convertDisplayedSelectionToActual(grid, selections);
            // None of these are consecutive ascending, so each is its own range
            expect(result).to.deep.equal([
                { fromRow: 2, toRow: 2, fromCell: 1, toCell: 1 },
                { fromRow: 1, toRow: 1, fromCell: 1, toCell: 1 },
                { fromRow: 0, toRow: 0, fromCell: 1, toCell: 1 },
                { fromRow: 4, toRow: 4, fromCell: 1, toCell: 1 },
                { fromRow: 3, toRow: 3, fromCell: 1, toCell: 1 },
            ]);
        });

        test("merges consecutive ascending actual rows within display order", () => {
            // Display rows 0–3 map to actual rows [5, 6, 7, 8] (consecutive ascending)
            const grid = createMockGrid({
                actualRowIds: [5, 6, 7, 8],
                hasSortOrFilter: true,
            });
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 3, fromCell: 0, toCell: 2 }];
            const result = convertDisplayedSelectionToActual(grid, selections);
            // All consecutive ascending → merged into one range
            expect(result).to.deep.equal([{ fromRow: 5, toRow: 8, fromCell: 0, toCell: 2 }]);
        });

        test("splits ranges at display-order discontinuities", () => {
            // Display: [3, 4, 5, 0, 1]
            // First 3 are ascending, then jumps down
            const grid = createMockGrid({
                actualRowIds: [3, 4, 5, 0, 1],
                hasSortOrFilter: true,
            });
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 4, fromCell: 0, toCell: 1 }];
            const result = convertDisplayedSelectionToActual(grid, selections);
            expect(result).to.deep.equal([
                { fromRow: 3, toRow: 5, fromCell: 0, toCell: 1 }, // display rows 0-2
                { fromRow: 0, toRow: 1, fromCell: 0, toCell: 1 }, // display rows 3-4
            ]);
        });

        test("handles empty selections", () => {
            const grid = createMockGrid({
                actualRowIds: [],
                hasSortOrFilter: true,
            });
            const result = convertDisplayedSelectionToActual(grid, []);
            expect(result).to.deep.equal([]);
        });

        test("orders multiple non-contiguous display selections by grid order with sort", () => {
            // Display: [10, 20, 30, 40, 50]
            const grid = createMockGrid({
                actualRowIds: [10, 20, 30, 40, 50],
                hasSortOrFilter: true,
            });
            const selections: ISlickRange[] = [
                { fromRow: 3, toRow: 4, fromCell: 0, toCell: 1 }, // display rows 3-4 → actual 40, 50
                { fromRow: 0, toRow: 1, fromCell: 0, toCell: 1 }, // display rows 0-1 → actual 10, 20
            ];
            const result = convertDisplayedSelectionToActual(grid, selections);
            // Selection input is out-of-order by display row (3-4 first, then 0-1).
            // Copy conversion should normalize to visual grid order (0-1 first, then 3-4).
            expect(result).to.deep.equal([
                { fromRow: 10, toRow: 10, fromCell: 0, toCell: 1 },
                { fromRow: 20, toRow: 20, fromCell: 0, toCell: 1 },
                { fromRow: 40, toRow: 40, fromCell: 0, toCell: 1 },
                { fromRow: 50, toRow: 50, fromCell: 0, toCell: 1 },
            ]);
        });
    });

    suite("tryCombineSelections", () => {
        test("returns empty array unchanged", () => {
            const result = tryCombineSelections([]);
            expect(result).to.deep.equal([]);
        });

        test("returns single selection unchanged", () => {
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 5, fromCell: 0, toCell: 3 }];
            const result = tryCombineSelections(selections);
            expect(result).to.deep.equal(selections);
        });

        test("merges two contiguous selections with same columns into one", () => {
            const selections: ISlickRange[] = [
                { fromRow: 0, toRow: 2, fromCell: 0, toCell: 3 },
                { fromRow: 3, toRow: 5, fromCell: 0, toCell: 3 },
            ];
            const result = tryCombineSelections(selections);
            expect(result).to.have.length(1);
            expect(result[0]).to.deep.equal({ fromRow: 0, toRow: 5, fromCell: 0, toCell: 3 });
        });

        test("does NOT merge non-contiguous selections with gap", () => {
            const selections: ISlickRange[] = [
                { fromRow: 0, toRow: 2, fromCell: 0, toCell: 3 },
                { fromRow: 5, toRow: 7, fromCell: 0, toCell: 3 },
            ];
            const result = tryCombineSelections(selections);
            expect(result).to.have.length(2);
            expect(result).to.deep.equal(selections);
        });

        test("does NOT merge selections with different column ranges that don't cover bounding box", () => {
            const selections: ISlickRange[] = [
                { fromRow: 0, toRow: 2, fromCell: 0, toCell: 1 },
                { fromRow: 0, toRow: 2, fromCell: 3, toCell: 4 },
            ];
            const result = tryCombineSelections(selections);
            expect(result).to.have.length(2);
        });

        test("preserves original selections in original order when merge is not possible", () => {
            const selections: ISlickRange[] = [
                { fromRow: 5, toRow: 7, fromCell: 0, toCell: 3 },
                { fromRow: 0, toRow: 2, fromCell: 0, toCell: 3 },
            ];
            const result = tryCombineSelections(selections);
            expect(result).to.deep.equal(selections);
        });
    });

    suite("tryCombineSelectionsForResults", () => {
        test("adjusts cell indices by -1 to account for row number column", () => {
            const selections: ISlickRange[] = [{ fromRow: 0, toRow: 5, fromCell: 1, toCell: 4 }];
            const result = tryCombineSelectionsForResults(selections);
            expect(result).to.have.length(1);
            expect(result[0].fromCell).to.equal(0);
            expect(result[0].toCell).to.equal(3);
            expect(result[0].fromRow).to.equal(0);
            expect(result[0].toRow).to.equal(5);
        });

        test("preserves non-contiguous selections and adjusts cells", () => {
            const selections: ISlickRange[] = [
                { fromRow: 5, toRow: 7, fromCell: 1, toCell: 3 },
                { fromRow: 0, toRow: 2, fromCell: 1, toCell: 3 },
            ];
            const result = tryCombineSelectionsForResults(selections);
            expect(result).to.have.length(2);
            expect(result[0].fromCell).to.equal(0);
            expect(result[0].toCell).to.equal(2);
            expect(result[1].fromCell).to.equal(0);
            expect(result[1].toCell).to.equal(2);
        });
    });
});
