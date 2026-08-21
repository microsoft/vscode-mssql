/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";

import type { BoundColumn, BoundRelation } from "../../../src/index.ts";

export function assertDefined<T>(
    value: T,
    message = "expected a defined value",
): asserts value is NonNullable<T> {
    assert.ok(value !== undefined && value !== null, message);
}

export function defined<T>(value: T, message = "expected a defined value"): NonNullable<T> {
    assertDefined(value, message);
    return value;
}

export function assertKnownColumns(
    relation: BoundRelation,
): asserts relation is BoundRelation & { readonly columns: readonly BoundColumn[] } {
    assert.notEqual(relation.columns, "unknown", "expected hydrated relation columns");
}
