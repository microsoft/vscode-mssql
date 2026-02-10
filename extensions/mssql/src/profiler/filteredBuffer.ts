/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RingBuffer } from "./ringBuffer";
import {
    IndexedRow,
    FilterClause,
    FilterOperator,
    FilterTypeHint,
    ColumnFilterCriteria,
} from "./profilerTypes";

/**
 * Internal cache structure for distinct values per field.
 */
interface DistinctValuesCache {
    /** Map of field name to array of distinct values (sorted) */
    values: Map<string, string[]>;
    /** Generation counter to detect buffer changes */
    generation: number;
}

/**
 * A filtered view over a RingBuffer that applies filter clauses client-side.
 * Separates filtering concerns from the ring buffer storage.
 *
 * Key behaviors:
 * - When filter is active, only matching rows are returned
 * - When filter is cleared, ALL events (including those hidden while filtering) are visible
 * - Filtering is client-side only; does not affect the underlying buffer storage
 * - Supports quick filter (cross-column search) and column-level filters
 *
 * @template T - Row type that extends IndexedRow
 */
export class FilteredBuffer<T extends IndexedRow> {
    private _buffer: RingBuffer<T>;
    private _clauses: FilterClause[] = [];
    private _enabled: boolean = false;
    /** Quick filter term for cross-column search */
    private _quickFilter: string = "";
    /** Column-level filters keyed by field name */
    private _columnFilters: Map<string, ColumnFilterCriteria> = new Map();
    /** Cache for distinct values per categorical column */
    private _distinctValuesCache: DistinctValuesCache = {
        values: new Map(),
        generation: 0,
    };
    /** Buffer generation counter for cache invalidation */
    private _bufferGeneration: number = 0;

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
     * Gets whether filtering is currently enabled.
     * Filter is active if legacy clauses, quick filter, or column filters are present.
     */
    get isFilterActive(): boolean {
        const hasLegacyClauses = this._enabled && this._clauses.length > 0;
        const hasQuickFilter = this._quickFilter.length > 0;
        const hasColumnFilters = this._columnFilters.size > 0;
        return hasLegacyClauses || hasQuickFilter || hasColumnFilters;
    }

    /**
     * Gets the current quick filter term.
     */
    get quickFilter(): string {
        return this._quickFilter;
    }

    /**
     * Gets the current column filters.
     */
    get columnFilters(): ReadonlyMap<string, ColumnFilterCriteria> {
        return this._columnFilters;
    }

    /**
     * Gets the current filter clauses.
     */
    get clauses(): ReadonlyArray<FilterClause> {
        return this._clauses;
    }

    /**
     * Gets the total number of items in the underlying buffer (unfiltered count).
     */
    get totalCount(): number {
        return this._buffer.size;
    }

    /**
     * Gets the number of items that match the current filter.
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
     * @param clauses - Array of filter clauses (combined with AND logic)
     */
    setFilter(clauses: FilterClause[]): void {
        this._clauses = [...clauses];
        this._enabled = clauses.length > 0;
    }

    /**
     * Clears all filter clauses and disables filtering.
     * After clearing, all events in the buffer become visible.
     */
    clearFilter(): void {
        this._clauses = [];
        this._enabled = false;
    }

    /**
     * Clears all filters including quick filter and column filters.
     */
    clearAllFilters(): void {
        this._clauses = [];
        this._enabled = false;
        this._quickFilter = "";
        this._columnFilters.clear();
    }

    /**
     * Sets the quick filter term for cross-column search.
     * @param term - Search term (empty string clears the quick filter)
     */
    setQuickFilter(term: string): void {
        this._quickFilter = term;
    }

    /**
     * Sets a column filter for a specific field.
     * @param field - The column field name
     * @param criteria - The filter criteria
     */
    setColumnFilter(field: string, criteria: ColumnFilterCriteria): void {
        this._columnFilters.set(field, criteria);
    }

    /**
     * Clears the column filter for a specific field.
     * @param field - The column field name
     */
    clearColumnFilter(field: string): void {
        this._columnFilters.delete(field);
    }

    /**
     * Gets distinct values for a categorical column.
     * Values are cached and recomputed only when the buffer changes.
     * @param mappedFields - Array of field names to search for (from eventsMapped config)
     * @returns Array of distinct values sorted alphabetically
     */
    getDistinctValues(mappedFields: string[]): string[] {
        // Use the first mapped field as cache key
        const cacheKey = mappedFields.join("|");

        // Check if cache is valid
        if (this._distinctValuesCache.generation !== this._bufferGeneration) {
            // Buffer changed, invalidate entire cache
            this._distinctValuesCache.values.clear();
            this._distinctValuesCache.generation = this._bufferGeneration;
        }

        // Check if we have cached values for this field
        const cached = this._distinctValuesCache.values.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        // Compute distinct values by trying each mapped field
        const allRows = this._buffer.getAllRows();
        const distinctSet = new Set<string>();

        for (const row of allRows) {
            // Try each mapped field until we find a value (same logic as convertEventToViewRow)
            for (const field of mappedFields) {
                const value = this.getFieldValue(row, field);
                // eslint-disable-next-line eqeqeq
                if (value != undefined && value !== "") {
                    distinctSet.add(String(value));
                    break; // Found a value, move to next row
                }
            }
        }

        // Sort and cache
        const sorted = Array.from(distinctSet).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase()),
        );
        this._distinctValuesCache.values.set(cacheKey, sorted);

        return sorted;
    }

    /**
     * Invalidates the distinct values cache.
     * Should be called when the buffer is modified (add, clear).
     */
    invalidateCache(): void {
        this._bufferGeneration++;
    }

    /**
     * Enables or disables the filter without changing clauses.
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }

    /**
     * Gets all rows that match the current filter.
     * Returns all rows if no filter is active.
     */
    getFilteredRows(): T[] {
        const allRows = this._buffer.getAllRows();
        if (!this.isFilterActive) {
            return allRows;
        }
        return allRows.filter((row) => this.evaluateRow(row));
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
     * Evaluates a row against all filters (AND logic between different filter types).
     * - Legacy clauses: All must match (AND logic)
     * - Quick filter: At least one column must contain the term (OR across columns)
     * - Column filters: All must match (AND logic), categorical uses OR within selected values
     */
    private evaluateRow(row: T): boolean {
        // Evaluate legacy filter clauses (AND logic)
        for (const clause of this._clauses) {
            if (!this.evaluateClause(row, clause)) {
                return false;
            }
        }

        // Evaluate quick filter (OR across all columns)
        if (this._quickFilter.length > 0) {
            if (!this.evaluateQuickFilter(row)) {
                return false;
            }
        }

        // Evaluate column filters (AND logic between columns)
        for (const criteria of this._columnFilters.values()) {
            if (!this.evaluateColumnFilter(row, criteria)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Evaluates the quick filter against a row.
     * Returns true if any column contains the quick filter term (case-insensitive).
     */
    private evaluateQuickFilter(row: T): boolean {
        const searchTerm = this._quickFilter.toLowerCase();

        // Check all enumerable properties of the row
        for (const key of Object.keys(row)) {
            const value = (row as Record<string, unknown>)[key];
            if (value !== null && value !== undefined) {
                const strValue = String(value).toLowerCase();
                if (strValue.includes(searchTerm)) {
                    return true;
                }
            }
        }

        // Check additionalData if present
        const additionalData = (row as Record<string, unknown>)["additionalData"];
        if (additionalData && typeof additionalData === "object") {
            for (const key of Object.keys(additionalData)) {
                const value = (additionalData as Record<string, unknown>)[key];
                if (value !== null && value !== undefined) {
                    const strValue = String(value).toLowerCase();
                    if (strValue.includes(searchTerm)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Evaluates a column filter against a row.
     * - Categorical: OR logic within selected values
     * - Numeric/Date/Text: Operator-based comparison
     *
     * The criteria.field is expected to be the raw field name (from eventsMapped)
     * that exists in EventRow/additionalData.
     */
    private evaluateColumnFilter(row: T, criteria: ColumnFilterCriteria): boolean {
        // Get the field value directly - criteria.field is the raw field name
        const fieldValue = this.getFieldValue(row, criteria.field);

        if (criteria.filterType === "categorical") {
            // Categorical filter: OR logic within selected values
            if (!criteria.selectedValues || criteria.selectedValues.length === 0) {
                return true; // No selection = no filter
            }
            if (this.isNullOrUndefined(fieldValue)) {
                return false;
            }
            const strValue = String(fieldValue);
            return criteria.selectedValues.some(
                (selected) => selected.toLowerCase() === strValue.toLowerCase(),
            );
        }

        // Operator-based filters (numeric, date, text)
        if (!criteria.operator || criteria.value === undefined) {
            return true; // No operator/value = no filter
        }

        // Determine type hint based on filter type
        let typeHint: FilterTypeHint = "string";
        if (criteria.filterType === "numeric") {
            typeHint = "number";
        } else if (criteria.filterType === "date") {
            typeHint = "datetime";
        }

        // Create a filter clause and evaluate it
        const clause: FilterClause = {
            field: criteria.field,
            operator: criteria.operator,
            value: criteria.value,
            typeHint: typeHint,
        };

        return this.evaluateClause(row, clause);
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

            default:
                // Unknown operator - default to no match
                return false;
        }
    }

    /**
     * Gets a field value from a row, checking both direct properties and additionalData.
     * Performs case-insensitive lookup to handle field name mismatches between
     * PascalCase config fields and camelCase EventRow properties.
     */
    private getFieldValue(row: T, field: string): unknown {
        const rowRecord = row as Record<string, unknown>;

        // Check direct property first (exact match)
        if (field in rowRecord) {
            return rowRecord[field];
        }

        // Try case-insensitive lookup on direct properties
        const fieldLower = field.toLowerCase();
        const rowKeys = Object.keys(rowRecord);
        for (const key of rowKeys) {
            if (key.toLowerCase() === fieldLower && key !== "additionalData") {
                return rowRecord[key];
            }
        }

        // Check additionalData if present (for EventRow)
        const additionalData = rowRecord["additionalData"];
        if (additionalData && typeof additionalData === "object") {
            const additionalRecord = additionalData as Record<string, unknown>;
            // Exact match in additionalData
            if (field in additionalRecord) {
                return additionalRecord[field];
            }
            // Case-insensitive lookup in additionalData
            for (const key of Object.keys(additionalRecord)) {
                if (key.toLowerCase() === fieldLower) {
                    return additionalRecord[key];
                }
            }
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
        filterValue: string | number | boolean | null | undefined,
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
            typeHint ?? (typeof filterValue === "number" ? "number" : "string");

        if (effectiveTypeHint === "number") {
            const numFieldValue = this.parseNumber(fieldValue);
            const numFilterValue = this.parseNumber(filterValue);
            if (numFieldValue === undefined || numFilterValue === undefined) {
                return false; // Parse failure - no match
            }
            return numFieldValue === numFilterValue;
        }

        if (effectiveTypeHint === "date" || effectiveTypeHint === "datetime") {
            const dateFieldValue = this.parseDate(fieldValue);
            const dateFilterValue = this.parseDate(filterValue);
            if (dateFieldValue === undefined || dateFilterValue === undefined) {
                return false;
            }
            return dateFieldValue.getTime() === dateFilterValue.getTime();
        }

        if (effectiveTypeHint === "boolean") {
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
        filterValue: string | number | boolean | null | undefined,
        typeHint?: FilterTypeHint,
    ): number {
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return NaN;
        }

        const effectiveTypeHint =
            typeHint ?? (typeof filterValue === "number" ? "number" : "string");

        if (effectiveTypeHint === "number") {
            const numFieldValue = this.parseNumber(fieldValue);
            const numFilterValue = this.parseNumber(filterValue);
            if (numFieldValue === undefined || numFilterValue === undefined) {
                return NaN;
            }
            return numFieldValue - numFilterValue;
        }

        if (effectiveTypeHint === "date" || effectiveTypeHint === "datetime") {
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
        filterValue: string | number | boolean | null | undefined,
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
        filterValue: string | number | boolean | null | undefined,
    ): boolean {
        if (this.isNullOrUndefined(fieldValue) || this.isNullOrUndefined(filterValue)) {
            return false;
        }
        const strFieldValue = String(fieldValue).toLowerCase();
        const strFilterValue = String(filterValue).toLowerCase();
        return strFieldValue.startsWith(strFilterValue);
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
