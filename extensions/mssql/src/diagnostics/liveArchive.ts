/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiagEvent } from "../sharedInterfaces/diagnostics";
/** Keep recovered events queryable within the bounded live window, deduplicated by sequence. */
export function mergeBackfill(
    archive: DiagEvent[],
    recovered: DiagEvent[],
    cap: number,
): DiagEvent[] {
    const bySeq = new Map(recovered.slice(-cap).map((event) => [event.seq, event]));
    for (let i = archive.length - 1; i >= 0 && bySeq.size < cap; i--) {
        if (!bySeq.has(archive[i].seq)) bySeq.set(archive[i].seq, archive[i]);
    }
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
