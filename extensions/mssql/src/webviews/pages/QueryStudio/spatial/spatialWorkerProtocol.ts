/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QsSpatialFeatureTransport } from "../../../../sharedInterfaces/spatialResults";

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
}

export interface SpatialDecodeResponse {
    type: "decoded";
    generation: number;
    sequence: number;
    features: SpatialDecodedFeature[];
    decoded: number;
    unsupported: number;
    errors: number;
    elapsedMs: number;
}
