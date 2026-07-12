/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared codec for typed result-cell encodings (vector and spatial).
 * Import-free and environment-free by convention: no vscode/DOM/Node imports —
 * shared by the extension host, the results webview, and test/unit.
 *
 * Wire contract (STS2 D-0019, SPEC §7.7): a query that negotiated
 * `options.vectorEncoding = "binary-v1"` receives native vector cells as
 * `{$t:"vector", version:1, status:"ok", dimensions, baseType:"float32",
 * encoding:"f32le", byteLength, data:<base64 little-endian components>}` or an
 * unavailable sentinel `{$t:"vector", version:1, status:"unavailable",
 * reason, dimensions?, baseType?}`. The payload field is `data`, never `v` —
 * generic `{$t, v}` objects are scalar wrappers. Non-negotiated queries carry
 * the JSON-array TEXT representation instead (D-0018), which the ordinary
 * string paths already handle. Cells are validated structurally before any
 * allocation — hints and column metadata are never trusted for decode.
 */

export type VectorBaseType = "float32" | "float16";

export type VectorTransportReason =
    | "unsupportedBaseType"
    | "providerValueMismatch"
    | "decodeFailed"
    | "cellLimit";

export interface VectorCellOkV1 {
    readonly $t: "vector";
    readonly version: 1;
    readonly status: "ok";
    readonly dimensions: number;
    readonly baseType: VectorBaseType;
    readonly encoding: "f32le";
    readonly byteLength: number;
    readonly data: string;
}

export interface VectorCellUnavailableV1 {
    readonly $t: "vector";
    readonly version: 1;
    readonly status: "unavailable";
    readonly reason: string;
    readonly dimensions?: number;
    readonly baseType?: string;
}

export type VectorCellEncodingV1 = VectorCellOkV1 | VectorCellUnavailableV1;

/** Column-level vector facts (metadata hints; per-cell facts are authoritative). */
export interface VectorColumnMetadata {
    /** How this query transports vector cells. */
    readonly transport: "binary-v1" | "textFallback";
    /** Dimension count derived from column metadata (length = 8 + 4*dims). */
    readonly dimensions?: number;
    /** Base type when proven by metadata/catalog evidence — never guessed. */
    readonly baseType?: VectorBaseType;
}

/** Engine maximum (SQL Server 2025): guards absurd allocations pre-decode. */
export const VECTOR_MAX_DIMENSIONS = 1998;

/** Compact type hint emitted for negotiated vector columns (lockstep with STS2). */
export const VECTOR_TYPE_HINT_V1 = "vector:f32le:v1";

// ---------------------------------------------------------------------------
// Spatial WKB v1 (STS2 D-0020)
// ---------------------------------------------------------------------------

export type SpatialKind = "geometry" | "geography";

export type SpatialTransportReason =
    | "maxCellBytes"
    | "conversionFailed"
    | "unsupportedNativeValue"
    | "unsupportedInterchange";

export interface SpatialCellOkV1 {
    readonly $t: "spatial";
    readonly version: 1;
    readonly status: "ok";
    readonly kind: SpatialKind;
    readonly encoding: "wkb";
    readonly srid: number;
    readonly wkbBytes: number;
    /** Complete OGC/SQL-MM WKB from SqlGeometry/SqlGeography.AsBinaryZM(). */
    readonly wkb: string;
}

export interface SpatialCellUnavailableV1 {
    readonly $t: "spatial";
    readonly version: 1;
    readonly status: "unrenderable";
    readonly kind: SpatialKind;
    readonly reason: SpatialTransportReason;
    readonly srid?: number;
    readonly sourceBytes?: number;
    readonly sourceDigest?: string;
}

export type SpatialCellEncodingV1 = SpatialCellOkV1 | SpatialCellUnavailableV1;

export interface SpatialColumnMetadata {
    readonly kind: SpatialKind;
    readonly encoding: "wkb-v1";
}

/** STS2's pinned cell ceiling. Guard before allocating browser/host bytes. */
export const SPATIAL_MAX_WKB_BYTES = 1024 * 1024;

/** Compact type hint emitted only for negotiated spatial columns. */
export const SPATIAL_TYPE_HINT_V1 = "spatial:wkb:v1";

// ---------------------------------------------------------------------------
// Structural guards (strict: shape AND arithmetic must hold)
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function isInt32(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647
    );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalBase64(value: string): boolean {
    if (base64ByteLength(value) < 0) {
        return false;
    }
    const paddingIndex = value.indexOf("=");
    const end = paddingIndex < 0 ? value.length : paddingIndex;
    for (let i = 0; i < end; i++) {
        const code = value.charCodeAt(i);
        if (code >= 128 || BASE64_LOOKUP[code] < 0) {
            return false;
        }
    }
    if (paddingIndex >= 0) {
        const padding = value.length - paddingIndex;
        if (padding > 2 || !/^={1,2}$/.test(value.slice(paddingIndex))) {
            return false;
        }
    }
    return true;
}

/** Strict guard for a complete spatial WKB value. */
export function isSpatialCellOkV1(value: unknown): value is SpatialCellOkV1 {
    if (!isObject(value)) {
        return false;
    }
    const cell = value as Partial<SpatialCellOkV1>;
    return (
        cell.$t === "spatial" &&
        cell.version === 1 &&
        cell.status === "ok" &&
        (cell.kind === "geometry" || cell.kind === "geography") &&
        cell.encoding === "wkb" &&
        isInt32(cell.srid) &&
        isNonNegativeSafeInteger(cell.wkbBytes) &&
        cell.wkbBytes >= 5 &&
        cell.wkbBytes <= SPATIAL_MAX_WKB_BYTES &&
        typeof cell.wkb === "string" &&
        isCanonicalBase64(cell.wkb) &&
        base64ByteLength(cell.wkb) === cell.wkbBytes
    );
}

const SPATIAL_TRANSPORT_REASONS: readonly SpatialTransportReason[] = [
    "maxCellBytes",
    "conversionFailed",
    "unsupportedNativeValue",
    "unsupportedInterchange",
];

/** Strict guard for a transport-unavailable spatial value. */
export function isSpatialCellUnavailableV1(value: unknown): value is SpatialCellUnavailableV1 {
    if (!isObject(value)) {
        return false;
    }
    const cell = value as Partial<SpatialCellUnavailableV1>;
    return (
        cell.$t === "spatial" &&
        cell.version === 1 &&
        cell.status === "unrenderable" &&
        (cell.kind === "geometry" || cell.kind === "geography") &&
        typeof cell.reason === "string" &&
        SPATIAL_TRANSPORT_REASONS.includes(cell.reason as SpatialTransportReason) &&
        (cell.srid === undefined || isInt32(cell.srid)) &&
        (cell.sourceBytes === undefined || isNonNegativeSafeInteger(cell.sourceBytes)) &&
        (cell.sourceDigest === undefined || /^sha256:[0-9a-f]{64}$/.test(cell.sourceDigest))
    );
}

export function isSpatialCellEncodingV1(value: unknown): value is SpatialCellEncodingV1 {
    return isSpatialCellOkV1(value) || isSpatialCellUnavailableV1(value);
}

/** Strict guard for the successful typed vector cell. */
export function isVectorCellOkV1(value: unknown): value is VectorCellOkV1 {
    if (!isObject(value)) {
        return false;
    }
    const cell = value as Partial<VectorCellOkV1>;
    return (
        cell.$t === "vector" &&
        cell.version === 1 &&
        cell.status === "ok" &&
        typeof cell.dimensions === "number" &&
        Number.isInteger(cell.dimensions) &&
        cell.dimensions >= 1 &&
        cell.dimensions <= VECTOR_MAX_DIMENSIONS &&
        cell.baseType === "float32" &&
        cell.encoding === "f32le" &&
        typeof cell.byteLength === "number" &&
        cell.byteLength === cell.dimensions * 4 &&
        typeof cell.data === "string" &&
        base64ByteLength(cell.data) === cell.byteLength
    );
}

/** Strict guard for the unavailable sentinel. */
export function isVectorCellUnavailableV1(value: unknown): value is VectorCellUnavailableV1 {
    if (!isObject(value)) {
        return false;
    }
    const cell = value as Partial<VectorCellUnavailableV1>;
    return (
        cell.$t === "vector" &&
        cell.version === 1 &&
        cell.status === "unavailable" &&
        typeof cell.reason === "string" &&
        (cell.dimensions === undefined ||
            (typeof cell.dimensions === "number" && Number.isInteger(cell.dimensions))) &&
        (cell.baseType === undefined || typeof cell.baseType === "string")
    );
}

/** Either typed vector cell form. */
export function isVectorCellEncodingV1(value: unknown): value is VectorCellEncodingV1 {
    return isVectorCellOkV1(value) || isVectorCellUnavailableV1(value);
}

// ---------------------------------------------------------------------------
// Base64 (pure — no Buffer/atob so host, webview, and tests share bytes)
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP: Int16Array = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < BASE64_ALPHABET.length; i++) {
        table[BASE64_ALPHABET.charCodeAt(i)] = i;
    }
    return table;
})();

/** Exact decoded byte count of canonical base64 (validation before allocation). */
export function base64ByteLength(base64: string): number {
    let length = base64.length;
    if (length === 0 || length % 4 !== 0) {
        return -1;
    }
    let padding = 0;
    if (base64.charCodeAt(length - 1) === 61 /* '=' */) {
        padding++;
        if (base64.charCodeAt(length - 2) === 61) {
            padding++;
        }
    }
    return (length / 4) * 3 - padding;
}

/** Decodes canonical base64 into bytes; null on any malformed input. */
export function decodeBase64(base64: string): Uint8Array | null {
    const byteLength = base64ByteLength(base64);
    if (byteLength < 0) {
        return null;
    }
    const bytes = new Uint8Array(byteLength);
    let bits = 0;
    let bitCount = 0;
    let out = 0;
    const end = base64.indexOf("=") === -1 ? base64.length : base64.indexOf("=");
    for (let i = 0; i < end; i++) {
        const code = base64.charCodeAt(i);
        const sextet = code < 128 ? BASE64_LOOKUP[code] : -1;
        if (sextet < 0) {
            return null;
        }
        bits = (bits << 6) | sextet;
        bitCount += 6;
        if (bitCount >= 8) {
            bitCount -= 8;
            bytes[out++] = (bits >> bitCount) & 0xff;
        }
    }
    return out === byteLength ? bytes : null;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

export interface DecodedFloat32Vector {
    readonly dimensions: number;
    readonly values: Float32Array;
}

export interface DecodedSpatialWkb {
    readonly kind: SpatialKind;
    readonly srid: number;
    readonly bytes: Uint8Array;
}

/** Decode a complete validated WKB cell without interpreting geometry. */
export function decodeSpatialWkb(cell: unknown): DecodedSpatialWkb | null {
    if (!isSpatialCellOkV1(cell)) {
        return null;
    }
    const bytes = decodeBase64(cell.wkb);
    if (bytes === null || bytes.byteLength !== cell.wkbBytes) {
        return null;
    }
    return { kind: cell.kind, srid: cell.srid, bytes };
}

/**
 * Full decode of a validated ok-cell. Returns null when the payload fails
 * structural validation (defense in depth — callers may pass unknown values).
 */
export function decodeVectorFloat32(cell: unknown): DecodedFloat32Vector | null {
    if (!isVectorCellOkV1(cell)) {
        return null;
    }
    const bytes = decodeBase64(cell.data);
    if (bytes === null || bytes.byteLength !== cell.byteLength) {
        return null;
    }
    // Explicit little-endian read (wire contract) — independent of platform
    // endianness, unlike a raw Float32Array view over the buffer.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values = new Float32Array(cell.dimensions);
    for (let i = 0; i < cell.dimensions; i++) {
        values[i] = view.getFloat32(i * 4, /* littleEndian */ true);
    }
    return { dimensions: cell.dimensions, values };
}

/** Bounded prefix decode (grid previews): at most maxComponents values. */
export function decodeVectorPrefix(cell: unknown, maxComponents: number): number[] | null {
    if (!isVectorCellOkV1(cell) || maxComponents < 0) {
        return null;
    }
    if (maxComponents === 0) {
        return [];
    }
    const count = Math.min(cell.dimensions, maxComponents);
    // Decode only the leading base64 quantums that cover count*4 bytes.
    const neededBytes = count * 4;
    const neededChars = Math.ceil(neededBytes / 3) * 4;
    const bytes = decodeBase64(
        cell.data.length <= neededChars ? cell.data : padBase64(cell.data.slice(0, neededChars)),
    );
    if (bytes === null || bytes.byteLength < neededBytes) {
        return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
        values.push(view.getFloat32(i * 4, true));
    }
    return values;
}

function padBase64(prefix: string): string {
    const remainder = prefix.length % 4;
    return remainder === 0 ? prefix : prefix + "=".repeat(4 - remainder);
}

export interface VectorCellSummary {
    readonly status: "ok" | "unavailable";
    readonly dimensions?: number;
    readonly baseType?: string;
    readonly byteLength?: number;
    readonly reason?: string;
}

/** Cheap facts about a typed vector cell (no component decode). */
export function vectorCellSummary(cell: VectorCellEncodingV1): VectorCellSummary {
    if (cell.status === "ok") {
        return {
            status: "ok",
            dimensions: cell.dimensions,
            baseType: cell.baseType,
            byteLength: cell.byteLength,
        };
    }
    return {
        status: "unavailable",
        reason: cell.reason,
        ...(cell.dimensions !== undefined ? { dimensions: cell.dimensions } : {}),
        ...(cell.baseType !== undefined ? { baseType: cell.baseType } : {}),
    };
}

// ---------------------------------------------------------------------------
// Text formatting per consumer purpose
// ---------------------------------------------------------------------------

export type CellTextPurpose =
    | "gridPreview"
    | "copy"
    | "textView"
    | "cellDocument"
    | "csvExport"
    | "jsonExport"
    | "insertExport"
    | "toolSummary";

/** Components shown in the bounded grid preview. */
const PREVIEW_COMPONENTS = 4;

/**
 * Shortest decimal text that round-trips to the same float32 — parity with
 * the engine's own JSON representation (shortest-round-trip), so copy/export
 * text matches what a non-negotiated query would have shown.
 */
export function formatFloat32Shortest(value: number): string {
    if (Number.isNaN(value)) {
        return "NaN";
    }
    if (!Number.isFinite(value)) {
        return value > 0 ? "Infinity" : "-Infinity";
    }
    if (value === 0) {
        return Object.is(value, -0) ? "-0" : "0";
    }
    for (let precision = 1; precision <= 9; precision++) {
        const text = value.toPrecision(precision);
        if (Math.fround(Number(text)) === value) {
            return String(Number(text));
        }
    }
    return String(value);
}

/**
 * Full JSON-array text of a decoded vector. Non-finite components render as
 * NaN/Infinity tokens — visible and honest (strict-JSON consumers fail loud
 * on that cell rather than silently reading nulls).
 */
export function vectorJsonArrayText(decoded: DecodedFloat32Vector): string {
    const parts: string[] = new Array(decoded.dimensions);
    for (let i = 0; i < decoded.dimensions; i++) {
        parts[i] = formatFloat32Shortest(decoded.values[i]);
    }
    return `[${parts.join(",")}]`;
}

/**
 * Text for one typed vector cell for a given consumer purpose. Grid previews
 * stay bounded (never a full decode on the render path); data-fidelity
 * purposes (copy, exports, cell document, text view) carry the full array.
 */
export function vectorCellText(cell: VectorCellEncodingV1, purpose: CellTextPurpose): string {
    if (cell.status === "unavailable") {
        if (purpose === "insertExport") {
            return "NULL"; // generated scripts must stay valid SQL
        }
        const facts = [
            cell.dimensions !== undefined ? `${cell.dimensions}D` : undefined,
            cell.baseType,
        ]
            .filter((f): f is string => f !== undefined)
            .join(" ");
        const detail = facts.length > 0 ? `${facts}, ${cell.reason}` : cell.reason;
        return purpose === "csvExport" || purpose === "jsonExport" || purpose === "copy"
            ? ""
            : `<vector unavailable: ${detail}>`;
    }
    switch (purpose) {
        case "gridPreview": {
            const prefix = decodeVectorPrefix(cell, PREVIEW_COMPONENTS);
            if (prefix === null) {
                return `<vector unavailable: decodeFailed>`;
            }
            const shown = prefix.map(formatFloat32Shortest).join(", ");
            const ellipsis = cell.dimensions > PREVIEW_COMPONENTS ? ", …" : "";
            return `[${shown}${ellipsis}] · ${cell.dimensions}D ${cell.baseType}`;
        }
        case "toolSummary":
            return `VECTOR(${cell.dimensions}) ${cell.baseType}`;
        case "insertExport": {
            const decoded = decodeVectorFloat32(cell);
            if (decoded === null) {
                return "NULL";
            }
            return `CAST('${vectorJsonArrayText(decoded)}' AS VECTOR(${cell.dimensions}))`;
        }
        case "copy":
        case "textView":
        case "cellDocument":
        case "csvExport":
        case "jsonExport": {
            const decoded = decodeVectorFloat32(cell);
            if (decoded === null) {
                return `<vector unavailable: decodeFailed>`;
            }
            return vectorJsonArrayText(decoded);
        }
    }
}

function spatialUnavailableText(cell: SpatialCellUnavailableV1): string {
    const facts = [
        cell.kind.toUpperCase(),
        cell.srid !== undefined ? `SRID ${cell.srid}` : undefined,
        cell.sourceBytes !== undefined ? `${cell.sourceBytes} source bytes` : undefined,
        cell.reason,
    ].filter((fact): fact is string => fact !== undefined);
    return `<spatial unavailable: ${facts.join(", ")}>`;
}

function bytesToSqlHex(bytes: Uint8Array): string {
    const digits = "0123456789ABCDEF";
    const output = new Array<string>(bytes.byteLength * 2 + 1);
    output[0] = "0x";
    for (let i = 0; i < bytes.byteLength; i++) {
        output[i * 2 + 1] = digits[bytes[i] >> 4] + digits[bytes[i] & 0x0f];
    }
    return output.join("");
}

/** Purpose-specific text for one typed spatial cell. */
export function spatialCellText(cell: SpatialCellEncodingV1, purpose: CellTextPurpose): string {
    if (cell.status === "unrenderable") {
        return purpose === "insertExport" ? "NULL" : spatialUnavailableText(cell);
    }
    if (purpose === "gridPreview" || purpose === "toolSummary") {
        return `${cell.kind.toUpperCase()} · SRID ${cell.srid} · ${cell.wkbBytes} WKB bytes`;
    }
    const decoded = decodeSpatialWkb(cell);
    if (decoded === null) {
        return "<spatial unavailable: decodeFailed>";
    }
    const hex = bytesToSqlHex(decoded.bytes);
    if (purpose === "insertExport") {
        return `${cell.kind}::STGeomFromWKB(${hex}, ${cell.srid})`;
    }
    return hex;
}

/**
 * Purpose-aware text for ANY cell value: typed vector cells route through the
 * vector formatter; everything else returns null so the caller falls through
 * to its existing scalar/wrapper handling. This is the single chokepoint new
 * typed encodings (spatial next) extend.
 */
export function typedCellTextForPurpose(value: unknown, purpose: CellTextPurpose): string | null {
    if (isVectorCellEncodingV1(value)) {
        return vectorCellText(value, purpose);
    }
    if (isSpatialCellEncodingV1(value)) {
        return spatialCellText(value, purpose);
    }
    return null;
}

/** Dimensions from vector column metadata length (wire length = 8 + 4*dims). */
export function vectorDimensionsFromColumnLength(length: number | undefined): number | undefined {
    if (length === undefined || length <= 8 || (length - 8) % 4 !== 0) {
        return undefined;
    }
    const dimensions = (length - 8) / 4;
    return dimensions >= 1 && dimensions <= VECTOR_MAX_DIMENSIONS ? dimensions : undefined;
}
