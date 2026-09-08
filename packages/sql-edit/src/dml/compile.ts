/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compiles staged edits into statements.
 *
 * Two rules shape everything here. A statement must address exactly one row, and it must refuse
 * to run if the row changed since it was read. The old editor guaranteed neither: it matched on
 * key columns only, so a concurrent change was overwritten without anyone noticing, and it
 * discovered ambiguity only when the server happened to update more rows than intended.
 *
 * The same compiler produces the script the UI previews and the batch that executes, so a
 * preview can never describe something different from what runs.
 */

import { ColumnMetadata, TableMetadata } from "../metadata/tableMetadata";
import { Sql, SqlEditError, qualifiedName, quoteName, stringLiteral } from "../core/sql";
import { EditValue, encodeComparisonValue, encodeValue } from "../types/valueCodec";
import { KeyStrategy } from "../metadata/keyStrategy";
import { isComparableType } from "../types/typeTraits";

export type EditKind = "insert" | "update" | "delete";

export interface StagedEdit {
    /** Client-side id, echoed back so a failure can name the row the user is looking at. */
    readonly rowId: number;
    readonly kind: EditKind;
    /** Values the user typed, by column name. Only changed columns for an update. */
    readonly values?: Readonly<Record<string, EditValue>>;
    /**
     * The row as it was read, by column name. Used to address the row and to detect a
     * concurrent change. Absent for an insert.
     */
    readonly original?: Readonly<Record<string, EditValue>>;
}

export interface CompiledStatement {
    readonly rowId: number;
    readonly kind: EditKind;
    readonly sql: string;
    /** True when the statement's own guard is what enforces single-row addressing. */
    readonly guarded: boolean;
}

/** Memory-optimized tables require a snapshot hint or the statement fails at run time. */
function tableHint(table: TableMetadata): string {
    return table.isMemoryOptimized ? " WITH (SNAPSHOT)" : "";
}

/**
 * Builds the predicate that addresses one row.
 *
 * The key columns locate the row. When the table also has a rowversion, that single column is
 * the concurrency token and nothing else is needed. Otherwise the original values of the
 * columns being written are added, so an edit only applies if those columns still hold what the
 * user saw. Comparing every column instead would make any unrelated change elsewhere in the row
 * block the edit, which is stricter than anyone wants.
 */
export function compileRowPredicate(
    table: TableMetadata,
    key: KeyStrategy,
    edit: StagedEdit,
    concurrencyColumns: readonly string[],
): Sql {
    const original = edit.original;
    if (!original) {
        throw new SqlEditError("This edit has no original row to match on.", "invalidValue");
    }
    const byName = new Map(table.columns.map((c) => [c.name, c]));
    const terms: string[] = [];

    const addTerm = (columnName: string) => {
        const column = byName.get(columnName);
        if (!column) {
            throw new SqlEditError(`There is no column named "${columnName}".`, "invalidValue");
        }
        const value = original[columnName];
        const name = quoteName(columnName);
        if (value === undefined || value === null) {
            terms.push(`${name} IS NULL`);
            return;
        }
        terms.push(`${name} = ${encodeComparisonValue(value, column, columnName)}`);
    };

    for (const columnName of key.columns) {
        addTerm(columnName);
    }
    for (const columnName of concurrencyColumns) {
        if (!key.columns.includes(columnName)) {
            addTerm(columnName);
        }
    }

    if (terms.length === 0) {
        throw new SqlEditError(
            "This row cannot be addressed, because the table offers nothing to match on.",
            "noKey",
        );
    }
    return terms.join(" AND ");
}

/**
 * Columns whose original value guards the edit.
 *
 * A rowversion is preferred because it is one narrow column that changes on every write, so the
 * check is both cheap and complete. Without one, the columns being written are used.
 */
export function concurrencyColumnsFor(table: TableMetadata, edit: StagedEdit): string[] {
    if (table.rowVersionColumn) {
        return [table.rowVersionColumn];
    }
    if (edit.kind === "delete") {
        // A delete writes nothing, so there is no narrower set than the whole comparable row.
        return table.columns
            .filter((c) => !c.isComputed && c.name !== undefined)
            .map((c) => c.name)
            .filter((name) => !isUncomparable(table, name));
    }
    return Object.keys(edit.values ?? {}).filter((name) => !isUncomparable(table, name));
}

function isUncomparable(table: TableMetadata, columnName: string): boolean {
    const column = table.columns.find((c) => c.name === columnName);
    return column ? !isComparableType(column.typeName) : true;
}

function writableColumn(table: TableMetadata, name: string): ColumnMetadata {
    const column = table.columns.find((c) => c.name === name);
    if (!column) {
        throw new SqlEditError(`There is no column named "${name}".`, "invalidValue");
    }
    if (!column.isWritable) {
        const reason = column.isComputed
            ? "is computed"
            : column.isIdentity
              ? "is an identity column"
              : "is maintained by the server";
        throw new SqlEditError(
            `Column "${name}" ${reason} and cannot be edited.`,
            "unsupportedType",
        );
    }
    return column;
}

/**
 * Wraps a statement in a guard that refuses to touch more than one row.
 *
 * Written as a check after the fact rather than a count before it: counting first would let a
 * concurrent insert slip in between the count and the write. `@@ROWCOUNT` describes what the
 * statement actually did, and `THROW` inside a transaction with XACT_ABORT rolls the whole
 * batch back.
 */
function guard(sql: string, edit: StagedEdit, expectation: string): string {
    const message = stringLiteral(`sql-edit:${edit.rowId}:${edit.kind}:${expectation}`);
    return `${sql};
IF @@ROWCOUNT <> 1
BEGIN
    DECLARE @m${edit.rowId} nvarchar(400) = ${message};
    THROW 51000, @m${edit.rowId}, 1;
END`;
}

export function compileInsert(table: TableMetadata, edit: StagedEdit): CompiledStatement {
    const values = edit.values ?? {};
    const names = Object.keys(values);
    const target = `${qualifiedName(table.schema, table.name)}${tableHint(table)}`;

    if (names.length === 0) {
        // Every column is defaultable, so an empty insert is legitimate and needs its own form.
        return {
            rowId: edit.rowId,
            kind: "insert",
            sql: guard(`INSERT INTO ${target} DEFAULT VALUES`, edit, "insert"),
            guarded: true,
        };
    }

    const columns = names.map((n) => quoteName(writableColumn(table, n).name)).join(", ");
    const literals = names
        .map((n) => encodeValue(values[n], writableColumn(table, n), n))
        .join(", ");

    return {
        rowId: edit.rowId,
        kind: "insert",
        sql: guard(`INSERT INTO ${target} (${columns}) VALUES (${literals})`, edit, "insert"),
        guarded: true,
    };
}

export function compileUpdate(
    table: TableMetadata,
    key: KeyStrategy,
    edit: StagedEdit,
): CompiledStatement {
    const values = edit.values ?? {};
    const names = Object.keys(values);
    if (names.length === 0) {
        throw new SqlEditError("This row has no changes to save.", "invalidValue");
    }

    const assignments = names
        .map(
            (n) =>
                `${quoteName(writableColumn(table, n).name)} = ${encodeValue(values[n], writableColumn(table, n), n)}`,
        )
        .join(", ");
    const predicate = compileRowPredicate(table, key, edit, concurrencyColumnsFor(table, edit));
    const target = `${qualifiedName(table.schema, table.name)}${tableHint(table)}`;

    return {
        rowId: edit.rowId,
        kind: "update",
        sql: guard(`UPDATE ${target} SET ${assignments} WHERE ${predicate}`, edit, "update"),
        guarded: true,
    };
}

export function compileDelete(
    table: TableMetadata,
    key: KeyStrategy,
    edit: StagedEdit,
): CompiledStatement {
    const predicate = compileRowPredicate(table, key, edit, concurrencyColumnsFor(table, edit));
    const target = `${qualifiedName(table.schema, table.name)}${tableHint(table)}`;
    return {
        rowId: edit.rowId,
        kind: "delete",
        sql: guard(`DELETE FROM ${target} WHERE ${predicate}`, edit, "delete"),
        guarded: true,
    };
}

export function compileEdit(
    table: TableMetadata,
    key: KeyStrategy,
    edit: StagedEdit,
): CompiledStatement {
    switch (edit.kind) {
        case "insert":
            return compileInsert(table, edit);
        case "update":
            return compileUpdate(table, key, edit);
        case "delete":
            return compileDelete(table, key, edit);
    }
}

/**
 * Orders edits so they cannot deadlock or violate a constraint against each other.
 *
 * Deletes run first to free unique values, then updates, then inserts that may reuse them.
 * Within a kind the client's row order is kept so a failure maps to a predictable row.
 */
const KIND_ORDER: Record<EditKind, number> = { delete: 0, update: 1, insert: 2 };

export function orderEdits(edits: readonly StagedEdit[]): StagedEdit[] {
    return [...edits].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.rowId - b.rowId);
}
