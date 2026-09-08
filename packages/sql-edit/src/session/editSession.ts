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
import { CellValue, QueryOptions, SqlRunner, cellToText } from "../core/types";
import { KeyStrategy, chooseKeyStrategy } from "../metadata/keyStrategy";
import {
    PageCursor,
    PageRequest,
    compileCellQuery,
    compileCountQuery,
    compilePageQuery,
    resolvePageOrder,
} from "../query/select";
import { EditorKind, editorKindFor, isLargeValueType } from "../types/typeTraits";
import { SqlEditError } from "../core/sql";
import { StagedEdit } from "../dml/compile";
import { TableMetadata, loadTableMetadata } from "../metadata/tableMetadata";

/** A row as the grid receives it: text values plus the cursor that addresses it. */
export interface EditRow {
    readonly values: Readonly<Record<string, string | null>>;
    /** Key values for this row, used to seek and to address it in an edit. */
    readonly cursor: PageCursor;
    /** True when at least one cell arrived clipped, so the grid can say so. */
    readonly hasTruncatedCells: boolean;
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
    readonly isNullable: boolean;
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
    /** Present when nothing was applied because one statement failed. */
    readonly failure?: EditFailure;
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
                isNullable: c.isNullable,
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

        const rows = result.rows
            .slice(0, compiled.pageSize)
            .map((raw) => this.toRow(raw, compiled.cursorColumns));
        const hasNextPage = result.rows.length > compiled.pageSize;

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
        return row ? cellToText(row[columnName] ?? null) : null;
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
        const batch: CompiledBatch = compileBatch(this.table, this.key, edits);
        try {
            await this._runner.query(batch.sql, { tag: "sqlEdit.commit" });
            return { applied: batch.statements.length };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failure = parseFailure(message, batch.statements);
            if (failure) {
                throw new EditCommitError(failure.message, failure);
            }
            throw new SqlEditError(
                `The changes were not saved, and nothing was applied. ${message}`,
                "commitFailed",
            );
        }
    }

    private toRow(raw: Record<string, CellValue>, cursorColumns: readonly string[]): EditRow {
        const values: Record<string, string | null> = {};
        let hasTruncatedCells = false;

        for (const column of this.table.columns) {
            const cell = raw[column.name];
            if (
                cell !== null &&
                typeof cell === "object" &&
                "$t" in cell &&
                cell.$t === "truncated"
            ) {
                hasTruncatedCells = true;
            }
            values[column.name] = cellToText(cell ?? null);
        }

        const cursor: Record<string, string | null> = {};
        for (const column of cursorColumns) {
            cursor[column] = values[column] ?? null;
        }

        return { values, cursor, hasTruncatedCells };
    }
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
