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
import { TdsCell, TdsColumn } from "./driver/tdsDriver";

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

function encodeStringCell(raw: string, type: string, policy: EncodePolicy): EncodedCell {
    const byteLength = Buffer.byteLength(raw, "utf8");
    if (byteLength <= policy.maxCellBytes) {
        return { value: raw, isNull: false, approxBytes: byteLength + 2 };
    }
    const prefixBytes = Math.min(policy.truncatedPrefixBytes, policy.maxCellBytes);
    const prefix = utf8SafePrefix(raw, prefixBytes);
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

/** UTF-8 prefix that never splits a code point (STS2 truncation rule). */
export function utf8SafePrefix(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, "utf8") <= maxBytes) {
        return text;
    }
    const bytes = Buffer.from(text, "utf8").subarray(0, maxBytes);
    let end = bytes.length;
    // Back off continuation bytes (0b10xxxxxx) and a split lead byte.
    while (end > 0 && (bytes[end - 1] & 0xc0) === 0x80) {
        end--;
    }
    if (end > 0 && (bytes[end - 1] & 0xc0) === 0xc0) {
        end--;
    }
    return bytes.subarray(0, end).toString("utf8");
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
