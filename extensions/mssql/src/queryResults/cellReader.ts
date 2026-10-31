/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CellReader (C2D-T, addendum §1.5): the ONE normalizing accessor every
 * host-side algorithm (engine, sampler, profiler, export) reads cells
 * through. Hides the wire encodings: nulls come from the bitmap (never value
 * comparison), byte-capped cells surface their prefix with
 * `isTruncated: true`, and truncated values are equality-comparable only by
 * digest — a distinctCount that hashed prefixes would silently merge
 * distinct values sharing one.
 */

import { isTruncatedCellEncoding, isTypedScalarCellEncoding } from "../services/sqlDataPlane/api";
import { QsCellWindow } from "../sharedInterfaces/queryStudio";

export interface CellRead {
    /** Decoded value; undefined when NULL. Truncated cells expose the prefix. */
    readonly value: unknown;
    /** Numeric SQL values retain their exact text while calculations use JS numbers. */
    readonly numeric?: boolean;
    readonly isNull: boolean;
    readonly isTruncated: boolean;
    readonly truncation?: { of: "string" | "binary"; bytes?: number; digest?: string };
}

/** Value-bearing model output must visibly distinguish a retained prefix. */
export function cellPreviewValue(cell: CellRead): unknown {
    return cell.isNull ? null : cell.isTruncated ? `${String(cell.value)}…` : cell.value;
}

/** Decode one window's base64 null bitmap into an indexable bit reader. */
function bitmapReader(bitmap: string | undefined): (index: number) => boolean {
    if (!bitmap) {
        return () => false;
    }
    const bytes = Buffer.from(bitmap, "base64");
    return (index) => {
        const byteIndex = index >> 3;
        return byteIndex < bytes.length && (bytes[byteIndex] & (1 << (index & 7))) !== 0;
    };
}

/** Bound reader over one window — build once per window, not per cell. */
export interface WindowCellReader {
    readonly columnCount: number;
    cellAt(row: number, col: number): CellRead;
}

export function windowCellReader(window: QsCellWindow): WindowCellReader {
    const columnCount = window.columns.length;
    const numericColumns = window.columns.map((column, index) =>
        /^(?:bigint|int|smallint|tinyint|decimal|numeric|money|smallmoney|float|real|bit)(?:\b|\()/i.test(
            window.typeHints?.[index] ?? column.sqlType ?? "",
        ),
    );
    const nullBit = bitmapReader(window.nullBitmap);
    const truncatedBit = bitmapReader(window.truncatedBitmap);
    return {
        columnCount,
        cellAt(row: number, col: number): CellRead {
            const raw = window.values[row]?.[col];
            const index = row * columnCount + col;
            if (raw === undefined || raw === null || nullBit(index)) {
                return { value: undefined, isNull: true, isTruncated: false };
            }
            if (isTruncatedCellEncoding(raw)) {
                return {
                    value: raw.v,
                    isNull: false,
                    isTruncated: true,
                    truncation: {
                        of: raw.of,
                        ...(raw.bytes !== undefined ? { bytes: raw.bytes } : {}),
                        ...(raw.digest !== undefined ? { digest: raw.digest } : {}),
                    },
                };
            }
            if (isTypedScalarCellEncoding(raw)) {
                return {
                    value: raw.v,
                    numeric: raw.$t === "decimal" || raw.$t === "int64" || raw.$t === "double",
                    isNull: false,
                    isTruncated: truncatedBit(index),
                };
            }
            return {
                value: raw,
                numeric: numericColumns[col],
                isNull: false,
                isTruncated: truncatedBit(index),
            };
        },
    };
}

/**
 * Equality key for grouping/distinct: type-prefixed so 1 and "1" stay
 * distinct; truncated cells key by full-value digest when present, else by
 * an explicit incomparable marker unique per prefix (honest overcount beats
 * silent merge).
 */
export function cellEqualityKey(cell: CellRead): string {
    if (cell.isNull) {
        return "\u0000null";
    }
    if (cell.isTruncated) {
        return cell.truncation?.digest
            ? `\u0000digest:${cell.truncation.digest}`
            : `\u0000truncated:${String(cell.value)}`;
    }
    const value = cell.value;
    switch (typeof value) {
        case "number":
            return `n:${value}`;
        case "boolean":
            return `b:${value}`;
        case "string":
            return `s:${value}`;
        default:
            return `j:${JSON.stringify(value)}`;
    }
}

/** Numeric coercion for aggregates/comparisons; undefined when non-numeric. */
export function cellNumeric(cell: CellRead): number | undefined {
    if (cell.isNull || cell.isTruncated) {
        return undefined;
    }
    const value = cell.value;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (cell.numeric && typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
