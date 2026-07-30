/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const TOOLTIP_WIDTH = 560;
const TOOLTIP_MAXIMUM_HEIGHT = 420;
const TOOLTIP_MINIMUM_HEIGHT = 80;
const TOOLTIP_VIEWPORT_MARGIN = 8;
const TOOLTIP_SOURCE_GAP = 8;
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
 * Positions node tooltips beside their source. If neither horizontal side has
 * enough room, the tooltip is placed above or below the node instead.
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

    const source = anchor.sourceBounds;
    const rightmostLeft = viewport.width - TOOLTIP_VIEWPORT_MARGIN - tooltipWidth;
    if (rightmostLeft >= source.right) {
        const left = Math.min(source.right + TOOLTIP_SOURCE_GAP, rightmostLeft);
        return {
            left,
            top: defaultTop,
            maxHeight: getMaximumHeight(defaultTop, viewport.height),
        };
    }

    if (source.left - tooltipWidth >= TOOLTIP_VIEWPORT_MARGIN) {
        const left = Math.max(
            TOOLTIP_VIEWPORT_MARGIN,
            source.left - tooltipWidth - TOOLTIP_SOURCE_GAP,
        );
        return {
            left,
            top: defaultTop,
            maxHeight: getMaximumHeight(defaultTop, viewport.height),
        };
    }

    const left = clamp(
        (source.left + source.right - tooltipWidth) / 2,
        TOOLTIP_VIEWPORT_MARGIN,
        maximumLeft,
    );
    const belowTop = source.bottom + TOOLTIP_SOURCE_GAP;
    const availableBelow = viewport.height - TOOLTIP_VIEWPORT_MARGIN - belowTop;
    const availableAbove = source.top - TOOLTIP_SOURCE_GAP - TOOLTIP_VIEWPORT_MARGIN;

    if (availableBelow >= TOOLTIP_MINIMUM_HEIGHT || availableBelow >= availableAbove) {
        return {
            left,
            top: belowTop,
            maxHeight: Math.min(TOOLTIP_MAXIMUM_HEIGHT, Math.max(0, availableBelow)),
        };
    }

    const maxHeight = Math.min(TOOLTIP_MAXIMUM_HEIGHT, Math.max(0, availableAbove));
    return {
        left,
        top: source.top - TOOLTIP_SOURCE_GAP - maxHeight,
        maxHeight,
    };
}
