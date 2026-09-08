/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The package talks to SQL Server through these two small interfaces so it never depends on
 * vscode or on a particular backend. The extension supplies an implementation backed by the
 * SQL data plane; tests supply a fake.
 */

/** A value as it arrives from the server, already shaped for display. */
export type CellValue = string | number | boolean | null;

/** One result row, keyed by column name. */
export type Row = Readonly<Record<string, CellValue>>;

export interface ColumnInfo {
    readonly name: string;
    /** Engine type name, e.g. "nvarchar", "bigint". Present when the backend reports it. */
    readonly type?: string;
}

export interface QueryResult {
    readonly columns: readonly ColumnInfo[];
    readonly rows: readonly Row[];
    /**
     * True when at least one cell arrived truncated and could not be completed. The value shown
     * is a prefix, not the whole thing, and callers must not present it as complete.
     */
    readonly truncated: boolean;
}

/** A chunk of an oversized cell, as delivered by the backend's fetch-back. */
export interface CellChunk {
    readonly bytes: Uint8Array;
    readonly eof: boolean;
}

/**
 * Everything the package needs from a live server connection.
 */
export interface SqlRunner {
    /** Runs a query and collects every row. Use for catalog queries with bounded results. */
    query(sql: string, options?: QueryOptions): Promise<QueryResult>;

    /**
     * Runs a query and hands each page to `onPage` as it arrives. Returning a promise from
     * `onPage` holds the backend's next page until it settles, so a slow consumer throttles the
     * server instead of queueing without limit.
     */
    stream(
        sql: string,
        onPage: (page: PageEvent) => void | Promise<void>,
        options?: StreamOptions,
    ): StreamHandle;

    /** Fetches a byte range of an oversized cell the backend retained for a live query. */
    fetchCell?(
        queryId: string,
        cellRef: string,
        offset: number,
        length: number,
    ): Promise<CellChunk>;

    /** Facts about the connected instance, used to gate features that do not exist everywhere. */
    serverInfo(): Promise<ServerInfo>;
}

export interface QueryOptions {
    /** Raises the per-cell limit where the backend allows it (e.g. large showplan XML). */
    maxCellBytes?: number;
    /** Milliseconds; 0 or absent means the provider default. */
    timeoutMs?: number;
    /** Label carried into diagnostics; never derived from SQL text. */
    tag?: string;
}

export interface StreamOptions extends QueryOptions {
    /**
     * Ask the backend to keep oversized cells whole so `fetchCell` can complete them. Costs
     * server memory, so only streams that genuinely need whole values should set it.
     */
    retainOversizedCells?: boolean;
}

export interface PageEvent {
    readonly queryId: string;
    readonly columns: readonly ColumnInfo[];
    readonly rows: readonly RawRow[];
}

/** A row before column names are applied; cells may be truncation markers. */
export type RawRow = readonly RawCell[];

export type RawCell = CellValue | TruncatedCell | BinaryCell;

/** A cell the backend could not send whole. */
export interface TruncatedCell {
    readonly $t: "truncated";
    readonly of?: "string" | "binary" | string;
    /** Size of the complete value in bytes. */
    readonly bytes?: number;
    /** `sha256:<hex>` of the complete value, for verifying a reassembly. */
    readonly digest?: string;
    /** The prefix that did fit: UTF-8 text, or base64 when `of` is "binary". */
    readonly v?: string;
    /** Handle for fetching the remainder, present only when the query retained it. */
    readonly more?: string;
}

/** A binary cell that fit within the limit. */
export interface BinaryCell {
    readonly $t: "binary";
    /** base64 */
    readonly v: string;
}

export interface StreamHandle {
    /** Resolves when the query completes, or rejects if it fails. */
    readonly completed: Promise<StreamCompletion>;
    cancel(): Promise<void>;
    dispose(): Promise<void>;
}

export interface StreamCompletion {
    readonly status: "succeeded" | "failed" | "canceled" | "disposed" | "connectionLost";
    readonly message?: string;
}

export interface ServerInfo {
    /** serverproperty('EngineEdition'): 5 = Azure SQL Database, 8 = Managed Instance. */
    readonly engineEditionId?: number;
    /** Major version number, e.g. 16 for SQL Server 2022. */
    readonly majorVersion?: number;
    readonly database?: string;
    readonly serverName?: string;
}

export function isTruncatedCell(cell: unknown): cell is TruncatedCell {
    return typeof cell === "object" && cell !== null && (cell as TruncatedCell).$t === "truncated";
}

export function isBinaryCell(cell: unknown): cell is BinaryCell {
    return typeof cell === "object" && cell !== null && (cell as BinaryCell).$t === "binary";
}

/** True on Azure SQL Database, where server-scoped features (SQL Agent, most DMVs) do not exist. */
export function isAzureSqlDatabase(info: ServerInfo): boolean {
    return info.engineEditionId === 5;
}

/** True on Azure SQL Managed Instance. */
export function isManagedInstance(info: ServerInfo): boolean {
    return info.engineEditionId === 8;
}
