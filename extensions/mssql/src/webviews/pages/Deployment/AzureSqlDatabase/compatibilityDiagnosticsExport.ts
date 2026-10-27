/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function serializeCompatibilityDiagnostics(
    headers: readonly string[],
    rows: readonly (readonly string[])[],
    format: "csv" | "json",
): string {
    if (format === "json") {
        return JSON.stringify(
            rows.map((row) =>
                Object.fromEntries(headers.map((header, index) => [header, row[index]])),
            ),
            undefined,
            2,
        );
    }
    const csvCell = (value: string) => {
        // Diagnostic messages and filenames can contain spreadsheet formulas.
        const text = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
        return `"${text.replace(/"/g, '""')}"`;
    };
    return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
