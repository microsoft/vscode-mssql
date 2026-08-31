/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identifier quoting (design 05 §10.6): bracket only when required — the
 * identifier is not a regular T-SQL identifier or collides with a reserved
 * word.
 */

import { TSQL_KEYWORD_MAP } from "../data/keywords.generated";

const REGULAR_IDENTIFIER = /^[A-Za-z_@#][A-Za-z0-9_@#$]*$/;

export function needsBracketing(identifier: string): boolean {
    if (!REGULAR_IDENTIFIER.test(identifier)) {
        return true;
    }
    const keyword = TSQL_KEYWORD_MAP.get(identifier.toUpperCase());
    return keyword !== undefined && keyword.reserved;
}

export function quoteIdentifier(identifier: string): string {
    return needsBracketing(identifier) ? `[${identifier.replace(/\]/g, "]]")}]` : identifier;
}

export function quoteParts(parts: readonly string[]): string {
    return parts.map(quoteIdentifier).join(".");
}
