/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { uuid } from "../../../src/utils/utils";
import { FilteredBuffer } from "../../../src/profiler/filteredBuffer";
import { IndexedRow, FilterOperator, FilterTypeHint } from "../../../src/profiler/profilerTypes";

interface TestRow extends IndexedRow {
    eventNumber: number;
    name: string;
    value: number;
    timestamp: Date;
    category?: string;
    additionalData?: Record<string, string>;
}

/**
 * Helper function to create test row data with UUID and eventNumber
 */
let nextEventNumber = 1;
function createTestRow(
    name: string,
    value: number,
    timestampOffset: number = 0,
    category?: string,
    additionalData?: Record<string, string>,
): TestRow {
    return {
        id: uuid(),
        eventNumber: nextEventNumber++,
        name,
        value,
        timestamp: new Date(Date.now() + timestampOffset),
        category,
        additionalData,
    };
}

/**
 * Reset event number counter for clean test state
 */
function resetEventNumber(): void {
    nextEventNumber = 1;
}

suite("FilteredBuffer Tests", () => {
    let filteredBuffer: FilteredBuffer<TestRow>;

    setup(() => {
        resetEventNumber();
        filteredBuffer = new FilteredBuffer<TestRow>(100);
    });

    suite("constructor", () => {
        test("should create a FilteredBuffer with correct initial state", () => {
            expect(filteredBuffer.capacity).to.equal(100);
            expect(filteredBuffer.size).to.equal(0);
            expect(filteredBuffer.isFilterActive).to.be.false;
            expect(filteredBuffer.clauses).to.have.length(0);
        });
    });

    suite("filter state management", () => {
        test("isFilterActive returns false when no filter is set", () => {
            expect(filteredBuffer.isFilterActive).to.be.false;
        });

        test("isFilterActive returns true when filter is enabled with clauses", () => {
            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            expect(filteredBuffer.isFilterActive).to.be.true;
        });

        test("clearFilter clears all clauses and disables filter", () => {
            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            expect(filteredBuffer.isFilterActive).to.be.true;

            filteredBuffer.clearColumnFilters();
            expect(filteredBuffer.isFilterActive).to.be.false;
            expect(filteredBuffer.clauses).to.have.length(0);
        });
    });

    suite("totalCount and filteredCount", () => {
        test("totalCount returns underlying buffer size", () => {
            filteredBuffer.add(createTestRow("test1", 1));
            filteredBuffer.add(createTestRow("test2", 2));
            filteredBuffer.add(createTestRow("test3", 3));

            expect(filteredBuffer.totalCount).to.equal(3);
        });

        test("filteredCount equals totalCount when no filter is active", () => {
            filteredBuffer.add(createTestRow("test1", 1));
            filteredBuffer.add(createTestRow("test2", 2));

            expect(filteredBuffer.filteredCount).to.equal(2);
        });

        test("filteredCount returns matching rows count when filter is active", () => {
            filteredBuffer.add(createTestRow("apple", 1));
            filteredBuffer.add(createTestRow("banana", 2));
            filteredBuffer.add(createTestRow("apple pie", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
            ]);

            expect(filteredBuffer.totalCount).to.equal(3);
            expect(filteredBuffer.filteredCount).to.equal(2);
        });
    });

    suite("getFilteredRows", () => {
        test("returns all rows when no filter is active", () => {
            filteredBuffer.add(createTestRow("test1", 1));
            filteredBuffer.add(createTestRow("test2", 2));
            filteredBuffer.add(createTestRow("test3", 3));

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3);
        });

        test("returns only matching rows when filter is active", () => {
            filteredBuffer.add(createTestRow("apple", 1));
            filteredBuffer.add(createTestRow("banana", 2));
            filteredBuffer.add(createTestRow("cherry", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "a" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows[0].name).to.equal("apple");
            expect(rows[1].name).to.equal("banana");
        });

        test("returns ALL rows after clearing filter (including those that arrived while filtering)", () => {
            // Add initial rows
            filteredBuffer.add(createTestRow("apple", 1));
            filteredBuffer.add(createTestRow("banana", 2));

            // Apply filter
            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
            ]);

            // Add more rows while filter is active (simulating live events)
            filteredBuffer.add(createTestRow("cherry", 3));
            filteredBuffer.add(createTestRow("apple crisp", 4));

            // Verify only matching rows show
            expect(filteredBuffer.getFilteredRows()).to.have.length(2);

            // Clear filter - should show ALL rows including cherry
            filteredBuffer.clearColumnFilters();
            const allRows = filteredBuffer.getFilteredRows();
            expect(allRows).to.have.length(4);
            expect(allRows.map((r) => r.name)).to.include("cherry");
        });
    });

    suite("getFilteredRange", () => {
        test("returns correct range of filtered rows", () => {
            for (let i = 1; i <= 10; i++) {
                filteredBuffer.add(createTestRow(`row${i}`, i));
            }

            const rows = filteredBuffer.getFilteredRange(2, 3);
            expect(rows).to.have.length(3);
            expect(rows[0].name).to.equal("row3");
            expect(rows[2].name).to.equal("row5");
        });

        test("returns empty array for invalid startIndex", () => {
            filteredBuffer.add(createTestRow("test", 1));

            expect(filteredBuffer.getFilteredRange(-1, 5)).to.have.length(0);
            expect(filteredBuffer.getFilteredRange(100, 5)).to.have.length(0);
        });

        test("truncates count to available rows", () => {
            filteredBuffer.add(createTestRow("test1", 1));
            filteredBuffer.add(createTestRow("test2", 2));
            filteredBuffer.add(createTestRow("test3", 3));

            const rows = filteredBuffer.getFilteredRange(1, 100);
            expect(rows).to.have.length(2);
        });
    });

    suite("matches", () => {
        test("returns true when no filter is active", () => {
            const row = createTestRow("test", 1);
            expect(filteredBuffer.matches(row)).to.be.true;
        });

        test("returns true when row matches filter", () => {
            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            const row = createTestRow("testing", 1);
            expect(filteredBuffer.matches(row)).to.be.true;
        });

        test("returns false when row does not match filter", () => {
            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "xyz" },
            ]);
            const row = createTestRow("testing", 1);
            expect(filteredBuffer.matches(row)).to.be.false;
        });
    });

    suite("FilterOperator.Equals", () => {
        test("matches exact string (case-insensitive)", () => {
            filteredBuffer.add(createTestRow("Apple", 1));
            filteredBuffer.add(createTestRow("apple", 2));
            filteredBuffer.add(createTestRow("APPLE", 3));
            filteredBuffer.add(createTestRow("banana", 4));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Equals, value: "apple" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3);
        });

        test("matches exact number", () => {
            filteredBuffer.add(createTestRow("test1", 100));
            filteredBuffer.add(createTestRow("test2", 200));
            filteredBuffer.add(createTestRow("test3", 100));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.Equals,
                    value: 100,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("handles null comparison for equals", () => {
            filteredBuffer.add(createTestRow("test1", 1, 0, "cat1"));
            filteredBuffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.Equals, value: undefined },
            ]);

            // Only undefined category should match
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("test2");
        });
    });

    suite("FilterOperator.NotEquals", () => {
        test("excludes matching values", () => {
            filteredBuffer.add(createTestRow("apple", 1));
            filteredBuffer.add(createTestRow("banana", 2));
            filteredBuffer.add(createTestRow("cherry", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.NotEquals, value: "banana" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.map((r) => r.name)).to.not.include("banana");
        });
    });

    suite("FilterOperator.LessThan", () => {
        test("filters numbers less than value", () => {
            filteredBuffer.add(createTestRow("test1", 10));
            filteredBuffer.add(createTestRow("test2", 20));
            filteredBuffer.add(createTestRow("test3", 30));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.LessThan,
                    value: 25,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.value < 25)).to.be.true;
        });

        test("returns no match when numeric parsing fails", () => {
            filteredBuffer.add(createTestRow("test1", 10));

            filteredBuffer.setColumnFilters([
                {
                    field: "name",
                    operator: FilterOperator.LessThan,
                    value: 5,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            // "test1" cannot be parsed as number, so no match
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("FilterOperator.LessThanOrEqual", () => {
        test("filters numbers less than or equal to value", () => {
            filteredBuffer.add(createTestRow("test1", 10));
            filteredBuffer.add(createTestRow("test2", 20));
            filteredBuffer.add(createTestRow("test3", 30));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.LessThanOrEqual,
                    value: 20,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.GreaterThan", () => {
        test("filters numbers greater than value", () => {
            filteredBuffer.add(createTestRow("test1", 10));
            filteredBuffer.add(createTestRow("test2", 20));
            filteredBuffer.add(createTestRow("test3", 30));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.GreaterThan,
                    value: 15,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.GreaterThanOrEqual", () => {
        test("filters numbers greater than or equal to value", () => {
            filteredBuffer.add(createTestRow("test1", 10));
            filteredBuffer.add(createTestRow("test2", 20));
            filteredBuffer.add(createTestRow("test3", 30));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: 20,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.IsNull", () => {
        test("matches null values", () => {
            filteredBuffer.add(createTestRow("test1", 1, 0, "category"));
            filteredBuffer.add(createTestRow("test2", 2, 0, undefined));
            filteredBuffer.add(createTestRow("test3", 3, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.IsNull },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("matches missing fields", () => {
            filteredBuffer.add(createTestRow("test1", 1));

            filteredBuffer.setColumnFilters([
                { field: "nonExistentField", operator: FilterOperator.IsNull },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
        });
    });

    suite("FilterOperator.IsNotNull", () => {
        test("matches non-null values", () => {
            filteredBuffer.add(createTestRow("test1", 1, 0, "category"));
            filteredBuffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.IsNotNull },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("test1");
        });
    });

    suite("FilterOperator.Contains", () => {
        test("matches substring (case-insensitive)", () => {
            filteredBuffer.add(createTestRow("Hello World", 1));
            filteredBuffer.add(createTestRow("hello there", 2));
            filteredBuffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "HELLO" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("returns false for null field value", () => {
            filteredBuffer.add(createTestRow("test", 1, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.Contains, value: "any" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("FilterOperator.NotContains", () => {
        test("excludes rows containing substring", () => {
            filteredBuffer.add(createTestRow("Hello World", 1));
            filteredBuffer.add(createTestRow("hello there", 2));
            filteredBuffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.NotContains, value: "hello" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("goodbye");
        });

        test("returns true for null/missing field (does not contain)", () => {
            filteredBuffer.add(createTestRow("test1", 1, 0, "hasCategory"));
            filteredBuffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.NotContains, value: "xyz" },
            ]);

            // Both should match: "hasCategory" doesn't contain "xyz", and undefined treated as "does not contain"
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.StartsWith", () => {
        test("matches string prefix (case-insensitive)", () => {
            filteredBuffer.add(createTestRow("Hello World", 1));
            filteredBuffer.add(createTestRow("HELLO there", 2));
            filteredBuffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.StartsWith, value: "hello" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("returns false for null field value", () => {
            filteredBuffer.add(createTestRow("test", 1, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.StartsWith, value: "any" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("FilterOperator.NotStartsWith", () => {
        test("excludes rows starting with prefix", () => {
            filteredBuffer.add(createTestRow("Hello World", 1));
            filteredBuffer.add(createTestRow("hello there", 2));
            filteredBuffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.NotStartsWith, value: "hello" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("goodbye");
        });

        test("returns true for null/missing field (does not start with)", () => {
            filteredBuffer.add(createTestRow("test1", 1, 0, "category"));
            filteredBuffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setColumnFilters([
                { field: "category", operator: FilterOperator.NotStartsWith, value: "x" },
            ]);

            // Both should match
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("AND combination of multiple clauses", () => {
        test("all clauses must match for row to be included", () => {
            filteredBuffer.add(createTestRow("apple", 100, 0, "fruit"));
            filteredBuffer.add(createTestRow("banana", 200, 0, "fruit"));
            filteredBuffer.add(createTestRow("carrot", 50, 0, "vegetable"));
            filteredBuffer.add(createTestRow("apple pie", 150, 0, "dessert"));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
                {
                    field: "value",
                    operator: FilterOperator.GreaterThan,
                    value: 50,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.name.includes("apple") && r.value > 50)).to.be.true;
        });

        test("returns empty when no rows match all clauses", () => {
            filteredBuffer.add(createTestRow("apple", 100));
            filteredBuffer.add(createTestRow("banana", 200));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
                {
                    field: "value",
                    operator: FilterOperator.Equals,
                    value: 999,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("additionalData field access", () => {
        test("can filter on fields in additionalData", () => {
            filteredBuffer.add(
                createTestRow("test1", 1, 0, undefined, { query: "SELECT * FROM users" }),
            );
            filteredBuffer.add(
                createTestRow("test2", 2, 0, undefined, { query: "INSERT INTO logs" }),
            );
            filteredBuffer.add(
                createTestRow("test3", 3, 0, undefined, { query: "SELECT id FROM orders" }),
            );

            filteredBuffer.setColumnFilters([
                { field: "query", operator: FilterOperator.Contains, value: "SELECT" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("date comparison", () => {
        test("filters dates correctly", () => {
            const now = Date.now();
            filteredBuffer.add(createTestRow("past", 1, -10000)); // 10 seconds ago
            filteredBuffer.add(createTestRow("recent", 2, -1000)); // 1 second ago
            filteredBuffer.add(createTestRow("future", 3, 10000)); // 10 seconds in future

            filteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThan,
                    value: new Date(now - 5000).toISOString(),
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("boolean comparison", () => {
        test("filters booleans correctly", () => {
            interface BoolRow extends IndexedRow {
                eventNumber: number;
                name: string;
                active: boolean;
            }

            const boolFiltered = new FilteredBuffer<BoolRow>(10);

            boolFiltered.add({ id: uuid(), eventNumber: 1, name: "test1", active: true });
            boolFiltered.add({ id: uuid(), eventNumber: 2, name: "test2", active: false });
            boolFiltered.add({ id: uuid(), eventNumber: 3, name: "test3", active: true });

            boolFiltered.setColumnFilters([
                {
                    field: "active",
                    operator: FilterOperator.Equals,
                    value: true,
                    typeHint: FilterTypeHint.Boolean,
                },
            ]);

            const rows = boolFiltered.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("unknown operator handling", () => {
        test("unknown operator returns no match", () => {
            filteredBuffer.add(createTestRow("test", 1));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: "unknownOp" as FilterOperator, value: "test" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("empty string and whitespace handling", () => {
        test("empty string filter value", () => {
            filteredBuffer.add(createTestRow("", 1));
            filteredBuffer.add(createTestRow("test", 2));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Equals, value: "" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("");
        });

        test("numeric string parsing with whitespace", () => {
            filteredBuffer.add(createTestRow("test1", 100));
            filteredBuffer.add(createTestRow("test2", 200));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.Equals,
                    value: "  100  " as unknown as number,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
        });
    });

    suite("Real EventRow field coverage", () => {
        /**
         * EventRow structure:
         * - id: string (UUID)
         * - eventNumber: number
         * - timestamp: Date
         * - eventClass: string
         * - textData: string
         * - databaseName: string
         * - spid: number | undefined
         * - duration: number | undefined
         * - cpu: number | undefined
         * - reads: number | undefined
         * - writes: number | undefined
         * - additionalData: Record<string, string>
         */
        interface EventRow extends IndexedRow {
            eventNumber: number;
            timestamp: Date;
            eventClass: string;
            textData: string;
            databaseName: string;
            spid: number | undefined;
            duration: number | undefined;
            cpu: number | undefined;
            reads: number | undefined;
            writes: number | undefined;
            additionalData: Record<string, string>;
        }

        let eventFilteredBuffer: FilteredBuffer<EventRow>;

        function createEventRow(overrides: Partial<EventRow> = {}): EventRow {
            return {
                id: uuid(),
                eventNumber: nextEventNumber++,
                timestamp: new Date(),
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT * FROM Users",
                databaseName: "TestDB",
                spid: 55,
                duration: 1000,
                cpu: 100,
                reads: 50,
                writes: 10,
                additionalData: {},
                ...overrides,
            };
        }

        setup(() => {
            resetEventNumber();
            eventFilteredBuffer = new FilteredBuffer<EventRow>(100);
        });

        test("filters by eventClass (string field)", () => {
            eventFilteredBuffer.add(createEventRow({ eventClass: "SQL:BatchCompleted" }));
            eventFilteredBuffer.add(createEventRow({ eventClass: "RPC:Completed" }));
            eventFilteredBuffer.add(createEventRow({ eventClass: "SQL:BatchStarting" }));

            eventFilteredBuffer.setColumnFilters([
                { field: "eventClass", operator: FilterOperator.Contains, value: "SQL" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by textData with StartsWith", () => {
            eventFilteredBuffer.add(createEventRow({ textData: "SELECT * FROM Users" }));
            eventFilteredBuffer.add(createEventRow({ textData: "INSERT INTO Logs VALUES" }));
            eventFilteredBuffer.add(createEventRow({ textData: "SELECT COUNT(*) FROM Orders" }));

            eventFilteredBuffer.setColumnFilters([
                { field: "textData", operator: FilterOperator.StartsWith, value: "SELECT" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by databaseName with Equals", () => {
            eventFilteredBuffer.add(createEventRow({ databaseName: "ProductionDB" }));
            eventFilteredBuffer.add(createEventRow({ databaseName: "TestDB" }));
            eventFilteredBuffer.add(createEventRow({ databaseName: "productiondb" })); // case insensitive

            eventFilteredBuffer.setColumnFilters([
                { field: "databaseName", operator: FilterOperator.Equals, value: "ProductionDB" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Both ProductionDB and productiondb match
        });

        test("filters by spid (number | undefined field) with Equals", () => {
            eventFilteredBuffer.add(createEventRow({ spid: 55 }));
            eventFilteredBuffer.add(createEventRow({ spid: 60 }));
            eventFilteredBuffer.add(createEventRow({ spid: undefined }));

            eventFilteredBuffer.setColumnFilters([
                {
                    field: "spid",
                    operator: FilterOperator.Equals,
                    value: 55,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].spid).to.equal(55);
        });

        test("filters by spid with IsNull to find undefined values", () => {
            eventFilteredBuffer.add(createEventRow({ spid: 55 }));
            eventFilteredBuffer.add(createEventRow({ spid: undefined }));
            eventFilteredBuffer.add(createEventRow({ spid: undefined }));

            eventFilteredBuffer.setColumnFilters([
                { field: "spid", operator: FilterOperator.IsNull },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by duration with GreaterThan", () => {
            eventFilteredBuffer.add(createEventRow({ duration: 500 }));
            eventFilteredBuffer.add(createEventRow({ duration: 1500 }));
            eventFilteredBuffer.add(createEventRow({ duration: 3000 }));
            eventFilteredBuffer.add(createEventRow({ duration: undefined }));

            eventFilteredBuffer.setColumnFilters([
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThan,
                    value: 1000,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.duration !== undefined && r.duration > 1000)).to.be.true;
        });

        test("filters by cpu with LessThanOrEqual", () => {
            eventFilteredBuffer.add(createEventRow({ cpu: 50 }));
            eventFilteredBuffer.add(createEventRow({ cpu: 100 }));
            eventFilteredBuffer.add(createEventRow({ cpu: 200 }));

            eventFilteredBuffer.setColumnFilters([
                {
                    field: "cpu",
                    operator: FilterOperator.LessThanOrEqual,
                    value: 100,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by reads with NotEquals", () => {
            eventFilteredBuffer.add(createEventRow({ reads: 0 }));
            eventFilteredBuffer.add(createEventRow({ reads: 100 }));
            eventFilteredBuffer.add(createEventRow({ reads: 0 }));

            eventFilteredBuffer.setColumnFilters([
                {
                    field: "reads",
                    operator: FilterOperator.NotEquals,
                    value: 0,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].reads).to.equal(100);
        });

        test("filters by additionalData nested field", () => {
            eventFilteredBuffer.add(
                createEventRow({
                    additionalData: { client_app_name: "SQL Server Management Studio" },
                }),
            );
            eventFilteredBuffer.add(
                createEventRow({ additionalData: { client_app_name: "Azure Data Studio" } }),
            );
            eventFilteredBuffer.add(
                createEventRow({ additionalData: { client_app_name: "VS Code mssql" } }),
            );

            eventFilteredBuffer.setColumnFilters([
                {
                    field: "client_app_name",
                    operator: FilterOperator.Contains,
                    value: "Studio",
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("Date filtering with various input formats", () => {
        /**
         * These tests verify date filtering works with different string formats
         * that users might enter in the filter input field.
         */
        interface DateTestRow extends IndexedRow {
            eventNumber: number;
            timestamp: Date;
            name: string;
        }

        let dateFilteredBuffer: FilteredBuffer<DateTestRow>;

        // Fixed dates for predictable testing
        const date2024Jan15 = new Date("2024-01-15T10:30:00.000Z");
        const date2024Mar20 = new Date("2024-03-20T14:45:00.000Z");
        const date2024Jun01 = new Date("2024-06-01T08:00:00.000Z");
        const date2024Dec31 = new Date("2024-12-31T23:59:59.000Z");

        setup(() => {
            resetEventNumber();
            dateFilteredBuffer = new FilteredBuffer<DateTestRow>(100);

            dateFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Jan15,
                name: "January event",
            });
            dateFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Mar20,
                name: "March event",
            });
            dateFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Jun01,
                name: "June event",
            });
            dateFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Dec31,
                name: "December event",
            });
        });

        test("filters dates with ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)", () => {
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThan,
                    value: "2024-03-01T00:00:00.000Z",
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // Mar, Jun, Dec
        });

        test("filters dates with simplified ISO format (YYYY-MM-DD)", () => {
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.LessThan,
                    value: "2024-06-01",
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jan and Mar (Jun is at midnight so not less than)
        });

        test("filters dates with Equals using ISO date", () => {
            // Note: Equals on dates requires exact match including time
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.Equals,
                    value: "2024-01-15T10:30:00.000Z",
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("January event");
        });

        test("filters dates with GreaterThanOrEqual", () => {
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2024-06-01T08:00:00.000Z",
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jun (exact match) and Dec
        });

        test("filters dates with LessThanOrEqual", () => {
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.LessThanOrEqual,
                    value: "2024-03-20T14:45:00.000Z",
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jan and Mar (exact match)
        });

        test("filters dates between range using two clauses", () => {
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2024-02-01",
                    typeHint: FilterTypeHint.Date,
                },
                {
                    field: "timestamp",
                    operator: FilterOperator.LessThan,
                    value: "2024-07-01",
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Mar and Jun
        });

        test("filters with Date object value converted to string", () => {
            const filterDate = new Date("2024-05-01T00:00:00.000Z");
            dateFilteredBuffer.setColumnFilters([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThan,
                    value: filterDate.toISOString(),
                    typeHint: FilterTypeHint.Date,
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jun and Dec
        });
    });

    suite("Profiler date format (YYYY-MM-DD HH:mm:ss.sss)", () => {
        /**
         * Tests for the profiler's specific date format that uses space separator
         * instead of 'T' and no 'Z' suffix. This is the format used when displaying
         * timestamps in the profiler grid after conversion.
         * Format: "2026-01-21 20:29:10.000"
         */
        interface ProfilerDateRow extends IndexedRow {
            eventNumber: number;
            StartTime: string; // Profiler stores as formatted string in grid
            name: string;
        }

        let profilerFilteredBuffer: FilteredBuffer<ProfilerDateRow>;

        setup(() => {
            resetEventNumber();
            profilerFilteredBuffer = new FilteredBuffer<ProfilerDateRow>(100);

            // Add events with profiler-format timestamp strings (as they appear in grid)
            profilerFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 20:00:00.000",
                name: "Early event",
            });
            profilerFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 20:29:10.000",
                name: "Middle event",
            });
            profilerFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 20:32:00.000",
                name: "Late event",
            });
            profilerFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 21:00:00.000",
                name: "Much later event",
            });
        });

        test("GreaterThan with profiler format filters correctly", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.GreaterThan,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Late and Much later (not Middle since it's equal)
            expect(rows.map((r) => r.name)).to.deep.equal(["Late event", "Much later event"]);
        });

        test("GreaterThanOrEqual with profiler format includes exact match", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // Middle, Late, and Much later
        });

        test("LessThan with profiler format filters correctly", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.LessThan,
                    value: "2026-01-21 20:32:00.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Early and Middle
            expect(rows.map((r) => r.name)).to.deep.equal(["Early event", "Middle event"]);
        });

        test("LessThanOrEqual with profiler format includes exact match", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.LessThanOrEqual,
                    value: "2026-01-21 20:32:00.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // Early, Middle, and Late (exact match)
        });

        test("Equals with profiler format requires exact time match", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.Equals,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("Middle event");
        });

        test("NotEquals with profiler format", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.NotEquals,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // All except Middle event
        });

        test("range filter with profiler format", () => {
            profilerFilteredBuffer.setColumnFilters([
                {
                    field: "StartTime",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: FilterTypeHint.DateTime,
                },
                {
                    field: "StartTime",
                    operator: FilterOperator.LessThan,
                    value: "2026-01-21 21:00:00.000",
                    typeHint: FilterTypeHint.DateTime,
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Middle and Late
            expect(rows.map((r) => r.name)).to.deep.equal(["Middle event", "Late event"]);
        });
    });

    suite("Multi-clause filter combinations (3+ clauses)", () => {
        interface ComplexRow extends IndexedRow {
            eventNumber: number;
            eventClass: string;
            textData: string;
            databaseName: string;
            duration: number | undefined;
            spid: number;
        }

        let complexFilteredBuffer: FilteredBuffer<ComplexRow>;

        setup(() => {
            resetEventNumber();
            complexFilteredBuffer = new FilteredBuffer<ComplexRow>(100);

            // Add diverse test data
            complexFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT * FROM Users WHERE active = 1",
                databaseName: "ProductionDB",
                duration: 500,
                spid: 55,
            });
            complexFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT * FROM Orders WHERE total > 100",
                databaseName: "ProductionDB",
                duration: 2000,
                spid: 60,
            });
            complexFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                eventClass: "RPC:Completed",
                textData: "sp_GetUserDetails @userId = 123",
                databaseName: "ProductionDB",
                duration: 100,
                spid: 55,
            });
            complexFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "INSERT INTO Logs VALUES (1, 'test')",
                databaseName: "TestDB",
                duration: 50,
                spid: 70,
            });
            complexFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT id FROM Users",
                databaseName: "ProductionDB",
                duration: 1500,
                spid: 55,
            });
        });

        test("3 clauses: eventClass AND textData AND databaseName", () => {
            complexFilteredBuffer.setColumnFilters([
                {
                    field: "eventClass",
                    operator: FilterOperator.Equals,
                    value: "SQL:BatchCompleted",
                },
                { field: "textData", operator: FilterOperator.StartsWith, value: "SELECT" },
                { field: "databaseName", operator: FilterOperator.Equals, value: "ProductionDB" },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // All SELECT queries in ProductionDB
        });

        test("4 clauses: eventClass AND textData AND databaseName AND duration", () => {
            complexFilteredBuffer.setColumnFilters([
                {
                    field: "eventClass",
                    operator: FilterOperator.Equals,
                    value: "SQL:BatchCompleted",
                },
                { field: "textData", operator: FilterOperator.StartsWith, value: "SELECT" },
                { field: "databaseName", operator: FilterOperator.Equals, value: "ProductionDB" },
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThan,
                    value: 1000,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Slow SELECT queries in ProductionDB
        });

        test("4 clauses with different operator types", () => {
            complexFilteredBuffer.setColumnFilters([
                { field: "eventClass", operator: FilterOperator.Contains, value: "Batch" },
                { field: "textData", operator: FilterOperator.NotContains, value: "INSERT" },
                {
                    field: "spid",
                    operator: FilterOperator.Equals,
                    value: 55,
                    typeHint: FilterTypeHint.Number,
                },
                {
                    field: "duration",
                    operator: FilterOperator.LessThanOrEqual,
                    value: 1000,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1); // Only the first SELECT with spid=55, duration=500
            expect(rows[0].textData).to.contain("Users WHERE active");
        });

        test("5 clauses: comprehensive filtering", () => {
            complexFilteredBuffer.setColumnFilters([
                { field: "eventClass", operator: FilterOperator.StartsWith, value: "SQL" },
                { field: "textData", operator: FilterOperator.Contains, value: "SELECT" },
                { field: "databaseName", operator: FilterOperator.NotEquals, value: "TestDB" },
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: 100,
                    typeHint: FilterTypeHint.Number,
                },
                { field: "spid", operator: FilterOperator.IsNotNull },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // All ProductionDB SELECTs with duration >= 100
        });

        test("clauses that filter to empty result", () => {
            complexFilteredBuffer.setColumnFilters([
                {
                    field: "eventClass",
                    operator: FilterOperator.Equals,
                    value: "SQL:BatchCompleted",
                },
                { field: "databaseName", operator: FilterOperator.Equals, value: "NonExistentDB" },
                {
                    field: "spid",
                    operator: FilterOperator.Equals,
                    value: 999,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });

        test("clauses with mixed null checks", () => {
            // Add a row with undefined duration
            complexFilteredBuffer.add({
                id: uuid(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT 1",
                databaseName: "ProductionDB",
                duration: undefined,
                spid: 55,
            });

            complexFilteredBuffer.setColumnFilters([
                {
                    field: "eventClass",
                    operator: FilterOperator.Equals,
                    value: "SQL:BatchCompleted",
                },
                { field: "duration", operator: FilterOperator.IsNotNull },
                { field: "databaseName", operator: FilterOperator.Equals, value: "ProductionDB" },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            // Should exclude the row with undefined duration
            expect(rows).to.have.length(3);
            expect(rows.every((r) => r.duration !== undefined)).to.be.true;
        });
    });

    suite("Edge cases for numeric fields with undefined", () => {
        test("GreaterThan excludes undefined values", () => {
            filteredBuffer.add(createTestRow("test1", 100));
            filteredBuffer.add(createTestRow("test2", 200));

            // Add row with value field but using category to simulate optional number
            interface OptionalNumRow extends IndexedRow {
                eventNumber: number;
                name: string;
                optionalNum?: number;
            }

            const optFiltered = new FilteredBuffer<OptionalNumRow>(10);

            optFiltered.add({ id: uuid(), eventNumber: 1, name: "has value", optionalNum: 150 });
            optFiltered.add({
                id: uuid(),
                eventNumber: 2,
                name: "no value",
                optionalNum: undefined,
            });
            optFiltered.add({ id: uuid(), eventNumber: 3, name: "high value", optionalNum: 300 });

            optFiltered.setColumnFilters([
                {
                    field: "optionalNum",
                    operator: FilterOperator.GreaterThan,
                    value: 100,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = optFiltered.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.optionalNum !== undefined && r.optionalNum > 100)).to.be
                .true;
        });

        test("combining IsNotNull with numeric comparison", () => {
            interface OptionalNumRow extends IndexedRow {
                eventNumber: number;
                name: string;
                duration?: number;
            }

            const optFiltered = new FilteredBuffer<OptionalNumRow>(10);

            optFiltered.add({ id: uuid(), eventNumber: 1, name: "fast", duration: 50 });
            optFiltered.add({ id: uuid(), eventNumber: 2, name: "slow", duration: 5000 });
            optFiltered.add({ id: uuid(), eventNumber: 3, name: "unknown", duration: undefined });

            // Find slow queries (duration > 1000) but only where duration is known
            optFiltered.setColumnFilters([
                { field: "duration", operator: FilterOperator.IsNotNull },
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThan,
                    value: 1000,
                    typeHint: FilterTypeHint.Number,
                },
            ]);

            const rows = optFiltered.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("slow");
        });
    });

    suite("EndsWith operator", () => {
        test("should match values that end with the specified string", () => {
            filteredBuffer.add(createTestRow("SELECT * FROM users", 1));
            filteredBuffer.add(createTestRow("INSERT INTO orders", 2));
            filteredBuffer.add(createTestRow("DELETE FROM users", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.EndsWith, value: "users" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows[0].name).to.equal("SELECT * FROM users");
            expect(rows[1].name).to.equal("DELETE FROM users");
        });

        test("should be case-insensitive", () => {
            filteredBuffer.add(createTestRow("query.SQL", 1));
            filteredBuffer.add(createTestRow("query.txt", 2));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.EndsWith, value: ".sql" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("query.SQL");
        });

        test("should return no results when nothing matches", () => {
            filteredBuffer.add(createTestRow("hello", 1));
            filteredBuffer.add(createTestRow("world", 2));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.EndsWith, value: "xyz" },
            ]);

            expect(filteredBuffer.getFilteredRows()).to.have.length(0);
        });
    });

    suite("NotEndsWith operator", () => {
        test("should match values that do not end with the specified string", () => {
            filteredBuffer.add(createTestRow("SELECT * FROM users", 1));
            filteredBuffer.add(createTestRow("INSERT INTO orders", 2));
            filteredBuffer.add(createTestRow("DELETE FROM users", 3));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.NotEndsWith, value: "users" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("INSERT INTO orders");
        });

        test("should be case-insensitive", () => {
            filteredBuffer.add(createTestRow("query.SQL", 1));
            filteredBuffer.add(createTestRow("query.txt", 2));

            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.NotEndsWith, value: ".sql" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("query.txt");
        });
    });

    suite("In operator", () => {
        test("should match values in the specified set", () => {
            filteredBuffer.add(createTestRow("Alpha", 1, 0, "catA"));
            filteredBuffer.add(createTestRow("Beta", 2, 0, "catB"));
            filteredBuffer.add(createTestRow("Gamma", 3, 0, "catC"));
            filteredBuffer.add(createTestRow("Delta", 4, 0, "catA"));

            filteredBuffer.setColumnFilters([
                {
                    field: "category",
                    operator: FilterOperator.In,
                    values: ["catA", "catC"],
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3);
            expect(rows.map((r) => r.name)).to.deep.equal(["Alpha", "Gamma", "Delta"]);
        });

        test("should be case-insensitive", () => {
            filteredBuffer.add(createTestRow("A", 1, 0, "CatA"));
            filteredBuffer.add(createTestRow("B", 2, 0, "CATB"));
            filteredBuffer.add(createTestRow("C", 3, 0, "catc"));

            filteredBuffer.setColumnFilters([
                {
                    field: "category",
                    operator: FilterOperator.In,
                    values: ["cata", "catB"],
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.map((r) => r.name)).to.deep.equal(["A", "B"]);
        });

        test("should return no results when values array is empty", () => {
            filteredBuffer.add(createTestRow("A", 1, 0, "catA"));
            filteredBuffer.add(createTestRow("B", 2, 0, "catB"));

            filteredBuffer.setColumnFilters([
                {
                    field: "category",
                    operator: FilterOperator.In,
                    values: [],
                },
            ]);

            expect(filteredBuffer.getFilteredRows()).to.have.length(0);
        });

        test("should return no results when values is undefined", () => {
            filteredBuffer.add(createTestRow("A", 1, 0, "catA"));

            filteredBuffer.setColumnFilters([
                {
                    field: "category",
                    operator: FilterOperator.In,
                    values: undefined,
                },
            ]);

            expect(filteredBuffer.getFilteredRows()).to.have.length(0);
        });

        test("should handle numeric field values converted to strings", () => {
            filteredBuffer.add(createTestRow("A", 100));
            filteredBuffer.add(createTestRow("B", 200));
            filteredBuffer.add(createTestRow("C", 300));

            filteredBuffer.setColumnFilters([
                {
                    field: "value",
                    operator: FilterOperator.In,
                    values: ["100", "300"],
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.map((r) => r.name)).to.deep.equal(["A", "C"]);
        });
    });
    suite("applyFilter and resetFilter", () => {
        test("applyFilter sets clauses and builds cache", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));
            filteredBuffer.add(createTestRow("alpha-2", 3));

            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });

            expect(filteredBuffer.isFilterActive).to.be.true;
            expect(filteredBuffer.getFilteredCount()).to.equal(2);
            expect(filteredBuffer.getFilteredRows().map((r) => r.name)).to.deep.equal([
                "alpha",
                "alpha-2",
            ]);
        });

        test("applyFilter with quickFilter only", () => {
            filteredBuffer.add(createTestRow("hello", 1));
            filteredBuffer.add(createTestRow("world", 2));
            filteredBuffer.add(createTestRow("hello world", 3));

            filteredBuffer.applyFilter({ quickFilter: "hello" });

            expect(filteredBuffer.isFilterActive).to.be.true;
            expect(filteredBuffer.getFilteredCount()).to.equal(2);
        });

        test("applyFilter with both clauses and quickFilter", () => {
            filteredBuffer.add(createTestRow("alpha", 10));
            filteredBuffer.add(createTestRow("alpha", 20));
            filteredBuffer.add(createTestRow("beta", 10));

            filteredBuffer.applyFilter({
                clauses: [
                    {
                        field: "value",
                        operator: FilterOperator.GreaterThan,
                        value: 5,
                        typeHint: FilterTypeHint.Number,
                    },
                ],
                quickFilter: "alpha",
            });

            expect(filteredBuffer.getFilteredCount()).to.equal(2);
            expect(filteredBuffer.getFilteredRows().map((r) => r.value)).to.deep.equal([10, 20]);
        });

        test("resetFilter clears all filters and cache", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));

            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Equals, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(1);

            filteredBuffer.resetFilter();
            expect(filteredBuffer.isFilterActive).to.be.false;
            expect(filteredBuffer.getFilteredCount()).to.equal(2);
            expect(filteredBuffer.getFilteredRows()).to.have.length(2);
        });

        test("applyFilter with empty clauses clears clause filter but keeps quickFilter", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));

            filteredBuffer.applyFilter({
                clauses: [],
                quickFilter: "alpha",
            });

            expect(filteredBuffer.isFilterActive).to.be.true;
            expect(filteredBuffer.getFilteredCount()).to.equal(1);
        });
    });

    suite("cache incremental maintenance via add()", () => {
        test("add() appends matching row to cache", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(1);

            // Add another matching row — should be appended to cache
            filteredBuffer.add(createTestRow("alpha-new", 2));
            expect(filteredBuffer.getFilteredCount()).to.equal(2);
        });

        test("add() does not append non-matching row to cache", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(1);

            filteredBuffer.add(createTestRow("beta", 2));
            expect(filteredBuffer.getFilteredCount()).to.equal(1);
        });

        test("add() handles eviction of matching row from cache front", () => {
            const smallBuffer = new FilteredBuffer<TestRow>(3);

            smallBuffer.add(createTestRow("alpha-1", 1));
            smallBuffer.add(createTestRow("alpha-2", 2));
            smallBuffer.add(createTestRow("beta", 3));

            smallBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(smallBuffer.getFilteredCount()).to.equal(2);

            // Adding a 4th row evicts "alpha-1" (oldest)
            smallBuffer.add(createTestRow("alpha-3", 4));
            expect(smallBuffer.getFilteredCount()).to.equal(2); // alpha-2 + alpha-3
            expect(smallBuffer.getFilteredRows().map((r) => r.name)).to.deep.equal([
                "alpha-2",
                "alpha-3",
            ]);
        });

        test("add() handles eviction of non-matching row (cache unchanged)", () => {
            const smallBuffer = new FilteredBuffer<TestRow>(3);

            smallBuffer.add(createTestRow("beta", 1)); // will be evicted
            smallBuffer.add(createTestRow("alpha-1", 2));
            smallBuffer.add(createTestRow("alpha-2", 3));

            smallBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(smallBuffer.getFilteredCount()).to.equal(2);

            // Adding a 4th row evicts "beta" which is NOT in cache
            smallBuffer.add(createTestRow("alpha-3", 4));
            expect(smallBuffer.getFilteredCount()).to.equal(3); // alpha-1, alpha-2, alpha-3
        });

        test("add() with no active cache (no filter) does nothing extra", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            // No filter applied — add should not build cache
            filteredBuffer.add(createTestRow("beta", 2));
            expect(filteredBuffer.getFilteredCount()).to.equal(2);
            expect(filteredBuffer.isFilterActive).to.be.false;
        });

        test("multiple consecutive evictions maintain cache correctly", () => {
            const smallBuffer = new FilteredBuffer<TestRow>(3);

            smallBuffer.add(createTestRow("alpha-1", 1));
            smallBuffer.add(createTestRow("beta-1", 2));
            smallBuffer.add(createTestRow("alpha-2", 3));

            smallBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(smallBuffer.getFilteredCount()).to.equal(2);

            // Evict alpha-1 (matching, in cache)
            smallBuffer.add(createTestRow("alpha-3", 4));
            expect(smallBuffer.getFilteredCount()).to.equal(2); // alpha-2, alpha-3

            // Evict beta-1 (non-matching, not in cache)
            smallBuffer.add(createTestRow("beta-2", 5));
            expect(smallBuffer.getFilteredCount()).to.equal(2); // alpha-2, alpha-3

            // Evict alpha-2 (matching, in cache)
            smallBuffer.add(createTestRow("alpha-4", 6));
            expect(smallBuffer.getFilteredCount()).to.equal(2); // alpha-3, alpha-4
            expect(smallBuffer.getFilteredRows().map((r) => r.name)).to.deep.equal([
                "alpha-3",
                "alpha-4",
            ]);
        });

        test("eviction when cache is empty (all rows filtered out)", () => {
            const smallBuffer = new FilteredBuffer<TestRow>(3);

            smallBuffer.add(createTestRow("beta-1", 1));
            smallBuffer.add(createTestRow("beta-2", 2));
            smallBuffer.add(createTestRow("beta-3", 3));

            // Filter matches nothing — cache is empty
            smallBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(smallBuffer.getFilteredCount()).to.equal(0);

            // Evict beta-1 (not in cache), add non-matching row
            smallBuffer.add(createTestRow("beta-4", 4));
            expect(smallBuffer.getFilteredCount()).to.equal(0);

            // Evict beta-2, add matching row — cache goes from empty to 1
            smallBuffer.add(createTestRow("alpha-1", 5));
            expect(smallBuffer.getFilteredCount()).to.equal(1);
            expect(smallBuffer.getFilteredRows().map((r) => r.name)).to.deep.equal(["alpha-1"]);
        });

        test("eviction with quick filter active", () => {
            const smallBuffer = new FilteredBuffer<TestRow>(3);

            smallBuffer.add(createTestRow("hello world", 1));
            smallBuffer.add(createTestRow("hello there", 2));
            smallBuffer.add(createTestRow("goodbye", 3));

            smallBuffer.applyFilter({ quickFilter: "hello" });
            expect(smallBuffer.getFilteredCount()).to.equal(2);

            // Evict "hello world" (matching, in cache), add non-matching
            smallBuffer.add(createTestRow("farewell", 4));
            expect(smallBuffer.getFilteredCount()).to.equal(1); // hello there

            // Evict "hello there" (matching, in cache), add matching
            smallBuffer.add(createTestRow("hello again", 5));
            expect(smallBuffer.getFilteredCount()).to.equal(1); // hello again
            expect(smallBuffer.getFilteredRows().map((r) => r.name)).to.deep.equal(["hello again"]);
        });
    });

    suite("cache invalidation", () => {
        test("setColumnFilters invalidates cache (lazy rebuild on next read)", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));
            filteredBuffer.add(createTestRow("gamma", 3));

            // Build cache via applyFilter
            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(1);

            // Use legacy setter — should invalidate cache but still work
            filteredBuffer.setColumnFilters([
                { field: "name", operator: FilterOperator.Contains, value: "a" },
            ]);
            // Lazy rebuild on read
            expect(filteredBuffer.getFilteredCount()).to.equal(3); // alpha, beta (no 'a'), gamma
        });

        test("setQuickFilter invalidates cache (lazy rebuild on next read)", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));

            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(1);

            // Legacy setQuickFilter — changes filter and invalidates cache
            filteredBuffer.setQuickFilter("beta");
            // Now both clause (alpha) and quick (beta) are active — nothing matches both
            expect(filteredBuffer.getFilteredCount()).to.equal(0);
        });

        test("clear() clears the cache", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(1);

            filteredBuffer.clear();
            expect(filteredBuffer.getFilteredCount()).to.equal(0);
            expect(filteredBuffer.size).to.equal(0);
        });

        test("clearRange() invalidates cache", () => {
            filteredBuffer.add(createTestRow("alpha-1", 1));
            filteredBuffer.add(createTestRow("alpha-2", 2));
            filteredBuffer.add(createTestRow("beta", 3));

            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });
            expect(filteredBuffer.getFilteredCount()).to.equal(2);

            // Remove oldest row
            filteredBuffer.clearRange(1);
            // Cache was invalidated — lazy rebuild
            expect(filteredBuffer.getFilteredCount()).to.equal(1); // only alpha-2 remains
        });

        test("setRowConverter invalidates cache", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));

            filteredBuffer.applyFilter({
                clauses: [
                    { field: "displayName", operator: FilterOperator.Contains, value: "alpha" },
                ],
            });
            // Without converter, "displayName" doesn't exist — nothing matches
            expect(filteredBuffer.getFilteredCount()).to.equal(0);

            // Set a converter that maps name → displayName
            filteredBuffer.setRowConverter((row) => ({
                ...row,
                displayName: row.name,
            }));
            // Cache was invalidated — lazy rebuild now uses converter
            expect(filteredBuffer.getFilteredCount()).to.equal(1);
        });
    });

    suite("getFilteredRange with cache", () => {
        test("returns correct page from cached results", () => {
            for (let i = 0; i < 10; i++) {
                filteredBuffer.add(createTestRow(`item-${i}`, i));
            }

            filteredBuffer.applyFilter({
                clauses: [
                    {
                        field: "value",
                        operator: FilterOperator.GreaterThanOrEqual,
                        value: 3,
                        typeHint: FilterTypeHint.Number,
                    },
                ],
            });

            // Filtered: items 3-9 = 7 rows
            expect(filteredBuffer.getFilteredCount()).to.equal(7);

            // Get page 2 (rows 2-4 of filtered)
            const page = filteredBuffer.getFilteredRange(2, 3);
            expect(page).to.have.length(3);
            expect(page.map((r) => r.value)).to.deep.equal([5, 6, 7]);
        });
    });

    suite("filteredCount getter with cache", () => {
        test("returns total count when no filter active", () => {
            filteredBuffer.add(createTestRow("a", 1));
            filteredBuffer.add(createTestRow("b", 2));
            expect(filteredBuffer.filteredCount).to.equal(2);
        });

        test("returns cached filtered count when filter is active", () => {
            filteredBuffer.add(createTestRow("alpha", 1));
            filteredBuffer.add(createTestRow("beta", 2));
            filteredBuffer.add(createTestRow("alpha-2", 3));

            filteredBuffer.applyFilter({
                clauses: [{ field: "name", operator: FilterOperator.Contains, value: "alpha" }],
            });

            expect(filteredBuffer.filteredCount).to.equal(2);
        });
    });
});
