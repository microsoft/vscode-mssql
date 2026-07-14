/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer versioned edit operations (SV-R6; addendum §7).
 * The DURABLE, identity-first operation vocabulary: React Flow is a
 * projection, never the edit authority (§7.2) — undo/redo moves a cursor
 * over this log, rebase replays it through the pure reducer, and the v1
 * publish handoff correlates it onto a fresh DacFx baseline.
 *
 * Identity rules (§4.4/§7.1):
 * - EXISTING entities target catalog ids (objectId / columnId /
 *   constraintObjectId) plus baseline schema/name for correlation
 *   diagnostics — names are display/diagnostic facts, ids are authority.
 * - NEW entities carry session-stable local uuids (`new-table:<uuid>` …);
 *   valid GUIDs for STS are minted only at replay (§4.5).
 *
 * First-release operation matrix (§7.3): table add/drop/rename/schema,
 * column add/drop/rename/type/nullability, FK add/drop/actions. Identity,
 * default, computed and reorder edits are DELIBERATELY absent until their
 * substrate facts and v1 updater paths are proven (§9, D12/D17) — the
 * reducer rejects unknown kinds with a typed conflict, never silently.
 */

import { FkReferentialAction } from "../../services/metadata/catalogModel";

/** Existing-or-new entity reference for tables. */
export type TableRef =
    | { kind: "existing"; objectId: number; baselineSchema: string; baselineName: string }
    | { kind: "new"; localId: string };

/** Column reference within a table (existing columns by columnId). */
export type ColumnRef =
    | { kind: "existing"; columnId: number; baselineName: string }
    | { kind: "new"; localId: string };

export type ForeignKeyRef =
    | { kind: "existing"; constraintObjectId: number; baselineName: string }
    | { kind: "new"; localId: string };

/** Discrete target type facts — never parsed back out of display text. */
export interface EditTypeSpec {
    displayText: string;
    typeName: string;
    /** Logical length for char/binary families ("max" allowed). */
    length?: number | "max";
    precision?: number;
    scale?: number;
}

export interface NewColumnSpec {
    localId: string;
    name: string;
    type: EditTypeSpec;
    nullable: boolean;
}

interface EditBase<K extends string> {
    version: 1;
    operationId: string;
    kind: K;
}

export type SchemaVisualizerEditOp =
    | (EditBase<"addTable"> & {
          table: { localId: string; schema: string; name: string; columns: NewColumnSpec[] };
      })
    | (EditBase<"dropTable"> & { table: TableRef })
    | (EditBase<"renameTable"> & { table: TableRef; newName: string })
    | (EditBase<"setTableSchema"> & { table: TableRef; newSchema: string })
    | (EditBase<"addColumn"> & { table: TableRef; column: NewColumnSpec })
    | (EditBase<"dropColumn"> & { table: TableRef; column: ColumnRef })
    | (EditBase<"renameColumn"> & { table: TableRef; column: ColumnRef; newName: string })
    | (EditBase<"setColumnType"> & {
          table: TableRef;
          column: ColumnRef;
          newType: EditTypeSpec;
          /** Baseline display text — precondition fact for replay honesty. */
          beforeDisplayText?: string;
      })
    | (EditBase<"setColumnNullability"> & {
          table: TableRef;
          column: ColumnRef;
          nullable: boolean;
      })
    | (EditBase<"addForeignKey"> & {
          foreignKey: {
              localId: string;
              name: string;
              fromTable: TableRef;
              toTable: TableRef;
              columnPairs: Array<{ fromColumn: ColumnRef; toColumn: ColumnRef }>;
              onDelete: FkReferentialAction;
              onUpdate: FkReferentialAction;
          };
      })
    | (EditBase<"dropForeignKey"> & { foreignKey: ForeignKeyRef })
    | (EditBase<"setForeignKeyActions"> & {
          foreignKey: ForeignKeyRef;
          onDelete: FkReferentialAction;
          onUpdate: FkReferentialAction;
      });

export type EditKind = SchemaVisualizerEditOp["kind"];

export type EditConflictCode =
    | "targetNotFound"
    | "columnNotFound"
    | "foreignKeyNotFound"
    | "duplicateName"
    | "fkEndpointMissing"
    | "fkColumnMissing"
    | "unsupportedOperation";

export interface EditConflict {
    operationId: string;
    code: EditConflictCode;
    /** Safe summary — entity NAMES allowed (user-facing), never SQL text. */
    message: string;
}

/** Stable key for the entity an op touches (normalization grouping). */
export function tableKey(ref: TableRef): string {
    return ref.kind === "existing" ? `t:${ref.objectId}` : `tn:${ref.localId}`;
}

export function columnKey(table: TableRef, ref: ColumnRef): string {
    const base = tableKey(table);
    return ref.kind === "existing" ? `${base}|c:${ref.columnId}` : `${base}|cn:${ref.localId}`;
}

export function foreignKeyKey(ref: ForeignKeyRef): string {
    return ref.kind === "existing" ? `fk:${ref.constraintObjectId}` : `fkn:${ref.localId}`;
}
