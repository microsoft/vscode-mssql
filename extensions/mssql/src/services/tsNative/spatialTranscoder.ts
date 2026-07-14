/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Server CLR spatial serialization → OGC WKB transcoder (TSQ2 §6.9,
 * D-0020 parity). Input is the raw UDT payload tedious delivers for
 * geometry/geography columns (MS-SSCLRT layout, empirically verified against
 * SQL Server 2025); output matches SqlGeometry/SqlGeography.AsBinaryZM():
 * little-endian ISO WKB with Z (+1000) / M (+2000) type offsets, SRID
 * carried separately (typed-cell field, not EWKB).
 *
 * Geography point order: the CLR payload stores (lat, long); WKB emits
 * (x=long, y=lat) — verified against STAsBinary() on live fixtures.
 *
 * Declared curve policy (Q13): version-2 payloads containing arc segments
 * (CircularString/CompoundCurve/CurvePolygon) and FullGlobe transcode to a
 * per-cell `unrenderable` status with reason `unsupportedNativeValue` —
 * never a wrong-but-plausible shape. Malformed/truncated buffers are
 * `conversionFailed`. Bounds: points/figures/shapes counts are validated
 * against the buffer length before any allocation.
 *
 * Attribution: layout understanding cross-checked against the MIT-licensed
 * node-mssql UDT parser lineage (github.com/tediousjs/node-mssql lib/udt.js)
 * and MS-SSCLRT. This implementation is original code.
 */

export type SpatialKind = "geometry" | "geography";

export interface SpatialTranscodeOk {
    status: "ok";
    kind: SpatialKind;
    srid: number;
    wkb: Buffer;
}

export interface SpatialTranscodeUnrenderable {
    status: "unrenderable";
    kind: SpatialKind;
    reason: "unsupportedNativeValue" | "conversionFailed" | "maxCellBytes";
}

export type SpatialTranscodeResult = SpatialTranscodeOk | SpatialTranscodeUnrenderable;

// CLR property flags
const FLAG_Z = 0x01;
const FLAG_M = 0x02;
// 0x04 = isValid (not needed for shape reconstruction)
const FLAG_SINGLE_POINT = 0x08;
const FLAG_SINGLE_LINE = 0x10;

// CLR shape types
const SHAPE_POINT = 1;
const SHAPE_LINESTRING = 2;
const SHAPE_POLYGON = 3;
const SHAPE_MULTIPOINT = 4;
const SHAPE_MULTILINESTRING = 5;
const SHAPE_MULTIPOLYGON = 6;
const SHAPE_COLLECTION = 7;
// 8..11 = CircularString/CompoundCurve/CurvePolygon/FullGlobe → unrenderable

// WKB type codes (ISO offsets: +1000 Z, +2000 M)
const WKB_POINT = 1;
const WKB_LINESTRING = 2;
const WKB_POLYGON = 3;
const WKB_MULTIPOINT = 4;
const WKB_MULTILINESTRING = 5;
const WKB_MULTIPOLYGON = 6;
const WKB_COLLECTION = 7;

/** Hard output bound: a transcoded cell may not exceed this many WKB bytes. */
const MAX_WKB_BYTES = 32 * 1024 * 1024;
const MAX_COUNT = 10_000_000; // sanity bound before buffer-length validation

interface ParsedPayload {
    srid: number;
    hasZ: boolean;
    hasM: boolean;
    points: { x: number; y: number; z?: number; m?: number }[];
    figures: { attribute: number; pointOffset: number }[];
    shapes: { parentOffset: number; figureOffset: number; type: number }[];
}

export function transcodeSpatial(payload: Buffer, kind: SpatialKind): SpatialTranscodeResult {
    let parsed: ParsedPayload;
    try {
        parsed = parseClr(payload, kind);
    } catch (error) {
        return {
            status: "unrenderable",
            kind,
            reason:
                error instanceof UnsupportedShapeError
                    ? "unsupportedNativeValue"
                    : "conversionFailed",
        };
    }
    try {
        const wkb = writeWkb(parsed);
        if (wkb.byteLength > MAX_WKB_BYTES) {
            return { status: "unrenderable", kind, reason: "maxCellBytes" };
        }
        return { status: "ok", kind, srid: parsed.srid, wkb };
    } catch (error) {
        return {
            status: "unrenderable",
            kind,
            reason:
                error instanceof UnsupportedShapeError
                    ? "unsupportedNativeValue"
                    : "conversionFailed",
        };
    }
}

class UnsupportedShapeError extends Error {}

// ---------------------------------------------------------------------------
// CLR parsing
// ---------------------------------------------------------------------------

class Reader {
    offset = 0;
    constructor(private readonly buffer: Buffer) {}
    int32(): number {
        this.need(4);
        const value = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return value;
    }
    uint32(): number {
        this.need(4);
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }
    byte(): number {
        this.need(1);
        return this.buffer.readUInt8(this.offset++);
    }
    double(): number {
        this.need(8);
        const value = this.buffer.readDoubleLE(this.offset);
        this.offset += 8;
        return value;
    }
    need(bytes: number): void {
        if (this.offset + bytes > this.buffer.length) {
            throw new Error("truncated CLR spatial payload");
        }
    }
    get exhausted(): boolean {
        return this.offset >= this.buffer.length;
    }
}

function parseClr(payload: Buffer, kind: SpatialKind): ParsedPayload {
    const reader = new Reader(payload);
    const srid = reader.int32();
    const version = reader.byte();
    if (version !== 1 && version !== 2) {
        throw new Error(`unknown CLR spatial version ${version}`);
    }
    const flags = reader.byte();
    const hasZ = (flags & FLAG_Z) !== 0;
    const hasM = (flags & FLAG_M) !== 0;
    const singlePoint = (flags & FLAG_SINGLE_POINT) !== 0;
    const singleLine = (flags & FLAG_SINGLE_LINE) !== 0;

    const readPoint = (): { x: number; y: number } => {
        const a = reader.double();
        const b = reader.double();
        // Geography stores (lat, long); WKB wants (x=long, y=lat).
        return kind === "geography" ? { x: b, y: a } : { x: a, y: b };
    };

    if (singlePoint) {
        const point: ParsedPayload["points"][number] = readPoint();
        if (hasZ) {
            point.z = reader.double();
        }
        if (hasM) {
            point.m = reader.double();
        }
        return {
            srid,
            hasZ,
            hasM,
            points: [point],
            figures: [{ attribute: 1, pointOffset: 0 }],
            shapes: [{ parentOffset: -1, figureOffset: 0, type: SHAPE_POINT }],
        };
    }
    if (singleLine) {
        const points: ParsedPayload["points"] = [readPoint(), readPoint()];
        if (hasZ) {
            points[0].z = reader.double();
            points[1].z = reader.double();
        }
        if (hasM) {
            points[0].m = reader.double();
            points[1].m = reader.double();
        }
        return {
            srid,
            hasZ,
            hasM,
            points,
            figures: [{ attribute: 1, pointOffset: 0 }],
            shapes: [{ parentOffset: -1, figureOffset: 0, type: SHAPE_LINESTRING }],
        };
    }

    const pointCount = reader.uint32();
    boundCheck(pointCount, 16, payload.length);
    const points: ParsedPayload["points"] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
        points[i] = readPoint();
    }
    if (hasZ) {
        for (let i = 0; i < pointCount; i++) {
            points[i].z = reader.double();
        }
    }
    if (hasM) {
        for (let i = 0; i < pointCount; i++) {
            points[i].m = reader.double();
        }
    }
    const figureCount = reader.uint32();
    boundCheck(figureCount, 5, payload.length);
    const figures: ParsedPayload["figures"] = new Array(figureCount);
    for (let i = 0; i < figureCount; i++) {
        figures[i] = { attribute: reader.byte(), pointOffset: reader.int32() };
    }
    const shapeCount = reader.uint32();
    boundCheck(shapeCount, 9, payload.length);
    const shapes: ParsedPayload["shapes"] = new Array(shapeCount);
    for (let i = 0; i < shapeCount; i++) {
        shapes[i] = {
            parentOffset: reader.int32(),
            figureOffset: reader.int32(),
            type: reader.byte(),
        };
    }
    if (version === 2 && !reader.exhausted) {
        // Segment table present ⇒ arc content somewhere in the payload.
        throw new UnsupportedShapeError("curve segments (v2) are not transcoded");
    }
    for (const shape of shapes) {
        if (shape.type > SHAPE_COLLECTION || shape.type === 0) {
            throw new UnsupportedShapeError(`CLR shape type ${shape.type}`);
        }
    }
    return { srid, hasZ, hasM, points, figures, shapes };
}

function boundCheck(count: number, unitBytes: number, bufferLength: number): void {
    if (count > MAX_COUNT || count * unitBytes > bufferLength * 2) {
        throw new Error(`implausible CLR count ${count}`);
    }
}

// ---------------------------------------------------------------------------
// WKB writing
// ---------------------------------------------------------------------------

class WkbWriter {
    private chunks: Buffer[] = [];
    private length = 0;

    byte(value: number): void {
        const buffer = Buffer.allocUnsafe(1);
        buffer.writeUInt8(value, 0);
        this.push(buffer);
    }
    uint32(value: number): void {
        const buffer = Buffer.allocUnsafe(4);
        buffer.writeUInt32LE(value >>> 0, 0);
        this.push(buffer);
    }
    double(value: number): void {
        const buffer = Buffer.allocUnsafe(8);
        buffer.writeDoubleLE(value, 0);
        this.push(buffer);
    }
    private push(buffer: Buffer): void {
        this.chunks.push(buffer);
        this.length += buffer.length;
        if (this.length > MAX_WKB_BYTES) {
            throw new Error("WKB output bound exceeded");
        }
    }
    finish(): Buffer {
        return Buffer.concat(this.chunks, this.length);
    }
}

function writeWkb(parsed: ParsedPayload): Buffer {
    const writer = new WkbWriter();
    const roots = parsed.shapes
        .map((shape, index) => ({ shape, index }))
        .filter(({ shape }) => shape.parentOffset === -1);
    if (roots.length !== 1) {
        throw new Error(`expected one root shape, found ${roots.length}`);
    }
    writeShape(writer, parsed, roots[0].index);
    return writer.finish();
}

function typeCode(base: number, parsed: ParsedPayload): number {
    return base + (parsed.hasZ ? 1000 : 0) + (parsed.hasM ? 2000 : 0);
}

function writeCoords(writer: WkbWriter, parsed: ParsedPayload, pointIndex: number): void {
    const point = parsed.points[pointIndex];
    writer.double(point.x);
    writer.double(point.y);
    if (parsed.hasZ) {
        writer.double(point.z ?? NaN);
    }
    if (parsed.hasM) {
        writer.double(point.m ?? NaN);
    }
}

/** Point range [start, end) of figure `figureIndex`. */
function figurePoints(parsed: ParsedPayload, figureIndex: number): { start: number; end: number } {
    const start = parsed.figures[figureIndex].pointOffset;
    const end =
        figureIndex + 1 < parsed.figures.length
            ? parsed.figures[figureIndex + 1].pointOffset
            : parsed.points.length;
    if (start < 0 || end < start || end > parsed.points.length) {
        throw new Error("figure point range out of bounds");
    }
    return { start, end };
}

/** Figure range [start, end) of shape `shapeIndex`. */
function shapeFigures(parsed: ParsedPayload, shapeIndex: number): { start: number; end: number } {
    const start = parsed.shapes[shapeIndex].figureOffset;
    let end = parsed.figures.length;
    for (let i = shapeIndex + 1; i < parsed.shapes.length; i++) {
        if (parsed.shapes[i].figureOffset >= start) {
            end = parsed.shapes[i].figureOffset;
            break;
        }
    }
    if (start < 0 || end < start) {
        throw new Error("shape figure range out of bounds");
    }
    return { start, end };
}

function childShapes(parsed: ParsedPayload, shapeIndex: number): number[] {
    const children: number[] = [];
    for (let i = 0; i < parsed.shapes.length; i++) {
        if (parsed.shapes[i].parentOffset === shapeIndex) {
            children.push(i);
        }
    }
    return children;
}

function writeShape(writer: WkbWriter, parsed: ParsedPayload, shapeIndex: number): void {
    const shape = parsed.shapes[shapeIndex];
    writer.byte(1); // little-endian
    switch (shape.type) {
        case SHAPE_POINT: {
            writer.uint32(typeCode(WKB_POINT, parsed));
            const figures = shapeFigures(parsed, shapeIndex);
            if (figures.end === figures.start) {
                // POINT EMPTY: NaN coordinates (common WKB convention).
                writer.double(NaN);
                writer.double(NaN);
                if (parsed.hasZ) {
                    writer.double(NaN);
                }
                if (parsed.hasM) {
                    writer.double(NaN);
                }
                return;
            }
            const { start } = figurePoints(parsed, figures.start);
            writeCoords(writer, parsed, start);
            return;
        }
        case SHAPE_LINESTRING: {
            writer.uint32(typeCode(WKB_LINESTRING, parsed));
            const figures = shapeFigures(parsed, shapeIndex);
            if (figures.end === figures.start) {
                writer.uint32(0);
                return;
            }
            const { start, end } = figurePoints(parsed, figures.start);
            writer.uint32(end - start);
            for (let i = start; i < end; i++) {
                writeCoords(writer, parsed, i);
            }
            return;
        }
        case SHAPE_POLYGON: {
            writer.uint32(typeCode(WKB_POLYGON, parsed));
            const figures = shapeFigures(parsed, shapeIndex);
            writer.uint32(figures.end - figures.start);
            for (let f = figures.start; f < figures.end; f++) {
                const { start, end } = figurePoints(parsed, f);
                writer.uint32(end - start);
                for (let i = start; i < end; i++) {
                    writeCoords(writer, parsed, i);
                }
            }
            return;
        }
        case SHAPE_MULTIPOINT:
        case SHAPE_MULTILINESTRING:
        case SHAPE_MULTIPOLYGON:
        case SHAPE_COLLECTION: {
            const base =
                shape.type === SHAPE_MULTIPOINT
                    ? WKB_MULTIPOINT
                    : shape.type === SHAPE_MULTILINESTRING
                      ? WKB_MULTILINESTRING
                      : shape.type === SHAPE_MULTIPOLYGON
                        ? WKB_MULTIPOLYGON
                        : WKB_COLLECTION;
            writer.uint32(typeCode(base, parsed));
            const children = childShapes(parsed, shapeIndex);
            writer.uint32(children.length);
            for (const child of children) {
                writeShape(writer, parsed, child);
            }
            return;
        }
        default:
            throw new UnsupportedShapeError(`CLR shape type ${shape.type}`);
    }
}
