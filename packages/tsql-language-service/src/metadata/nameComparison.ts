/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataNameComparison } from "./contracts.js";

/**
 * Locale-independent ordinal comparison used until a metadata backend supplies collation rules.
 * Display spelling is never folded; only keys used for lookup, equality, and prefix matching are.
 */
export function createMetadataNameComparison(caseSensitive: boolean): MetadataNameComparison {
    const key = (value: string) => (caseSensitive ? value : value.toUpperCase());
    return Object.freeze({
        caseSensitive,
        key,
        equals: (left: string | undefined, right: string | undefined) =>
            left === undefined || right === undefined ? left === right : key(left) === key(right),
        startsWith: (value: string, prefix: string) => key(value).startsWith(key(prefix)),
    });
}
