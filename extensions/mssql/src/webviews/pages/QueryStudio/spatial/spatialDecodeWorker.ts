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
import { analyzeSpatialCoordinates } from "./spatialGeometryAnalysis";

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
        const geometryObject = geoJson.writeGeometryObject(geometry) as unknown as Record<
            string,
            unknown
        >;
        const geometryType = geometry.getType();
        const coordinates = geometryObject["coordinates"];
        const analysis = analyzeSpatialCoordinates(geometryType, coordinates);
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
            vertices: analysis.vertices,
            envelope: analysis.envelope,
            parts: analysis.parts,
            rings: analysis.rings,
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
