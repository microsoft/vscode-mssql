/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL identifier formatting for OE v2 native commands (oe_view_design
 * §11.4): bracket-quote identifiers (']' doubled) and compose qualified names.
 * Pure module; identifiers always pass through bracketQuote.
 */

/** Always-bracketed, ]-doubled — safe for any identifier content. */
export function bracketQuote(identifier: string): string {
    return `[${identifier.replace(/]/g, "]]")}]`;
}

export function qualifiedName(schema: string, name: string): string {
    return `${bracketQuote(schema)}.${bracketQuote(name)}`;
}
