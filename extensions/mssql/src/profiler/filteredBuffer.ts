/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RingBuffer } from "./ringBuffer";
import { IndexedRow, FilterClause, FilterOperator, FilterTypeHint } from "./profilerTypes";

/**
 * A filtered view over a RingBuffer that applies filter clauses client-side.
 * Separates filtering concerns from the ring buffer storage.
 *
 * Key behaviors:
 * - When filter is active, only matching rows are returned
 * - When filter is cleared, ALL events (including those hidden while filtering) are visible
 * - Filtering is client-side only; does not affect the underlying buffer storage
 *
 * @template T - Row type that extends IndexedRow
 */
export class FilteredBuffer<T extends IndexedRow> {
    private _buffer: RingBuffer<T>;
    private _clauses: FilterClause[] = [];
    private _enabled: boolean = false;
    private _quickFilter: string | undefined;

    /**
     * Optional function to convert raw buffer rows to a different shape
     * before applying filters. When set, filters operate on the converted rows.
     */
    private _rowConverter: ((row: T) => Record<string, unknown>) | undefined;

    /**
     * Creates a new FilteredBuffer wrapping the given RingBuffer.
     * @param buffer - The underlying RingBuffer to filter
     */
    constructor(buffer: RingBuffer<T>) {
        this._buffer = buffer;
    }

    /**
     * Gets the underlying RingBuffer.
     */
    get buffer(): RingBuffer<T> {
        return this._buffer;
    }

    /**
     * Gets whether any filtering is currently active (column filters or quick filter).
     */
    get isFilterActive(): boolean {
        return (
            (this._enabled && this._clauses.length > 0) ||
            (this._quickFilter !== undefined && this._quickFilter.trim() !== "")
        );
    }

    /**
     * Gets whether column-level filtering (clauses) is active.
     */
    get isClauseFilterActive(): boolean {
        return this._enabled && this._clauses.length > 0;
    }

    /**
     * Gets the current filter clauses.
     */
    get clauses(): ReadonlyArray<FilterClause> {
        return this._clauses;
    }

    /**
     * Gets the current quick filter term.
     */
    get quickFilter(): string | undefined {
        return this._quickFilter;
    }

    /**
     * Gets the total number of items in the underlying buffer (unfiltered count).
     */
    get totalCount(): number {
        return this._buffer.size;
    }

    /**
     * Gets the number of items that match the current filter (column + quick).
     * Returns total count if no filter is active.
     */
    get filteredCount(): number {
        if (!this.isFilterActive) {
            return this._buffer.size;
        }
        return this.getFilteredRows().length;
    }

    /**
     * Sets the filter clauses and enables filtering.
     * This sets the filter per column if any. Filter clauses represent
     * the conditions that must be met for a row to be included in the filtered result.
     * If there are many clauses, they are combined with AND logic (a row must match all clauses to be included).
     * Meaning of the clause properties:
     * - field: The column/field name to filter on
     * - operator: The comparison operator (e.g. equals, contains, greater than)
     * - value: The value to compare against (not used for operators like IsNull)
     * - values: An array of values for operators like "In"
     * - typeHint: Optional hint for how to interpret the value (e.g. as number or date)
     * These are not used for quick filter which is a separate text-based search across all columns.
     * @param clauses - Array of filter clauses (combined with AND logic)
     */
    setColumnFilters(clauses: FilterClause[]): void {
        this._clauses = [...clauses];
        this._enabled = clauses.length > 0;
    }

    /**
     * Clears all filter clauses and disables clause filtering.
     * Does NOT clear quick filter — use clearQuickFilter() or clearAllFilters() for that.
     * After clearing, all events in the buffer become visible (if no quick filter).
     */
    clearColumnFilters(): void {
        this._clauses = [];
        this._enabled = false;
    }

    /**
     * Sets the quick filter term (cross-column case-insensitive contains search).
     * An empty/whitespace-only term disables quick filtering.
     */
    setQuickFilter(term: string | undefined): void {
        this._quickFilter = term && term.trim() !== "" ? term : undefined;
    }

    /**
     * Clears the quick filter.
     */
    clearQuickFilter(): void {
        this._quickFilter = undefined;
    }

    /**
     * Clears both column filters and the quick filter.
     */
    clearAllFilters(): void {
        this.clearColumnFilters();
        this.clearQuickFilter();
    }

    /**
     * Sets an optional row converter function.
     * When set, rows are converted before filters are evaluated.
     * This allows filtering on view-level column names instead of raw event fields.
     */
    setRowConverter(converter: ((row: T) => Record<string, unknown>) | undefined): void {
        this._rowConverter = converter;
    }

    /**
     * Gets all rows that match the current filter.
     * Returns all rows if no filter is active.
     * When a row converter is set, filters operate on converted rows.
     */
    getFilteredRows(): T[] {
        const allRows = this._buffer.getAllRows();
        if (!this.isFilterActive) {
            return allRows;
        }

        const hasClauseFilter = this._enabled && this._clauses.length > 0;
        const hasQuickFilter = this._quickFilter !== undefined && this._quickFilter.trim() !== "";

        return allRows.filter((row) => {
            const targetRow = this._rowConverter ? (this._rowConverter(row) as T) : row;

            if (hasClauseFilter && !this.evaluateRow(targetRow)) {
                return false;
            }
            if (hasQuickFilter && !this.matchesQuickFilter(targetRow, this._quickFilter!)) {
                return false;
            }
            return true;
        });
    }

    /**
     * Gets the count of rows that match the current filter (column + quick).
     * When a row converter is set, filters operate on converted rows.
     * More efficient than getFilteredRows().length when you only need the count.
     */
    getFilteredCount(): number {
        if (!this.isFilterActive) {
            return this._buffer.size;
        }
        return this.getFilteredRows().length;
    }

    /**
     * Gets distinct non-empty string values for a given field across ALL rows
     * in the underlying buffer (ignoring any active filters).
     * When a row converter is set, the converted row is used.
     * @param field - The column/field name to collect distinct values for
     * @returns Sorted array of unique non-empty string values
     */
    getDistinctValuesForField(field: string): string[] {
        const allRows = this._buffer.getAllRows();
        const seen = new Set<string>();
        for (const row of allRows) {
            const target = this._rowConverter
                ? this._rowConverter(row)
                : (row as unknown as Record<string, unknown>);
            const val = String(target[field] ?? "");
            if (val !== "") {
                seen.add(val);
            }
        }
        return Array.from(seen).sort((a, b) => a.localeCompare(b));
    }

    /**
     * Gets a range of filtered rows for pagination.
     * @param startIndex - The starting index in the filtered result set
     * @param count - Maximum number of rows to return
     * @returns Array of matching rows
     */
    getFilteredRange(startIndex: number, count: number): T[] {
        const filtered = this.getFilteredRows();
        if (startIndex < 0 || startIndex >= filtered.length) {
            return [];
        }
        const endIndex = Math.min(startIndex + count, filtered.length);
        return filtered.slice(startIndex, endIndex);
    }

    /**
     * Tests if a single row matches the current filter.
     * Returns true if no filter is active or if the row matches all clauses.
     * @param row - The row to test
     */
    matches(row: T): boolean {
        if (!this.isFilterActive) {
            return true;
        }
        return this.evaluateRow(row);
    }

    /**
     * Tests if a row matches the quick filter (cross-column OR, case-insensitive contains).
     * Returns true if any column value contains the search term.
     * Skips internal fields like 'id' and 'eventNumber'.
     * @param row - The row to test
     * @param quickFilter - The search term
     */
    matchesQuickFilter(row: T, quickFilter: string): boolean {
        if (!quickFilter || quickFilter.trim() === "") {
            return true;
        }
        const term = quickFilter.toLowerCase();
        for (const key of Object.keys(row as Record<string, unknown>)) {
            if (key === "id" || key === "eventNumber") {
                continue;
            }
            const val = (row as Record<string, unknown>)[key];
            // eslint-disable-next-line eqeqeq
            if (val != undefined && String(val).toLowerCase().includes(term)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Evaluates a row against all filter clauses (AND logic).
     * All clauses must match for the row to pass.
     */
    private evaluateRow(row: T): boolean {
        for (const clause of this._clauses) {
            if (!this.evaluateClause(row, clause)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Evaluates a single filter clause against a row.
     */
    private evaluateClause(row: T, clause: FilterClause): boolean {
        const fieldValue = this.getFieldValue(row, clause.field);

        switch (clause.operator) {
            case FilterOperator.IsNull:
                return this.isNullOrUndefined(fieldValue);

            case FilterOperator.IsNotNull:
                return !this.isNullOrUndefined(fieldValue);

            case FilterOperator.Equals:
                return this.evaluateEquals(fieldValue, clause.value, clause.typeHint);

            case FilterOperator.NotEquals:
                return !this.evaluateEquals(fieldValue, clause.value, clause.typeHint);

            case FilterOperator.LessThan:
                return this.evaluateComparison(fieldValue, clause.value, clause.typeHint) < 0;

            case FilterOperator.LessThanOrEqual:
                return this.evaluateComparison(fieldValue, clause.value, clause.typeHint) <= 0;

            case FilterOperator.GreaterThan:
                return this.evaluateComparison(fieldValue, clause.value, clause.typeHint) > 0;

            case FilterOperator.GreaterThanOrEqual:
                return this.evaluateComparison(fieldValue, clause.value, clause.typeHint) >= 0;

            case FilterOperator.Contains:
                return this.evaluateContains(fieldValue, clause.value);

            case FilterOperator.NotContains:
                // If field is null/missing, treat as "does not contain" => returns true
                if (this.isNullOrUndefined(fieldValue)) {
                    return true;
                }
                return !this.evaluateContains(fieldValue, clause.value);

            case FilterOperator.StartsWith:
                return this.evaluateStartsWith(fieldValue, clause.value);

            case FilterOperator.NotStartsWith:
                // If field is null/missing, treat as "does not start with" => returns true
                if (this.isNullOrUndefined(fieldValue)) {
                    return true;
                }
                return !this.evaluateStartsWith(fieldValue, clause.value);

            case FilterOperator.EndsWith:
                return this.evaluateEndsWith(fieldValue, clause.value);

            case FilterOperator.NotEndsWith:
                // If field is null/missing, treat as "does not end with" => returns true
                if (this.isNullOrUndefined(fieldValue)) {
                    return true;
                }
                return !this.evaluateEndsWith(fieldValue, clause.value);

            case FilterOperator.In:
                return this.evaluateIn(fieldValue, clause.values);

            default:
                // Unknown operator - default to no match
                return false;
        }
    }

    /**
     * Gets a field value from a row, checking both direct properties and additionalData.
     */
    private getFieldValue(row: T, field: string): unknown {
        // Check direct property first
        if (field in row) {
            return (row as Record<string, unknown>)[field];
        }

        // Check additionalData if present (for EventRow)
        const additionalData = (row as Record<string, unknown>)["additionalData"];
        if (additionalData && typeof additionalData === "object" && field in additionalData) {
            return (additionalData as Record<string, unknown>)[field];
        }

        return undefined;
    }

    /**
     * Checks if a value is null or undefined.
     * @param value - The value to check
     * @returns true if value is null or undefined
     */
    private isNullOrUndefined(value: unknown): boolean {
        // eslint-disable-next-line eqeqeq
        return value == undefined;
    }

    /**
     * Evaluates equality between field value and filter value.
     * Handles type coercion based on typeHint.
     */
    private evaluateEquals(
        fieldValue: unknown,
        filterValue: string | number | boolean | undefined,
        typeHint?: FilterTypeHint,
    ): boolean {
        if (this.isNullOrUndefined(fieldValue) && this.isNullOrUndefined(filterValue)) {
            return true;
        }
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return false;
        }

        // Determine type hint from filter value if not provided
        const effectiveTypeHint =
            typeHint ??
            (typeof filterValue === "number" ? FilterTypeHint.Number : FilterTypeHint.String);

        if (effectiveTypeHint === FilterTypeHint.Number) {
            const numFieldValue = this.parseNumber(fieldValue);
            const numFilterValue = this.parseNumber(filterValue);
            if (numFieldValue === undefined || numFilterValue === undefined) {
                return false; // Parse failure - no match
            }
            return numFieldValue === numFilterValue;
        }

        if (
            effectiveTypeHint === FilterTypeHint.Date ||
            effectiveTypeHint === FilterTypeHint.DateTime
        ) {
            const dateFieldValue = this.parseDate(fieldValue);
            const dateFilterValue = this.parseDate(filterValue);
            if (dateFieldValue === undefined || dateFilterValue === undefined) {
                return false;
            }
            return dateFieldValue.getTime() === dateFilterValue.getTime();
        }

        if (effectiveTypeHint === FilterTypeHint.Boolean) {
            const boolFieldValue = this.parseBoolean(fieldValue);
            const boolFilterValue = this.parseBoolean(filterValue);
            return boolFieldValue === boolFilterValue;
        }

        // Default: string comparison (case-insensitive)
        return String(fieldValue).toLowerCase() === String(filterValue).toLowerCase();
    }

    /**
     * Evaluates numeric comparison between field value and filter value.
     * Returns: negative if fieldValue < filterValue, 0 if equal, positive if greater.
     * Returns NaN if comparison cannot be performed.
     */
    private evaluateComparison(
        fieldValue: unknown,
        filterValue: string | number | boolean | undefined,
        typeHint?: FilterTypeHint,
    ): number {
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return NaN;
        }

        const effectiveTypeHint =
            typeHint ??
            (typeof filterValue === "number" ? FilterTypeHint.Number : FilterTypeHint.String);

        if (effectiveTypeHint === FilterTypeHint.Number) {
            const numFieldValue = this.parseNumber(fieldValue);
            const numFilterValue = this.parseNumber(filterValue);
            if (numFieldValue === undefined || numFilterValue === undefined) {
                return NaN;
            }
            return numFieldValue - numFilterValue;
        }

        if (
            effectiveTypeHint === FilterTypeHint.Date ||
            effectiveTypeHint === FilterTypeHint.DateTime
        ) {
            const dateFieldValue = this.parseDate(fieldValue);
            const dateFilterValue = this.parseDate(filterValue);
            if (dateFieldValue === undefined || dateFilterValue === undefined) {
                return NaN;
            }
            return dateFieldValue.getTime() - dateFilterValue.getTime();
        }

        // String comparison
        return String(fieldValue).toLowerCase().localeCompare(String(filterValue).toLowerCase());
    }

    /**
     * Evaluates contains (substring) check - case-insensitive.
     */
    private evaluateContains(
        fieldValue: unknown,
        filterValue: string | number | boolean | undefined,
    ): boolean {
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return false;
        }
        const strFieldValue = String(fieldValue).toLowerCase();
        const strFilterValue = String(filterValue).toLowerCase();
        return strFieldValue.includes(strFilterValue);
    }

    /**
     * Evaluates starts-with check - case-insensitive.
     */
    private evaluateStartsWith(
        fieldValue: unknown,
        filterValue: string | number | boolean | undefined,
    ): boolean {
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return false;
        }
        const strFieldValue = String(fieldValue).toLowerCase();
        const strFilterValue = String(filterValue).toLowerCase();
        return strFieldValue.startsWith(strFilterValue);
    }

    /**
     * Evaluates ends-with check - case-insensitive.
     */
    private evaluateEndsWith(
        fieldValue: unknown,
        filterValue: string | number | boolean | undefined,
    ): boolean {
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return false;
        }
        const strFieldValue = String(fieldValue).toLowerCase();
        const strFilterValue = String(filterValue).toLowerCase();
        return strFieldValue.endsWith(strFilterValue);
    }

    /**
     * Evaluates "in" (one-of) check - case-insensitive string comparison.
     * Returns true if the field value matches any of the provided values.
     */
    private evaluateIn(fieldValue: unknown, values: string[] | undefined): boolean {
        if (this.isNullOrUndefined(fieldValue) || !values || values.length === 0) {
            return false;
        }
        const strFieldValue = String(fieldValue).toLowerCase();
        return values.some((v) => strFieldValue === v.toLowerCase());
    }

    /**
     * Parses a value as a number, returning undefined if parsing fails.
     * @param value - The value to parse
     * @returns The parsed number or undefined if parsing fails
     */
    private parseNumber(value: unknown): number | undefined {
        if (typeof value === "number") {
            return isNaN(value) ? undefined : value;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed === "") {
                return undefined;
            }
            const parsed = Number(trimmed);
            return isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
    }

    /**
     * Parses a value as a Date, returning undefined if parsing fails.
     * @param value - The value to parse
     * @returns The parsed Date or undefined if parsing fails
     */
    private parseDate(value: unknown): Date | undefined {
        if (value instanceof Date) {
            return isNaN(value.getTime()) ? undefined : value;
        }
        if (typeof value === "number") {
            const date = new Date(value);
            return isNaN(date.getTime()) ? undefined : date;
        }
        if (typeof value === "string") {
            const date = new Date(value);
            return isNaN(date.getTime()) ? undefined : date;
        }
        return undefined;
    }

    /**
     * Parses a value as a boolean.
     */
    private parseBoolean(value: unknown): boolean {
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "string") {
            const lower = value.toLowerCase().trim();
            return lower === "true" || lower === "1" || lower === "yes";
        }
        if (typeof value === "number") {
            return value !== 0;
        }
        return false;
    }
}
