/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay the normalized edit log onto a FRESH v1 baseline (SV-R8;
 * addendum §6.6, §4.5). The `createSession` response is the final replay
 * baseline: correlation targets THAT schema, untouched entities are
 * copied from it VERBATIM (the metadata projection and the DacFx
 * projection are not identical — copying ours would fabricate diffs),
 * and every id sent to STS is a valid GUID from the v1 baseline or a
 * freshly minted UUID for locally created entities.
 *
 * Correlation rules (§6.6):
 * - exact (schema, name) match first; case-insensitive fallback ONLY on
 *   case-insensitive databases;
 * - explicit rename ops preserve old identity (ops target BASELINE names);
 * - ambiguity or absence is a HARD typed conflict — never a guess;
 * - what we send MUST represent the user's designer intent (D14): the
 *   DacFx report stays the safety net, not the excuse.
 *
 * FK action mapping is an EXPLICIT switch: the catalog string union and
 * the legacy OnAction enum ORDER DISAGREE (0/1 swapped) — a cast would
 * silently swap CASCADE and NO_ACTION (§5.5).
 */

import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";
import { FkReferentialAction } from "../../services/metadata/catalogModel";
import {
    ColumnRef,
    EditTypeSpec,
    ForeignKeyRef,
    NewColumnSpec,
    SchemaVisualizerEditOp,
    TableRef,
} from "../model/schemaVisualizerEdit";

export type ReplayConflictCode =
    | "correlationNotFound"
    | "correlationAmbiguous"
    | "fkEndpointMissing"
    | "fkColumnMissing"
    | "duplicateName"
    | "unsupportedOperation";

export interface ReplayConflict {
    operationId?: string;
    code: ReplayConflictCode;
    /** Entity names allowed (user-facing); never SQL text or secrets. */
    message: string;
}

export interface ReplayCounts {
    operations: number;
    correlatedTables: number;
    createdTables: number;
}

export type ReplayResult =
    | { ok: true; schema: SchemaDesigner.Schema; counts: ReplayCounts }
    | { ok: false; conflict: ReplayConflict };

/** Explicit string→enum mapping (§5.5 — NEVER a numeric cast). */
export function toOnAction(action: FkReferentialAction): SchemaDesigner.OnAction {
    switch (action) {
        case "CASCADE":
            return SchemaDesigner.OnAction.CASCADE;
        case "NO_ACTION":
            return SchemaDesigner.OnAction.NO_ACTION;
        case "SET_NULL":
            return SchemaDesigner.OnAction.SET_NULL;
        case "SET_DEFAULT":
            return SchemaDesigner.OnAction.SET_DEFAULT;
    }
}

export interface ReplayOptions {
    caseSensitive: boolean;
    /** Injectable for deterministic tests; production = crypto.randomUUID. */
    newId: () => string;
}

function deepCopySchema(schema: SchemaDesigner.Schema): SchemaDesigner.Schema {
    return JSON.parse(JSON.stringify(schema)) as SchemaDesigner.Schema;
}

class Correlator {
    /** local table key (tableKey semantics) → v1 table object. */
    private tableByRefKey = new Map<string, SchemaDesigner.Table>();
    private fkByRefKey = new Map<
        string,
        { table: SchemaDesigner.Table; fk: SchemaDesigner.ForeignKey }
    >();
    private columnByRefKey = new Map<string, SchemaDesigner.Column>();

    constructor(
        private readonly schema: SchemaDesigner.Schema,
        private readonly options: ReplayOptions,
    ) {}

    private namesEqual(a: string, b: string): boolean {
        return this.options.caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
    }

    private refKeyOfTable(ref: TableRef): string {
        return ref.kind === "existing" ? `t:${ref.objectId}` : `tn:${ref.localId}`;
    }

    private refKeyOfColumn(table: TableRef, ref: ColumnRef): string {
        const base = this.refKeyOfTable(table);
        return ref.kind === "existing" ? `${base}|c:${ref.columnId}` : `${base}|cn:${ref.localId}`;
    }

    private refKeyOfFk(ref: ForeignKeyRef): string {
        return ref.kind === "existing" ? `fk:${ref.constraintObjectId}` : `fkn:${ref.localId}`;
    }

    registerNewTable(localId: string, table: SchemaDesigner.Table): void {
        this.tableByRefKey.set(`tn:${localId}`, table);
    }

    registerNewColumn(table: TableRef, localId: string, column: SchemaDesigner.Column): void {
        this.columnByRefKey.set(`${this.refKeyOfTable(table)}|cn:${localId}`, column);
    }

    registerNewFk(
        localId: string,
        table: SchemaDesigner.Table,
        fk: SchemaDesigner.ForeignKey,
    ): void {
        this.fkByRefKey.set(`fkn:${localId}`, { table, fk });
    }

    table(ref: TableRef, operationId: string): SchemaDesigner.Table | ReplayConflict {
        const key = this.refKeyOfTable(ref);
        const cached = this.tableByRefKey.get(key);
        if (cached) {
            return cached;
        }
        if (ref.kind === "new") {
            return {
                operationId,
                code: "correlationNotFound",
                message: "Locally created table was not registered before use.",
            };
        }
        // §6.6: exact match first; case-insensitive fallback only on CI DBs.
        const exact = this.schema.tables.filter(
            (table) => table.schema === ref.baselineSchema && table.name === ref.baselineName,
        );
        const candidates =
            exact.length > 0
                ? exact
                : this.options.caseSensitive
                  ? []
                  : this.schema.tables.filter(
                        (table) =>
                            this.namesEqual(table.schema, ref.baselineSchema) &&
                            this.namesEqual(table.name, ref.baselineName),
                    );
        if (candidates.length === 0) {
            return {
                operationId,
                code: "correlationNotFound",
                message: `Table ${ref.baselineSchema}.${ref.baselineName} no longer exists in the live database.`,
            };
        }
        if (candidates.length > 1) {
            return {
                operationId,
                code: "correlationAmbiguous",
                message: `Table ${ref.baselineSchema}.${ref.baselineName} matches more than one live table.`,
            };
        }
        this.tableByRefKey.set(key, candidates[0]);
        return candidates[0];
    }

    column(
        tableRef: TableRef,
        table: SchemaDesigner.Table,
        ref: ColumnRef,
        operationId: string,
    ): SchemaDesigner.Column | ReplayConflict {
        const key = this.refKeyOfColumn(tableRef, ref);
        const cached = this.columnByRefKey.get(key);
        if (cached) {
            return cached;
        }
        if (ref.kind === "new") {
            return {
                operationId,
                code: "correlationNotFound",
                message: "Locally created column was not registered before use.",
            };
        }
        const exact = table.columns.filter((column) => column.name === ref.baselineName);
        const candidates =
            exact.length > 0
                ? exact
                : this.options.caseSensitive
                  ? []
                  : table.columns.filter((column) =>
                        this.namesEqual(column.name, ref.baselineName),
                    );
        if (candidates.length === 0) {
            return {
                operationId,
                code: "correlationNotFound",
                message: `Column ${ref.baselineName} no longer exists on ${table.schema}.${table.name}.`,
            };
        }
        if (candidates.length > 1) {
            return {
                operationId,
                code: "correlationAmbiguous",
                message: `Column ${ref.baselineName} matches more than one live column on ${table.schema}.${table.name}.`,
            };
        }
        this.columnByRefKey.set(key, candidates[0]);
        return candidates[0];
    }

    foreignKey(
        ref: ForeignKeyRef,
        operationId: string,
    ): { table: SchemaDesigner.Table; fk: SchemaDesigner.ForeignKey } | ReplayConflict {
        const key = this.refKeyOfFk(ref);
        const cached = this.fkByRefKey.get(key);
        if (cached) {
            return cached;
        }
        if (ref.kind === "new") {
            return {
                operationId,
                code: "correlationNotFound",
                message: "Locally created foreign key was not registered before use.",
            };
        }
        const matches: Array<{ table: SchemaDesigner.Table; fk: SchemaDesigner.ForeignKey }> = [];
        for (const table of this.schema.tables) {
            for (const fk of table.foreignKeys) {
                if (
                    fk.name === ref.baselineName ||
                    (!this.options.caseSensitive && this.namesEqual(fk.name, ref.baselineName))
                ) {
                    matches.push({ table, fk });
                }
            }
        }
        const exact = matches.filter((match) => match.fk.name === ref.baselineName);
        const chosen = exact.length > 0 ? exact : matches;
        if (chosen.length === 0) {
            return {
                operationId,
                code: "correlationNotFound",
                message: `Foreign key ${ref.baselineName} no longer exists in the live database.`,
            };
        }
        if (chosen.length > 1) {
            return {
                operationId,
                code: "correlationAmbiguous",
                message: `Foreign key ${ref.baselineName} matches more than one live constraint.`,
            };
        }
        this.fkByRefKey.set(key, chosen[0]);
        return chosen[0];
    }
}

function isConflict(value: unknown): value is ReplayConflict {
    return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function legacyColumnFromSpec(spec: NewColumnSpec, options: ReplayOptions): SchemaDesigner.Column {
    return {
        id: options.newId(),
        name: spec.name,
        dataType: spec.type.typeName,
        maxLength: typeSpecMaxLength(spec.type),
        precision: spec.type.precision ?? 0,
        scale: spec.type.scale ?? 0,
        isPrimaryKey: false,
        isIdentity: false,
        identitySeed: 0,
        identityIncrement: 0,
        isNullable: spec.nullable,
        defaultValue: "",
        isComputed: false,
        computedFormula: "",
        computedPersisted: false,
    };
}

function typeSpecMaxLength(type: EditTypeSpec): string {
    if (type.length === undefined) {
        return "";
    }
    return type.length === "max" ? "max" : String(type.length);
}

function applyTypeSpec(column: SchemaDesigner.Column, type: EditTypeSpec): void {
    column.dataType = type.typeName;
    column.maxLength = typeSpecMaxLength(type);
    column.precision = type.precision ?? 0;
    column.scale = type.scale ?? 0;
}

/**
 * Replay a NORMALIZED op log onto a deep copy of the v1 baseline. Fails
 * (typed) on the first correlation or structural conflict — publish never
 * proceeds past a schema that stopped representing the user's intent.
 */
export function replayEditsToLegacySchema(
    baseline: SchemaDesigner.Schema,
    ops: SchemaVisualizerEditOp[],
    options: ReplayOptions,
): ReplayResult {
    const schema = deepCopySchema(baseline);
    const correlator = new Correlator(schema, options);
    const counts: ReplayCounts = {
        operations: ops.length,
        correlatedTables: 0,
        createdTables: 0,
    };
    const fail = (conflict: ReplayConflict): ReplayResult => ({ ok: false, conflict });

    for (const op of ops) {
        switch (op.kind) {
            case "addTable": {
                const table: SchemaDesigner.Table = {
                    id: options.newId(),
                    name: op.table.name,
                    schema: op.table.schema,
                    columns: [],
                    foreignKeys: [],
                };
                for (const columnSpec of op.table.columns) {
                    const column = legacyColumnFromSpec(columnSpec, options);
                    table.columns.push(column);
                    correlator.registerNewColumn(
                        { kind: "new", localId: op.table.localId },
                        columnSpec.localId,
                        column,
                    );
                }
                schema.tables.push(table);
                correlator.registerNewTable(op.table.localId, table);
                counts.createdTables++;
                break;
            }
            case "dropTable": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                schema.tables = schema.tables.filter((candidate) => candidate !== table);
                for (const other of schema.tables) {
                    other.foreignKeys = other.foreignKeys.filter(
                        (fk) => fk.referencedTableId !== table.id,
                    );
                }
                counts.correlatedTables++;
                break;
            }
            case "renameTable": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                table.name = op.newName;
                counts.correlatedTables++;
                break;
            }
            case "setTableSchema": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                table.schema = op.newSchema;
                counts.correlatedTables++;
                break;
            }
            case "addColumn": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                const column = legacyColumnFromSpec(op.column, options);
                table.columns.push(column);
                correlator.registerNewColumn(op.table, op.column.localId, column);
                break;
            }
            case "dropColumn": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                const column = correlator.column(op.table, table, op.column, op.operationId);
                if (isConflict(column)) {
                    return fail(column);
                }
                table.columns = table.columns.filter((candidate) => candidate !== column);
                break;
            }
            case "renameColumn": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                const column = correlator.column(op.table, table, op.column, op.operationId);
                if (isConflict(column)) {
                    return fail(column);
                }
                column.name = op.newName;
                break;
            }
            case "setColumnType": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                const column = correlator.column(op.table, table, op.column, op.operationId);
                if (isConflict(column)) {
                    return fail(column);
                }
                applyTypeSpec(column, op.newType);
                break;
            }
            case "setColumnNullability": {
                const table = correlator.table(op.table, op.operationId);
                if (isConflict(table)) {
                    return fail(table);
                }
                const column = correlator.column(op.table, table, op.column, op.operationId);
                if (isConflict(column)) {
                    return fail(column);
                }
                column.isNullable = op.nullable;
                break;
            }
            case "addForeignKey": {
                const spec = op.foreignKey;
                const fromTable = correlator.table(spec.fromTable, op.operationId);
                if (isConflict(fromTable)) {
                    return fail(fromTable);
                }
                const toTable = correlator.table(spec.toTable, op.operationId);
                if (isConflict(toTable)) {
                    return fail(toTable);
                }
                const columnsIds: string[] = [];
                const referencedColumnsIds: string[] = [];
                for (const pair of spec.columnPairs) {
                    const fromColumn = correlator.column(
                        spec.fromTable,
                        fromTable,
                        pair.fromColumn,
                        op.operationId,
                    );
                    if (isConflict(fromColumn)) {
                        return fail(fromColumn);
                    }
                    const toColumn = correlator.column(
                        spec.toTable,
                        toTable,
                        pair.toColumn,
                        op.operationId,
                    );
                    if (isConflict(toColumn)) {
                        return fail(toColumn);
                    }
                    columnsIds.push(fromColumn.id);
                    referencedColumnsIds.push(toColumn.id);
                }
                const fk: SchemaDesigner.ForeignKey = {
                    id: options.newId(),
                    name: spec.name,
                    columnsIds,
                    referencedTableId: toTable.id,
                    referencedColumnsIds,
                    onDeleteAction: toOnAction(spec.onDelete),
                    onUpdateAction: toOnAction(spec.onUpdate),
                };
                fromTable.foreignKeys.push(fk);
                correlator.registerNewFk(spec.localId, fromTable, fk);
                break;
            }
            case "dropForeignKey": {
                const found = correlator.foreignKey(op.foreignKey, op.operationId);
                if (isConflict(found)) {
                    return fail(found);
                }
                found.table.foreignKeys = found.table.foreignKeys.filter(
                    (candidate) => candidate !== found.fk,
                );
                break;
            }
            case "setForeignKeyActions": {
                const found = correlator.foreignKey(op.foreignKey, op.operationId);
                if (isConflict(found)) {
                    return fail(found);
                }
                found.fk.onDeleteAction = toOnAction(op.onDelete);
                found.fk.onUpdateAction = toOnAction(op.onUpdate);
                break;
            }
            default:
                return fail({
                    operationId: (op as { operationId?: string }).operationId,
                    code: "unsupportedOperation",
                    message: `Operation kind '${(op as { kind?: string }).kind}' cannot be replayed.`,
                });
        }
    }
    return { ok: true, schema, counts };
}
