/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    profilerSortComparator,
    createDataViewSortFn,
    getNextSortState,
} from "../../../src/sharedInterfaces/profiler";
import { SortDirection, SortState } from "../../../src/profiler/profilerTypes";

suite("profilerSortUtils", () => {
    suite("profilerSortComparator", () => {
        test("should compare numbers ascending correctly", () => {
            const result = profilerSortComparator(100, 200, SortDirection.ASC);
            expect(result).to.be.lessThan(0);
        });

        test("should compare numbers descending correctly", () => {
            const result = profilerSortComparator(100, 200, SortDirection.DESC);
            expect(result).to.be.greaterThan(0);
        });

        test("should compare equal numbers as 0", () => {
            const result = profilerSortComparator(100, 100, SortDirection.ASC);
            expect(result).to.equal(0);
        });

        test("should compare strings case-insensitively ascending", () => {
            const result = profilerSortComparator("Alpha", "beta", SortDirection.ASC);
            expect(result).to.be.lessThan(0);
        });

        test("should compare strings case-insensitively descending", () => {
            const result = profilerSortComparator("Alpha", "beta", SortDirection.DESC);
            expect(result).to.be.greaterThan(0);
        });

        test("should push undefined values to the end regardless of sort direction (ASC)", () => {
            const result = profilerSortComparator(undefined, 100, SortDirection.ASC);
            expect(result).to.be.greaterThan(0); // undefined pushed after 100
        });

        test("should push undefined values to the end regardless of sort direction (DESC)", () => {
            const result = profilerSortComparator(undefined, 100, SortDirection.DESC);
            expect(result).to.be.greaterThan(0); // undefined still pushed after 100
        });

        test("should push undefined values to the end", () => {
            const result = profilerSortComparator(undefined, 50, SortDirection.ASC);
            expect(result).to.be.greaterThan(0);
        });

        test("should push empty string values to the end", () => {
            const result = profilerSortComparator("", "test", SortDirection.ASC);
            expect(result).to.be.greaterThan(0);
        });

        test("should return 0 when both values are undefined", () => {
            const result = profilerSortComparator(undefined, undefined, SortDirection.ASC);
            expect(result).to.equal(0);
        });

        test("should handle missing field as empty", () => {
            const result = profilerSortComparator(undefined, 100, SortDirection.ASC);
            expect(result).to.be.greaterThan(0); // missing field pushed to end
        });

        test("should compare strings with numeric awareness", () => {
            const result = profilerSortComparator("query2", "query10", SortDirection.ASC);
            expect(result).to.be.lessThan(0); // "query2" < "query10" with numeric sort
        });

        test("should sort a full array correctly ascending by number", () => {
            const rows = [
                { id: "1", duration: 300 },
                { id: "2", duration: 100 },
                { id: "3", duration: undefined },
                { id: "4", duration: 200 },
            ];
            rows.sort((a, b) => profilerSortComparator(a.duration, b.duration, SortDirection.ASC));
            expect(rows.map((r) => r.id)).to.deep.equal(["2", "4", "1", "3"]);
        });

        test("should sort a full array correctly descending by number", () => {
            const rows = [
                { id: "1", duration: 300 },
                { id: "2", duration: 100 },
                { id: "3", duration: undefined },
                { id: "4", duration: 200 },
            ];
            rows.sort((a, b) => profilerSortComparator(a.duration, b.duration, SortDirection.DESC));
            expect(rows.map((r) => r.id)).to.deep.equal(["1", "4", "2", "3"]);
        });

        test("should sort a full array correctly ascending by string", () => {
            const rows = [
                { id: "1", eventClass: "Zebra" },
                { id: "2", eventClass: "apple" },
                { id: "3", eventClass: "" },
                { id: "4", eventClass: "Banana" },
            ];
            rows.sort((a, b) =>
                profilerSortComparator(a.eventClass, b.eventClass, SortDirection.ASC),
            );
            expect(rows.map((r) => r.id)).to.deep.equal(["2", "4", "1", "3"]);
        });

        test("should handle value on one side being a non-empty string and other being undefined", () => {
            const resultAsc = profilerSortComparator("test", undefined, SortDirection.ASC);
            expect(resultAsc).to.be.lessThan(0); // "test" comes before undefined

            const resultDesc = profilerSortComparator("test", undefined, SortDirection.DESC);
            expect(resultDesc).to.be.lessThan(0); // "test" still comes before undefined
        });
    });

    suite("createDataViewSortFn", () => {
        test("should restore natural order by eventNumber when sort is undefined", () => {
            const sortFn = createDataViewSortFn(undefined);
            const rows = [
                { eventNumber: 3, eventClass: "C" },
                { eventNumber: 1, eventClass: "A" },
                { eventNumber: 2, eventClass: "B" },
            ];
            rows.sort(sortFn);
            expect(rows.map((r) => r.eventNumber)).to.deep.equal([1, 2, 3]);
        });

        test("should sort by the specified field ascending", () => {
            const sortFn = createDataViewSortFn({
                field: "eventClass",
                direction: SortDirection.ASC,
            });
            const rows = [
                { eventNumber: 1, eventClass: "Charlie" },
                { eventNumber: 2, eventClass: "Alpha" },
                { eventNumber: 3, eventClass: "Bravo" },
            ];
            rows.sort(sortFn);
            expect(rows.map((r) => r.eventClass)).to.deep.equal(["Alpha", "Bravo", "Charlie"]);
        });

        test("should sort by the specified field descending", () => {
            const sortFn = createDataViewSortFn({
                field: "eventClass",
                direction: SortDirection.DESC,
            });
            const rows = [
                { eventNumber: 1, eventClass: "Charlie" },
                { eventNumber: 2, eventClass: "Alpha" },
                { eventNumber: 3, eventClass: "Bravo" },
            ];
            rows.sort(sortFn);
            expect(rows.map((r) => r.eventClass)).to.deep.equal(["Charlie", "Bravo", "Alpha"]);
        });

        test("should sort numbers correctly", () => {
            const sortFn = createDataViewSortFn({
                field: "duration",
                direction: SortDirection.ASC,
            });
            const rows = [
                { eventNumber: 1, duration: 500 },
                { eventNumber: 2, duration: 100 },
                { eventNumber: 3, duration: 300 },
            ];
            rows.sort(sortFn);
            expect(rows.map((r) => r.duration)).to.deep.equal([100, 300, 500]);
        });
    });

    suite("getNextSortState", () => {
        test("should start ascending when no sort is active", () => {
            const result = getNextSortState(undefined, "eventClass");
            expect(result).to.deep.equal({
                field: "eventClass",
                direction: SortDirection.ASC,
            });
        });

        test("should start ascending when clicking a different column", () => {
            const currentSort: SortState = {
                field: "duration",
                direction: SortDirection.ASC,
            };
            const result = getNextSortState(currentSort, "eventClass");
            expect(result).to.deep.equal({
                field: "eventClass",
                direction: SortDirection.ASC,
            });
        });

        test("should switch to descending when clicking the same column already sorted ascending", () => {
            const currentSort: SortState = {
                field: "eventClass",
                direction: SortDirection.ASC,
            };
            const result = getNextSortState(currentSort, "eventClass");
            expect(result).to.deep.equal({
                field: "eventClass",
                direction: SortDirection.DESC,
            });
        });

        test("should clear sort when clicking the same column already sorted descending", () => {
            const currentSort: SortState = {
                field: "eventClass",
                direction: SortDirection.DESC,
            };
            const result = getNextSortState(currentSort, "eventClass");
            expect(result).to.be.undefined;
        });

        test("should cycle correctly: undefined → ASC → DESC → undefined", () => {
            let state = getNextSortState(undefined, "col");
            expect(state).to.deep.equal({
                field: "col",
                direction: SortDirection.ASC,
            });

            state = getNextSortState(state, "col");
            expect(state).to.deep.equal({
                field: "col",
                direction: SortDirection.DESC,
            });

            state = getNextSortState(state, "col");
            expect(state).to.be.undefined;
        });

        test("should reset to ascending when switching between columns after DESC", () => {
            const currentSort: SortState = {
                field: "colA",
                direction: SortDirection.DESC,
            };
            const result = getNextSortState(currentSort, "colB");
            expect(result).to.deep.equal({
                field: "colB",
                direction: SortDirection.ASC,
            });
        });
    });
});
