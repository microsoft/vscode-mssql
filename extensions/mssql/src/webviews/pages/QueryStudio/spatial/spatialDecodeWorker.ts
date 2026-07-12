/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import WKB from "ol/format/WKB.js";
import GeoJSON from "ol/format/GeoJSON.js";
import type {
    SpatialDecodeRequest,
    SpatialDecodeResponse,
    SpatialDecodedFeature,
} from "./spatialWorkerProtocol";

const wkb = new WKB();
const geoJson = new GeoJSON();

function decodeBase64(value: string): ArrayBuffer {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function vertexCount(value: unknown): number {
    if (!Array.isArray(value)) {
        return 0;
    }
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
        return 1;
    }
    let count = 0;
    for (const child of value) {
        count += vertexCount(child);
    }
    return count;
}

function envelope(value: unknown): [number, number, number, number] | undefined {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const visit = (coordinate: unknown): void => {
        if (!Array.isArray(coordinate)) return;
        if (
            coordinate.length >= 2 &&
            typeof coordinate[0] === "number" &&
            typeof coordinate[1] === "number"
        ) {
            minX = Math.min(minX, coordinate[0]);
            minY = Math.min(minY, coordinate[1]);
            maxX = Math.max(maxX, coordinate[0]);
            maxY = Math.max(maxY, coordinate[1]);
            return;
        }
        coordinate.forEach(visit);
    };
    visit(value);
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : undefined;
}

function topologyCounts(type: string, coordinates: unknown): { parts: number; rings: number } {
    const array = Array.isArray(coordinates) ? coordinates : [];
    switch (type) {
        case "MultiPoint":
        case "MultiLineString":
            return { parts: array.length, rings: 0 };
        case "Polygon":
            return { parts: 1, rings: array.length };
        case "MultiPolygon":
            return {
                parts: array.length,
                rings: array.reduce(
                    (total, polygon) => total + (Array.isArray(polygon) ? polygon.length : 0),
                    0,
                ),
            };
        default:
            return { parts: array.length > 0 ? 1 : 0, rings: 0 };
    }
}

function decodeFeature(feature: SpatialDecodeRequest["features"][number]): SpatialDecodedFeature {
    const base = {
        ordinal: feature.ordinal,
        ...(feature.label !== undefined ? { label: feature.label } : {}),
        ...(feature.colorValue !== undefined ? { colorValue: feature.colorValue } : {}),
    };
    if (feature.spatial === null) {
        return { ...base, status: "null" };
    }
    if (feature.spatial.status === "unrenderable") {
        return {
            ...base,
            status: "unrenderable",
            kind: feature.spatial.kind,
            ...(feature.spatial.srid !== undefined ? { srid: feature.spatial.srid } : {}),
            reason: feature.spatial.reason,
        };
    }
    try {
        const geometry = wkb.readGeometry(decodeBase64(feature.spatial.wkb));
        const geometryObject = geoJson.writeGeometryObject(geometry) as Record<string, unknown>;
        const geometryType = geometry.getType();
        const coordinates = geometryObject["coordinates"];
        const topology = topologyCounts(geometryType, coordinates);
        const projection =
            feature.spatial.kind === "geography" || feature.spatial.srid === 4326
                ? ("EPSG:4326" as const)
                : feature.spatial.srid === 3857
                  ? ("EPSG:3857" as const)
                  : ("planar" as const);
        return {
            ...base,
            status: "ready",
            kind: feature.spatial.kind,
            srid: feature.spatial.srid,
            geometryType,
            layout:
                "getLayout" in geometry && typeof geometry.getLayout === "function"
                    ? geometry.getLayout()
                    : undefined,
            vertices: vertexCount(coordinates),
            envelope: envelope(coordinates),
            parts: topology.parts,
            rings: topology.rings,
            geometry: geometryObject,
            projection,
            wkbBytes: feature.spatial.wkbBytes,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const unsupported = /unsupported wkb geometry type/i.test(message);
        return {
            ...base,
            status: unsupported ? "unsupported" : "error",
            kind: feature.spatial.kind,
            srid: feature.spatial.srid,
            wkbBytes: feature.spatial.wkbBytes,
            reason: unsupported ? "unsupportedInterchange" : "decodeFailed",
        };
    }
}

self.onmessage = (event: MessageEvent<SpatialDecodeRequest>) => {
    if (event.data.type !== "decode") {
        return;
    }
    const startedAt = performance.now();
    const features = event.data.features.map(decodeFeature);
    const response: SpatialDecodeResponse = {
        type: "decoded",
        generation: event.data.generation,
        sequence: event.data.sequence,
        features,
        decoded: features.filter((feature) => feature.status === "ready").length,
        unsupported: features.filter((feature) => feature.status === "unsupported").length,
        errors: features.filter((feature) => feature.status === "error").length,
        elapsedMs: performance.now() - startedAt,
    };
    self.postMessage(response);
};
