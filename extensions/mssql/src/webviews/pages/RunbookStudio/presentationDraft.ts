/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PresentationLayoutEdit } from "../../../sharedInterfaces/runbookPresentation";

/** Merge staged layout edits by their stable output-node identity. A later
 * edit replaces the complete intent for that node while retaining edits for
 * every other node, including both sides of an atomic reorder. */
export function mergePresentationLayoutEdits(
    current: PresentationLayoutEdit[],
    changes: PresentationLayoutEdit[],
): PresentationLayoutEdit[] {
    const byNode = new Map(current.map((edit) => [edit.nodeId, edit]));
    for (const edit of changes) {
        byNode.set(edit.nodeId, edit);
    }
    return [...byNode.values()];
}
