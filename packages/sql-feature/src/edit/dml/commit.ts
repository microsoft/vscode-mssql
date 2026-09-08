/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Assembles staged edits into one atomic batch.
 *
 * The old editor sent each row edit as its own command with an explicit note that transactions
 * were still to do, so a failure halfway through left the earlier rows applied and no way back.
 * Here every statement rides in one transaction in one round trip: either the whole save happens
 * or none of it does.
 *
 * `SET XACT_ABORT ON` is what makes that true. Without it a statement that fails inside a
 * transaction can leave the transaction open and the batch continuing, which is how partially
 * applied saves happen in practice.
 */

import {
    CompileBatchOptions,
    CompiledStatement,
    EditKind,
    StagedEdit,
    compileEdit,
    orderEdits,
} from "./compile";
import { SqlEditError, comment } from "../core/sql";
import { KeyStrategy } from "../metadata/keyStrategy";
import { TableMetadata } from "../metadata/tableMetadata";

export interface CompiledBatch {
    readonly sql: string;
    readonly statements: readonly CompiledStatement[];
}

/** What a guard failure means, decoded from the error the batch raises. */
export interface EditFailure {
    readonly rowId: number;
    readonly kind: EditKind;
    /** `notFound` when nothing matched, `ambiguous` when more than one row did. */
    readonly reason: "changedOrDeleted" | "ambiguous" | "unknown";
    readonly message: string;
}

/**
 * Builds the batch.
 *
 * Statements are separated by blank lines and each is preceded by a comment naming the row, so
 * the generated script stays readable when a user copies it out to run themselves.
 */
export function compileBatch(
    table: TableMetadata,
    key: KeyStrategy,
    edits: readonly StagedEdit[],
    options?: CompileBatchOptions,
): CompiledBatch {
    if (edits.length === 0) {
        throw new SqlEditError("There are no changes to save.", "invalidValue");
    }
    if (!key.canEdit) {
        throw new SqlEditError(key.explanation, "noKey");
    }

    const hasObservations = (options?.observationColumns?.length ?? 0) > 0;
    const observationTarget = "@sql_edit_observations";
    const statementOptions = hasObservations ? { ...options, observationTarget } : options;
    const statements = orderEdits(edits).map((edit) =>
        compileEdit(table, key, edit, statementOptions),
    );
    const body = statements
        .map((s) => `${comment(`row ${s.rowId}: ${s.kind}`)}\n${s.sql}`)
        .join("\n\n");
    const observationDeclaration = hasObservations
        ? `${observationTableDeclaration(table, options!.observationColumns!)}\n\n`
        : "";
    const observationSelect = hasObservations
        ? `\n\n${observationSelectSql(options!.observationColumns!)}`
        : "";

    const sql = `SET XACT_ABORT ON;
SET NOCOUNT OFF;
BEGIN TRANSACTION;

${observationDeclaration}${body}

COMMIT TRANSACTION;${observationSelect}`;

    return { sql, statements };
}

function observationTableDeclaration(table: TableMetadata, columns: readonly string[]): string {
    const byName = new Map(table.columns.map((column) => [column.name, column]));
    const definitions = columns.map((name, index) => {
        const column = byName.get(name);
        if (!column) {
            throw new SqlEditError(`There is no column named "${name}".`, "invalidValue");
        }
        return `${quoteObservationName(index)} ${observationType(column)}`;
    });
    return `DECLARE @sql_edit_observations TABLE (\n    [__sql_edit_row_id] bigint NOT NULL,\n    [__sql_edit_kind] nvarchar(6) NOT NULL,\n    ${definitions.join(",\n    ")}\n);`;
}

function observationSelectSql(columns: readonly string[]): string {
    const keyColumns = columns.map((_, index) => quoteObservationName(index)).join(", ");
    return `SELECT [__sql_edit_row_id], [__sql_edit_kind], ${keyColumns}\nFROM @sql_edit_observations\nORDER BY [__sql_edit_row_id];`;
}

function quoteObservationName(index: number): string {
    return `[__sql_edit_key_${index}]`;
}

function observationType(column: TableMetadata["columns"][number]): string {
    const type = column.typeName.toLowerCase();
    switch (type) {
        case "char":
        case "varchar":
            return `${type}(${lengthFor(column.maxLength)})`;
        case "nchar":
        case "nvarchar":
            return `${type}(${lengthFor(column.maxLength === -1 ? -1 : numberOrDefault(column.maxLength) / 2)})`;
        case "binary":
        case "varbinary":
            return `${type}(${lengthFor(column.maxLength)})`;
        case "decimal":
        case "numeric":
            return `${type}(${numberOrDefault(column.precision, 38)},${numberOrDefault(column.scale)})`;
        case "datetime2":
        case "datetimeoffset":
        case "time":
            return `${type}(${numberOrDefault(column.scale, 7)})`;
        case "timestamp":
        case "rowversion":
            return "binary(8)";
        case "bigint":
        case "int":
        case "smallint":
        case "tinyint":
        case "bit":
        case "date":
        case "datetime":
        case "smalldatetime":
        case "float":
        case "real":
        case "money":
        case "smallmoney":
        case "uniqueidentifier":
            return type;
        default:
            throw new SqlEditError(
                `Column "${column.name}" has a key type that cannot be returned safely after saving.`,
                "unsupportedType",
            );
    }
}

function lengthFor(length: number | undefined): string {
    return length === -1 ? "max" : String(Math.max(1, Math.floor(length ?? 1)));
}

function numberOrDefault(value: number | undefined, fallback = 0): number {
    return Number.isFinite(value) ? Math.floor(value!) : fallback;
}

/**
 * The script a user sees in the preview pane.
 *
 * Identical to what executes apart from the transaction wrapper being spelled out, because a
 * preview that differs from the statement is worse than no preview at all.
 */
export function scriptBatch(
    table: TableMetadata,
    key: KeyStrategy,
    edits: readonly StagedEdit[],
): string {
    return compileBatch(table, key, edits).sql;
}

/**
 * Reads a guard failure out of a server error.
 *
 * The guard raises a message tagged with the row id and kind, so a failed save can point at the
 * row in the grid instead of reporting a bare SQL error. Anything unrecognised is passed
 * through untouched rather than being reshaped into a guess.
 */
export function parseFailure(
    message: string,
    statements: readonly CompiledStatement[],
): EditFailure | undefined {
    const match = /sql-edit:(\d+):(insert|update|delete):(\w+)/.exec(message);
    if (!match) {
        return undefined;
    }
    const rowId = Number(match[1]);
    const kind = match[2] as EditKind;
    const known = statements.some((s) => s.rowId === rowId);
    if (!known) {
        return undefined;
    }

    // An insert that affects no rows means the insert itself failed; for an update or delete it
    // means the row is gone or was changed by someone else after it was read.
    const reason = kind === "insert" ? "unknown" : "changedOrDeleted";
    return {
        rowId,
        kind,
        reason,
        message:
            kind === "insert"
                ? "The row could not be inserted."
                : "This row changed on the server after it was loaded, so the edit was not applied. Refresh to see the current values.",
    };
}
