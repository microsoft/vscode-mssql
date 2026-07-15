/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Table-editor draft model (SV-R8c). The editor drawer edits a DRAFT copy
 * of one table; on save the draft is diffed against the CURRENT editable
 * table into semantic ops. This diff is identity-based, never name-based:
 * every draft row carries the ColumnRef it started from, so a rename is a
 * first-class `renameColumn` (§7.3) and can never be misread as
 * drop+add — the exact ambiguity the op log exists to prevent (§5.4).
 *
 * Type changes are captured as discrete EditTypeSpec facts built by the
 * type picker; the draft never reverse-parses display text (§20).
 */

import {
    ColumnRef,
    EditTypeSpec,
    NewColumnSpec,
    SchemaVisualizerEditOp,
    TableRef,
} from "./schemaVisualizerEdit";
import { EditableTable } from "./schemaVisualizerEditReducer";

export interface TableDraftColumn {
    /** Ref of the column this row started from; "new" rows mint localIds. */
    ref: ColumnRef;
    name: string;
    /** Current display text (baseline or edited) — read-only in the UI. */
    typeDisplay: string;
    /** Set when the picker chose a (new) type for this row. */
    editedType?: EditTypeSpec;
    nullable: boolean;
}

export interface TableDraft {
    table: TableRef;
    schema: string;
    name: string;
    columns: TableDraftColumn[];
}

/** Draft for editing an existing (possibly already-edited) table. */
export function buildTableDraft(table: EditableTable): TableDraft {
    return {
        table: table.ref,
        schema: table.schema,
        name: table.name,
        columns: table.columns.map((column) => ({
            ref: column.ref,
            name: column.name,
            typeDisplay: column.editedType?.displayText ?? column.typeDisplay,
            ...(column.editedType !== undefined ? { editedType: column.editedType } : {}),
            nullable: column.nullable,
        })),
    };
}

/** Draft for a brand-new table (addTable flow). */
export function buildNewTableDraft(
    localId: string,
    schema: string,
    name: string,
    firstColumn: NewColumnSpec,
): TableDraft {
    return {
        table: { kind: "new", localId },
        schema,
        name,
        columns: [
            {
                ref: { kind: "new", localId: firstColumn.localId },
                name: firstColumn.name,
                typeDisplay: firstColumn.type.displayText,
                editedType: firstColumn.type,
                nullable: firstColumn.nullable,
            },
        ],
    };
}

function columnRefKey(ref: ColumnRef): string {
    return ref.kind === "existing" ? `c:${ref.columnId}` : `n:${ref.localId}`;
}

export interface DraftDiffResult {
    ops: SchemaVisualizerEditOp[];
    /** Human-readable refusals (e.g. empty names); save stays blocked. */
    errors: string[];
}

/**
 * Diff a saved draft against the CURRENT editable table into ops, in
 * apply-safe order (renames/retypes before drops keeps messages honest;
 * normalizeOperations coalesces later anyway). `newOperationId` mints op
 * ids (injected for deterministic tests).
 */
export function diffTableDraft(
    current: EditableTable,
    draft: TableDraft,
    newOperationId: () => string,
): DraftDiffResult {
    const ops: SchemaVisualizerEditOp[] = [];
    const errors: string[] = [];
    const table = draft.table;

    if (draft.name.trim().length === 0) {
        errors.push("Table name cannot be empty.");
    }
    if (draft.schema.trim().length === 0) {
        errors.push("Schema cannot be empty.");
    }
    const seenNames = new Set<string>();
    for (const column of draft.columns) {
        if (column.name.trim().length === 0) {
            errors.push("Column names cannot be empty.");
            break;
        }
        const key = column.name.trim().toLowerCase();
        if (seenNames.has(key)) {
            errors.push(`Duplicate column name "${column.name.trim()}".`);
            break;
        }
        seenNames.add(key);
    }
    if (draft.columns.length === 0) {
        errors.push("A table needs at least one column.");
    }
    if (errors.length > 0) {
        return { ops: [], errors };
    }

    if (draft.name.trim() !== current.name) {
        ops.push({
            version: 1,
            operationId: newOperationId(),
            kind: "renameTable",
            table,
            newName: draft.name.trim(),
        });
    }
    if (draft.schema.trim() !== current.schema) {
        ops.push({
            version: 1,
            operationId: newOperationId(),
            kind: "setTableSchema",
            table,
            newSchema: draft.schema.trim(),
        });
    }

    const draftByRef = new Map(draft.columns.map((column) => [columnRefKey(column.ref), column]));
    for (const column of current.columns) {
        const draftColumn = draftByRef.get(columnRefKey(column.ref));
        if (draftColumn === undefined) {
            ops.push({
                version: 1,
                operationId: newOperationId(),
                kind: "dropColumn",
                table,
                column: column.ref,
            });
            continue;
        }
        if (draftColumn.name.trim() !== column.name) {
            ops.push({
                version: 1,
                operationId: newOperationId(),
                kind: "renameColumn",
                table,
                column: column.ref,
                newName: draftColumn.name.trim(),
            });
        }
        const currentDisplay = column.editedType?.displayText ?? column.typeDisplay;
        if (
            draftColumn.editedType !== undefined &&
            draftColumn.editedType.displayText !== currentDisplay
        ) {
            ops.push({
                version: 1,
                operationId: newOperationId(),
                kind: "setColumnType",
                table,
                column: column.ref,
                newType: draftColumn.editedType,
                beforeDisplayText: currentDisplay,
            });
        }
        if (draftColumn.nullable !== column.nullable) {
            ops.push({
                version: 1,
                operationId: newOperationId(),
                kind: "setColumnNullability",
                table,
                column: column.ref,
                nullable: draftColumn.nullable,
            });
        }
    }
    const currentKeys = new Set(current.columns.map((column) => columnRefKey(column.ref)));
    for (const draftColumn of draft.columns) {
        if (currentKeys.has(columnRefKey(draftColumn.ref))) {
            continue;
        }
        if (draftColumn.ref.kind !== "new") {
            continue; // an existing ref that vanished from current — stale draft
        }
        if (draftColumn.editedType === undefined) {
            errors.push(`New column "${draftColumn.name}" needs a type.`);
            continue;
        }
        ops.push({
            version: 1,
            operationId: newOperationId(),
            kind: "addColumn",
            table,
            column: {
                localId: draftColumn.ref.localId,
                name: draftColumn.name.trim(),
                type: draftColumn.editedType,
                nullable: draftColumn.nullable,
            },
        });
    }
    if (errors.length > 0) {
        return { ops: [], errors };
    }
    return { ops, errors };
}

/** Ops for saving a NEW table draft (single addTable op). */
export function newTableDraftToOps(
    draft: TableDraft,
    newOperationId: () => string,
): DraftDiffResult {
    const errors: string[] = [];
    if (draft.table.kind !== "new") {
        return { ops: [], errors: ["Not a new-table draft."] };
    }
    if (draft.name.trim().length === 0) {
        errors.push("Table name cannot be empty.");
    }
    if (draft.schema.trim().length === 0) {
        errors.push("Schema cannot be empty.");
    }
    if (draft.columns.length === 0) {
        errors.push("A table needs at least one column.");
    }
    const columns: NewColumnSpec[] = [];
    const seenNames = new Set<string>();
    for (const column of draft.columns) {
        if (column.ref.kind !== "new") {
            errors.push("New tables can only contain new columns.");
            break;
        }
        if (column.name.trim().length === 0) {
            errors.push("Column names cannot be empty.");
            break;
        }
        const key = column.name.trim().toLowerCase();
        if (seenNames.has(key)) {
            errors.push(`Duplicate column name "${column.name.trim()}".`);
            break;
        }
        seenNames.add(key);
        if (column.editedType === undefined) {
            errors.push(`New column "${column.name}" needs a type.`);
            break;
        }
        columns.push({
            localId: column.ref.localId,
            name: column.name.trim(),
            type: column.editedType,
            nullable: column.nullable,
        });
    }
    if (errors.length > 0) {
        return { ops: [], errors };
    }
    return {
        ops: [
            {
                version: 1,
                operationId: newOperationId(),
                kind: "addTable",
                table: {
                    localId: draft.table.localId,
                    schema: draft.schema.trim(),
                    name: draft.name.trim(),
                    columns,
                },
            },
        ],
        errors: [],
    };
}

// ---------------------------------------------------------------------------
// Type picker facts (discrete — the UI builds display text from parts)
// ---------------------------------------------------------------------------

export interface TypePickerEntry {
    typeName: string;
    lengthKind: "none" | "length" | "lengthOrMax" | "precisionScale";
}

/** Common editable target types (v1 picker; DacFx validates the rest). */
export const TYPE_PICKER_ENTRIES: readonly TypePickerEntry[] = [
    { typeName: "int", lengthKind: "none" },
    { typeName: "bigint", lengthKind: "none" },
    { typeName: "smallint", lengthKind: "none" },
    { typeName: "tinyint", lengthKind: "none" },
    { typeName: "bit", lengthKind: "none" },
    { typeName: "decimal", lengthKind: "precisionScale" },
    { typeName: "numeric", lengthKind: "precisionScale" },
    { typeName: "money", lengthKind: "none" },
    { typeName: "float", lengthKind: "none" },
    { typeName: "real", lengthKind: "none" },
    { typeName: "date", lengthKind: "none" },
    { typeName: "time", lengthKind: "none" },
    { typeName: "datetime", lengthKind: "none" },
    { typeName: "datetime2", lengthKind: "none" },
    { typeName: "datetimeoffset", lengthKind: "none" },
    { typeName: "char", lengthKind: "length" },
    { typeName: "varchar", lengthKind: "lengthOrMax" },
    { typeName: "nchar", lengthKind: "length" },
    { typeName: "nvarchar", lengthKind: "lengthOrMax" },
    { typeName: "binary", lengthKind: "length" },
    { typeName: "varbinary", lengthKind: "lengthOrMax" },
    { typeName: "uniqueidentifier", lengthKind: "none" },
    { typeName: "xml", lengthKind: "none" },
];

/** Build discrete type facts + display text from picker inputs. */
export function buildTypeSpec(
    typeName: string,
    options?: { length?: number | "max"; precision?: number; scale?: number },
): EditTypeSpec {
    const entry = TYPE_PICKER_ENTRIES.find((candidate) => candidate.typeName === typeName);
    const kind = entry?.lengthKind ?? "none";
    if ((kind === "length" || kind === "lengthOrMax") && options?.length !== undefined) {
        return {
            displayText: `${typeName}(${options.length})`,
            typeName,
            length: options.length,
        };
    }
    if (kind === "precisionScale" && options?.precision !== undefined) {
        const scale = options.scale ?? 0;
        return {
            displayText: `${typeName}(${options.precision},${scale})`,
            typeName,
            precision: options.precision,
            scale,
        };
    }
    return { displayText: typeName, typeName };
}
