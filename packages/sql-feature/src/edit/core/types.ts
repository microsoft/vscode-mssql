/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The engine's port onto a SQL connection.
 *
 * Deliberately the same shape the diagnostics package uses, so one adapter over the data plane
 * satisfies both. The engine never imports a driver, a connection or anything from the
 * extension host, which is what lets every rule in it be tested without a server.
 */

export interface QueryOptions {
    /** Raises the per-cell limit, for reading a large value whole. */
    maxCellBytes?: number;
    /** Milliseconds; 0 or absent means the provider default. */
    timeoutMs?: number;
    /** Label carried into diagnostics; never derived from SQL text. */
    tag?: string;
    /** Keeps oversized cells fetchable rather than clipped. */
    retainOversizedCells?: boolean;
}

/** A cell as it arrives: already decoded to text, or a marker for the awkward cases. */
export type CellValue = string | number | boolean | null | TruncatedCell | BinaryCell;

export interface TruncatedCell {
    readonly $t: "truncated";
    /** Full size in bytes, so the caller knows what it is missing. */
    readonly bytes?: number;
    /** The prefix that did arrive. */
    readonly v: string;
    /** Handle for fetching the rest, when the backend retained it. */
    readonly more?: string;
}

export interface BinaryCell {
    readonly $t: "binary";
    /** Base64. */
    readonly v: string;
}

export interface QueryResult {
    /** Read-only: the engine never mutates what a driver hands back. */
    readonly rows: readonly Readonly<Record<string, CellValue>>[];
    readonly columns: readonly { name: string; type?: string }[];
    /** Rows the statement reported as affected, where the driver supplies it. */
    readonly rowsAffected?: number;
}

export interface SqlRunner {
    query(sql: string, options?: QueryOptions): Promise<QueryResult>;
}

export function isTruncatedCell(cell: unknown): cell is TruncatedCell {
    return typeof cell === "object" && cell !== null && (cell as TruncatedCell).$t === "truncated";
}

export function isBinaryCell(cell: unknown): cell is BinaryCell {
    return typeof cell === "object" && cell !== null && (cell as BinaryCell).$t === "binary";
}

/** Renders a cell as the text the grid shows and the codec later parses back. */
export function cellToText(cell: CellValue): string | null {
    if (cell === null || cell === undefined) {
        return null;
    }
    if (isBinaryCell(cell)) {
        return `0x${Buffer.from(cell.v, "base64").toString("hex")}`;
    }
    if (isTruncatedCell(cell)) {
        return cell.v;
    }
    return typeof cell === "string" ? cell : String(cell);
}
