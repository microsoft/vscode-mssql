/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode } from "../syntax/index.js";
import { firstDescendantOfKind as firstDescendant } from "../syntax/treeUtilities.js";

/** The argument shapes shared by routine diagnostics and signature help. */
export interface RoutineCallArguments {
    /** The scalar or table-function argument list, when the grammar created one. */
    readonly node?: SyntaxNode;
    /** One node per supplied argument, including named arguments. */
    readonly items: readonly SyntaxNode[];
    /** True for the special `*` form used by scalar and table-valued calls. */
    readonly wildcard: boolean;
}

/**
 * Returns the bound argument shape for a routine call.
 *
 * Table-valued sources use `TableFunctionArgumentList`, while scalar and global function calls
 * use `ArgumentList`. Keeping that distinction here prevents each feature from counting only the
 * scalar form and then disagreeing about the same call.
 */
export function routineCallArguments(call: SyntaxNode): RoutineCallArguments {
    const scalar = firstDescendant(call, "ArgumentList");
    if (scalar) {
        return {
            node: scalar,
            items: Object.freeze(
                [...scalar.children()].filter((child) => child.kind === "Expression"),
            ),
            wildcard: false,
        };
    }

    const table = firstDescendant(call, "TableFunctionArgumentList");
    if (table) {
        const written = [...table.children()].filter(
            (child) => child.kind === "TableFunctionArgument",
        );
        // `*` is a built-in's own contract, as in COUNT(*), not a supplied argument. Counting it
        // as one would report a routine that was given nothing as correctly called.
        const items = written.filter((child) => !isBareStar(child));
        return {
            node: table,
            items: Object.freeze(items),
            wildcard: items.length !== written.length,
        };
    }

    return {
        items: Object.freeze([]),
        wildcard: firstDescendant(call, "Star") !== undefined,
    };
}

/** True when the argument was written as a bare `*` rather than as an expression. */
function isBareStar(argument: SyntaxNode): boolean {
    const children = [...argument.children()];
    return children.length === 1 && children[0]!.kind === "Star";
}

/** True when a variable node is the parameter label in `@name = value` routine syntax. */
export function isNamedRoutineArgumentLabel(variable: SyntaxNode): boolean {
    if (variable.kind !== "Variable") return false;
    const expression = variable.parent();
    if (!expression || expression.kind !== "Expression") return false;
    const children = [...expression.children()];
    if (
        !children[0] ||
        children[0].start !== variable.start ||
        children[0].end !== variable.end ||
        children[1]?.kind !== "Equal"
    ) {
        return false;
    }
    const argumentContainer = expression.parent();
    return (
        argumentContainer?.kind === "ArgumentList" ||
        argumentContainer?.kind === "TableFunctionArgument"
    );
}
