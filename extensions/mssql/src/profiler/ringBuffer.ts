/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndexedRow } from "./profilerTypes";

/**
 * A circular buffer for storing rows with automatic sequence numbering.
 *
 * @template T - Row type that extends IndexedRow
 */
export class RingBuffer<T extends IndexedRow> {
    private _rows: (T | undefined)[];
    private _head: number = 0;
    private _size: number = 0;
    private _capacity: number;
    private _paused: boolean = false;

    /**
     * Creates a new RingBuffer with the specified capacity.
     * @param capacity - Maximum number of rows to store
     * @param _indexedFields - Unused, kept for API compatibility
     */
    constructor(capacity: number, _indexedFields: string[] = []) {
        if (capacity <= 0) {
            throw new Error("Capacity must be greater than 0");
        }
        this._capacity = capacity;
        this._rows = new Array(capacity);
    }

    /**
     * Gets the current capacity of the buffer.
     */
    get capacity(): number {
        return this._capacity;
    }

    /**
     * Gets the current number of rows in the buffer.
     */
    get size(): number {
        return this._size;
    }

    /**
     * Gets the head position in the buffer.
     */
    get head(): number {
        return this._head;
    }

    /**
     * Gets whether the buffer is paused.
     */
    isPaused(): boolean {
        return this._paused;
    }

    /**
     * Sets the paused state of the buffer.
     * When paused, add() will not add new rows.
     */
    setPaused(paused: boolean): void {
        this._paused = paused;
    }

    /**
     * Adds a row to the buffer.
     * Does nothing if the buffer is paused.
     *
     * @param row - The row to add (must include id and eventNumber from library)
     * @returns Object containing the added row and removed row (if any), or undefined if paused
     */
    add(row: T): { added: T; removed?: T } | undefined {
        if (this._paused) {
            return undefined;
        }

        // Calculate position - always relative to head for proper circular buffer behavior
        // When not full: add at (head + size) which is the logical end
        // When full: overwrite at head (oldest position)
        const position =
            this._size < this._capacity ? (this._head + this._size) % this._capacity : this._head;

        // Check if we're overwriting an existing row
        const removedRow = this._size >= this._capacity ? this._rows[position] : undefined;

        // Store the row
        this._rows[position] = row;

        // Update head and size
        if (this._size < this._capacity) {
            this._size++;
        } else {
            this._head = (this._head + 1) % this._capacity;
        }

        return { added: row, removed: removedRow };
    }

    /**
     * Gets all rows in chronological order.
     */
    getAllRows(): T[] {
        const result: T[] = [];
        for (let i = 0; i < this._size; i++) {
            const index = (this._head + i) % this._capacity;
            const row = this._rows[index];
            if (row) {
                result.push(row);
            }
        }
        return result;
    }

    /**
     * Clears all rows from the buffer.
     */
    clear(): void {
        this._rows = new Array(this._capacity);
        this._size = 0;
        this._head = 0;
    }

    /**
     * Clears rows from the buffer up to the specified count.
     * Removes the oldest N rows from the buffer.
     * @param count - Number of rows to remove from the beginning
     */
    clearRange(count: number): void {
        if (count <= 0 || this._size === 0) {
            return;
        }

        const actualCount = Math.min(count, this._size);

        // Clear the rows
        for (let i = 0; i < actualCount; i++) {
            const index = (this._head + i) % this._capacity;
            this._rows[index] = undefined;
        }

        // Update head and size
        this._head = (this._head + actualCount) % this._capacity;
        this._size -= actualCount;

        // If buffer is now empty, reset head to 0 to reclaim positions immediately
        if (this._size === 0) {
            this._head = 0;
        }
    }

    /**
     * Gets the most recent rows.
     * @param count - Number of rows to return
     * @returns Array of most recent rows (newest first)
     */
    getRecent(count: number): T[] {
        const result: T[] = [];
        const actualCount = Math.min(count, this._size);

        for (let i = 0; i < actualCount; i++) {
            const index = (this._head + this._size - 1 - i + this._capacity) % this._capacity;
            const row = this._rows[index];
            if (row) {
                result.push(row);
            }
        }
        return result;
    }

    /**
     * Gets a range of rows for pagination, in chronological order.
     * @param startIndex - The starting index (0-based, relative to current buffer contents)
     * @param count - Maximum number of rows to return
     * @returns Array of rows starting from startIndex
     */
    getRange(startIndex: number, count: number): T[] {
        if (startIndex < 0 || startIndex >= this._size) {
            return [];
        }

        const result: T[] = [];
        const actualCount = Math.min(count, this._size - startIndex);

        for (let i = 0; i < actualCount; i++) {
            const bufferIndex = (this._head + startIndex + i) % this._capacity;
            const row = this._rows[bufferIndex];
            if (row) {
                result.push(row);
            }
        }
        return result;
    }

    /**
     * Gets a single row by its index in the buffer.
     * @param index - The index (0-based, relative to current buffer contents)
     * @returns The row at the index, or undefined if out of bounds
     */
    getAt(index: number): T | undefined {
        if (index < 0 || index >= this._size) {
            return undefined;
        }
        const bufferIndex = (this._head + index) % this._capacity;
        return this._rows[bufferIndex];
    }

    /**
     * Finds a row by its ID.
     * @param id - The unique ID of the row to find
     * @returns The row with the matching ID, or undefined if not found
     */
    findById(id: string): T | undefined {
        for (let i = 0; i < this._size; i++) {
            const bufferIndex = (this._head + i) % this._capacity;
            const row = this._rows[bufferIndex];
            if (row && row.id === id) {
                return row;
            }
        }
        return undefined;
    }
}
