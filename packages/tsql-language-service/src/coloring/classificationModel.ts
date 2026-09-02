/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { textRangeKey as rangeKey } from "../text/index.js";
import {
    sqlColorTokenModifiers,
    type SqlColorTokenModifier,
    type SqlColorTokenType,
} from "./contracts.js";

/** One resolved classification before it is attached to a document range. */
export interface Classification {
    readonly type: SqlColorTokenType;
    readonly modifiers: readonly SqlColorTokenModifier[];
}

const noModifiers: readonly SqlColorTokenModifier[] = Object.freeze([]);
const modifierOrder = new Map(sqlColorTokenModifiers.map((modifier, index) => [modifier, index]));

export function classification(
    type: SqlColorTokenType,
    modifiers: readonly SqlColorTokenModifier[] = noModifiers,
): Classification {
    return { type, modifiers: normalizeModifiers(modifiers) };
}

/** Deduplicates and orders modifiers by the published legend so results are byte-comparable. */
export function normalizeModifiers(
    modifiers: readonly SqlColorTokenModifier[],
): readonly SqlColorTokenModifier[] {
    if (modifiers.length === 0) return noModifiers;
    const unique = [...new Set(modifiers)];
    if (unique.length === 1) return Object.freeze(unique);
    unique.sort((left, right) => modifierOrder.get(left)! - modifierOrder.get(right)!);
    return Object.freeze(unique);
}
