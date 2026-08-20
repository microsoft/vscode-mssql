/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DocumentAnalysisSnapshot } from "../runtime/contracts.js";
import { ancestorOfKind as ancestor } from "../syntax/treeUtilities.js";

/** The complete identifier occurrence at a caret in one published document snapshot. */
export function occurrenceRange(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): { readonly start: number; readonly end: number } | undefined {
    const node = ancestor(snapshot.syntax.nodeAt(offset), [
        "IdentifierName",
        "MultipartIdentifier",
        "Variable",
    ]);
    return node ? { start: node.start, end: node.end } : undefined;
}

/** Rejects host positions that cannot belong to the supplied immutable snapshot. */
export function assertDocumentOffset(snapshot: DocumentAnalysisSnapshot, offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > snapshot.text.length) {
        throw new RangeError(`Invalid document offset ${offset}`);
    }
}
