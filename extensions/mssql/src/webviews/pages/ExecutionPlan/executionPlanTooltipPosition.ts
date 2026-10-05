/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const TOOLTIP_WIDTH = 520;
const TOOLTIP_MAXIMUM_HEIGHT = 420;
const TOOLTIP_MINIMUM_HEIGHT = 80;
const TOOLTIP_VIEWPORT_MARGIN = 8;
const TOOLTIP_VERTICAL_CLAMP_HEIGHT = 200;

export interface ExecutionPlanTooltipSourceBounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface ExecutionPlanTooltipAnchor {
    x: number;
    y: number;
    sourceBounds?: ExecutionPlanTooltipSourceBounds;
}

export interface ExecutionPlanTooltipViewport {
    width: number;
    height: number;
}

export interface ExecutionPlanTooltipPlacement {
    left: number;
    top: number;
    maxHeight: number;
}

export interface ExecutionPlanTooltipSize {
    width: number;
    height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(value, maximum));
}

function getMaximumHeight(top: number, viewportHeight: number): number {
    return Math.min(
        TOOLTIP_MAXIMUM_HEIGHT,
        Math.max(TOOLTIP_MINIMUM_HEIGHT, viewportHeight - top - TOOLTIP_VIEWPORT_MARGIN),
    );
}

/**
 * Adjusts the initial anchor-based placement after the tooltip has rendered at
 * its natural size. This keeps compact tooltips inside the viewport without a
 * fixed height or an internal scrollbar.
 */
export function fitExecutionPlanTooltipPlacement(
    placement: ExecutionPlanTooltipPlacement,
    tooltipSize: ExecutionPlanTooltipSize,
    viewport: ExecutionPlanTooltipViewport,
): ExecutionPlanTooltipPlacement {
    const fittedHeight = Math.min(
        tooltipSize.height,
        Math.max(0, viewport.height - TOOLTIP_VIEWPORT_MARGIN * 2),
    );
    const maximumLeft = Math.max(
        TOOLTIP_VIEWPORT_MARGIN,
        viewport.width - tooltipSize.width - TOOLTIP_VIEWPORT_MARGIN,
    );
    const maximumTop = Math.max(
        TOOLTIP_VIEWPORT_MARGIN,
        viewport.height - fittedHeight - TOOLTIP_VIEWPORT_MARGIN,
    );

    return {
        ...placement,
        left: clamp(placement.left, TOOLTIP_VIEWPORT_MARGIN, maximumLeft),
        top: clamp(placement.top, TOOLTIP_VIEWPORT_MARGIN, maximumTop),
        maxHeight: fittedHeight,
    };
}

/**
 * Prefers the supplied anchor and lets the post-render fitting pass move the
 * tooltip only when its measured dimensions would overflow the viewport.
 */
export function getExecutionPlanTooltipPlacement(
    anchor: ExecutionPlanTooltipAnchor,
    viewport: ExecutionPlanTooltipViewport,
): ExecutionPlanTooltipPlacement {
    const availableWidth = Math.max(0, viewport.width - TOOLTIP_VIEWPORT_MARGIN * 2);
    const tooltipWidth = Math.min(TOOLTIP_WIDTH, availableWidth);
    const maximumLeft = Math.max(
        TOOLTIP_VIEWPORT_MARGIN,
        viewport.width - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN,
    );
    const defaultTop = clamp(
        anchor.y,
        TOOLTIP_VIEWPORT_MARGIN,
        Math.max(TOOLTIP_VIEWPORT_MARGIN, viewport.height - TOOLTIP_VERTICAL_CLAMP_HEIGHT),
    );

    if (!anchor.sourceBounds) {
        return {
            left: clamp(anchor.x, TOOLTIP_VIEWPORT_MARGIN, maximumLeft),
            top: defaultTop,
            maxHeight: getMaximumHeight(defaultTop, viewport.height),
        };
    }

    return {
        left: anchor.x,
        top: anchor.y,
        maxHeight: getMaximumHeight(anchor.y, viewport.height),
    };
}
