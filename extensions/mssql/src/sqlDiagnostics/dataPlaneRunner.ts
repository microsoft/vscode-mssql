/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CellChunk,
    CellValue as FeatureCellValue,
    ColumnInfo,
    PageEvent,
    QueryOptions,
    QueryResult,
    RawRow,
    Row,
    ServerInfo,
    SqlRunner,
    SqlExecutionError,
    StreamCompletion,
    StreamHandle,
    StreamOptions,
    capabilitiesFrom,
    serverCapabilitiesSql,
    type ServerCapabilities,
} from "sql-feature/core";

import {
    CellValue,
    ISqlSession,
    IQueryEventSink,
    QueryCompleteSummary,
    ResultSetMetadata,
    RowsPage,
    ServerMessage,
    decodeCell,
} from "../services/sqlDataPlane/api";
import { SqlFeatures } from "../constants/locConstants";

/**
 * Adapts an {@link ISqlSession} onto the narrow {@link SqlRunner} the sql-diagnostics package
 * expects, so the package never imports vscode or the data plane types.
 *
 * The data plane's sink already gives us what streaming needs: returning a promise from
 * `onRowsPage` holds the backend's next page until it settles, so a slow consumer paces the
 * server rather than queueing without bound.
 */
export class DataPlaneRunner implements SqlRunner {
    private cachedInfo?: ServerInfo;

    constructor(private readonly session: ISqlSession) {}

    async query(sql: string, options?: QueryOptions): Promise<QueryResult> {
        let columns: readonly ColumnInfo[] = [];
        const rows: Row[] = [];
        let truncated = false;
        let serverError: string | undefined;

        const handle = this.session.execute(
            sql,
            {
                tag: options?.tag,
                maxCellBytes: options?.maxCellBytes,
                ...(options?.retainOversizedCells ? { retainOversizedCells: true } : {}),
                timeoutMs: options?.timeoutMs,
                commandKind: "metadata",
                priority: "interactive",
            },
            {
                onResultSetStarted: (meta: ResultSetMetadata) => {
                    columns = meta.columns.map((c) => ({ name: c.name, type: c.sqlType }));
                },
                onRowsPage: (page: RowsPage) => {
                    const columnCount = columns.length;
                    for (let r = 0; r < page.rowCount; r++) {
                        const row: Record<string, FeatureCellValue> = {};
                        for (let c = 0; c < columnCount; c++) {
                            const cell = decodeCell(page.compact, r, c, columnCount);
                            const flat = flattenCell(cell);
                            if (flat.truncated) {
                                truncated = true;
                            }
                            row[columns[c].name] = flat.value;
                        }
                        rows.push(row);
                    }
                },
                onMessage: (message) => {
                    if (message.kind === "error") serverError ??= message.text;
                },
                onComplete: () => {
                    /* Settled through handle.completion. */
                },
            } satisfies IQueryEventSink,
        );

        try {
            const summary = await handle.completion;
            if (
                summary.status !== "succeeded" ||
                summary.errorCount > 0 ||
                serverError ||
                summary.outcomeCertainty === "unknown"
            ) {
                throw new SqlExecutionError(
                    summary.error?.message ??
                        serverError ??
                        (summary.outcomeCertainty === "unknown"
                            ? SqlFeatures.queryOutcomeUnknown
                            : summary.errorCount > 0
                              ? SqlFeatures.queryReportedErrors
                              : describeCompletion(summary)),
                    summary.status,
                    summary.outcomeCertainty ??
                        (["connectionLost", "canceled", "disposed"].includes(summary.status) ||
                        summary.synthesized
                            ? "unknown"
                            : "known"),
                );
            }
            return { columns, rows, truncated };
        } catch (error) {
            if (error instanceof SqlExecutionError) throw error;
            throw new SqlExecutionError(
                error instanceof Error ? error.message : String(error),
                "failed",
                "unknown",
            );
        } finally {
            // Cleanup cannot turn an acknowledged commit into a failed save/retry prompt.
            await handle.dispose().catch(() => undefined);
        }
    }

    stream(
        sql: string,
        onPage: (page: PageEvent) => void | Promise<void>,
        options?: StreamOptions,
    ): StreamHandle {
        let columns: readonly ColumnInfo[] = [];
        let queryId = "";
        let serverError: string | undefined;

        const handle = this.session.execute(
            sql,
            {
                tag: options?.tag,
                maxCellBytes: options?.maxCellBytes,
                timeoutMs: options?.timeoutMs ?? 0,
                commandKind: "user",
                priority: "background",
                // Oversized cells stay fetchable for streams that need whole values, such as
                // Extended Events buffers that run to a few megabytes each.
                ...(options?.retainOversizedCells ? { retainOversizedCells: true } : {}),
            },
            {
                onResultSetStarted: (meta: ResultSetMetadata) => {
                    columns = meta.columns.map((c) => ({ name: c.name, type: c.sqlType }));
                },
                onRowsPage: async (page: RowsPage) => {
                    const columnCount = columns.length;
                    const rawRows: RawRow[] = [];
                    for (let r = 0; r < page.rowCount; r++) {
                        const cells: unknown[] = [];
                        for (let c = 0; c < columnCount; c++) {
                            // Raw values, markers included: the profiler needs the truncation
                            // marker itself so it can fetch the rest of a buffer.
                            cells.push(page.compact.values[r]?.[c]);
                        }
                        rawRows.push(cells as RawRow);
                    }
                    // Awaiting the consumer is what applies backpressure to the server.
                    await onPage({ queryId, columns, rows: rawRows });
                },
                onMessage: (message: ServerMessage) => {
                    if (message.kind === "error") serverError ??= message.text;
                },
                onComplete: () => {
                    /* Settled through handle.completion. */
                },
            } satisfies IQueryEventSink,
        );

        handle.backendQueryId?.then((id) => (queryId = id)).catch(() => undefined);

        return {
            completed: handle.completion.then(
                (summary): StreamCompletion => ({
                    status:
                        summary.errorCount > 0 ||
                        serverError ||
                        summary.outcomeCertainty === "unknown"
                            ? "failed"
                            : mapStatus(summary.status),
                    message: summary.error?.message ?? serverError ?? describeCompletion(summary),
                }),
                (error): StreamCompletion => ({
                    status: "failed",
                    message: error instanceof Error ? error.message : String(error),
                }),
            ),
            cancel: async () => {
                await handle.cancel();
            },
            dispose: async () => {
                await handle.dispose();
            },
        };
    }

    async fetchCell(
        queryId: string,
        cellRef: string,
        offset: number,
        length: number,
    ): Promise<CellChunk> {
        const fetch = this.session.fetchCell;

        if (!fetch) {
            throw new Error(
                "This connection cannot fetch oversized cells. Values larger than the per-cell limit arrive truncated.",
            );
        }

        const chunk = await fetch.call(this.session, queryId, cellRef, offset, length);
        return { bytes: Buffer.from(chunk.v, "base64"), eof: chunk.eof };
    }

    async serverInfo(): Promise<ServerInfo> {
        if (this.cachedInfo) {
            return this.cachedInfo;
        }

        const result = await this.query(serverCapabilitiesSql, { tag: "sqlDiag.serverInfo" });
        const row = result.rows[0] ?? {};
        this.cachedInfo = {
            engineEditionId: numberOrUndefined(row.engine_edition_id),
            majorVersion: numberOrUndefined(row.major_version),
            database: stringOrUndefined(row.database_name),
            serverName: stringOrUndefined(row.server_name),
        };
        return this.cachedInfo;
    }

    /** Reads everything the feature gating needs in one round trip. */
    async capabilities(): Promise<ServerCapabilities> {
        const result = await this.query(serverCapabilitiesSql, { tag: "sqlDiag.capabilities" });
        const row = result.rows[0] ?? {};
        return capabilitiesFrom({
            engineEditionId: numberOrUndefined(row.engine_edition_id),
            edition: stringOrUndefined(row.edition),
            productVersion: stringOrUndefined(row.product_version),
            majorVersion: numberOrUndefined(row.major_version),
            serverName: stringOrUndefined(row.server_name),
            database: stringOrUndefined(row.database_name),
        });
    }
}

/**
 * Flattens the data plane's tagged cell union into a plain display value, and reports whether
 * it arrived clipped so the caller can say so rather than presenting a prefix as complete.
 */
function flattenCell(cell: CellValue | undefined): {
    value: FeatureCellValue;
    truncated: boolean;
} {
    if (!cell) {
        return { value: null, truncated: false };
    }

    switch (cell.kind) {
        case "null":
            return { value: null, truncated: false };
        case "string":
            return {
                value: cell.truncated
                    ? truncatedCell(cell.value, cell.truncated.originalBytes, cell.truncated.digest)
                    : cell.value,
                truncated: cell.truncated !== undefined,
            };
        case "number":
            return { value: cell.value, truncated: false };
        case "boolean":
            return { value: cell.value, truncated: false };
        case "datetime":
            return { value: cell.iso ?? cell.display, truncated: false };
        case "binary":
            if (cell.truncated) {
                return {
                    value: truncatedCell(
                        cell.base64 ?? cell.hexPrefix ?? "",
                        cell.truncated.originalBytes,
                        cell.truncated.digest,
                        "binary",
                    ),
                    truncated: true,
                };
            }
            return {
                value: cell.base64 ? { $t: "binary", v: cell.base64 } : (cell.hexPrefix ?? null),
                truncated: false,
            };
        case "xml":
        case "json":
            return {
                value: cell.truncated
                    ? truncatedCell(cell.value, cell.truncated.originalBytes, cell.truncated.digest)
                    : cell.value,
                truncated: cell.truncated !== undefined,
            };
        default: {
            // Binary and any future kinds: show something honest rather than "[object Object]".
            const anyCell = cell as { value?: unknown; display?: string; truncated?: unknown };
            const value =
                typeof anyCell.display === "string"
                    ? anyCell.display
                    : anyCell.value === undefined
                      ? null
                      : String(anyCell.value);
            return {
                value: anyCell.truncated
                    ? truncatedCell(
                          value === null ? "" : String(value),
                          (anyCell.truncated as { originalBytes?: number }).originalBytes,
                          (anyCell.truncated as { digest?: string }).digest,
                      )
                    : value,
                truncated: anyCell.truncated !== undefined,
            };
        }
    }
}

function truncatedCell(
    value: string,
    bytes?: number,
    digest?: string,
    of: "string" | "binary" = "string",
): FeatureCellValue {
    return {
        $t: "truncated",
        of,
        ...(bytes !== undefined ? { bytes } : {}),
        ...(digest ? { digest } : {}),
        v: value,
    };
}

function numberOrUndefined(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
}

function mapStatus(status: QueryCompleteSummary["status"]): StreamCompletion["status"] {
    switch (status) {
        case "succeeded":
            return "succeeded";
        case "canceled":
            return "canceled";
        case "disposed":
            return "disposed";
        case "connectionLost":
            return "connectionLost";
        default:
            return "failed";
    }
}

function describeCompletion(summary: QueryCompleteSummary): string {
    const detail = (summary as { error?: { message?: string } }).error?.message;
    return detail ?? `Query ${summary.status}.`;
}
