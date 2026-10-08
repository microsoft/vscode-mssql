/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A sql-core `SqlReader` over one SQL data plane session.
 *
 * - Queries run one at a time, in call order: the data plane permits one active query for each
 *   session.
 * - Every read has a deadline (`timeoutMs`, else `defaultTimeoutMs`). The reader enforces it
 *   itself, because a data plane backend can ignore `ExecuteOptions.timeoutMs`: at the deadline it
 *   cancels the query and rejects with kind `timeout`. An `AbortSignal` cancels the same way and
 *   rejects with kind `canceled`. A query that does not stop within `cancelGraceMs` keeps the
 *   session busy, so the reader replaces the session.
 * - A failed read is never retried, because the batch can be a change.
 *
 * Values: `null` for NULL; numbers as numbers, except `bigint` and decimal values, which the data
 * plane sends as exact decimal strings; dates and times as ISO 8601 strings; XML and JSON as text;
 * binary as a `0x` hexadecimal string.
 *
 * Truncation: the data plane can shorten a large value (when `maxCellBytes` is set, or by its own
 * limit) or drop rows. The reader returns the prefix that it received, never pads or marks the
 * value, and lists each shortened value in `DataPlaneResultSet.truncatedCells`. sql-core results
 * have no field for this, so callers wrap the reader in a {@link TruncationRecorder} and report
 * the list with the result. A shortened plan XML is therefore visible, not silent.
 */

import { SqlReadError, SqlReadOptions, SqlReader, SqlResultSet, SqlValue } from "sql-core";
import {
    CellValue,
    DataPlaneErrorCodes,
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
    ResultSetEnded,
    ResultSetMetadata,
    RowsPage,
    ServerMessage,
    decodeCell,
} from "../services/sqlDataPlane/api";
import { PerformanceTruncation } from "../sharedInterfaces/performance";

/** Supplies the session that a reader runs on. */
export interface DataPlaneSessionSource {
    /** Returns an open session. Opens a new one when the last one closed or was lost. */
    open(): Promise<ISqlSession>;
    /** Drops the current session, so that the next `open` starts a new one. */
    recycle(): void;
}

export interface DataPlaneSqlReaderOptions {
    /** Deadline for a read without `timeoutMs`. */
    readonly defaultTimeoutMs?: number;
    /** Time that a canceled query has to stop before the reader replaces the session. */
    readonly cancelGraceMs?: number;
    /** Asks the data plane to shorten larger values. By default the reader sets no limit. */
    readonly maxCellBytes?: number;
}

export const defaultReadTimeoutMs = 60_000;
export const defaultCancelGraceMs = 5_000;

/** A value that the data plane shortened, in one result set. */
export interface TruncatedCell {
    readonly row: number;
    readonly column: string;
    readonly returnedLength: number;
    readonly originalBytes?: number;
    readonly reason: string;
}

export interface DataPlaneResultSet extends SqlResultSet {
    readonly truncatedCells: readonly TruncatedCell[];
    /** Set when the data plane dropped rows of the set. */
    readonly truncatedReason?: string;
}

type StopReason = "timeout" | "canceled";

const queryTag = "performance";

export class DataPlaneSqlReader implements SqlReader {
    private _lane: Promise<void> = Promise.resolve();
    private readonly _defaultTimeoutMs: number;
    private readonly _cancelGraceMs: number;

    constructor(
        private readonly _source: DataPlaneSessionSource,
        private readonly _options: DataPlaneSqlReaderOptions = {},
    ) {
        this._defaultTimeoutMs = _options.defaultTimeoutMs ?? defaultReadTimeoutMs;
        this._cancelGraceMs = _options.cancelGraceMs ?? defaultCancelGraceMs;
    }

    read(sql: string, options: SqlReadOptions = {}): Promise<DataPlaneResultSet[]> {
        if (options.signal?.aborted) {
            return Promise.reject(stopError("canceled"));
        }
        const timeoutMs = options.timeoutMs ?? this._defaultTimeoutMs;
        return new Promise<DataPlaneResultSet[]>((resolve, reject) => {
            let state: "queued" | "running" | "done" = "queued";
            const stop = new ReadStop(timeoutMs, options.signal, (reason) => {
                // A running query observes the stop itself; a queued one never starts.
                if (state === "queued") {
                    state = "done";
                    stop.dispose();
                    reject(stopError(reason, timeoutMs));
                }
            });
            this._lane = this._lane.then(async () => {
                if (state !== "queued") {
                    return;
                }
                state = "running";
                try {
                    resolve(await this.execute(sql, stop, timeoutMs));
                } catch (error) {
                    reject(error);
                } finally {
                    state = "done";
                    stop.dispose();
                }
            });
        });
    }

    private async execute(
        sql: string,
        stop: ReadStop,
        timeoutMs: number,
    ): Promise<DataPlaneResultSet[]> {
        const opened = await Promise.race([
            this._source.open().then(
                (session) => ({ session }),
                (error: unknown) => ({ error }),
            ),
            stop.stopped.then((reason) => ({ reason })),
        ]);
        if ("reason" in opened) {
            throw stopError(opened.reason, timeoutMs);
        }
        if ("error" in opened) {
            throw connectionError(opened.error);
        }

        const collector = new ResultCollector();
        let handle: QueryHandle;
        try {
            handle = opened.session.execute(
                sql,
                {
                    priority: "background",
                    tag: queryTag,
                    timeoutMs: stop.remainingMs(),
                    ...(this._options.maxCellBytes
                        ? { maxCellBytes: this._options.maxCellBytes }
                        : {}),
                },
                collector,
            );
        } catch (error) {
            // The session is not open, or it still runs a query that did not stop.
            this._source.recycle();
            throw connectionError(error);
        }

        const outcome = await Promise.race([
            handle.completion.then((summary) => ({ summary })),
            stop.stopped.then((reason) => ({ reason })),
        ]);
        if ("reason" in outcome) {
            await this.stopQuery(handle);
            throw stopError(outcome.reason, timeoutMs);
        }
        if (outcome.summary.status === "succeeded" && collector.errors.length === 0) {
            return collector.resultSets();
        }
        const error = toReadError(outcome.summary, collector.errors);
        if (error.kind === "connection") {
            this._source.recycle();
        }
        throw error;
    }

    private async stopQuery(handle: QueryHandle): Promise<void> {
        void Promise.resolve()
            .then(() => handle.cancel())
            .catch(() => undefined);
        const stopped = await settlesWithin(handle.completion, this._cancelGraceMs);
        if (!stopped) {
            // The session accepts no other query until this one ends.
            void Promise.resolve()
                .then(() => handle.dispose())
                .catch(() => undefined);
            this._source.recycle();
        }
    }
}

/**
 * Wraps a reader for one operation and keeps the values that the data plane shortened, so the
 * operation can report them with its result.
 */
export class TruncationRecorder implements SqlReader {
    private readonly _truncated: PerformanceTruncation[] = [];

    constructor(private readonly _reader: SqlReader) {}

    get truncated(): readonly PerformanceTruncation[] {
        return this._truncated;
    }

    async read(sql: string, options?: SqlReadOptions): Promise<SqlResultSet[]> {
        const resultSets = await this._reader.read(sql, options);
        this._truncated.push(...truncationsOf(resultSets));
        return resultSets;
    }
}

/** Lists the shortened values and result sets that a data plane reader reported. */
export function truncationsOf(resultSets: readonly SqlResultSet[]): PerformanceTruncation[] {
    const truncations: PerformanceTruncation[] = [];
    resultSets.forEach((resultSet, index) => {
        const dataPlaneSet = resultSet as Partial<DataPlaneResultSet>;
        for (const cell of dataPlaneSet.truncatedCells ?? []) {
            truncations.push({ resultSet: index, ...cell });
        }
        if (dataPlaneSet.truncatedReason) {
            truncations.push({ resultSet: index, reason: dataPlaneSet.truncatedReason });
        }
    });
    return truncations;
}

/** Converts a decoded data plane cell to a sql-core value. */
export function toSqlValue(cell: CellValue): SqlValue {
    switch (cell.kind) {
        case "null":
            // eslint-disable-next-line no-restricted-syntax -- sql-core represents NULL as null
            return null;
        case "string":
        case "xml":
        case "json":
            return cell.value;
        case "number":
            // A string here is an exact bigint or decimal value from the data plane.
            return cell.value;
        case "boolean":
            return cell.value;
        case "datetime":
            return toIsoDateTime(cell.iso ?? cell.display);
        case "binary":
            return toHex(cell);
        case "unsupported":
            return cell.display;
    }
}

/**
 * Maps a failed query to a read error: a SQL error number makes a `server` error, a timeout
 * (the data plane's client deadline or SQL client error -2) makes `timeout`, and a lost session or
 * transport makes `connection`.
 */
export function toReadError(
    summary: QueryCompleteSummary,
    errors: readonly ServerMessage[],
): SqlReadError {
    const code = summary.error?.code;
    const errorNumber =
        summary.error?.server?.number ?? errors.find((error) => error.number !== undefined)?.number;
    const message =
        errors[0]?.text ??
        summary.error?.message ??
        `The query ended with status ${summary.status}.`;

    switch (summary.status) {
        case "canceled":
            return new SqlReadError(message, "canceled");
        case "connectionLost":
        case "disposed":
            return new SqlReadError(message, "connection");
    }
    if (code === DataPlaneErrorCodes.clientTimeout || errorNumber === -2) {
        return new SqlReadError(message, "timeout", errorNumber);
    }
    if (code === DataPlaneErrorCodes.clientAborted) {
        return new SqlReadError(message, "canceled");
    }
    if (
        errorNumber !== undefined ||
        errors.length > 0 ||
        code === DataPlaneErrorCodes.queryFailed
    ) {
        return new SqlReadError(message, "server", errorNumber);
    }
    return new SqlReadError(message, "connection");
}

interface CollectedResultSet {
    readonly columns: string[];
    readonly rows: SqlValue[][];
    readonly truncatedCells: TruncatedCell[];
    truncatedReason?: string;
}

class ResultCollector implements IQueryEventSink {
    readonly errors: ServerMessage[] = [];
    private readonly _sets: CollectedResultSet[] = [];
    private readonly _setsById = new Map<string, CollectedResultSet>();

    resultSets(): DataPlaneResultSet[] {
        return this._sets.map((set) => ({
            columns: set.columns,
            rows: set.rows,
            truncatedCells: set.truncatedCells,
            ...(set.truncatedReason ? { truncatedReason: set.truncatedReason } : {}),
        }));
    }

    onResultSetStarted(meta: ResultSetMetadata): void {
        const set: CollectedResultSet = {
            columns: meta.columns.map((column) => column.name),
            rows: [],
            truncatedCells: [],
        };
        this._sets.push(set);
        this._setsById.set(meta.resultSetId, set);
    }

    onRowsPage(page: RowsPage): void {
        const set = this._setsById.get(page.resultSetId);
        if (!set) {
            return;
        }
        const columnCount = set.columns.length;
        // Read the null bitmap once per page, not once per cell.
        const nulls = page.compact.nullBitmap
            ? Buffer.from(page.compact.nullBitmap, "base64")
            : undefined;
        const values = { values: page.compact.values, typeHints: page.compact.typeHints };
        for (let pageRow = 0; pageRow < page.compact.values.length; pageRow++) {
            const row: SqlValue[] = [];
            for (let column = 0; column < columnCount; column++) {
                const bit = pageRow * columnCount + column;
                const cell: CellValue =
                    nulls && (nulls[bit >> 3] ?? 0) & (1 << (bit & 7))
                        ? { kind: "null" }
                        : decodeCell(values, pageRow, column, columnCount);
                const value = toSqlValue(cell);
                row.push(value);
                const truncated = "truncated" in cell ? cell.truncated : undefined;
                if (truncated) {
                    set.truncatedCells.push({
                        row: set.rows.length,
                        column: set.columns[column],
                        returnedLength: returnedLength(cell, value),
                        ...(truncated.originalBytes !== undefined
                            ? { originalBytes: truncated.originalBytes }
                            : {}),
                        reason: truncated.reason,
                    });
                }
            }
            set.rows.push(row);
        }
    }

    onResultSetEnded(info: ResultSetEnded): void {
        const set = this._setsById.get(info.resultSetId);
        if (set && info.truncatedReason) {
            set.truncatedReason = info.truncatedReason;
        }
    }

    onMessage(message: ServerMessage): void {
        if (message.kind === "error") {
            this.errors.push(message);
        }
    }

    onComplete(): void {
        // The reader waits for the handle's completion, which settles after this callback.
    }
}

class ReadStop {
    private _reason: StopReason | undefined;
    private _resolve!: (reason: StopReason) => void;
    private readonly _timer: ReturnType<typeof setTimeout>;
    private readonly _deadline: number;
    private readonly _onAbort = () => this.fire("canceled");
    readonly stopped: Promise<StopReason>;

    constructor(
        timeoutMs: number,
        private readonly _signal: AbortSignal | undefined,
        private readonly _onStop: (reason: StopReason) => void,
    ) {
        this.stopped = new Promise<StopReason>((resolve) => {
            this._resolve = resolve;
        });
        this._deadline = Date.now() + timeoutMs;
        this._timer = setTimeout(() => this.fire("timeout"), Math.max(0, timeoutMs));
        _signal?.addEventListener("abort", this._onAbort);
    }

    remainingMs(): number {
        return Math.max(1, this._deadline - Date.now());
    }

    dispose(): void {
        clearTimeout(this._timer);
        this._signal?.removeEventListener("abort", this._onAbort);
    }

    private fire(reason: StopReason): void {
        if (this._reason) {
            return;
        }
        this._reason = reason;
        this._resolve(reason);
        this._onStop(reason);
    }
}

function stopError(reason: StopReason, timeoutMs?: number): SqlReadError {
    return reason === "timeout"
        ? new SqlReadError(`The query did not finish within ${timeoutMs} ms.`, "timeout")
        : new SqlReadError("The query was canceled.", "canceled");
}

function connectionError(error: unknown): SqlReadError {
    if (error instanceof SqlReadError) {
        return error;
    }
    return new SqlReadError(error instanceof Error ? error.message : String(error), "connection");
}

/** Length of a shortened value. Binary values count hex digits, without the `0x` prefix. */
function returnedLength(cell: CellValue, value: SqlValue): number {
    if (typeof value !== "string") {
        return 0;
    }
    return cell.kind === "binary" && value.startsWith("0x") ? value.length - 2 : value.length;
}

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
    });
    try {
        return await Promise.race([
            promise.then(
                () => true,
                () => true,
            ),
            expired,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

const isoDateTimePattern =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?: ?([+-]\d{2}:\d{2}|Z))?$/;

/** Turns `2026-07-04 12:00:00.000 +02:00` into `2026-07-04T12:00:00.000+02:00`. */
function toIsoDateTime(value: string): string {
    const match = isoDateTimePattern.exec(value);
    return match ? `${match[1]}T${match[2]}${match[3] ?? ""}` : value;
}

function toHex(cell: Extract<CellValue, { kind: "binary" }>): string {
    if (cell.base64 !== undefined) {
        return `0x${Buffer.from(cell.base64, "base64").toString("hex").toUpperCase()}`;
    }
    const text = cell.hexPrefix ?? "";
    const digits = /^0x/i.test(text) ? text.slice(2) : text;
    return /^[0-9a-f]*$/i.test(digits) ? `0x${digits.toUpperCase()}` : text;
}
