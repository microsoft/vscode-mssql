/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const ARROW_LENGTH = 8;
const ARROW_HALF_HEIGHT = 4.5;
/** How far the edge line starts inside the arrowhead base, so the two join without a gap. */
const ARROW_EDGE_OVERLAP = 1;

export interface ExecutionPlanArrowGeometry {
    path: string;
    edgeSourceX: number;
}

/**
 * A small, solid arrowhead at the start of a left-to-right edge, pointing at the parent operator
 * that receives the rows. Every edge gets the same head; edge thickness alone shows row volume.
 */
export function getExecutionPlanArrowGeometry(
    sourceX: number,
    sourceY: number,
): ExecutionPlanArrowGeometry {
    const baseX = sourceX + ARROW_LENGTH;
    return {
        path: [
            `M ${sourceX} ${sourceY}`,
            `L ${baseX} ${sourceY - ARROW_HALF_HEIGHT}`,
            `L ${baseX} ${sourceY + ARROW_HALF_HEIGHT}`,
            "Z",
        ].join(" "),
        edgeSourceX: baseX - ARROW_EDGE_OVERLAP,
    };
}
