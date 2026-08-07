/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ExecutionPlanViewport {
    x: number;
    y: number;
    zoom: number;
}

export interface ExecutionPlanViewportPoint {
    x: number;
    y: number;
}

export interface ExecutionPlanViewportSize {
    width: number;
    height: number;
}

/**
 * Returns a viewport with a new zoom while keeping the flow coordinate beneath the supplied
 * screen-space anchor fixed. Execution plans use the canvas origin so top-aligned nodes remain
 * visible as the scale changes.
 */
export function getViewportForExecutionPlanZoom(
    viewport: ExecutionPlanViewport,
    zoom: number,
    anchor: ExecutionPlanViewportPoint = { x: 0, y: 0 },
): ExecutionPlanViewport | undefined {
    if (viewport.zoom <= 0 || zoom <= 0) {
        return undefined;
    }

    const scale = zoom / viewport.zoom;
    return {
        x: anchor.x - (anchor.x - viewport.x) * scale,
        y: anchor.y - (anchor.y - viewport.y) * scale,
        zoom,
    };
}

/**
 * Returns the smallest viewport translation that fully reveals a node. The zoom level is
 * preserved, and no viewport is returned when the node is already visible.
 */
export function getViewportToRevealExecutionPlanNode(
    viewport: ExecutionPlanViewport,
    nodePosition: ExecutionPlanViewportPoint,
    nodeSize: ExecutionPlanViewportSize,
    viewportSize: ExecutionPlanViewportSize,
    padding: number,
): ExecutionPlanViewport | undefined {
    if (
        viewport.zoom <= 0 ||
        viewportSize.width <= 0 ||
        viewportSize.height <= 0 ||
        nodeSize.width < 0 ||
        nodeSize.height < 0
    ) {
        return undefined;
    }

    const safePadding = Math.max(0, padding);
    const visibleLeft = Math.min(safePadding, viewportSize.width / 2);
    const visibleTop = Math.min(safePadding, viewportSize.height / 2);
    const visibleRight = Math.max(visibleLeft, viewportSize.width - safePadding);
    const visibleBottom = Math.max(visibleTop, viewportSize.height - safePadding);

    const nodeLeft = viewport.x + nodePosition.x * viewport.zoom;
    const nodeTop = viewport.y + nodePosition.y * viewport.zoom;
    const nodeRight = nodeLeft + nodeSize.width * viewport.zoom;
    const nodeBottom = nodeTop + nodeSize.height * viewport.zoom;

    let deltaX = 0;
    let deltaY = 0;

    if (nodeLeft < visibleLeft) {
        deltaX = visibleLeft - nodeLeft;
    } else if (nodeRight > visibleRight) {
        deltaX = visibleRight - nodeRight;
    }

    if (nodeTop < visibleTop) {
        deltaY = visibleTop - nodeTop;
    } else if (nodeBottom > visibleBottom) {
        deltaY = visibleBottom - nodeBottom;
    }

    if (deltaX === 0 && deltaY === 0) {
        return undefined;
    }

    return {
        x: viewport.x + deltaX,
        y: viewport.y + deltaY,
        zoom: viewport.zoom,
    };
}
