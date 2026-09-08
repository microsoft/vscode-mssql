/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The engine's public surface.
 *
 * A session holds metadata and the chosen key strategy, and nothing else. It does not cache
 * rows: the old design materialised the whole result set to a file so that a row could be
 * addressed by its position in it, which is what forced offset paging and a hard row cap. Here
 * a page is a query, and a row is addressed by its own key, so a session stays small no matter
 * how large the table is.
 */

import { CompiledBatch, EditFailure, compileBatch, parseFailure, scriptBatch } from "../dml/commit";
import { SqlExecutionError } from "../../core/execution";
import { CellValue, QueryOptions, SqlRunner, cellToText, isTruncatedCell } from "../core/types";
import { KeyStrategy, chooseKeyStrategy } from "../metadata/keyStrategy";
import {
    PageCursor,
    PageRequest,
    compileCellQuery,
    compileCountQuery,
    compileCurrentRowQuery,
    compilePageQuery,
    resolvePageOrder,
} from "../query/select";
import { EditorKind, editorKindFor, isLargeValueType } from "../types/typeTraits";
import { SqlEditError } from "../core/sql";
import { EditKind, StagedEdit } from "../dml/compile";
import { TableMetadata, loadTableMetadata } from "../metadata/tableMetadata";

/** A row as the grid receives it: text values plus the cursor that addresses it. */
export interface EditRow {
    readonly values: Readonly<Record<string, string | null>>;
    /** Key values for this row, used to seek and to address it in an edit. */
    readonly cursor: PageCursor;
    /** True when at least one cell arrived clipped, so the grid can say so. */
    readonly hasTruncatedCells: boolean;
    /** Column names whose displayed value is only a prefix of the stored value. */
    readonly incompleteColumns: readonly string[];
}

export interface EditPage {
    readonly rows: readonly EditRow[];
    /** Cursor to pass back for the next page; absent when this was the last one. */
    readonly nextCursor?: PageCursor;
    readonly pageSize: number;
}

/** Everything the grid needs to render, validate and edit one column. */
export interface EditColumnInfo {
    readonly name: string;
    readonly typeName: string;
    readonly declaredTypeName?: string;
    readonly declaredTypeSchema?: string;
    readonly maxLength?: number;
    readonly precision?: number;
    readonly scale?: number;
    readonly isNullable: boolean;
    readonly hasDefault: boolean;
    readonly isWritable: boolean;
    readonly isIdentity: boolean;
    readonly isComputed: boolean;
    /** The editor this value deserves; a document type gets more than a one-line box. */
    readonly editorKind: EditorKind;
    /** True when the value can exceed a wire cell bound and so may arrive clipped. */
    readonly isLargeValue: boolean;
    readonly readOnlyReason?: string;
}

export interface EditSessionInfo {
    readonly table: TableMetadata;
    readonly key: KeyStrategy;
    /** Columns in display order with everything the grid needs to render and validate. */
    readonly columns: readonly EditColumnInfo[];
}

export interface CommitResult {
    readonly applied: number;
    /** Keys returned by the server for rows affected by this acknowledged batch. */
    readonly observations?: readonly CommitObservation[];
    /** Present when nothing was applied because one statement failed. */
    readonly failure?: EditFailure;
}

export interface CommitObservation {
    readonly rowId: number;
    readonly kind: EditKind;
    readonly key: Readonly<Record<string, string | null>>;
    readonly incompleteColumns?: readonly string[];
}

/** Cells larger than this arrive clipped unless the caller asks for the whole value. */
const DEFAULT_MAX_CELL_BYTES = 1024 * 1024;

export class EditSession {
    private constructor(
        private readonly _runner: SqlRunner,
        readonly table: TableMetadata,
        readonly key: KeyStrategy,
    ) {}

    /**
     * Opens a session against one object.
     *
     * The key strategy is resolved here so the caller can show what rows will be matched on
     * before anyone types a value, rather than discovering it when a save fails.
     */
    static async open(runner: SqlRunner, schema: string, name: string): Promise<EditSession> {
        const table = await loadTableMetadata(runner, schema, name);
        const key = chooseKeyStrategy(table);
        return new EditSession(runner, table, key);
    }

    get info(): EditSessionInfo {
        return {
            table: this.table,
            key: this.key,
            columns: this.table.columns.map((c) => ({
                name: c.name,
                typeName: c.typeName,
                ...(c.declaredTypeName ? { declaredTypeName: c.declaredTypeName } : {}),
                ...(c.declaredTypeSchema ? { declaredTypeSchema: c.declaredTypeSchema } : {}),
                ...(c.maxLength !== undefined ? { maxLength: c.maxLength } : {}),
                ...(c.precision !== undefined ? { precision: c.precision } : {}),
                ...(c.scale !== undefined ? { scale: c.scale } : {}),
                isNullable: c.isNullable,
                hasDefault: c.hasDefault,
                isWritable: c.isWritable,
                isIdentity: c.isIdentity,
                isComputed: c.isComputed,
                editorKind: editorKindFor(c.typeName, c.maxLength, c.isWritable),
                isLargeValue: isLargeValueType(c.typeName, c.maxLength),
                ...(c.isWritable ? {} : { readOnlyReason: readOnlyReason(c) }),
            })),
        };
    }

    /** Reads one page. Pass the previous page's `nextCursor` to continue. */
    async readPage(request: PageRequest, options?: QueryOptions): Promise<EditPage> {
        const compiled = compilePageQuery(this.table, this.key, request, {
            includeLookahead: true,
        });
        const result = await this._runner.query(compiled.sql, {
            tag: "sqlEdit.page",
            maxCellBytes: options?.maxCellBytes ?? DEFAULT_MAX_CELL_BYTES,
            // Oversized values stay fetchable so a large cell can be opened in full rather
            // than silently clipped in the grid.
            retainOversizedCells: true,
            ...options,
        });

        const fetchedRows = result.rows.map((raw) => this.toRow(raw, compiled.cursorColumns));
        const rows = fetchedRows.slice(0, compiled.pageSize);
        const hasNextPage = fetchedRows.length > compiled.pageSize;

        return {
            rows,
            pageSize: compiled.pageSize,
            ...(hasNextPage && rows.length > 0 ? { nextCursor: rows[rows.length - 1].cursor } : {}),
        };
    }

    /** Total matching rows, for a count the UI can state rather than imply. */
    async countRows(request: Pick<PageRequest, "filters">): Promise<number> {
        const result = await this._runner.query(compileCountQuery(this.table, request.filters), {
            tag: "sqlEdit.count",
        });
        return Number(result.rows[0]?.total ?? 0);
    }

    /**
     * Reads one cell in full, for opening a document value in an editor.
     *
     * The grid bounds every cell so a page of xml or json cannot flood the wire, which means a
     * large value arrives clipped. Saving a clipped value would truncate the column, so the
     * whole value is fetched for the one cell being opened.
     */
    async readCellValue(
        cursor: PageCursor,
        columnName: string,
        sort?: readonly import("../query/filter").SortColumn[],
    ): Promise<string | null> {
        const order = resolvePageOrder(sort, this.key);
        const sql = compileCellQuery(this.table, columnName, cursor, order);
        const result = await this._runner.query(sql, {
            tag: "sqlEdit.cell",
            // A document column is the reason this method exists, so the bound is raised well
            // past the page default rather than clipping again.
            maxCellBytes: 64 * 1024 * 1024,
        });
        const row = result.rows[0];
        const cell = row?.[columnName];
        if (isTruncatedCell(cell)) {
            throw new SqlEditError(
                `The complete value for column "${columnName}" is still too large to load. It remains read-only.`,
                "incompleteValue",
            );
        }
        return row ? cellToText(cell ?? null) : null;
    }

    /** Reads the current server row addressed by its original key without replacing the draft. */
    async readCurrentRow(cursor: PageCursor): Promise<EditRow | undefined> {
        const order = this.key.columns.map((column) => ({ column }));
        const result = await this._runner.query(compileCurrentRowQuery(this.table, cursor, order), {
            tag: "sqlEdit.currentRow",
            maxCellBytes: DEFAULT_MAX_CELL_BYTES,
            retainOversizedCells: true,
        });
        const raw = result.rows[0];
        return raw ? this.toRow(raw, this.key.columns) : undefined;
    }

    /** The script for the staged edits, identical to what `commit` executes. */
    script(edits: readonly StagedEdit[]): string {
        return scriptBatch(this.table, this.key, edits);
    }

    /**
     * Applies every staged edit, or none of them.
     *
     * A failure is reported against the row that caused it, and nothing is left half-applied,
     * so the grid's staged state stays a faithful record of what is still unsaved.
     */
    async commit(edits: readonly StagedEdit[]): Promise<CommitResult> {
        const batch: CompiledBatch = compileBatch(this.table, this.key, edits, {
            observationColumns: this.key.columns,
        });
        try {
            const result = await this._runner.query(batch.sql, {
                tag: "sqlEdit.commit",
                retainOversizedCells: true,
            });
            return {
                applied: batch.statements.length,
                observations: observationsFrom(result.rows, this.key.columns),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof SqlExecutionError && error.outcomeCertainty === "unknown") {
                throw new SqlExecutionError(
                    `The save outcome is unknown. Changes may have been applied. Check the server before retrying. ${message}`,
                    error.status,
                    "unknown",
                );
            }
            const failure = parseFailure(message, batch.statements);
            if (failure) {
                throw new EditCommitError(failure.message, failure);
            }
            throw new SqlEditError(`The save failed. ${message}`, "commitFailed");
        }
    }

    private toRow(raw: Record<string, CellValue>, cursorColumns: readonly string[]): EditRow {
        const values: Record<string, string | null> = {};
        const incompleteColumns: string[] = [];

        for (const column of this.table.columns) {
            const cell = raw[column.name];
            if (isTruncatedCell(cell)) {
                incompleteColumns.push(column.name);
            }
            values[column.name] = cellToText(cell ?? null);
        }

        const cursor: Record<string, string | null> = {};
        for (const column of cursorColumns) {
            cursor[column] = values[column] ?? null;
        }

        return {
            values,
            cursor,
            hasTruncatedCells: incompleteColumns.length > 0,
            incompleteColumns,
        };
    }
}

function observationsFrom(
    rows: readonly Readonly<Record<string, CellValue>>[],
    keyColumns: readonly string[],
): CommitObservation[] {
    const observations: CommitObservation[] = [];
    for (const row of rows) {
        const rowId = Number(cellToText(row.__sql_edit_row_id));
        const kind = cellToText(row.__sql_edit_kind);
        if (!Number.isSafeInteger(rowId) || !isEditKind(kind)) {
            continue;
        }
        const key: Record<string, string | null> = {};
        const incompleteColumns: string[] = [];
        for (const [index, column] of keyColumns.entries()) {
            const cell = row[`__sql_edit_key_${index}`];
            if (isTruncatedCell(cell)) {
                incompleteColumns.push(column);
            }
            key[column] = cellToText(cell ?? null);
        }
        observations.push({
            rowId,
            kind,
            key,
            ...(incompleteColumns.length > 0 ? { incompleteColumns } : {}),
        });
    }
    return observations;
}

function isEditKind(value: string | null): value is EditKind {
    return value === "insert" || value === "update" || value === "delete";
}

/** Thrown when one staged edit could not be applied; carries the row it belongs to. */
export class EditCommitError extends Error {
    constructor(
        message: string,
        readonly failure: EditFailure,
    ) {
        super(message);
        this.name = "EditCommitError";
    }
}

function readOnlyReason(column: { isComputed: boolean; isIdentity: boolean }): string {
    if (column.isComputed) {
        return "This column is computed by the server.";
    }
    if (column.isIdentity) {
        return "This column is an identity and is assigned on insert.";
    }
    return "This column is maintained by the server.";
}
