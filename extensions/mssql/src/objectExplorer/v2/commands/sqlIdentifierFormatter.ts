/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL identifier formatting for OE v2 native commands (oe_view_design
 * §11.4): bracket-quote identifiers (']' doubled), qualified names, and
 * bounded SELECT TOP preview SQL. Pure module — the ONLY place OE v2
 * composes SQL text, and identifiers always pass through bracketQuote.
 */

/** Always-bracketed, ]-doubled — safe for any identifier content. */
export function bracketQuote(identifier: string): string {
    return `[${identifier.replace(/]/g, "]]")}]`;
}

export function qualifiedName(schema: string, name: string): string {
    return `${bracketQuote(schema)}.${bracketQuote(name)}`;
}

/** SELECT TOP n * FROM [schema].[name]; — n clamped to [1, 100000]. */
export function selectTopSql(schema: string, name: string, rowLimit: number): string {
    const limit = Number.isInteger(rowLimit) && rowLimit > 0 ? Math.min(rowLimit, 100_000) : 1000;
    return `SELECT TOP ${limit} *\nFROM ${qualifiedName(schema, name)};\n`;
}
