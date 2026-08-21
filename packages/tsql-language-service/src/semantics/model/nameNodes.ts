/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxKind, SyntaxNode } from "../../syntax/index.js";
import { directChildOfKind as directChild } from "../../syntax/treeUtilities.js";

/**
 * Where a rowset or module name lives in the tree.
 *
 * The grammar reaches the same name through more than one shape: a `FROM` source wraps it in
 * `TableSourceName`, while a DML target holds it directly because wrapping it there reintroduces a
 * shift/reduce conflict with `OUTPUT ... INTO target (columns)`. Consumers ask this module rather
 * than matching a node kind, so a grammar shape change never silently disables a validation.
 */

/** Node kinds that own a rowset or module name. */
export const rowsetNameOwnerKinds: readonly SyntaxKind[] = Object.freeze([
    "TableSourceName",
    "DmlTarget",
    "ExecutableEntity",
]);

/**
 * The `MultipartIdentifier` naming the rowset or module `owner` refers to.
 *
 * Returns nothing for a target written as a variable, an `OPENROWSET`, or an omitted-component
 * name, none of which carry a complete multipart name to validate or resolve.
 */
export function rowsetNameNode(owner: SyntaxNode): SyntaxNode | undefined {
    const held = directChild(owner, "TableSourceName");
    if (held) return directChild(held, "MultipartIdentifier");
    return directChild(owner, "MultipartIdentifier");
}

/** The omitted-component name a rowset owner was written with, when it was written that way. */
export function omittedRowsetNameNode(owner: SyntaxNode): SyntaxNode | undefined {
    const held = directChild(owner, "TableSourceName");
    if (held) return directChild(held, "OmittedTableSourceName");
    return directChild(owner, "OmittedTableSourceName");
}
