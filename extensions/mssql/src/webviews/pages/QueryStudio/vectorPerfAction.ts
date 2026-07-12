/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QsVectorPerfSearchAction } from "../../../sharedInterfaces/queryStudio";
import type { VectorSearchTargetInfo } from "../../../sharedInterfaces/vectorSearch";

export type VectorPerfTargetResolution =
    | { readonly target: VectorSearchTargetInfo; readonly targetIndex: number }
    | { readonly error: string };

function sameIdentifier(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

/** Resolve a perf selector only against host-discovered catalog targets. */
export function resolveVectorPerfSearchTarget(
    action: QsVectorPerfSearchAction,
    targets: readonly VectorSearchTargetInfo[],
): VectorPerfTargetResolution {
    const matches = targets
        .map((target, targetIndex) => ({ target, targetIndex }))
        .filter(
            ({ target }) =>
                sameIdentifier(target.schema, action.target.schema) &&
                sameIdentifier(target.table, action.target.table) &&
                sameIdentifier(target.vectorColumn, action.target.vectorColumn),
        );
    if (matches.length === 0) {
        return { error: "The requested Vector performance target was not found in the catalog." };
    }
    if (matches.length > 1) {
        return { error: "The requested Vector performance target is ambiguous." };
    }
    if (!matches[0].target.keyColumn) {
        return { error: "The requested Vector performance target has no unique scalar key." };
    }
    return matches[0];
}
