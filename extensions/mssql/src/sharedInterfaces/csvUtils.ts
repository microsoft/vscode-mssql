/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared CSV utilities for profiler export functionality.
 * Used by both the React webview (profiler.tsx) and extension (profilerWebviewController.ts).
 */

/**
 * Sanitizes a value for CSV export to prevent formula injection.
 * Values starting with =, +, -, @, or tab are prefixed with a single quote.
 * This prevents spreadsheet applications from interpreting values as formulas.
 */
export function sanitizeCsvValue(value: string): string {
    if (/^[=+\-@\t]/.test(value)) {
        return "'" + value;
    }
    return value;
}

/**
 * Converts a single value to a properly escaped CSV cell.
 * Handles null/undefined, Date objects, newlines, formula injection, and quote escaping.
 */
export function formatCsvCell(value: unknown): string {
    // Handle null/undefined - use typeof and falsiness check to avoid null literal
    if (value === undefined || (typeof value === "object" && !value)) {
        return '""';
    }

    // Handle numeric zero and boolean false specially (they're falsy but valid values)
    if (value === 0) {
        return '"0"';
    }
    if (value === false) {
        return '"false"';
    }

    // Handle empty string
    if (value === "") {
        return '""';
    }

    // Handle Date objects - convert to ISO string
    if (value instanceof Date) {
        return `"${value.toISOString()}"`;
    }

    // Convert to string and handle newlines (replace with space for CSV compatibility)
    let stringValue = String(value).replace(/\r\n|\r|\n/g, " ");

    // Sanitize for formula injection
    stringValue = sanitizeCsvValue(stringValue);

    // Escape quotes and wrap in quotes
    stringValue = stringValue.replace(/"/g, '""');

    return `"${stringValue}"`;
}

/**
 * Generates a timestamp string suitable for file names.
 * Format: YYYY-MM-DD-HH-mm-ss
 */
export function generateExportTimestamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/**
 * Column definition for CSV export
 */
export interface CsvColumn {
    /** Field name to extract from data row */
    field: string;
    /** Header text for the column */
    header: string;
}

/**
 * Generates CSV content from an array of data rows.
 *
 * @param columns - Array of column definitions with field and header
 * @param rows - Array of data objects to export
 * @param getFieldValue - Optional function to extract field value from a row (defaults to direct property access)
 * @returns CSV content as a string
 */
export function generateCsvContent<T>(
    columns: CsvColumn[],
    rows: T[],
    getFieldValue?: (row: T, field: string) => unknown,
): string {
    // Default field accessor - direct property access
    const getValue =
        getFieldValue ?? ((row: T, field: string) => (row as Record<string, unknown>)[field]);

    // Build CSV content using array for memory efficiency
    const csvRows: string[] = [];

    // Add header row
    const headers = columns.map((col) => formatCsvCell(col.header));
    csvRows.push(headers.join(","));

    // Add data rows
    for (const row of rows) {
        const rowCells = columns.map((col) => {
            const value = getValue(row, col.field);
            return formatCsvCell(value);
        });
        csvRows.push(rowCells.join(","));
    }

    return csvRows.join("\n");
}
