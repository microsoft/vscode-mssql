/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QsSpatialFeatureTransport } from "../../../../sharedInterfaces/spatialResults";

export const SPATIAL_CLUSTER_POINT_THRESHOLD = 2_000;
export const SPATIAL_VERTEX_BUDGET = 250_000;
export const SPATIAL_DERIVED_BYTES_BUDGET = 64 * 1024 * 1024;

export type SpatialRendererChoice = "auto" | "canvas" | "clusters" | "gpuPoints";
export type SpatialRendererTier = "canvas" | "clusters" | "gpuPoints";

export function resolveSpatialRendererTier(
    allRenderableArePoints: boolean,
    featureCount: number,
    renderer: SpatialRendererChoice,
): SpatialRendererTier {
    if (!allRenderableArePoints) return "canvas";
    if (renderer === "canvas") return "canvas";
    if (renderer === "gpuPoints") return "gpuPoints";
    if (renderer === "clusters" || featureCount >= SPATIAL_CLUSTER_POINT_THRESHOLD) {
        return "clusters";
    }
    return "canvas";
}

export type SpatialDecodeStatus = "ready" | "null" | "unrenderable" | "unsupported" | "error";

export interface SpatialDecodedFeature {
    ordinal: number;
    status: SpatialDecodeStatus;
    label?: string;
    colorValue?: string;
    kind?: "geometry" | "geography";
    srid?: number;
    geometryType?: string;
    layout?: string;
    vertices?: number;
    envelope?: [minX: number, minY: number, maxX: number, maxY: number];
    parts?: number;
    rings?: number;
    /** GeoJSON geometry only; properties never carry source values. */
    geometry?: Record<string, unknown>;
    projection?: "EPSG:4326" | "EPSG:3857" | "planar";
    wkbBytes?: number;
    reason?: string;
}

export interface SpatialDecodeRequest {
    type: "decode";
    generation: number;
    sequence: number;
    features: QsSpatialFeatureTransport[];
    remainingVertices: number;
    remainingDerivedBytes: number;
}

export interface SpatialDecodeResponse {
    type: "decoded";
    generation: number;
    sequence: number;
    features: SpatialDecodedFeature[];
    decoded: number;
    unsupported: number;
    errors: number;
    vertices: number;
    derivedBytes: number;
    budgetReason?: "vertexBudget" | "derivedMemoryBudget";
    elapsedMs: number;
}
