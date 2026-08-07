/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const CLASSIC_ARROW_MARKER_SIZE = 6;
const CLASSIC_ARROW_NOTCH_RATIO = 0.75;

export interface ExecutionPlanClassicArrowGeometry {
    path: string;
    edgeSourceX: number;
}

/**
 * Reproduces mxGraph's classic, notched start marker for a left-to-right edge.
 * The visible edge begins at the marker notch so it does not run through the arrowhead.
 */
export function getExecutionPlanClassicArrowGeometry(
    sourceX: number,
    sourceY: number,
    strokeWidth: number,
): ExecutionPlanClassicArrowGeometry {
    const normalizedStrokeWidth = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 1;
    const markerLength = CLASSIC_ARROW_MARKER_SIZE + normalizedStrokeWidth;
    const halfMarkerHeight = markerLength / 2;
    const tipX = sourceX + normalizedStrokeWidth / 2;
    const backX = tipX + markerLength;
    const notchX = tipX + markerLength * CLASSIC_ARROW_NOTCH_RATIO;

    return {
        path: [
            `M ${tipX} ${sourceY}`,
            `L ${backX} ${sourceY - halfMarkerHeight}`,
            `L ${notchX} ${sourceY}`,
            `L ${backX} ${sourceY + halfMarkerHeight}`,
            "Z",
        ].join(" "),
        edgeSourceX: notchX,
    };
}
