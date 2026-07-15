/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure camera math for the Projection workspace (testable seam beside the
 * canvas component, like vectorPerfAction.ts). The projection canvas maps
 * world (x, y) to screen via `sx = (x - cx) * scale + w/2` and
 * `sy = h/2 - (y - cy) * scale`.
 *
 * PCA coordinates have no fixed magnitude — unnormalized embeddings can span
 * hundreds of world units, so a correct fit scale may be far below 1. The
 * fit therefore has NO lower clamp (only the shared max for degenerate
 * single-point extents), and the interactive zoom floor is RELATIVE to the
 * fit so wheel zoom-out never jumps back up past it.
 */

export interface ProjectionPointsLike {
    readonly xs: ArrayLike<number>;
    readonly ys: ArrayLike<number>;
    readonly count: number;
}

export interface ProjectionViewTransform {
    cx: number;
    cy: number;
    scale: number;
}

export const VECTOR_PROJECTION_SCALE_MAX = 1200;
export const VECTOR_PROJECTION_FIT_PADDING = 0.86;
/** Legacy absolute wheel floor — still honored when it sits below the fit. */
export const VECTOR_PROJECTION_SCALE_MIN = 6;
/** How far past the fit the user may zoom out (fitScale / this ratio). */
export const VECTOR_PROJECTION_ZOOM_OUT_RATIO = 8;

/**
 * Camera that frames every point with padding, or undefined when there is
 * nothing to frame (no points / unusable canvas). Never clamps the scale
 * upward: wide spreads legitimately fit at scales « 1.
 */
export function computeProjectionFit(
    points: ProjectionPointsLike,
    width: number,
    height: number,
): ProjectionViewTransform | undefined {
    if (points.count <= 0 || width < 2 || height < 2) {
        return undefined;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.count; i++) {
        const x = points.xs[i];
        const y = points.ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (minX > maxX || minY > maxY) {
        return undefined;
    }
    const spanX = Math.max(1e-9, maxX - minX);
    const spanY = Math.max(1e-9, maxY - minY);
    return {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        scale: Math.min(
            VECTOR_PROJECTION_SCALE_MAX,
            Math.min(width / spanX, height / spanY) * VECTOR_PROJECTION_FIT_PADDING,
        ),
    };
}

/**
 * Lower zoom clamp for interactive zoom. Without a known fit this is the
 * legacy absolute floor; with one, the floor always sits at or below the
 * fit scale so returning to (and past) the framed view stays reachable.
 */
export function projectionZoomFloor(fitScale: number | undefined): number {
    if (fitScale === undefined || !Number.isFinite(fitScale) || fitScale <= 0) {
        return VECTOR_PROJECTION_SCALE_MIN;
    }
    return Math.min(VECTOR_PROJECTION_SCALE_MIN, fitScale / VECTOR_PROJECTION_ZOOM_OUT_RATIO);
}

/**
 * True when at least one point lands inside the viewport (with a margin
 * matching the draw cull). A restored camera that shows NOTHING is stale
 * evidence — the caller should refit instead of presenting empty space.
 */
export function projectionShowsAnyPoint(
    points: ProjectionPointsLike,
    view: ProjectionViewTransform,
    width: number,
    height: number,
    marginPx = 6,
): boolean {
    if (points.count <= 0 || !Number.isFinite(view.scale) || view.scale <= 0) {
        return false;
    }
    for (let i = 0; i < points.count; i++) {
        const sx = (points.xs[i] - view.cx) * view.scale + width / 2;
        const sy = height / 2 - (points.ys[i] - view.cy) * view.scale;
        if (
            sx >= -marginPx &&
            sy >= -marginPx &&
            sx <= width + marginPx &&
            sy <= height + marginPx
        ) {
            return true;
        }
    }
    return false;
}
