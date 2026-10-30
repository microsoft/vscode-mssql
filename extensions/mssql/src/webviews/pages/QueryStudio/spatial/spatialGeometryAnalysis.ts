/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SpatialGeometryAnalysis {
    vertices: number;
    envelope?: [minX: number, minY: number, maxX: number, maxY: number];
    parts: number;
    rings: number;
}

/** GeoJSON collections have member geometries rather than a coordinates field. */
export function analyzeSpatialGeometry(geometry: Record<string, unknown>): SpatialGeometryAnalysis {
    if (geometry.type !== "GeometryCollection") {
        return analyzeSpatialCoordinates(String(geometry.type), geometry.coordinates);
    }
    const result: SpatialGeometryAnalysis = { vertices: 0, parts: 0, rings: 0 };
    for (const member of Array.isArray(geometry.geometries) ? geometry.geometries : []) {
        if (!member || typeof member !== "object") continue;
        const child = analyzeSpatialGeometry(member as Record<string, unknown>);
        result.vertices += child.vertices;
        result.parts += child.parts;
        result.rings += child.rings;
        if (child.envelope) {
            const [minX, minY, maxX, maxY] = result.envelope ?? child.envelope;
            result.envelope = [
                Math.min(minX, child.envelope[0]),
                Math.min(minY, child.envelope[1]),
                Math.max(maxX, child.envelope[2]),
                Math.max(maxY, child.envelope[3]),
            ];
        }
    }
    return result;
}

export function estimateSpatialDerivedBytes(
    vertices: number,
    labelLength = 0,
    colorValueLength = 0,
): number {
    return 1024 + vertices * 128 + labelLength * 2 + colorValueLength * 2;
}

export function spatialBudgetReason(
    currentVertices: number,
    currentDerivedBytes: number,
    nextVertices: number,
    nextDerivedBytes: number,
    remainingVertices: number,
    remainingDerivedBytes: number,
): "vertexBudget" | "derivedMemoryBudget" | undefined {
    if (currentVertices + nextVertices > remainingVertices) {
        return "vertexBudget";
    }
    if (currentDerivedBytes + nextDerivedBytes > remainingDerivedBytes) {
        return "derivedMemoryBudget";
    }
    return undefined;
}

export function analyzeSpatialCoordinates(
    type: string,
    coordinates: unknown,
): SpatialGeometryAnalysis {
    let vertices = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const visit = (coordinate: unknown): void => {
        if (!Array.isArray(coordinate)) return;
        if (
            coordinate.length >= 2 &&
            typeof coordinate[0] === "number" &&
            typeof coordinate[1] === "number" &&
            Number.isFinite(coordinate[0]) &&
            Number.isFinite(coordinate[1])
        ) {
            vertices++;
            minX = Math.min(minX, coordinate[0]);
            minY = Math.min(minY, coordinate[1]);
            maxX = Math.max(maxX, coordinate[0]);
            maxY = Math.max(maxY, coordinate[1]);
            return;
        }
        coordinate.forEach(visit);
    };
    visit(coordinates);

    const array = Array.isArray(coordinates) ? coordinates : [];
    let parts = array.length > 0 ? 1 : 0;
    let rings = 0;
    switch (type) {
        case "MultiPoint":
        case "MultiLineString":
            parts = array.length;
            break;
        case "Polygon":
            rings = array.length;
            break;
        case "MultiPolygon":
            parts = array.length;
            rings = array.reduce(
                (total, polygon) => total + (Array.isArray(polygon) ? polygon.length : 0),
                0,
            );
            break;
    }

    return {
        vertices,
        ...(Number.isFinite(minX)
            ? {
                  envelope: [minX, minY, maxX, maxY].map((value) => (value === 0 ? 0 : value)) as [
                      number,
                      number,
                      number,
                      number,
                  ],
              }
            : {}),
        parts,
        rings,
    };
}
