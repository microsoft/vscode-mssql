/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure math for the "Copy image" map export: each OpenLayers layer canvas
 * carries either a CSS matrix transform or a CSS size that differs from its
 * pixel size; compositing onto one output canvas needs that mapping as a
 * 2d-context transform. Kept free of DOM/OL imports so unit tests cover it.
 */

export type CanvasCompositeMatrix = [number, number, number, number, number, number];

const IDENTITY: CanvasCompositeMatrix = [1, 0, 0, 1, 0, 0];

/**
 * Resolve the context transform that maps a layer canvas's pixels onto the
 * output canvas (CSS pixels). Prefers the element's `matrix(...)` transform;
 * falls back to the style-size / pixel-size scale; identity when neither is
 * usable (never NaN — a bad transform must not poison the whole export).
 */
export function canvasCompositeMatrix(
    transform: string,
    styleWidth: string,
    styleHeight: string,
    pixelWidth: number,
    pixelHeight: number,
): CanvasCompositeMatrix {
    const match = /^matrix\(([^(]*)\)$/.exec(transform.trim());
    if (match) {
        const parts = match[1].split(",").map((part) => Number(part.trim()));
        if (parts.length === 6 && parts.every((part) => Number.isFinite(part))) {
            return parts as CanvasCompositeMatrix;
        }
    }
    const scaleX = Number.parseFloat(styleWidth) / pixelWidth;
    const scaleY = Number.parseFloat(styleHeight) / pixelHeight;
    if (Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0) {
        return [scaleX, 0, 0, scaleY, 0, 0];
    }
    return IDENTITY;
}
