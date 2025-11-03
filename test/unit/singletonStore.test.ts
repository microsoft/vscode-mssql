/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import store, { QueryResultSingletonStore } from "../../src/queryResult/singletonStore";

suite("QueryResultSingletonStore", () => {
    let queryResultStore: QueryResultSingletonStore;

    setup(() => {
        queryResultStore = store;
    });

    test("deleteUriState should remove all data associated with a URI", () => {
        const testUri = "file:///test/path/query.sql";
        const gridId1 = "grid1";
        const gridId2 = "grid2";
        const gridKey1 = QueryResultSingletonStore.generateGridKey(testUri, gridId1);
        const gridKey2 = QueryResultSingletonStore.generateGridKey(testUri, gridId2);

        // Populate store with dummy data
        queryResultStore.gridState.maximizedGridIds.set(testUri, gridId1);
        queryResultStore.gridState.resultsTabYOffsets.set(testUri, 100);
        queryResultStore.gridState.messagesTabYOffsets.set(testUri, 200);
        queryResultStore.gridState.gridColumnFilters.set(gridKey1, {
            column1: { filterValues: ["value1"], columnDef: "column1" },
        });
        queryResultStore.gridState.gridColumnFilters.set(gridKey2, {
            column2: { filterValues: ["value2"], columnDef: "column2" },
        });
        queryResultStore.gridState.gridColumnWidths.set(gridKey1, [100, 200, 300]);
        queryResultStore.gridState.gridColumnWidths.set(gridKey2, [150, 250]);
        queryResultStore.gridState.gridScrollPositions.set(gridKey1, {
            scrollTop: 10,
            scrollLeft: 20,
        });
        queryResultStore.gridState.gridScrollPositions.set(gridKey2, {
            scrollTop: 30,
            scrollLeft: 40,
        });

        // Delete URI state
        queryResultStore.deleteUriState(testUri);

        // Verify all data is deleted
        expect(
            queryResultStore.gridState.maximizedGridIds.has(testUri),
            "maximizedGridIds should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.resultsTabYOffsets.has(testUri),
            "resultsTabYOffsets should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.messagesTabYOffsets.has(testUri),
            "messagesTabYOffsets should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridColumnFilters.has(gridKey1),
            "gridColumnFilters for grid1 should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridColumnFilters.has(gridKey2),
            "gridColumnFilters for grid2 should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridColumnWidths.has(gridKey1),
            "gridColumnWidths for grid1 should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridColumnWidths.has(gridKey2),
            "gridColumnWidths for grid2 should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridScrollPositions.has(gridKey1),
            "gridScrollPositions for grid1 should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridScrollPositions.has(gridKey2),
            "gridScrollPositions for grid2 should be deleted",
        ).is.equal(false);
    });

    test("deleteUriState should not affect data from other URIs", () => {
        const testUri1 = "file:///test/path/query1.sql";
        const testUri2 = "file:///test/path/query2.sql";
        const gridId = "grid1";
        const gridKey1 = QueryResultSingletonStore.generateGridKey(testUri1, gridId);
        const gridKey2 = QueryResultSingletonStore.generateGridKey(testUri2, gridId);

        // Populate store with data for both URIs
        queryResultStore.gridState.maximizedGridIds.set(testUri1, gridId);
        queryResultStore.gridState.maximizedGridIds.set(testUri2, gridId);
        queryResultStore.gridState.resultsTabYOffsets.set(testUri1, 100);
        queryResultStore.gridState.resultsTabYOffsets.set(testUri2, 200);
        queryResultStore.gridState.gridColumnFilters.set(gridKey1, {
            column1: { filterValues: ["filter1"], columnDef: "column1" },
        });
        queryResultStore.gridState.gridColumnFilters.set(gridKey2, {
            column2: { filterValues: ["filter2"], columnDef: "column2" },
        });
        queryResultStore.gridState.gridColumnWidths.set(gridKey1, [100, 200]);
        queryResultStore.gridState.gridColumnWidths.set(gridKey2, [150, 250]);

        // Delete only testUri1
        queryResultStore.deleteUriState(testUri1);

        // Verify testUri1 data is deleted
        expect(
            queryResultStore.gridState.maximizedGridIds.has(testUri1),
            "testUri1 maximizedGridIds should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.resultsTabYOffsets.has(testUri1),
            "testUri1 resultsTabYOffsets should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridColumnFilters.has(gridKey1),
            "testUri1 gridColumnFilters should be deleted",
        ).is.equal(false);
        expect(
            queryResultStore.gridState.gridColumnWidths.has(gridKey1),
            "testUri1 gridColumnWidths should be deleted",
        ).is.equal(false);

        // Verify testUri2 data still exists
        expect(
            queryResultStore.gridState.maximizedGridIds.has(testUri2),
            "testUri2 maximizedGridIds should exist",
        ).is.equal(true);
        expect(
            queryResultStore.gridState.maximizedGridIds.get(testUri2),
            "testUri2 maximizedGridIds value should match",
        ).is.equal(gridId);
        expect(
            queryResultStore.gridState.resultsTabYOffsets.has(testUri2),
            "testUri2 resultsTabYOffsets should exist",
        ).is.equal(true);
        expect(
            queryResultStore.gridState.resultsTabYOffsets.get(testUri2),
            "testUri2 resultsTabYOffsets value should match",
        ).is.equal(200);
        expect(
            queryResultStore.gridState.gridColumnFilters.has(gridKey2),
            "testUri2 gridColumnFilters should exist",
        ).is.equal(true);
        expect(
            queryResultStore.gridState.gridColumnFilters.get(gridKey2),
            "testUri2 gridColumnFilters value should match",
        ).is.deep.equal({
            column2: { filterValues: ["filter2"], columnDef: "column2" },
        });
        expect(
            queryResultStore.gridState.gridColumnWidths.has(gridKey2),
            "testUri2 gridColumnWidths should exist",
        ).is.equal(true);
        expect(
            queryResultStore.gridState.gridColumnWidths.get(gridKey2),
            "testUri2 gridColumnWidths value should match",
        ).is.deep.equal([150, 250]);
    });

    test("deleteUriState should handle non-existent URI gracefully", () => {
        const nonExistentUri = "file:///test/nonexistent.sql";

        // Should not throw an error
        expect(
            () => queryResultStore.deleteUriState(nonExistentUri),
            "Should not throw error for non-existent URI",
        ).to.not.throw();
    });
});
