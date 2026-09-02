/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "./contracts.js";

/** Stable, allocation-small key for a UTF-16 half-open range. */
export function textRangeKey(range: TextRange): string {
    return `${range.start}:${range.end}`;
}
