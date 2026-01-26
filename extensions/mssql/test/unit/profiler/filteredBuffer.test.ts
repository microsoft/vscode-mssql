/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { v4 as uuidv4 } from "uuid";
import { RingBuffer } from "../../../src/profiler/ringBuffer";
import { FilteredBuffer } from "../../../src/profiler/filteredBuffer";
import { IndexedRow, FilterOperator, FilterClause } from "../../../src/profiler/profilerTypes";

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
        id: uuidv4(),
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
    let buffer: RingBuffer<TestRow>;
    let filteredBuffer: FilteredBuffer<TestRow>;

    setup(() => {
        resetEventNumber();
        buffer = new RingBuffer<TestRow>(100);
        filteredBuffer = new FilteredBuffer<TestRow>(buffer);
    });

    suite("constructor", () => {
        test("should create a filtered buffer wrapping a RingBuffer", () => {
            expect(filteredBuffer.buffer).to.equal(buffer);
            expect(filteredBuffer.isFilterActive).to.be.false;
            expect(filteredBuffer.clauses).to.have.length(0);
        });
    });

    suite("filter state management", () => {
        test("isFilterActive returns false when no filter is set", () => {
            expect(filteredBuffer.isFilterActive).to.be.false;
        });

        test("isFilterActive returns true when filter is enabled with clauses", () => {
            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            expect(filteredBuffer.isFilterActive).to.be.true;
        });

        test("isFilterActive returns false when filter is disabled", () => {
            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            filteredBuffer.setEnabled(false);
            expect(filteredBuffer.isFilterActive).to.be.false;
        });

        test("clearFilter clears all clauses and disables filter", () => {
            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            expect(filteredBuffer.isFilterActive).to.be.true;

            filteredBuffer.clearFilter();
            expect(filteredBuffer.isFilterActive).to.be.false;
            expect(filteredBuffer.clauses).to.have.length(0);
        });

        test("setEnabled toggles filter without changing clauses", () => {
            const clauses: FilterClause[] = [
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ];
            filteredBuffer.setFilter(clauses);

            filteredBuffer.setEnabled(false);
            expect(filteredBuffer.isFilterActive).to.be.false;
            expect(filteredBuffer.clauses).to.have.length(1);

            filteredBuffer.setEnabled(true);
            expect(filteredBuffer.isFilterActive).to.be.true;
        });
    });

    suite("totalCount and filteredCount", () => {
        test("totalCount returns underlying buffer size", () => {
            buffer.add(createTestRow("test1", 1));
            buffer.add(createTestRow("test2", 2));
            buffer.add(createTestRow("test3", 3));

            expect(filteredBuffer.totalCount).to.equal(3);
        });

        test("filteredCount equals totalCount when no filter is active", () => {
            buffer.add(createTestRow("test1", 1));
            buffer.add(createTestRow("test2", 2));

            expect(filteredBuffer.filteredCount).to.equal(2);
        });

        test("filteredCount returns matching rows count when filter is active", () => {
            buffer.add(createTestRow("apple", 1));
            buffer.add(createTestRow("banana", 2));
            buffer.add(createTestRow("apple pie", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
            ]);

            expect(filteredBuffer.totalCount).to.equal(3);
            expect(filteredBuffer.filteredCount).to.equal(2);
        });
    });

    suite("getFilteredRows", () => {
        test("returns all rows when no filter is active", () => {
            buffer.add(createTestRow("test1", 1));
            buffer.add(createTestRow("test2", 2));
            buffer.add(createTestRow("test3", 3));

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3);
        });

        test("returns only matching rows when filter is active", () => {
            buffer.add(createTestRow("apple", 1));
            buffer.add(createTestRow("banana", 2));
            buffer.add(createTestRow("cherry", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "a" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows[0].name).to.equal("apple");
            expect(rows[1].name).to.equal("banana");
        });

        test("returns ALL rows after clearing filter (including those that arrived while filtering)", () => {
            // Add initial rows
            buffer.add(createTestRow("apple", 1));
            buffer.add(createTestRow("banana", 2));

            // Apply filter
            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
            ]);

            // Add more rows while filter is active (simulating live events)
            buffer.add(createTestRow("cherry", 3));
            buffer.add(createTestRow("apple crisp", 4));

            // Verify only matching rows show
            expect(filteredBuffer.getFilteredRows()).to.have.length(2);

            // Clear filter - should show ALL rows including cherry
            filteredBuffer.clearFilter();
            const allRows = filteredBuffer.getFilteredRows();
            expect(allRows).to.have.length(4);
            expect(allRows.map((r) => r.name)).to.include("cherry");
        });
    });

    suite("getFilteredRange", () => {
        test("returns correct range of filtered rows", () => {
            for (let i = 1; i <= 10; i++) {
                buffer.add(createTestRow(`row${i}`, i));
            }

            const rows = filteredBuffer.getFilteredRange(2, 3);
            expect(rows).to.have.length(3);
            expect(rows[0].name).to.equal("row3");
            expect(rows[2].name).to.equal("row5");
        });

        test("returns empty array for invalid startIndex", () => {
            buffer.add(createTestRow("test", 1));

            expect(filteredBuffer.getFilteredRange(-1, 5)).to.have.length(0);
            expect(filteredBuffer.getFilteredRange(100, 5)).to.have.length(0);
        });

        test("truncates count to available rows", () => {
            buffer.add(createTestRow("test1", 1));
            buffer.add(createTestRow("test2", 2));
            buffer.add(createTestRow("test3", 3));

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
            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "test" },
            ]);
            const row = createTestRow("testing", 1);
            expect(filteredBuffer.matches(row)).to.be.true;
        });

        test("returns false when row does not match filter", () => {
            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "xyz" },
            ]);
            const row = createTestRow("testing", 1);
            expect(filteredBuffer.matches(row)).to.be.false;
        });
    });

    suite("FilterOperator.Equals", () => {
        test("matches exact string (case-insensitive)", () => {
            buffer.add(createTestRow("Apple", 1));
            buffer.add(createTestRow("apple", 2));
            buffer.add(createTestRow("APPLE", 3));
            buffer.add(createTestRow("banana", 4));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Equals, value: "apple" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3);
        });

        test("matches exact number", () => {
            buffer.add(createTestRow("test1", 100));
            buffer.add(createTestRow("test2", 200));
            buffer.add(createTestRow("test3", 100));

            filteredBuffer.setFilter([
                { field: "value", operator: FilterOperator.Equals, value: 100, typeHint: "number" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("handles null comparison for equals", () => {
            buffer.add(createTestRow("test1", 1, 0, "cat1"));
            buffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setFilter([
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
            buffer.add(createTestRow("apple", 1));
            buffer.add(createTestRow("banana", 2));
            buffer.add(createTestRow("cherry", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.NotEquals, value: "banana" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.map((r) => r.name)).to.not.include("banana");
        });
    });

    suite("FilterOperator.LessThan", () => {
        test("filters numbers less than value", () => {
            buffer.add(createTestRow("test1", 10));
            buffer.add(createTestRow("test2", 20));
            buffer.add(createTestRow("test3", 30));

            filteredBuffer.setFilter([
                {
                    field: "value",
                    operator: FilterOperator.LessThan,
                    value: 25,
                    typeHint: "number",
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.value < 25)).to.be.true;
        });

        test("returns no match when numeric parsing fails", () => {
            buffer.add(createTestRow("test1", 10));

            filteredBuffer.setFilter([
                {
                    field: "name",
                    operator: FilterOperator.LessThan,
                    value: 5,
                    typeHint: "number",
                },
            ]);

            // "test1" cannot be parsed as number, so no match
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("FilterOperator.LessThanOrEqual", () => {
        test("filters numbers less than or equal to value", () => {
            buffer.add(createTestRow("test1", 10));
            buffer.add(createTestRow("test2", 20));
            buffer.add(createTestRow("test3", 30));

            filteredBuffer.setFilter([
                {
                    field: "value",
                    operator: FilterOperator.LessThanOrEqual,
                    value: 20,
                    typeHint: "number",
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.GreaterThan", () => {
        test("filters numbers greater than value", () => {
            buffer.add(createTestRow("test1", 10));
            buffer.add(createTestRow("test2", 20));
            buffer.add(createTestRow("test3", 30));

            filteredBuffer.setFilter([
                {
                    field: "value",
                    operator: FilterOperator.GreaterThan,
                    value: 15,
                    typeHint: "number",
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.GreaterThanOrEqual", () => {
        test("filters numbers greater than or equal to value", () => {
            buffer.add(createTestRow("test1", 10));
            buffer.add(createTestRow("test2", 20));
            buffer.add(createTestRow("test3", 30));

            filteredBuffer.setFilter([
                {
                    field: "value",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: 20,
                    typeHint: "number",
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.IsNull", () => {
        test("matches null values", () => {
            buffer.add(createTestRow("test1", 1, 0, "category"));
            buffer.add(createTestRow("test2", 2, 0, undefined));
            buffer.add(createTestRow("test3", 3, 0, undefined));

            filteredBuffer.setFilter([{ field: "category", operator: FilterOperator.IsNull }]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("matches missing fields", () => {
            buffer.add(createTestRow("test1", 1));

            filteredBuffer.setFilter([
                { field: "nonExistentField", operator: FilterOperator.IsNull },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
        });
    });

    suite("FilterOperator.IsNotNull", () => {
        test("matches non-null values", () => {
            buffer.add(createTestRow("test1", 1, 0, "category"));
            buffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setFilter([{ field: "category", operator: FilterOperator.IsNotNull }]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("test1");
        });
    });

    suite("FilterOperator.Contains", () => {
        test("matches substring (case-insensitive)", () => {
            buffer.add(createTestRow("Hello World", 1));
            buffer.add(createTestRow("hello there", 2));
            buffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "HELLO" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("returns false for null field value", () => {
            buffer.add(createTestRow("test", 1, 0, undefined));

            filteredBuffer.setFilter([
                { field: "category", operator: FilterOperator.Contains, value: "any" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("FilterOperator.NotContains", () => {
        test("excludes rows containing substring", () => {
            buffer.add(createTestRow("Hello World", 1));
            buffer.add(createTestRow("hello there", 2));
            buffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.NotContains, value: "hello" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("goodbye");
        });

        test("returns true for null/missing field (does not contain)", () => {
            buffer.add(createTestRow("test1", 1, 0, "hasCategory"));
            buffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setFilter([
                { field: "category", operator: FilterOperator.NotContains, value: "xyz" },
            ]);

            // Both should match: "hasCategory" doesn't contain "xyz", and undefined treated as "does not contain"
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("FilterOperator.StartsWith", () => {
        test("matches string prefix (case-insensitive)", () => {
            buffer.add(createTestRow("Hello World", 1));
            buffer.add(createTestRow("HELLO there", 2));
            buffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.StartsWith, value: "hello" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("returns false for null field value", () => {
            buffer.add(createTestRow("test", 1, 0, undefined));

            filteredBuffer.setFilter([
                { field: "category", operator: FilterOperator.StartsWith, value: "any" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("FilterOperator.NotStartsWith", () => {
        test("excludes rows starting with prefix", () => {
            buffer.add(createTestRow("Hello World", 1));
            buffer.add(createTestRow("hello there", 2));
            buffer.add(createTestRow("goodbye", 3));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.NotStartsWith, value: "hello" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("goodbye");
        });

        test("returns true for null/missing field (does not start with)", () => {
            buffer.add(createTestRow("test1", 1, 0, "category"));
            buffer.add(createTestRow("test2", 2, 0, undefined));

            filteredBuffer.setFilter([
                { field: "category", operator: FilterOperator.NotStartsWith, value: "x" },
            ]);

            // Both should match
            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("AND combination of multiple clauses", () => {
        test("all clauses must match for row to be included", () => {
            buffer.add(createTestRow("apple", 100, 0, "fruit"));
            buffer.add(createTestRow("banana", 200, 0, "fruit"));
            buffer.add(createTestRow("carrot", 50, 0, "vegetable"));
            buffer.add(createTestRow("apple pie", 150, 0, "dessert"));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
                {
                    field: "value",
                    operator: FilterOperator.GreaterThan,
                    value: 50,
                    typeHint: "number",
                },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.name.includes("apple") && r.value > 50)).to.be.true;
        });

        test("returns empty when no rows match all clauses", () => {
            buffer.add(createTestRow("apple", 100));
            buffer.add(createTestRow("banana", 200));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Contains, value: "apple" },
                { field: "value", operator: FilterOperator.Equals, value: 999, typeHint: "number" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("additionalData field access", () => {
        test("can filter on fields in additionalData", () => {
            buffer.add(createTestRow("test1", 1, 0, undefined, { query: "SELECT * FROM users" }));
            buffer.add(createTestRow("test2", 2, 0, undefined, { query: "INSERT INTO logs" }));
            buffer.add(createTestRow("test3", 3, 0, undefined, { query: "SELECT id FROM orders" }));

            filteredBuffer.setFilter([
                { field: "query", operator: FilterOperator.Contains, value: "SELECT" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("date comparison", () => {
        test("filters dates correctly", () => {
            const now = Date.now();
            buffer.add(createTestRow("past", 1, -10000)); // 10 seconds ago
            buffer.add(createTestRow("recent", 2, -1000)); // 1 second ago
            buffer.add(createTestRow("future", 3, 10000)); // 10 seconds in future

            filteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThan,
                    value: new Date(now - 5000).toISOString(),
                    typeHint: "date",
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

            const boolBuffer = new RingBuffer<BoolRow>(10);
            const boolFiltered = new FilteredBuffer<BoolRow>(boolBuffer);

            boolBuffer.add({ id: uuidv4(), eventNumber: 1, name: "test1", active: true });
            boolBuffer.add({ id: uuidv4(), eventNumber: 2, name: "test2", active: false });
            boolBuffer.add({ id: uuidv4(), eventNumber: 3, name: "test3", active: true });

            boolFiltered.setFilter([
                {
                    field: "active",
                    operator: FilterOperator.Equals,
                    value: true,
                    typeHint: "boolean",
                },
            ]);

            const rows = boolFiltered.getFilteredRows();
            expect(rows).to.have.length(2);
        });
    });

    suite("unknown operator handling", () => {
        test("unknown operator returns no match", () => {
            buffer.add(createTestRow("test", 1));

            filteredBuffer.setFilter([
                { field: "name", operator: "unknownOp" as FilterOperator, value: "test" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });
    });

    suite("empty string and whitespace handling", () => {
        test("empty string filter value", () => {
            buffer.add(createTestRow("", 1));
            buffer.add(createTestRow("test", 2));

            filteredBuffer.setFilter([
                { field: "name", operator: FilterOperator.Equals, value: "" },
            ]);

            const rows = filteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("");
        });

        test("numeric string parsing with whitespace", () => {
            buffer.add(createTestRow("test1", 100));
            buffer.add(createTestRow("test2", 200));

            filteredBuffer.setFilter([
                {
                    field: "value",
                    operator: FilterOperator.Equals,
                    value: "  100  " as unknown as number,
                    typeHint: "number",
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

        let eventBuffer: RingBuffer<EventRow>;
        let eventFilteredBuffer: FilteredBuffer<EventRow>;

        function createEventRow(overrides: Partial<EventRow> = {}): EventRow {
            return {
                id: uuidv4(),
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
            eventBuffer = new RingBuffer<EventRow>(100);
            eventFilteredBuffer = new FilteredBuffer<EventRow>(eventBuffer);
        });

        test("filters by eventClass (string field)", () => {
            eventBuffer.add(createEventRow({ eventClass: "SQL:BatchCompleted" }));
            eventBuffer.add(createEventRow({ eventClass: "RPC:Completed" }));
            eventBuffer.add(createEventRow({ eventClass: "SQL:BatchStarting" }));

            eventFilteredBuffer.setFilter([
                { field: "eventClass", operator: FilterOperator.Contains, value: "SQL" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by textData with StartsWith", () => {
            eventBuffer.add(createEventRow({ textData: "SELECT * FROM Users" }));
            eventBuffer.add(createEventRow({ textData: "INSERT INTO Logs VALUES" }));
            eventBuffer.add(createEventRow({ textData: "SELECT COUNT(*) FROM Orders" }));

            eventFilteredBuffer.setFilter([
                { field: "textData", operator: FilterOperator.StartsWith, value: "SELECT" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by databaseName with Equals", () => {
            eventBuffer.add(createEventRow({ databaseName: "ProductionDB" }));
            eventBuffer.add(createEventRow({ databaseName: "TestDB" }));
            eventBuffer.add(createEventRow({ databaseName: "productiondb" })); // case insensitive

            eventFilteredBuffer.setFilter([
                { field: "databaseName", operator: FilterOperator.Equals, value: "ProductionDB" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Both ProductionDB and productiondb match
        });

        test("filters by spid (number | undefined field) with Equals", () => {
            eventBuffer.add(createEventRow({ spid: 55 }));
            eventBuffer.add(createEventRow({ spid: 60 }));
            eventBuffer.add(createEventRow({ spid: undefined }));

            eventFilteredBuffer.setFilter([
                { field: "spid", operator: FilterOperator.Equals, value: 55, typeHint: "number" },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].spid).to.equal(55);
        });

        test("filters by spid with IsNull to find undefined values", () => {
            eventBuffer.add(createEventRow({ spid: 55 }));
            eventBuffer.add(createEventRow({ spid: undefined }));
            eventBuffer.add(createEventRow({ spid: undefined }));

            eventFilteredBuffer.setFilter([{ field: "spid", operator: FilterOperator.IsNull }]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by duration with GreaterThan", () => {
            eventBuffer.add(createEventRow({ duration: 500 }));
            eventBuffer.add(createEventRow({ duration: 1500 }));
            eventBuffer.add(createEventRow({ duration: 3000 }));
            eventBuffer.add(createEventRow({ duration: undefined }));

            eventFilteredBuffer.setFilter([
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThan,
                    value: 1000,
                    typeHint: "number",
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
            expect(rows.every((r) => r.duration !== undefined && r.duration > 1000)).to.be.true;
        });

        test("filters by cpu with LessThanOrEqual", () => {
            eventBuffer.add(createEventRow({ cpu: 50 }));
            eventBuffer.add(createEventRow({ cpu: 100 }));
            eventBuffer.add(createEventRow({ cpu: 200 }));

            eventFilteredBuffer.setFilter([
                {
                    field: "cpu",
                    operator: FilterOperator.LessThanOrEqual,
                    value: 100,
                    typeHint: "number",
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2);
        });

        test("filters by reads with NotEquals", () => {
            eventBuffer.add(createEventRow({ reads: 0 }));
            eventBuffer.add(createEventRow({ reads: 100 }));
            eventBuffer.add(createEventRow({ reads: 0 }));

            eventFilteredBuffer.setFilter([
                {
                    field: "reads",
                    operator: FilterOperator.NotEquals,
                    value: 0,
                    typeHint: "number",
                },
            ]);

            const rows = eventFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].reads).to.equal(100);
        });

        test("filters by additionalData nested field", () => {
            eventBuffer.add(
                createEventRow({
                    additionalData: { client_app_name: "SQL Server Management Studio" },
                }),
            );
            eventBuffer.add(
                createEventRow({ additionalData: { client_app_name: "Azure Data Studio" } }),
            );
            eventBuffer.add(
                createEventRow({ additionalData: { client_app_name: "VS Code mssql" } }),
            );

            eventFilteredBuffer.setFilter([
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

        let dateBuffer: RingBuffer<DateTestRow>;
        let dateFilteredBuffer: FilteredBuffer<DateTestRow>;

        // Fixed dates for predictable testing
        const date2024Jan15 = new Date("2024-01-15T10:30:00.000Z");
        const date2024Mar20 = new Date("2024-03-20T14:45:00.000Z");
        const date2024Jun01 = new Date("2024-06-01T08:00:00.000Z");
        const date2024Dec31 = new Date("2024-12-31T23:59:59.000Z");

        setup(() => {
            resetEventNumber();
            dateBuffer = new RingBuffer<DateTestRow>(100);
            dateFilteredBuffer = new FilteredBuffer<DateTestRow>(dateBuffer);

            dateBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Jan15,
                name: "January event",
            });
            dateBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Mar20,
                name: "March event",
            });
            dateBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Jun01,
                name: "June event",
            });
            dateBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                timestamp: date2024Dec31,
                name: "December event",
            });
        });

        test("filters dates with ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)", () => {
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThan,
                    value: "2024-03-01T00:00:00.000Z",
                    typeHint: "date",
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // Mar, Jun, Dec
        });

        test("filters dates with simplified ISO format (YYYY-MM-DD)", () => {
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.LessThan,
                    value: "2024-06-01",
                    typeHint: "date",
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jan and Mar (Jun is at midnight so not less than)
        });

        test("filters dates with Equals using ISO date", () => {
            // Note: Equals on dates requires exact match including time
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.Equals,
                    value: "2024-01-15T10:30:00.000Z",
                    typeHint: "date",
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("January event");
        });

        test("filters dates with GreaterThanOrEqual", () => {
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2024-06-01T08:00:00.000Z",
                    typeHint: "date",
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jun (exact match) and Dec
        });

        test("filters dates with LessThanOrEqual", () => {
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.LessThanOrEqual,
                    value: "2024-03-20T14:45:00.000Z",
                    typeHint: "date",
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Jan and Mar (exact match)
        });

        test("filters dates between range using two clauses", () => {
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2024-02-01",
                    typeHint: "date",
                },
                {
                    field: "timestamp",
                    operator: FilterOperator.LessThan,
                    value: "2024-07-01",
                    typeHint: "date",
                },
            ]);

            const rows = dateFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Mar and Jun
        });

        test("filters with Date object value converted to string", () => {
            const filterDate = new Date("2024-05-01T00:00:00.000Z");
            dateFilteredBuffer.setFilter([
                {
                    field: "timestamp",
                    operator: FilterOperator.GreaterThan,
                    value: filterDate.toISOString(),
                    typeHint: "date",
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

        let profilerBuffer: RingBuffer<ProfilerDateRow>;
        let profilerFilteredBuffer: FilteredBuffer<ProfilerDateRow>;

        setup(() => {
            resetEventNumber();
            profilerBuffer = new RingBuffer<ProfilerDateRow>(100);
            profilerFilteredBuffer = new FilteredBuffer<ProfilerDateRow>(profilerBuffer);

            // Add events with profiler-format timestamp strings (as they appear in grid)
            profilerBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 20:00:00.000",
                name: "Early event",
            });
            profilerBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 20:29:10.000",
                name: "Middle event",
            });
            profilerBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 20:32:00.000",
                name: "Late event",
            });
            profilerBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                StartTime: "2026-01-21 21:00:00.000",
                name: "Much later event",
            });
        });

        test("GreaterThan with profiler format filters correctly", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.GreaterThan,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: "datetime",
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Late and Much later (not Middle since it's equal)
            expect(rows.map((r) => r.name)).to.deep.equal(["Late event", "Much later event"]);
        });

        test("GreaterThanOrEqual with profiler format includes exact match", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: "datetime",
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // Middle, Late, and Much later
        });

        test("LessThan with profiler format filters correctly", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.LessThan,
                    value: "2026-01-21 20:32:00.000",
                    typeHint: "datetime",
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Early and Middle
            expect(rows.map((r) => r.name)).to.deep.equal(["Early event", "Middle event"]);
        });

        test("LessThanOrEqual with profiler format includes exact match", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.LessThanOrEqual,
                    value: "2026-01-21 20:32:00.000",
                    typeHint: "datetime",
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // Early, Middle, and Late (exact match)
        });

        test("Equals with profiler format requires exact time match", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.Equals,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: "datetime",
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("Middle event");
        });

        test("NotEquals with profiler format", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.NotEquals,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: "datetime",
                },
            ]);

            const rows = profilerFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // All except Middle event
        });

        test("range filter with profiler format", () => {
            profilerFilteredBuffer.setFilter([
                {
                    field: "StartTime",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: "2026-01-21 20:29:10.000",
                    typeHint: "datetime",
                },
                {
                    field: "StartTime",
                    operator: FilterOperator.LessThan,
                    value: "2026-01-21 21:00:00.000",
                    typeHint: "datetime",
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

        let complexBuffer: RingBuffer<ComplexRow>;
        let complexFilteredBuffer: FilteredBuffer<ComplexRow>;

        setup(() => {
            resetEventNumber();
            complexBuffer = new RingBuffer<ComplexRow>(100);
            complexFilteredBuffer = new FilteredBuffer<ComplexRow>(complexBuffer);

            // Add diverse test data
            complexBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT * FROM Users WHERE active = 1",
                databaseName: "ProductionDB",
                duration: 500,
                spid: 55,
            });
            complexBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT * FROM Orders WHERE total > 100",
                databaseName: "ProductionDB",
                duration: 2000,
                spid: 60,
            });
            complexBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                eventClass: "RPC:Completed",
                textData: "sp_GetUserDetails @userId = 123",
                databaseName: "ProductionDB",
                duration: 100,
                spid: 55,
            });
            complexBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "INSERT INTO Logs VALUES (1, 'test')",
                databaseName: "TestDB",
                duration: 50,
                spid: 70,
            });
            complexBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT id FROM Users",
                databaseName: "ProductionDB",
                duration: 1500,
                spid: 55,
            });
        });

        test("3 clauses: eventClass AND textData AND databaseName", () => {
            complexFilteredBuffer.setFilter([
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
            complexFilteredBuffer.setFilter([
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
                    typeHint: "number",
                },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(2); // Slow SELECT queries in ProductionDB
        });

        test("4 clauses with different operator types", () => {
            complexFilteredBuffer.setFilter([
                { field: "eventClass", operator: FilterOperator.Contains, value: "Batch" },
                { field: "textData", operator: FilterOperator.NotContains, value: "INSERT" },
                { field: "spid", operator: FilterOperator.Equals, value: 55, typeHint: "number" },
                {
                    field: "duration",
                    operator: FilterOperator.LessThanOrEqual,
                    value: 1000,
                    typeHint: "number",
                },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(1); // Only the first SELECT with spid=55, duration=500
            expect(rows[0].textData).to.contain("Users WHERE active");
        });

        test("5 clauses: comprehensive filtering", () => {
            complexFilteredBuffer.setFilter([
                { field: "eventClass", operator: FilterOperator.StartsWith, value: "SQL" },
                { field: "textData", operator: FilterOperator.Contains, value: "SELECT" },
                { field: "databaseName", operator: FilterOperator.NotEquals, value: "TestDB" },
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThanOrEqual,
                    value: 100,
                    typeHint: "number",
                },
                { field: "spid", operator: FilterOperator.IsNotNull },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(3); // All ProductionDB SELECTs with duration >= 100
        });

        test("clauses that filter to empty result", () => {
            complexFilteredBuffer.setFilter([
                {
                    field: "eventClass",
                    operator: FilterOperator.Equals,
                    value: "SQL:BatchCompleted",
                },
                { field: "databaseName", operator: FilterOperator.Equals, value: "NonExistentDB" },
                { field: "spid", operator: FilterOperator.Equals, value: 999, typeHint: "number" },
            ]);

            const rows = complexFilteredBuffer.getFilteredRows();
            expect(rows).to.have.length(0);
        });

        test("clauses with mixed null checks", () => {
            // Add a row with undefined duration
            complexBuffer.add({
                id: uuidv4(),
                eventNumber: nextEventNumber++,
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT 1",
                databaseName: "ProductionDB",
                duration: undefined,
                spid: 55,
            });

            complexFilteredBuffer.setFilter([
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
            buffer.add(createTestRow("test1", 100));
            buffer.add(createTestRow("test2", 200));

            // Add row with value field but using category to simulate optional number
            interface OptionalNumRow extends IndexedRow {
                eventNumber: number;
                name: string;
                optionalNum?: number;
            }

            const optBuffer = new RingBuffer<OptionalNumRow>(10);
            const optFiltered = new FilteredBuffer<OptionalNumRow>(optBuffer);

            optBuffer.add({ id: uuidv4(), eventNumber: 1, name: "has value", optionalNum: 150 });
            optBuffer.add({
                id: uuidv4(),
                eventNumber: 2,
                name: "no value",
                optionalNum: undefined,
            });
            optBuffer.add({ id: uuidv4(), eventNumber: 3, name: "high value", optionalNum: 300 });

            optFiltered.setFilter([
                {
                    field: "optionalNum",
                    operator: FilterOperator.GreaterThan,
                    value: 100,
                    typeHint: "number",
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

            const optBuffer = new RingBuffer<OptionalNumRow>(10);
            const optFiltered = new FilteredBuffer<OptionalNumRow>(optBuffer);

            optBuffer.add({ id: uuidv4(), eventNumber: 1, name: "fast", duration: 50 });
            optBuffer.add({ id: uuidv4(), eventNumber: 2, name: "slow", duration: 5000 });
            optBuffer.add({ id: uuidv4(), eventNumber: 3, name: "unknown", duration: undefined });

            // Find slow queries (duration > 1000) but only where duration is known
            optFiltered.setFilter([
                { field: "duration", operator: FilterOperator.IsNotNull },
                {
                    field: "duration",
                    operator: FilterOperator.GreaterThan,
                    value: 1000,
                    typeHint: "number",
                },
            ]);

            const rows = optFiltered.getFilteredRows();
            expect(rows).to.have.length(1);
            expect(rows[0].name).to.equal("slow");
        });
    });
});
