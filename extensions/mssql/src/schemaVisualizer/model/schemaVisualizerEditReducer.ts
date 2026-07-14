/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure edit reducer + normalization + rebase (SV-R6; addendum §7.2–§7.5).
 *
 *   canonical baseline + operation log + cursor  →  editable model
 *
 * One reducer serves manual UI edits, LM-tool edits, undo/redo (cursor
 * moves), the pre-preview rebase, AND the v1 replay input — so conflict
 * semantics are testable without React or a server.
 *
 * Application is SEQUENTIAL and STOPS at the first conflict (§7.5): a
 * later op may depend on the conflicted one, so applying past it would
 * fabricate a model no user ever saw. Nothing is ever auto-discarded —
 * the log is returned untouched alongside the conflict.
 */

import { SchemaVisualizerCatalogModel, VisualizerTable } from "./schemaVisualizerModel";
import { FkReferentialAction } from "../../services/metadata/catalogModel";
import {
    ColumnRef,
    EditConflict,
    EditTypeSpec,
    ForeignKeyRef,
    SchemaVisualizerEditOp,
    TableRef,
    columnKey,
    foreignKeyKey,
    tableKey,
} from "./schemaVisualizerEdit";

// ---------------------------------------------------------------------------
// Editable model (baseline projection + local additions)
// ---------------------------------------------------------------------------

export interface EditableColumn {
    ref: ColumnRef;
    name: string;
    typeDisplay: string;
    /** Discrete target facts for NEW/retyped columns (replay input). */
    editedType?: EditTypeSpec;
    nullable: boolean;
    /** Baseline facts preserved for correlation (§6.6). */
    baselineName?: string;
}

export interface EditableTable {
    ref: TableRef;
    schema: string;
    name: string;
    baselineSchema?: string;
    baselineName?: string;
    columns: EditableColumn[];
}

export interface EditableForeignKey {
    ref: ForeignKeyRef;
    name: string;
    fromTableKey: string;
    toTableKey: string;
    columnPairs: Array<{ fromColumnName: string; toColumnName: string }>;
    onDelete: FkReferentialAction | "UNKNOWN";
    onUpdate: FkReferentialAction | "UNKNOWN";
}

export interface EditableModel {
    caseSensitive: boolean;
    tables: Map<string, EditableTable>;
    foreignKeys: Map<string, EditableForeignKey>;
}

function tableRefOf(table: VisualizerTable): TableRef {
    return {
        kind: "existing",
        objectId: table.identity.objectId,
        baselineSchema: table.schema,
        baselineName: table.name,
    };
}

/** Baseline → editable model (pure projection; ids carry over). */
export function buildEditableModel(model: SchemaVisualizerCatalogModel): EditableModel {
    const tables = new Map<string, EditableTable>();
    const tableKeyByObjectId = new Map<number, string>();
    for (const table of model.tables) {
        const ref = tableRefOf(table);
        const key = tableKey(ref);
        tableKeyByObjectId.set(table.identity.objectId, key);
        tables.set(key, {
            ref,
            schema: table.schema,
            name: table.name,
            baselineSchema: table.schema,
            baselineName: table.name,
            columns: table.columns.map((column) => ({
                ref:
                    column.identity.columnId !== undefined
                        ? {
                              kind: "existing",
                              columnId: column.identity.columnId,
                              baselineName: column.name,
                          }
                        : // Identity-less columns are render-only; edit mode
                          // requires the columnIdentityGrade capability.
                          { kind: "new", localId: `baseline-ord-${column.ordinal}` },
                name: column.name,
                typeDisplay: column.typeDisplay,
                nullable: column.nullable,
                baselineName: column.name,
            })),
        });
    }
    const foreignKeys = new Map<string, EditableForeignKey>();
    for (const fk of model.foreignKeys) {
        const fromKey = tableKeyByObjectId.get(fk.fromObjectId);
        const toKey = tableKeyByObjectId.get(fk.toObjectId);
        if (fromKey === undefined || toKey === undefined) {
            continue; // dangling baseline edge (raced DDL) — render-only
        }
        const ref: ForeignKeyRef =
            fk.identity.constraintObjectId !== undefined
                ? {
                      kind: "existing",
                      constraintObjectId: fk.identity.constraintObjectId,
                      baselineName: fk.name,
                  }
                : { kind: "new", localId: `baseline-fk-${fk.graphId}` };
        foreignKeys.set(foreignKeyKey(ref), {
            ref,
            name: fk.name,
            fromTableKey: fromKey,
            toTableKey: toKey,
            columnPairs: fk.columnPairs.map((pair) => ({
                fromColumnName: pair.fromColumnName,
                toColumnName: pair.toColumnName,
            })),
            onDelete: fk.onDelete.state === "known" ? fk.onDelete.value : "UNKNOWN",
            onUpdate: fk.onUpdate.state === "known" ? fk.onUpdate.value : "UNKNOWN",
        });
    }
    return { caseSensitive: model.caseSensitive, tables, foreignKeys };
}

function cloneModel(model: EditableModel): EditableModel {
    return {
        caseSensitive: model.caseSensitive,
        tables: new Map(
            [...model.tables].map(([key, table]) => [
                key,
                { ...table, columns: table.columns.map((column) => ({ ...column })) },
            ]),
        ),
        foreignKeys: new Map(
            [...model.foreignKeys].map(([key, fk]) => [
                key,
                { ...fk, columnPairs: fk.columnPairs.map((pair) => ({ ...pair })) },
            ]),
        ),
    };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type ApplyResult =
    | { ok: true; model: EditableModel }
    | { ok: false; conflict: EditConflict };

function conflict(operationId: string, code: EditConflict["code"], message: string): ApplyResult {
    return { ok: false, conflict: { operationId, code, message } };
}

function namesEqual(model: EditableModel, a: string, b: string): boolean {
    return model.caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
}

function findTable(model: EditableModel, ref: TableRef): EditableTable | undefined {
    return model.tables.get(tableKey(ref));
}

function findColumn(table: EditableTable, tableRef: TableRef, ref: ColumnRef) {
    const key = columnKey(tableRef, ref);
    return table.columns.find((column) => columnKey(tableRef, column.ref) === key);
}

function duplicateTableName(
    model: EditableModel,
    schema: string,
    name: string,
    excludeKey?: string,
): boolean {
    for (const [key, table] of model.tables) {
        if (key === excludeKey) {
            continue;
        }
        if (namesEqual(model, table.schema, schema) && namesEqual(model, table.name, name)) {
            return true;
        }
    }
    return false;
}

/** Apply ONE operation. Pure: input model is never mutated. */
export function applyEdit(model: EditableModel, op: SchemaVisualizerEditOp): ApplyResult {
    const next = cloneModel(model);
    switch (op.kind) {
        case "addTable": {
            if (duplicateTableName(next, op.table.schema, op.table.name)) {
                return conflict(
                    op.operationId,
                    "duplicateName",
                    `Table ${op.table.schema}.${op.table.name} already exists.`,
                );
            }
            const ref: TableRef = { kind: "new", localId: op.table.localId };
            next.tables.set(tableKey(ref), {
                ref,
                schema: op.table.schema,
                name: op.table.name,
                columns: op.table.columns.map((column) => ({
                    ref: { kind: "new", localId: column.localId },
                    name: column.name,
                    typeDisplay: column.type.displayText,
                    editedType: column.type,
                    nullable: column.nullable,
                })),
            });
            return { ok: true, model: next };
        }
        case "dropTable": {
            const key = tableKey(op.table);
            if (!next.tables.delete(key)) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            // FKs touching the table go with it (DDL semantics: they cannot
            // survive; replay orders drops accordingly).
            for (const [fkKey, fk] of [...next.foreignKeys]) {
                if (fk.fromTableKey === key || fk.toTableKey === key) {
                    next.foreignKeys.delete(fkKey);
                }
            }
            return { ok: true, model: next };
        }
        case "renameTable": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            if (duplicateTableName(next, table.schema, op.newName, tableKey(op.table))) {
                return conflict(
                    op.operationId,
                    "duplicateName",
                    `Table ${table.schema}.${op.newName} already exists.`,
                );
            }
            table.name = op.newName;
            return { ok: true, model: next };
        }
        case "setTableSchema": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            if (duplicateTableName(next, op.newSchema, table.name, tableKey(op.table))) {
                return conflict(
                    op.operationId,
                    "duplicateName",
                    `Table ${op.newSchema}.${table.name} already exists.`,
                );
            }
            table.schema = op.newSchema;
            return { ok: true, model: next };
        }
        case "addColumn": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            if (table.columns.some((column) => namesEqual(next, column.name, op.column.name))) {
                return conflict(
                    op.operationId,
                    "duplicateName",
                    `Column ${op.column.name} already exists on ${table.name}.`,
                );
            }
            table.columns.push({
                ref: { kind: "new", localId: op.column.localId },
                name: op.column.name,
                typeDisplay: op.column.type.displayText,
                editedType: op.column.type,
                nullable: op.column.nullable,
            });
            return { ok: true, model: next };
        }
        case "dropColumn": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            const column = findColumn(table, op.table, op.column);
            if (!column) {
                return conflict(op.operationId, "columnNotFound", "Column no longer exists.");
            }
            table.columns = table.columns.filter((candidate) => candidate !== column);
            return { ok: true, model: next };
        }
        case "renameColumn": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            const column = findColumn(table, op.table, op.column);
            if (!column) {
                return conflict(op.operationId, "columnNotFound", "Column no longer exists.");
            }
            if (
                table.columns.some(
                    (candidate) =>
                        candidate !== column && namesEqual(next, candidate.name, op.newName),
                )
            ) {
                return conflict(
                    op.operationId,
                    "duplicateName",
                    `Column ${op.newName} already exists on ${table.name}.`,
                );
            }
            column.name = op.newName;
            return { ok: true, model: next };
        }
        case "setColumnType": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            const column = findColumn(table, op.table, op.column);
            if (!column) {
                return conflict(op.operationId, "columnNotFound", "Column no longer exists.");
            }
            column.editedType = op.newType;
            column.typeDisplay = op.newType.displayText;
            return { ok: true, model: next };
        }
        case "setColumnNullability": {
            const table = findTable(next, op.table);
            if (!table) {
                return conflict(op.operationId, "targetNotFound", "Table no longer exists.");
            }
            const column = findColumn(table, op.table, op.column);
            if (!column) {
                return conflict(op.operationId, "columnNotFound", "Column no longer exists.");
            }
            column.nullable = op.nullable;
            return { ok: true, model: next };
        }
        case "addForeignKey": {
            const spec = op.foreignKey;
            const fromTable = findTable(next, spec.fromTable);
            const toTable = findTable(next, spec.toTable);
            if (!fromTable || !toTable) {
                return conflict(
                    op.operationId,
                    "fkEndpointMissing",
                    `Foreign key ${spec.name}: endpoint table missing.`,
                );
            }
            const pairs: Array<{ fromColumnName: string; toColumnName: string }> = [];
            for (const pair of spec.columnPairs) {
                const fromColumn = findColumn(fromTable, spec.fromTable, pair.fromColumn);
                const toColumn = findColumn(toTable, spec.toTable, pair.toColumn);
                if (!fromColumn || !toColumn) {
                    return conflict(
                        op.operationId,
                        "fkColumnMissing",
                        `Foreign key ${spec.name}: mapped column missing.`,
                    );
                }
                pairs.push({ fromColumnName: fromColumn.name, toColumnName: toColumn.name });
            }
            const ref: ForeignKeyRef = { kind: "new", localId: spec.localId };
            next.foreignKeys.set(foreignKeyKey(ref), {
                ref,
                name: spec.name,
                fromTableKey: tableKey(spec.fromTable),
                toTableKey: tableKey(spec.toTable),
                columnPairs: pairs,
                onDelete: spec.onDelete,
                onUpdate: spec.onUpdate,
            });
            return { ok: true, model: next };
        }
        case "dropForeignKey": {
            if (!next.foreignKeys.delete(foreignKeyKey(op.foreignKey))) {
                return conflict(
                    op.operationId,
                    "foreignKeyNotFound",
                    "Foreign key no longer exists.",
                );
            }
            return { ok: true, model: next };
        }
        case "setForeignKeyActions": {
            const fk = next.foreignKeys.get(foreignKeyKey(op.foreignKey));
            if (!fk) {
                return conflict(
                    op.operationId,
                    "foreignKeyNotFound",
                    "Foreign key no longer exists.",
                );
            }
            fk.onDelete = op.onDelete;
            fk.onUpdate = op.onUpdate;
            return { ok: true, model: next };
        }
        default: {
            const unknown = op as { operationId?: string; kind?: string };
            return conflict(
                unknown.operationId ?? "unknown",
                "unsupportedOperation",
                `Operation kind '${unknown.kind}' is not supported by this release.`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Normalization (§7.4)
// ---------------------------------------------------------------------------

function touchedEntityKey(op: SchemaVisualizerEditOp): string | undefined {
    switch (op.kind) {
        case "addTable":
            return tableKey({ kind: "new", localId: op.table.localId });
        case "dropTable":
        case "renameTable":
        case "setTableSchema":
            return tableKey(op.table);
        case "addColumn":
            return columnKey(op.table, { kind: "new", localId: op.column.localId });
        case "dropColumn":
        case "renameColumn":
        case "setColumnType":
        case "setColumnNullability":
            return columnKey(op.table, op.column);
        case "addForeignKey":
            return foreignKeyKey({ kind: "new", localId: op.foreignKey.localId });
        case "dropForeignKey":
        case "setForeignKeyActions":
            return foreignKeyKey(op.foreignKey);
    }
}

/** Parent-table key for column ops (drop-table cascade). */
function parentTableKey(op: SchemaVisualizerEditOp): string | undefined {
    switch (op.kind) {
        case "addColumn":
        case "dropColumn":
        case "renameColumn":
        case "setColumnType":
        case "setColumnNullability":
            return tableKey(op.table);
        default:
            return undefined;
    }
}

const FK_KINDS: ReadonlySet<string> = new Set([
    "addForeignKey",
    "dropForeignKey",
    "setForeignKeyActions",
]);

/**
 * Normalize the log (§7.4): new-entity add+drop cancels (with intervening
 * edits), consecutive renames coalesce (original baseline retained by
 * identity-first targets), repeated property sets keep the LAST value,
 * drops cascade over later edits to the dropped entity, and FK operations
 * order after table/column structure ops. Deterministic; ids untouched.
 */
export function normalizeOperations(ops: SchemaVisualizerEditOp[]): SchemaVisualizerEditOp[] {
    const kept: (SchemaVisualizerEditOp | undefined)[] = [...ops];

    // Pass 1: add(new)+drop cancellation and drop-cascade.
    for (let i = 0; i < kept.length; i++) {
        const op = kept[i];
        if (
            op === undefined ||
            (op.kind !== "dropTable" && op.kind !== "dropForeignKey" && op.kind !== "dropColumn")
        ) {
            continue;
        }
        const droppedKey = touchedEntityKey(op)!;
        const droppedIsNew =
            (op.kind === "dropTable" && op.table.kind === "new") ||
            (op.kind === "dropColumn" && op.column.kind === "new") ||
            (op.kind === "dropForeignKey" && op.foreignKey.kind === "new");
        // Remove EARLIER edits to the same entity (they can never publish);
        // when the entity was locally created, the drop disappears too.
        for (let j = 0; j < i; j++) {
            const earlier = kept[j];
            if (earlier === undefined) {
                continue;
            }
            const earlierKey = touchedEntityKey(earlier);
            if (
                earlierKey === droppedKey ||
                (op.kind === "dropTable" && parentTableKey(earlier) === droppedKey)
            ) {
                kept[j] = undefined;
            }
        }
        if (droppedIsNew) {
            kept[i] = undefined;
        }
    }

    // Pass 2: coalesce repeated single-property ops per entity (last wins).
    const lastByEntityAndKind = new Map<string, number>();
    for (let i = 0; i < kept.length; i++) {
        const op = kept[i];
        if (op === undefined) {
            continue;
        }
        if (
            op.kind === "renameTable" ||
            op.kind === "setTableSchema" ||
            op.kind === "renameColumn" ||
            op.kind === "setColumnType" ||
            op.kind === "setColumnNullability" ||
            op.kind === "setForeignKeyActions"
        ) {
            const key = `${op.kind}|${touchedEntityKey(op)}`;
            const previous = lastByEntityAndKind.get(key);
            if (previous !== undefined) {
                kept[previous] = undefined;
            }
            lastByEntityAndKind.set(key, i);
        }
    }

    // Pass 3: stable partition — structure ops first, FK ops after (§7.4).
    const structural = kept.filter(
        (op): op is SchemaVisualizerEditOp => op !== undefined && !FK_KINDS.has(op.kind),
    );
    const fkOps = kept.filter(
        (op): op is SchemaVisualizerEditOp => op !== undefined && FK_KINDS.has(op.kind),
    );
    return [...structural, ...fkOps];
}

// ---------------------------------------------------------------------------
// Rebase (§7.5)
// ---------------------------------------------------------------------------

export type RebaseOutcome =
    | { state: "clean"; model: EditableModel }
    | { state: "conflict"; conflict: EditConflict; appliedCount: number };

/**
 * Replay a NORMALIZED log onto a baseline. Sequential; stops at the first
 * conflict (later ops may depend on it). The caller's log is never
 * mutated or discarded (§7.5 "never discard edits automatically").
 */
export function rebaseOperations(
    baseline: SchemaVisualizerCatalogModel,
    ops: SchemaVisualizerEditOp[],
): RebaseOutcome {
    let model = buildEditableModel(baseline);
    let applied = 0;
    for (const op of ops) {
        const result = applyEdit(model, op);
        if (result.ok === false) {
            return { state: "conflict", conflict: result.conflict, appliedCount: applied };
        }
        model = result.model;
        applied++;
    }
    return { state: "clean", model };
}
