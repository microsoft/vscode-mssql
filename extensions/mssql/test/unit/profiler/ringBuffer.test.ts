/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { v4 as uuidv4 } from "uuid";
import { RingBuffer } from "../../../src/profiler/ringBuffer";
import { IndexedRow } from "../../../src/profiler/profilerTypes";

interface TestRow extends IndexedRow {
    eventNumber: number;
    name: string;
    value: number;
    timestamp: number;
}

/**
 * Helper function to create test row data with UUID and eventNumber
 */
let nextEventNumber = 1;
function createTestRow(name: string, value: number, timestamp: number): TestRow {
    return {
        id: uuidv4(),
        eventNumber: nextEventNumber++,
        name,
        value,
        timestamp,
    };
}

suite("RingBuffer Tests", () => {
    suite("constructor", () => {
        test("should create a buffer with specified capacity", () => {
            const buffer = new RingBuffer<TestRow>(100);
            expect(buffer.capacity).to.equal(100);
            expect(buffer.size).to.equal(0);
        });

        test("should throw error for invalid capacity", () => {
            expect(() => new RingBuffer<TestRow>(0)).to.throw("Capacity must be greater than 0");
            expect(() => new RingBuffer<TestRow>(-1)).to.throw("Capacity must be greater than 0");
        });

        test("should accept indexed fields parameter (for future use)", () => {
            // Indexed fields parameter is accepted but not currently used
            const buffer = new RingBuffer<TestRow>(10, ["name", "value"]);
            expect(buffer.capacity).to.equal(10);
        });
    });

    suite("add", () => {
        test("should add rows with event numbers", () => {
            const buffer = new RingBuffer<TestRow>(5);
            const result1 = buffer.add(createTestRow("test1", 1, 100));
            const result2 = buffer.add(createTestRow("test2", 2, 200));

            expect(result1?.added.eventNumber).to.equal(1);
            expect(result2?.added.eventNumber).to.equal(2);
            expect(buffer.size).to.equal(2);
        });

        test("should return undefined when paused", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.setPaused(true);

            const result = buffer.add(createTestRow("test", 1, 100));
            expect(result).to.be.undefined;
            expect(buffer.size).to.equal(0);
        });

        test("should overwrite oldest rows when full", () => {
            const buffer = new RingBuffer<TestRow>(3);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            buffer.add(createTestRow("row4", 4, 400));
            buffer.add(createTestRow("row5", 5, 500));

            expect(buffer.size).to.equal(3);
            const rows = buffer.getAllRows();
            expect(rows[0].name).to.equal("row3");
            expect(rows[2].name).to.equal("row5");
        });
    });

    suite("paused state", () => {
        test("isPaused should return current paused state", () => {
            const buffer = new RingBuffer<TestRow>(5);
            expect(buffer.isPaused()).to.be.false;

            buffer.setPaused(true);
            expect(buffer.isPaused()).to.be.true;

            buffer.setPaused(false);
            expect(buffer.isPaused()).to.be.false;
        });
    });

    suite("getAllRows", () => {
        test("should return empty array for empty buffer", () => {
            const buffer = new RingBuffer<TestRow>(5);
            expect(buffer.getAllRows()).to.deep.equal([]);
        });

        test("should return rows in chronological order", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("first", 1, 100));
            buffer.add(createTestRow("second", 2, 200));
            buffer.add(createTestRow("third", 3, 300));

            const rows = buffer.getAllRows();
            expect(rows[0].name).to.equal("first");
            expect(rows[2].name).to.equal("third");
        });
    });

    suite("getRecent", () => {
        test("should return most recent rows (newest first)", () => {
            const buffer = new RingBuffer<TestRow>(10);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            buffer.add(createTestRow("row4", 4, 400));
            buffer.add(createTestRow("row5", 5, 500));

            const recent = buffer.getRecent(3);
            expect(recent).to.have.length(3);
            expect(recent[0].name).to.equal("row5");
            expect(recent[1].name).to.equal("row4");
            expect(recent[2].name).to.equal("row3");
        });
    });

    suite("clear", () => {
        test("should clear all rows and reset state", () => {
            const buffer = new RingBuffer<TestRow>(5, ["name"]);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            buffer.clear();

            expect(buffer.size).to.equal(0);
            expect(buffer.getAllRows()).to.deep.equal([]);
        });

        test("should reset head to 0 after clear", () => {
            const buffer = new RingBuffer<TestRow>(3);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            buffer.add(createTestRow("row4", 4, 400)); // head moves to 1

            expect(buffer.head).to.equal(1);

            buffer.clear();

            expect(buffer.head).to.equal(0);
            expect(buffer.size).to.equal(0);
        });

        test("should allow adding new rows after clear", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            buffer.clear();

            const result = buffer.add(createTestRow("newRow", 99, 999));
            expect(result?.added.name).to.equal("newRow");
            expect(buffer.size).to.equal(1);
            expect(buffer.getAt(0)?.name).to.equal("newRow");
        });
    });

    suite("clearRange", () => {
        test("should clear oldest N rows", () => {
            const buffer = new RingBuffer<TestRow>(10);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            buffer.add(createTestRow("row4", 4, 400));
            buffer.add(createTestRow("row5", 5, 500));

            buffer.clearRange(3);

            expect(buffer.size).to.equal(2);
            const rows = buffer.getAllRows();
            expect(rows[0].name).to.equal("row4");
            expect(rows[1].name).to.equal("row5");
        });

        test("should do nothing when count is 0", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            buffer.clearRange(0);

            expect(buffer.size).to.equal(2);
        });

        test("should do nothing when count is negative", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            buffer.clearRange(-1);

            expect(buffer.size).to.equal(2);
        });

        test("should do nothing when buffer is empty", () => {
            const buffer = new RingBuffer<TestRow>(5);

            buffer.clearRange(10);

            expect(buffer.size).to.equal(0);
        });

        test("should clear all rows when count exceeds size", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            buffer.clearRange(100);

            expect(buffer.size).to.equal(0);
            expect(buffer.head).to.equal(0);
        });

        test("should update head position after clearRange", () => {
            const buffer = new RingBuffer<TestRow>(10);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));

            expect(buffer.head).to.equal(0);

            buffer.clearRange(2);

            expect(buffer.head).to.equal(2);
            expect(buffer.size).to.equal(1);
            expect(buffer.getAt(0)?.name).to.equal("row3");
        });

        test("should reset head to 0 when buffer becomes empty", () => {
            const buffer = new RingBuffer<TestRow>(10);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));

            buffer.clearRange(3);

            expect(buffer.size).to.equal(0);
            expect(buffer.head).to.equal(0);
        });

        test("should correctly position new rows added after clearRange", () => {
            // This test verifies the bug fix where add() was using wrong position
            // after clearRange moved the head
            const buffer = new RingBuffer<TestRow>(10);

            // Add 7 rows
            for (let i = 1; i <= 7; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            expect(buffer.size).to.equal(7);
            expect(buffer.head).to.equal(0);

            // Clear all 7 rows - head should reset to 0
            buffer.clearRange(7);
            expect(buffer.size).to.equal(0);
            expect(buffer.head).to.equal(0);

            // Add new events after clear
            const event1 = buffer.add(createTestRow("new1", 100, 1000));
            const event2 = buffer.add(createTestRow("new2", 200, 2000));
            const event3 = buffer.add(createTestRow("new3", 300, 3000));

            expect(buffer.size).to.equal(3);
            expect(event1?.added.name).to.equal("new1");
            expect(event2?.added.name).to.equal("new2");
            expect(event3?.added.name).to.equal("new3");

            // Verify rows are retrievable
            expect(buffer.getAt(0)?.name).to.equal("new1");
            expect(buffer.getAt(1)?.name).to.equal("new2");
            expect(buffer.getAt(2)?.name).to.equal("new3");
        });

        test("should handle partial clear with new events added", () => {
            // Scenario: partial clear leaves some events, then new events arrive
            const buffer = new RingBuffer<TestRow>(10);

            // Add 10 rows
            for (let i = 1; i <= 10; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            expect(buffer.size).to.equal(10);

            // Clear 7 rows, leaving 3 (row8, row9, row10)
            buffer.clearRange(7);
            expect(buffer.size).to.equal(3);
            expect(buffer.getAt(0)?.name).to.equal("row8");

            // Add 2 new events
            buffer.add(createTestRow("new1", 100, 1100));
            buffer.add(createTestRow("new2", 200, 1200));

            expect(buffer.size).to.equal(5);

            // Verify all rows in correct order
            const rows = buffer.getAllRows();
            expect(rows[0].name).to.equal("row8");
            expect(rows[1].name).to.equal("row9");
            expect(rows[2].name).to.equal("row10");
            expect(rows[3].name).to.equal("new1");
            expect(rows[4].name).to.equal("new2");
        });

        test("should handle getRange after clearRange", () => {
            const buffer = new RingBuffer<TestRow>(10);

            // Add 10 rows
            for (let i = 1; i <= 10; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }

            // Clear first 5
            buffer.clearRange(5);

            // getRange should work correctly with new head position
            const range = buffer.getRange(0, 3);
            expect(range).to.have.length(3);
            expect(range[0].name).to.equal("row6");
            expect(range[1].name).to.equal("row7");
            expect(range[2].name).to.equal("row8");
        });

        test("should handle getRange returning remaining rows after clearRange", () => {
            const buffer = new RingBuffer<TestRow>(10);

            // Add 10 rows
            for (let i = 1; i <= 10; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }

            // Clear 7, leaving 3
            buffer.clearRange(7);

            // getRange(0, 10) should return all 3 remaining rows
            const range = buffer.getRange(0, 10);
            expect(range).to.have.length(3);
            expect(range[0].name).to.equal("row8");
            expect(range[1].name).to.equal("row9");
            expect(range[2].name).to.equal("row10");
        });

        test("should handle clearRange with wrapped buffer", () => {
            // Buffer has wrapped around (head != 0)
            const buffer = new RingBuffer<TestRow>(5);

            // Fill buffer completely
            for (let i = 1; i <= 5; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            expect(buffer.head).to.equal(0);

            // Add 2 more - buffer wraps, head moves to 2
            buffer.add(createTestRow("row6", 6, 600));
            buffer.add(createTestRow("row7", 7, 700));
            expect(buffer.head).to.equal(2);

            // Buffer now contains: row3, row4, row5, row6, row7
            expect(buffer.getAllRows().map((r) => r.name)).to.deep.equal([
                "row3",
                "row4",
                "row5",
                "row6",
                "row7",
            ]);

            // Clear 2 oldest (row3, row4)
            buffer.clearRange(2);
            expect(buffer.size).to.equal(3);
            expect(buffer.head).to.equal(4);

            // Remaining: row5, row6, row7
            expect(buffer.getAllRows().map((r) => r.name)).to.deep.equal(["row5", "row6", "row7"]);
        });

        test("should handle add after clearRange on wrapped buffer", () => {
            const buffer = new RingBuffer<TestRow>(5);

            // Fill and wrap
            for (let i = 1; i <= 7; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            // Buffer: row3, row4, row5, row6, row7 (head=2)

            // Clear 3 oldest
            buffer.clearRange(3);
            // Remaining: row6, row7 (head=0 after wrap, size=2)

            // Add new row
            const result = buffer.add(createTestRow("new1", 100, 1000));
            expect(result?.added.name).to.equal("new1");
            expect(buffer.size).to.equal(3);

            const rows = buffer.getAllRows();
            expect(rows[0].name).to.equal("row6");
            expect(rows[1].name).to.equal("row7");
            expect(rows[2].name).to.equal("new1");
        });

        test("should handle interleaved clearRange and add operations", () => {
            const buffer = new RingBuffer<TestRow>(10);

            // Add 3
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));

            // Clear 1
            buffer.clearRange(1);
            expect(buffer.size).to.equal(2);

            // Add 2 more
            buffer.add(createTestRow("row4", 4, 400));
            buffer.add(createTestRow("row5", 5, 500));
            expect(buffer.size).to.equal(4);

            // Clear 2
            buffer.clearRange(2);
            expect(buffer.size).to.equal(2);

            // Add 1 more
            buffer.add(createTestRow("row6", 6, 600));
            expect(buffer.size).to.equal(3);

            // Verify final state
            const rows = buffer.getAllRows();
            expect(rows.map((r) => r.name)).to.deep.equal(["row4", "row5", "row6"]);
        });

        test("should handle clear all then add scenario (simulating UI clear button)", () => {
            const buffer = new RingBuffer<TestRow>(10);

            // Simulate profiler running - events arrive
            for (let i = 1; i <= 7; i++) {
                buffer.add(createTestRow(`event${i}`, i, i * 100));
            }
            expect(buffer.size).to.equal(7);

            // User clicks Clear - webview knows about 7 events
            const localRowCount = 7;
            buffer.clearRange(localRowCount);

            expect(buffer.size).to.equal(0);
            expect(buffer.head).to.equal(0);

            // New events arrive from SQL Server
            buffer.add(createTestRow("afterClear1", 100, 1000));
            buffer.add(createTestRow("afterClear2", 200, 2000));

            // Webview fetches new events
            const newEvents = buffer.getRange(0, 100);
            expect(newEvents).to.have.length(2);
            expect(newEvents[0].name).to.equal("afterClear1");
            expect(newEvents[1].name).to.equal("afterClear2");
        });

        test("should handle race condition: events added during clearRange processing", () => {
            // Simulates the scenario where:
            // 1. Webview has 10 events displayed
            // 2. User clicks Clear (localRowCount=10)
            // 3. Meanwhile, 3 new events arrive before clearRange is called
            // 4. clearRange(10) is called, should only clear 10, leaving the 3 new ones

            const buffer = new RingBuffer<TestRow>(20);

            // Initial 10 events
            for (let i = 1; i <= 10; i++) {
                buffer.add(createTestRow(`initial${i}`, i, i * 100));
            }

            // 3 new events arrive (simulating race condition)
            buffer.add(createTestRow("race1", 11, 1100));
            buffer.add(createTestRow("race2", 12, 1200));
            buffer.add(createTestRow("race3", 13, 1300));

            expect(buffer.size).to.equal(13);

            // clearRange called with webview's known count (10)
            buffer.clearRange(10);

            // Should have 3 remaining
            expect(buffer.size).to.equal(3);
            const remaining = buffer.getAllRows();
            expect(remaining[0].name).to.equal("race1");
            expect(remaining[1].name).to.equal("race2");
            expect(remaining[2].name).to.equal("race3");
        });

        test("should return correct rows via getRange after clear with index offset", () => {
            // Tests the pull model scenario:
            // 1. Buffer has events
            // 2. Webview fetches some events (localRowCount increases)
            // 3. User clears
            // 4. New events arrive
            // 5. Webview fetches from index 0 (since it was reset)

            const buffer = new RingBuffer<TestRow>(100);

            // Add 50 events
            for (let i = 1; i <= 50; i++) {
                buffer.add(createTestRow(`event${i}`, i, i * 100));
            }

            // Simulate webview fetched all 50
            const fetched = buffer.getRange(0, 50);
            expect(fetched).to.have.length(50);

            // Clear all 50
            buffer.clearRange(50);
            expect(buffer.size).to.equal(0);

            // New events arrive
            for (let i = 1; i <= 5; i++) {
                buffer.add(createTestRow(`new${i}`, i, i * 1000));
            }

            // Webview resets localRowCount to 0, fetches from 0
            const newFetch = buffer.getRange(0, 100);
            expect(newFetch).to.have.length(5);
            expect(newFetch[0].name).to.equal("new1");
            expect(newFetch[4].name).to.equal("new5");
        });
    });

    suite("head property", () => {
        test("should expose head position", () => {
            const buffer = new RingBuffer<TestRow>(3);
            expect(buffer.head).to.equal(0);

            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            expect(buffer.head).to.equal(0);

            buffer.add(createTestRow("row4", 4, 400));
            expect(buffer.head).to.equal(1);
        });
    });

    suite("getAt", () => {
        test("should return row at valid index", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));

            expect(buffer.getAt(0)?.name).to.equal("row1");
            expect(buffer.getAt(1)?.name).to.equal("row2");
            expect(buffer.getAt(2)?.name).to.equal("row3");
        });

        test("should return undefined for negative index", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));

            expect(buffer.getAt(-1)).to.be.undefined;
        });

        test("should return undefined for index out of bounds", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));

            expect(buffer.getAt(5)).to.be.undefined;
            expect(buffer.getAt(100)).to.be.undefined;
        });

        test("should return undefined for index equal to size", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            expect(buffer.getAt(2)).to.be.undefined;
        });

        test("should work correctly with wrapped buffer", () => {
            const buffer = new RingBuffer<TestRow>(3);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            buffer.add(createTestRow("row4", 4, 400)); // Overwrites row1

            expect(buffer.getAt(0)?.name).to.equal("row2");
            expect(buffer.getAt(1)?.name).to.equal("row3");
            expect(buffer.getAt(2)?.name).to.equal("row4");
        });
    });

    suite("getRange", () => {
        test("should return rows within specified range", () => {
            const buffer = new RingBuffer<TestRow>(10);
            for (let i = 1; i <= 5; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }

            const range = buffer.getRange(1, 3);
            expect(range).to.have.length(3);
            expect(range[0].name).to.equal("row2");
            expect(range[1].name).to.equal("row3");
            expect(range[2].name).to.equal("row4");
        });

        test("should return empty array for negative startIndex", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));

            const range = buffer.getRange(-1, 5);
            expect(range).to.deep.equal([]);
        });

        test("should return empty array for startIndex >= size", () => {
            const buffer = new RingBuffer<TestRow>(5);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            expect(buffer.getRange(2, 5)).to.deep.equal([]);
            expect(buffer.getRange(10, 5)).to.deep.equal([]);
        });

        test("should return remaining rows when count exceeds available", () => {
            const buffer = new RingBuffer<TestRow>(10);
            for (let i = 1; i <= 5; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }

            const range = buffer.getRange(3, 100);
            expect(range).to.have.length(2);
            expect(range[0].name).to.equal("row4");
            expect(range[1].name).to.equal("row5");
        });

        test("should work correctly with wrapped buffer", () => {
            const buffer = new RingBuffer<TestRow>(3);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));
            buffer.add(createTestRow("row3", 3, 300));
            buffer.add(createTestRow("row4", 4, 400));
            buffer.add(createTestRow("row5", 5, 500));

            // Buffer now contains: row3, row4, row5
            const range = buffer.getRange(0, 3);
            expect(range).to.have.length(3);
            expect(range[0].name).to.equal("row3");
            expect(range[1].name).to.equal("row4");
            expect(range[2].name).to.equal("row5");
        });
    });

    suite("capacity property", () => {
        test("should return the buffer capacity", () => {
            const buffer = new RingBuffer<TestRow>(100);
            expect(buffer.capacity).to.equal(100);
        });
    });

    suite("size property", () => {
        test("should return current number of elements", () => {
            const buffer = new RingBuffer<TestRow>(10);
            expect(buffer.size).to.equal(0);

            buffer.add(createTestRow("row1", 1, 100));
            expect(buffer.size).to.equal(1);

            buffer.add(createTestRow("row2", 2, 200));
            expect(buffer.size).to.equal(2);
        });

        test("should not exceed capacity", () => {
            const buffer = new RingBuffer<TestRow>(3);
            for (let i = 1; i <= 10; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            expect(buffer.size).to.equal(3);
        });
    });

    suite("edge cases", () => {
        test("should handle buffer with capacity 1", () => {
            const buffer = new RingBuffer<TestRow>(1);
            
            buffer.add(createTestRow("row1", 1, 100));
            expect(buffer.size).to.equal(1);
            expect(buffer.getAt(0)?.name).to.equal("row1");

            buffer.add(createTestRow("row2", 2, 200));
            expect(buffer.size).to.equal(1);
            expect(buffer.getAt(0)?.name).to.equal("row2");
        });

        test("should handle rapid add and clear cycles", () => {
            const buffer = new RingBuffer<TestRow>(5);

            for (let cycle = 0; cycle < 10; cycle++) {
                // Add rows
                for (let i = 0; i < 5; i++) {
                    buffer.add(createTestRow(`cycle${cycle}-row${i}`, i, i * 100));
                }
                expect(buffer.size).to.equal(5);

                // Clear all
                buffer.clear();
                expect(buffer.size).to.equal(0);
            }
        });

        test("should handle getRecent with count greater than size", () => {
            const buffer = new RingBuffer<TestRow>(10);
            buffer.add(createTestRow("row1", 1, 100));
            buffer.add(createTestRow("row2", 2, 200));

            const recent = buffer.getRecent(100);
            expect(recent).to.have.length(2);
            expect(recent[0].name).to.equal("row2"); // Most recent first
            expect(recent[1].name).to.equal("row1");
        });

        test("should handle getRecent with empty buffer", () => {
            const buffer = new RingBuffer<TestRow>(10);

            const recent = buffer.getRecent(5);
            expect(recent).to.deep.equal([]);
        });

        test("should maintain consistency after many operations", () => {
            const buffer = new RingBuffer<TestRow>(50);

            // Add 100 rows
            for (let i = 1; i <= 100; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            expect(buffer.size).to.equal(50);

            // Clear half
            buffer.clearRange(25);
            expect(buffer.size).to.equal(25);

            // Add more
            for (let i = 101; i <= 110; i++) {
                buffer.add(createTestRow(`row${i}`, i, i * 100));
            }
            expect(buffer.size).to.equal(35);

            // Verify all rows are accessible
            const allRows = buffer.getAllRows();
            expect(allRows).to.have.length(35);
        });
    });
});
