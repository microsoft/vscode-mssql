/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure client-side grid operations for the Query Studio results grid
 * (classic in-memory sort/filter parity — headerFilter/hybridDataProvider
 * intent). Webview-safe by convention: no vscode/DOM imports (the sibling
 * queryResultCellCodec is equally pure), shared by the results webview and
 * the unit tests (test/unit cannot compile src/webviews — the tsconfig split
 * excludes it from the extension build).
 */

import {
    isVectorCellOkV1,
    SPATIAL_TYPE_HINT_V1,
    typedCellTextForPurpose,
    VECTOR_TYPE_HINT_V1,
} from "./queryResultCellCodec";

export type QsSortDirection = "asc" | "desc";

export interface QsSortSpec {
    column: number;
    direction: QsSortDirection;
}

export interface QsColumnFilter {
    column: number;
    /** Case-insensitive substring match over the cell display text. */
    contains?: string;
    /** Selected distinct display texts; undefined = every value passes. */
    values?: readonly string[];
}

/** Distinct-values list cap in the filter popup (classic headerFilter scale). */
export const QS_DISTINCT_VALUES_CAP = 200;
/** Rendered cell text clamp — longer cells display truncated and link out. */
export const QS_CELL_DISPLAY_CLAMP = 2048;
/** Cell tooltip (title attribute) clamp. */
export const QS_CELL_TITLE_CLAMP = 512;
/** Avoid parsing large cell documents on the UI thread just to decide link styling. */
export const QS_CELL_DOCUMENT_PARSE_LIMIT = 256 * 1024;
export type QsCellDocumentLanguage = "xml" | "json";

/**
 * Structural check for the byte-capped cell marker
 * (services/sqlDataPlane/api.ts TruncatedCellEncoding — shape duplicated here
 * because this module stays import-free for webview safety).
 */
export function isTruncatedCellMarker(
    value: unknown,
): value is { $t: "truncated"; of?: "string" | "binary"; bytes?: number; v: string } {
    return (
        value !== null &&
        typeof value === "object" &&
        (value as { $t?: unknown }).$t === "truncated" &&
        typeof (value as { v?: unknown }).v === "string"
    );
}

/**
 * Typed wire wrapper (WireValueEncoder `{"$t": type, "v": string}`): the
 * service wraps lossy/ambiguous scalars — datetime2, datetimeoffset, time,
 * decimal, guid, binary, double, provider — so precision survives the wire.
 * Shape duplicated structurally for webview safety.
 */
export function isTypedCellWrapper(value: unknown): value is { $t: string; v: string } {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof (value as { $t?: unknown }).$t === "string" &&
        (value as { $t?: unknown }).$t !== "truncated" &&
        typeof (value as { v?: unknown }).v === "string"
    );
}

/** Binary display cap: hex beyond this many raw bytes elides (SSMS-style). */
const BINARY_DISPLAY_MAX_BYTES = 256;

/**
 * SSMS-style display for a typed wrapper — the user sees the VALUE, never
 * the wire encoding: dates as "2003-04-08 09:13:36.390", binary as
 * "0x0105…", decimals/guids as their invariant text.
 */
function typedWrapperDisplayText(wrapper: { $t: string; v: string }): string {
    switch (wrapper.$t) {
        case "datetime2":
            return formatIsoDateTime(wrapper.v, /* keepOffset */ false);
        case "datetimeoffset":
            return formatIsoDateTime(wrapper.v, /* keepOffset */ true);
        case "binary":
            return base64ToHexDisplay(wrapper.v);
        // time / decimal / guid / double / provider: invariant text is the value.
        default:
            return wrapper.v;
    }
}

/**
 * ISO round-trip ("O") → grid form: "T" becomes a space and the fractional
 * seconds trim trailing zeros down to SSMS's 3-digit floor.
 */
function formatIsoDateTime(iso: string, keepOffset: boolean): string {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(iso);
    if (!match) {
        return iso.replace("T", " ");
    }
    const [, date, time, fraction, offset] = match;
    let fractionText = "";
    if (fraction !== undefined && fraction.length > 0) {
        let lastNonZero = -1;
        for (let i = 0; i < fraction.length; i++) {
            if (fraction.charCodeAt(i) !== 48) {
                lastNonZero = i;
            }
        }
        fractionText = "." + fraction.slice(0, Math.max(3, lastNonZero + 1));
    }
    return `${date} ${time}${fractionText}${keepOffset ? ` ${offset.trim()}` : ""}`.trimEnd();
}

const HEX_DIGITS = "0123456789ABCDEF";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP: number[] = (() => {
    const table = new Array<number>(128).fill(-1);
    for (let i = 0; i < BASE64_ALPHABET.length; i++) {
        table[BASE64_ALPHABET.charCodeAt(i)] = i;
    }
    return table;
})();

/** base64 → "0x…" uppercase hex, elided past the display cap. No Buffer/atob (webview + host + tests). */
function base64ToHexDisplay(base64: string): string {
    let hex = "0x";
    let bits = 0;
    let bitCount = 0;
    let bytes = 0;
    for (let i = 0; i < base64.length && bytes < BINARY_DISPLAY_MAX_BYTES; i++) {
        const code = base64.charCodeAt(i);
        const sextet = code < 128 ? BASE64_LOOKUP[code] : -1;
        if (sextet < 0) {
            continue; // '=' padding / whitespace
        }
        bits = (bits << 6) | sextet;
        bitCount += 6;
        if (bitCount >= 8) {
            bitCount -= 8;
            const byte = (bits >> bitCount) & 0xff;
            hex += HEX_DIGITS[byte >> 4] + HEX_DIGITS[byte & 0xf];
            bytes++;
        }
    }
    // Rough over-cap check: 4 base64 chars ≈ 3 bytes.
    const totalBytes = Math.floor((base64.replace(/=+$/, "").length * 3) / 4);
    return totalBytes > BINARY_DISPLAY_MAX_BYTES ? `${hex}…` : hex;
}

/** Display text for one wire cell value (grid cellText parity). */
export function cellDisplayText(value: unknown): string {
    if (value === undefined || value === null) {
        return "NULL";
    }
    if (typeof value === "boolean") {
        // bit columns render 0/1 (SSMS parity), not true/false.
        return value ? "1" : "0";
    }
    if (isTruncatedCellMarker(value)) {
        // Byte-capped cell (maxCellBytes): show the prefix the service kept —
        // the grid's clamp/link-out treatment keeps the whole prefix
        // reachable. Sort/filter/copy operate on the same prefix.
        return value.v;
    }
    if (isTypedCellWrapper(value)) {
        return typedWrapperDisplayText(value);
    }
    if (typeof value === "object") {
        // Typed non-scalar encodings (vector; spatial next): bounded honest
        // preview — never a full component decode on the render path, and
        // never raw tag JSON in a grid cell.
        const typedText = typedCellTextForPurpose(value, "gridPreview");
        if (typedText !== null) {
            return typedText;
        }
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Full-fidelity text for one cell for copy/export-style consumers: typed
 * non-scalar encodings expand completely (a vector copies as its full JSON
 * array, engine-text parity); everything else matches the grid display.
 */
export function cellTextForPurpose(
    value: unknown,
    purpose: "copy" | "textView" | "cellDocument" | "csvExport" | "jsonExport" | "insertExport",
): string {
    const typedText = typedCellTextForPurpose(value, purpose);
    if (typedText !== null) {
        return typedText;
    }
    return cellDisplayText(value);
}

export interface QsCellDocumentMetadata {
    readonly sqlType?: string;
    readonly typeHint?: string;
    readonly isXml?: boolean;
    readonly isJson?: boolean;
}

function metadataDocumentLanguage(
    metadata: QsCellDocumentMetadata | undefined,
): QsCellDocumentLanguage | undefined {
    if (metadata?.isXml === true || metadata?.typeHint === "xml") {
        return "xml";
    }
    if (metadata?.isJson === true || metadata?.typeHint === "json") {
        return "json";
    }
    const sqlType = metadata?.sqlType?.trim().toLowerCase();
    if (sqlType === "xml") {
        return "xml";
    }
    if (sqlType === "json") {
        return "json";
    }
    return undefined;
}

function hasJsonShape(text: string): boolean {
    const trimmed = text.trim();
    return (
        trimmed.length > 0 &&
        ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]")))
    );
}

function hasXmlShape(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length > 0 && trimmed.startsWith("<") && trimmed.endsWith(">");
}

function isJsonDocumentText(text: string): boolean {
    if (!hasJsonShape(text)) {
        return false;
    }
    if (text.length > QS_CELL_DOCUMENT_PARSE_LIMIT) {
        return true;
    }
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Classify cells that should render as openable XML/JSON documents.
 * Metadata wins. Backend byte-capped cells are classified only by metadata
 * because their retained prefix is not enough to prove string JSON/XML.
 */
export function cellDocumentLanguage(
    value: unknown,
    metadata?: QsCellDocumentMetadata,
    /** Optional display text already materialized by the caller. */
    materializedText?: string,
): QsCellDocumentLanguage | undefined {
    const fromMetadata = metadataDocumentLanguage(metadata);
    if (fromMetadata !== undefined) {
        return fromMetadata;
    }
    if (value === undefined || value === null || isTruncatedCellMarker(value)) {
        return undefined;
    }
    // Typed OK vector cells open as JSON documents (the full component array
    // — the grid shows only a bounded preview). Unavailable sentinels have no
    // document to open.
    if (isVectorCellOkV1(value)) {
        return "json";
    }
    const text = materializedText ?? cellDisplayText(value);
    if (isJsonDocumentText(text)) {
        return "json";
    }
    return hasXmlShape(text) ? "xml" : undefined;
}

/**
 * Ascending comparator over two cell values. NULLs sort first (SQL Server
 * ORDER BY ASC semantics — a desc pass negates the result, landing NULLs
 * last). Numeric columns compare numerically; everything else compares
 * case-insensitively by display text. A "numeric" value that fails to parse
 * falls back to the string comparison so mixed content stays deterministic.
 */
export function compareCells(a: unknown, b: unknown, numeric: boolean): number {
    const aNull = a === undefined || a === null;
    const bNull = b === undefined || b === null;
    if (aNull || bNull) {
        return aNull && bNull ? 0 : aNull ? -1 : 1;
    }
    if (numeric) {
        // Display text unwraps typed wire wrappers (decimal/double arrive as
        // {$t, v} objects whose String() would be "[object Object]").
        const na = typeof a === "number" ? a : Number(cellDisplayText(a));
        const nb = typeof b === "number" ? b : Number(cellDisplayText(b));
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
            return na < nb ? -1 : na > nb ? 1 : 0;
        }
    }
    const sa = cellDisplayText(a).toLowerCase();
    const sb = cellDisplayText(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** True when the row passes every filter (AND across columns). */
export function rowPassesFilters(
    row: readonly unknown[],
    filters: readonly QsColumnFilter[],
): boolean {
    for (const filter of filters) {
        const text = cellDisplayText(row[filter.column]);
        if (
            filter.contains !== undefined &&
            filter.contains.length > 0 &&
            !text.toLowerCase().includes(filter.contains.toLowerCase())
        ) {
            return false;
        }
        if (filter.values !== undefined && !filter.values.includes(text)) {
            return false;
        }
    }
    return true;
}

/**
 * Filter + sort over the materialized rows. Returns ORIGINAL row indices in
 * view order — callers keep source row numbers alongside each rendered row.
 * Ties keep their original relative order (stable).
 */
export function applyFilterSort(
    rows: readonly (readonly unknown[])[],
    sort: QsSortSpec | undefined,
    filters: readonly QsColumnFilter[],
    typeHints?: readonly (string | undefined)[],
): number[] {
    const indices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        if (rowPassesFilters(rows[i], filters)) {
            indices.push(i);
        }
    }
    if (sort) {
        // SQL vectors have no scalar ordering: sorting a vector column is a
        // no-op (grid headers disable the affordance via the same hint).
        if (
            typeHints?.[sort.column] === VECTOR_TYPE_HINT_V1 ||
            typeHints?.[sort.column] === SPATIAL_TYPE_HINT_V1
        ) {
            return indices;
        }
        // Wire hints are "number" (int/float) or "number:approx" (bigint/
        // decimal/money) — both want numeric ordering.
        const numeric = typeHints?.[sort.column]?.startsWith("number") === true;
        const direction = sort.direction === "desc" ? -1 : 1;
        indices.sort((x, y) => {
            const order = compareCells(rows[x][sort.column], rows[y][sort.column], numeric);
            return order !== 0 ? order * direction : x - y;
        });
    }
    return indices;
}

/** Distinct display texts for one column, sorted, capped (default 200). */
export function distinctValues(
    rows: readonly (readonly unknown[])[],
    column: number,
    cap: number = QS_DISTINCT_VALUES_CAP,
): { values: string[]; hasMore: boolean } {
    const seen = new Set<string>();
    let hasMore = false;
    for (const row of rows) {
        const text = cellDisplayText(row[column]);
        if (seen.has(text)) {
            continue;
        }
        if (seen.size >= cap) {
            hasMore = true;
            break;
        }
        seen.add(text);
    }
    const values = [...seen].sort((a, b) => compareCells(a, b, false));
    return { values, hasMore };
}

/** Clamp display text; longer input truncates with a trailing ellipsis. */
export function clampDisplay(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + "…";
}
