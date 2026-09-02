/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode } from "../../syntax/index.js";

/**
 * Whether a parsed column declaration allows NULL values.
 *
 * Nullability is read only from the column's structural option or its direct computed-column tail.
 * Nested CHECK predicates are deliberately ignored, so `CHECK (c IS NOT NULL)` cannot change the
 * declaration metadata.
 */
export function columnAllowsNull(column: SyntaxNode): boolean {
    const direct = [...column.children()];
    for (const option of direct.filter((child) => child.kind === "ColumnOption")) {
        if (isNotNullPair([...option.children()])) return false;
    }
    return !isNotNullPair(direct);
}

function isNotNullPair(nodes: readonly SyntaxNode[]): boolean {
    return nodes.some((node, index) => node.kind === "Not" && nodes[index + 1]?.kind === "Null");
}
