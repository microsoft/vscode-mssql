/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";

import type { BoundColumn, BoundRelation, SignatureHelp } from "../../../src/index.ts";

type SignatureInformation = SignatureHelp["signatures"][number];

export type RequiredSignatureHelp = Omit<SignatureHelp, "signatures"> & {
    readonly signatures: readonly [SignatureInformation, ...SignatureInformation[]];
};

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

export function requiredSignatureHelp(value: SignatureHelp | undefined): RequiredSignatureHelp {
    assertDefined(value, "expected signature help");
    const [first, ...rest] = value.signatures;
    assertDefined(first, "expected at least one signature");
    return { ...value, signatures: [first, ...rest] };
}

export function assertKnownColumns(
    relation: BoundRelation,
): asserts relation is BoundRelation & { readonly columns: readonly BoundColumn[] } {
    assert.notEqual(relation.columns, "unknown", "expected hydrated relation columns");
}
