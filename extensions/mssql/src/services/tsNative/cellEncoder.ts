/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ts-native cell encoder (TSQ2 addendum §6): maps normalized driver cells to
 * the compact-page value encoding consumed by decodeCell()/RowStore/webviews.
 * The STS2 binding's SerializeTypeHints taxonomy is mirrored EXACTLY; golden
 * parity fixtures (TSQ2-6/N5) are the acceptance mechanism, not this prose.
 *
 * Fidelity policy (addendum §2.8/§6.3): exact mode is the default. Columns
 * whose values tedious cannot preserve exactly (decimal/numeric/money beyond
 * float precision, datetimeoffset original offset) are detected at METADATA
 * time by `fidelityViolation` and fail the query before any page is emitted —
 * never silently encoded. Lossy preview (TSQ2-9 debug override) relaxes this
 * explicitly and marks affected columns.
 *
 * Pure module: no vscode, no diagnostics singletons; crypto for digests only.
 */

import { createHash } from "crypto";
import { TruncatedCellEncoding, SqlCapabilityId } from "../sqlDataPlane/api";
import { SPATIAL_MAX_WKB_BYTES } from "../../sharedInterfaces/queryResultCellCodec";
import { TdsCell, TdsColumn } from "./driver/tdsDriver";
import { transcodeSpatial, SpatialKind } from "./spatialTranscoder";
import { transcodeVectorText } from "./vectorTranscoder";

// ---------------------------------------------------------------------------
// Type hints (STS2 SerializeTypeHints lockstep — sts2Backend.typeHintFor)
// ---------------------------------------------------------------------------

const NUMBER_TYPES = new Set(["int", "smallint", "tinyint", "float", "real"]);
const APPROX_TYPES = new Set(["bigint", "decimal", "numeric", "money", "smallmoney"]);
const BINARY_TYPES = new Set(["varbinary", "binary", "image", "timestamp", "rowversion"]);
const DATETIME_TYPES = new Set([
    "date",
    "datetime",
    "datetime2",
    "smalldatetime",
    "datetimeoffset",
    "time",
]);

export function typeHintForColumn(column: TdsColumn): string {
    const type = column.typeName.toLowerCase();
    if (type === "bit") {
        return "boolean";
    }
    if (NUMBER_TYPES.has(type)) {
        return "number";
    }
    if (APPROX_TYPES.has(type)) {
        return "number:approx";
    }
    if (BINARY_TYPES.has(type) || type === "udt") {
        return "binary";
    }
    if (type === "xml") {
        return "xml";
    }
    if (DATETIME_TYPES.has(type)) {
        return "datetime";
    }
    return "string";
}

// ---------------------------------------------------------------------------
// Exact-mode fidelity guard (evaluated per column at metadata time)
// ---------------------------------------------------------------------------

export interface FidelityViolation {
    columnName: string;
    typeName: string;
    capability: SqlCapabilityId;
    reasonCode: string;
}

/**
 * Columns the pinned tedious build cannot deliver exactly (addendum §2.8):
 * decimal/numeric parse to JS doubles (silent loss past ~15 significant
 * digits — conservatively gated at precision > 15), money/smallmoney share
 * the double path, and datetimeoffset discards the original offset.
 * bigint is EXACT (string carrier) and not gated.
 */
export function fidelityViolation(column: TdsColumn): FidelityViolation | undefined {
    const type = column.typeName.toLowerCase();
    if ((type === "decimal" || type === "numeric") && (column.precision ?? 38) > 15) {
        return {
            columnName: column.name,
            typeName: type,
            capability: "types.decimalExact",
            reasonCode: "driver.decimalToDouble",
        };
    }
    if (type === "money") {
        // money spans 19 digits; smallmoney (10 digits) fits a double exactly.
        return {
            columnName: column.name,
            typeName: type,
            capability: "types.decimalExact",
            reasonCode: "driver.moneyToDouble",
        };
    }
    if (type === "datetimeoffset") {
        return {
            columnName: column.name,
            typeName: type,
            capability: "types.datetimeOffsetOriginal",
            reasonCode: "driver.offsetDiscarded",
        };
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Cell encoding
// ---------------------------------------------------------------------------

export interface EncodePolicy {
    maxCellBytes: number;
    /** Truncation prefix cap: min(maxCellBytes, 65536) — STS2 parity. */
    truncatedPrefixBytes: number;
    /** TSQ2 §6.4: lossy preview marks instead of failing (debug-only). */
    lossyPreview: boolean;
    /** Per-query typed spatial WKB opt-in (negotiated AND requested). */
    spatialWkb: boolean;
    /** Per-query typed vector opt-in (negotiated AND requested). */
    vectorBinary: boolean;
}

/** True for a UDT column the spatial transcoder owns under opt-in. */
export function isSpatialColumn(column: TdsColumn): column is TdsColumn & {
    udtName: "geometry" | "geography";
} {
    return (
        column.typeName === "udt" &&
        (column.udtName === "geometry" || column.udtName === "geography")
    );
}

export interface EncodedCell {
    value: unknown;
    isNull: boolean;
    /** Approximate encoded byte contribution (page-limit accounting). */
    approxBytes: number;
}

const NULL_BYTES = 4;

export function encodeCell(cell: TdsCell, column: TdsColumn, policy: EncodePolicy): EncodedCell {
    const raw = cell.value;
    if (raw === null || raw === undefined) {
        return { value: undefined, isNull: true, approxBytes: NULL_BYTES };
    }
    const type = column.typeName.toLowerCase();

    // Typed spatial WKB (D-0020): opt-in only; per-cell honesty on failure.
    if (policy.spatialWkb && isSpatialColumn(column) && Buffer.isBuffer(raw)) {
        return encodeSpatialCell(raw, column.udtName);
    }
    // Typed vector (D-0019): identity-keyed only (§6.8 — never varchar
    // guessing); vectors are never truncated.
    if (policy.vectorBinary && type === "vector" && typeof raw === "string") {
        return encodeVectorCell(raw);
    }

    if (typeof raw === "boolean") {
        return { value: raw, isNull: false, approxBytes: 5 };
    }
    if (typeof raw === "number") {
        // Approx-carrier columns travel as invariant strings (decodeCell
        // "number:approx" contract); exact-mode gating happened at metadata.
        if (APPROX_TYPES.has(type)) {
            const text = formatInvariantNumber(raw, column);
            return { value: text, isNull: false, approxBytes: text.length + 2 };
        }
        return { value: raw, isNull: false, approxBytes: 20 };
    }
    if (typeof raw === "bigint") {
        const text = raw.toString();
        return { value: text, isNull: false, approxBytes: text.length + 2 };
    }
    if (typeof raw === "string") {
        // bigint (tedious yields strings) and character data share this path.
        return encodeStringCell(raw, type, policy);
    }
    if (raw instanceof Date) {
        const text = formatDateTime(raw, type, column.scale, cell.nanosecondsDelta);
        return { value: text, isNull: false, approxBytes: 36 };
    }
    if (Buffer.isBuffer(raw)) {
        return encodeBinaryCell(raw, policy);
    }
    if (raw instanceof Uint8Array) {
        return encodeBinaryCell(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), policy);
    }
    // Unmappable driver value: invariant-string fallback, never a throw.
    const fallback = String(raw);
    return { value: fallback, isNull: false, approxBytes: fallback.length + 2 };
}

/** D-0020 typed spatial cell — EXACT STS2 wire field names. */
function encodeSpatialCell(raw: Buffer, kind: SpatialKind): EncodedCell {
    const result = transcodeSpatial(raw, kind);
    if (result.status === "ok" && result.wkb.byteLength <= SPATIAL_MAX_WKB_BYTES) {
        const wkbBase64 = result.wkb.toString("base64");
        return {
            value: {
                $t: "spatial",
                version: 1,
                status: "ok",
                kind,
                encoding: "wkb",
                srid: result.srid,
                wkbBytes: result.wkb.byteLength,
                wkb: wkbBase64,
            },
            isNull: false,
            approxBytes: wkbBase64.length + 96,
        };
    }
    const reason =
        result.status === "ok"
            ? "maxCellBytes" // over the pinned STS2 spatial ceiling
            : result.reason;
    return {
        value: { $t: "spatial", version: 1, status: "unrenderable", kind, reason },
        isNull: false,
        approxBytes: 96,
    };
}

/** D-0019 typed vector cell — payload field is `data`, NEVER `v`. */
function encodeVectorCell(raw: string): EncodedCell {
    const result = transcodeVectorText(raw);
    if (result.status === "ok") {
        const dataBase64 = result.data.toString("base64");
        return {
            value: {
                $t: "vector",
                version: 1,
                status: "ok",
                dimensions: result.dimensions,
                baseType: "float32",
                encoding: "f32le",
                byteLength: result.dimensions * 4,
                data: dataBase64,
            },
            isNull: false,
            approxBytes: dataBase64.length + 112,
        };
    }
    return {
        value: { $t: "vector", version: 1, status: "unavailable", reason: result.reason },
        isNull: false,
        approxBytes: 96,
    };
}

function encodeStringCell(raw: string, type: string, policy: EncodePolicy): EncodedCell {
    const byteLength = Buffer.byteLength(raw, "utf8");
    if (byteLength <= policy.maxCellBytes) {
        return { value: raw, isNull: false, approxBytes: byteLength + 2 };
    }
    const prefixBytes = Math.min(policy.truncatedPrefixBytes, policy.maxCellBytes);
    // The byte count has already scanned the complete driver string. Thread
    // it through so a truncated 1 MiB MAX value does not pay a second full
    // scan, then avoid constructing a second full UTF-8 Buffer merely to
    // retain the protocol's bounded prefix.
    const prefix = utf8SafePrefix(raw, prefixBytes, byteLength);
    const marker: TruncatedCellEncoding = {
        $t: "truncated",
        of: "string",
        bytes: byteLength,
        digest: `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`,
        v: prefix,
    };
    return { value: marker, isNull: false, approxBytes: prefix.length + 96 };
}

function encodeBinaryCell(raw: Buffer, policy: EncodePolicy): EncodedCell {
    if (raw.byteLength <= policy.maxCellBytes) {
        // Compact binary cells travel as 0x-hex strings (decodeCell "binary"
        // hint reads hexPrefix). Golden parity pins the exact shape.
        const hex = `0x${raw.toString("hex").toUpperCase()}`;
        return { value: hex, isNull: false, approxBytes: hex.length + 2 };
    }
    const prefixBytes = Math.min(policy.truncatedPrefixBytes, policy.maxCellBytes);
    const marker: TruncatedCellEncoding = {
        $t: "truncated",
        of: "binary",
        bytes: raw.byteLength,
        digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
        v: raw.subarray(0, prefixBytes).toString("base64"),
    };
    return { value: marker, isNull: false, approxBytes: Math.ceil((prefixBytes * 4) / 3) + 96 };
}

/**
 * UTF-8 prefix that never splits a code point (STS2 truncation rule).
 *
 * The old `Buffer.from(text).subarray(0, maxBytes)` path allocated the
 * COMPLETE encoded value before discarding all but the prefix. That is a
 * major transient allocation for already-materialized MAX strings. Walk the
 * UTF-16 source instead, then detach only the bounded prefix. A V8 substring
 * can retain the complete driver MAX string (and its two-byte backing store),
 * which defeats RowStore spill/reclamation for truncated cells. Lone
 * surrogates deliberately normalize to U+FFFD, matching Node's UTF-8 Buffer
 * conversion rather than changing wire semantics.
 */
export function utf8SafePrefix(text: string, maxBytes: number, knownByteLength?: number): string {
    if ((knownByteLength ?? Buffer.byteLength(text, "utf8")) <= maxBytes) {
        return text;
    }
    if (maxBytes <= 0 || text.length === 0) {
        return "";
    }

    let offset = 0;
    let encodedBytes = 0;
    let segmentStart = 0;
    let parts: string[] | undefined;
    while (offset < text.length) {
        const first = text.charCodeAt(offset);
        let codeUnits = 1;
        let codePointBytes: number;
        let loneSurrogate = false;
        if (first <= 0x7f) {
            codePointBytes = 1;
        } else if (first <= 0x7ff) {
            codePointBytes = 2;
        } else if (first >= 0xd800 && first <= 0xdbff) {
            const second = text.charCodeAt(offset + 1);
            if (second >= 0xdc00 && second <= 0xdfff) {
                codeUnits = 2;
                codePointBytes = 4;
            } else {
                codePointBytes = 3; // U+FFFD, exactly like Buffer UTF-8 encoding.
                loneSurrogate = true;
            }
        } else if (first >= 0xdc00 && first <= 0xdfff) {
            codePointBytes = 3; // U+FFFD, exactly like Buffer UTF-8 encoding.
            loneSurrogate = true;
        } else {
            codePointBytes = 3;
        }
        if (encodedBytes + codePointBytes > maxBytes) {
            break;
        }
        if (loneSurrogate) {
            parts ??= [];
            if (segmentStart < offset) {
                parts.push(text.slice(segmentStart, offset));
            }
            parts.push("\uFFFD");
            segmentStart = offset + 1;
        }
        encodedBytes += codePointBytes;
        offset += codeUnits;
    }
    if (!parts) {
        return detachUtf8Prefix(text.slice(0, offset));
    }
    if (segmentStart < offset) {
        parts.push(text.slice(segmentStart, offset));
    }
    return detachUtf8Prefix(parts.join(""));
}

/**
 * Copy at most the already-bounded UTF-8 prefix into an independent string.
 * This avoids retaining a multi-megabyte driver string through a `slice`
 * parent while never allocating a buffer for the original value.
 */
function detachUtf8Prefix(prefix: string): string {
    return Buffer.from(prefix, "utf8").toString("utf8");
}

function formatInvariantNumber(value: number, column: TdsColumn): string {
    // Fixed-scale rendering for decimal-family columns keeps display parity
    // with the invariant decimal string ("1.50" for decimal(9,2)).
    if (column.scale !== undefined && Number.isFinite(value)) {
        return value.toFixed(column.scale);
    }
    return String(value);
}

function formatDateTime(
    value: Date,
    type: string,
    scale: number | undefined,
    nanosecondsDelta: number | undefined,
): string {
    // First cut: ISO instants; TSQ2-6 pins exact per-type/per-scale rendering
    // against golden live fixtures (sub-ms via nanosecondsDelta).
    if (type === "date") {
        return value.toISOString().slice(0, 10);
    }
    if (type === "time") {
        return formatTimePart(value, scale, nanosecondsDelta);
    }
    const base = value.toISOString();
    if (!nanosecondsDelta || !scale || scale <= 3) {
        return base;
    }
    // Extend milliseconds with the sub-ms remainder to the column scale.
    const subMs = Math.round(nanosecondsDelta / 100); // 100ns units
    const extended = base.replace(
        /\.(\d{3})Z$/,
        (_m, ms: string) =>
            `.${ms}${String(subMs)
                .padStart(4, "0")
                .slice(0, scale - 3)}Z`,
    );
    return extended;
}

function formatTimePart(
    value: Date,
    scale: number | undefined,
    nanosecondsDelta: number | undefined,
): string {
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    const ss = String(value.getUTCSeconds()).padStart(2, "0");
    const effectiveScale = scale ?? 7;
    if (effectiveScale === 0) {
        return `${hh}:${mm}:${ss}`;
    }
    const ms = value.getUTCMilliseconds();
    const subMs = nanosecondsDelta ? Math.round(nanosecondsDelta / 100) : 0;
    const fraction7 = `${String(ms).padStart(3, "0")}${String(subMs).padStart(4, "0")}`;
    return `${hh}:${mm}:${ss}.${fraction7.slice(0, effectiveScale)}`;
}
