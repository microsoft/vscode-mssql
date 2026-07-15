/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EditableModel → SchemaGraphProjection (SV-R8c). The edit-mode sibling of
 * visualizerToGraphProjection: the canvas re-projects the REDUCED model so
 * local edits render live, while node/edge ids stay stable across the
 * baseline↔edited boundary (existing entities keep their baseline graph
 * ids, so layout positions and selection survive entering edit mode; new
 * entities use `new-table:<localId>` / `new-fk:<localId>` per §4.4).
 *
 * Baseline-only render facts that the edit vocabulary cannot change
 * (primary key membership, identity, computed) are pulled from the
 * baseline model by column identity — never fabricated for new columns.
 */

import { EditableModel, EditableTable } from "./schemaVisualizerEditReducer";
import {
    availableValue,
    SchemaVisualizerCatalogModel,
    VisualizerColumn,
    VisualizerTable,
} from "./schemaVisualizerModel";
import {
    SchemaGraphColumnProjection,
    SchemaGraphEdgeProjection,
    SchemaGraphNodeProjection,
    SchemaGraphProjection,
} from "./visualizerToGraphProjection";

function nodeIdOf(table: EditableTable): string {
    return table.ref.kind === "existing"
        ? `table:${table.ref.objectId}`
        : `new-table:${table.ref.localId}`;
}

function actionLabel(value: string): string {
    return value === "UNKNOWN" ? "Unknown" : value;
}

/** Project the reduced (edited) model with baseline facts joined by identity. */
export function projectEditableGraph(
    editable: EditableModel,
    baseline: SchemaVisualizerCatalogModel,
): SchemaGraphProjection {
    const baselineTables = new Map<number, VisualizerTable>();
    for (const table of baseline.tables) {
        baselineTables.set(table.identity.objectId, table);
    }

    // Column names participating in outgoing FK pairs, per table key.
    const fkColumnsByTableKey = new Map<string, Set<string>>();
    for (const fk of editable.foreignKeys.values()) {
        let set = fkColumnsByTableKey.get(fk.fromTableKey);
        if (set === undefined) {
            set = new Set();
            fkColumnsByTableKey.set(fk.fromTableKey, set);
        }
        for (const pair of fk.columnPairs) {
            set.add(pair.fromColumnName);
        }
    }

    const nodes: SchemaGraphNodeProjection[] = [];
    const nodeById = new Map<string, SchemaGraphNodeProjection>();
    const nodeIdByTableKey = new Map<string, string>();
    for (const [key, table] of editable.tables) {
        const baselineTable =
            table.ref.kind === "existing" ? baselineTables.get(table.ref.objectId) : undefined;
        const baselineColumns = new Map<number, VisualizerColumn>();
        if (baselineTable !== undefined) {
            for (const column of baselineTable.columns) {
                if (column.identity.columnId !== undefined) {
                    baselineColumns.set(column.identity.columnId, column);
                }
            }
        }
        const fkColumns = fkColumnsByTableKey.get(key);
        const columns: SchemaGraphColumnProjection[] = table.columns.map((column) => {
            const baselineColumn =
                column.ref.kind === "existing"
                    ? baselineColumns.get(column.ref.columnId)
                    : undefined;
            return {
                id:
                    column.ref.kind === "existing"
                        ? (baselineColumn?.graphId ?? `column:unknown:${column.ref.columnId}`)
                        : `new-column:${column.ref.localId}`,
                name: column.name,
                typeDisplay: column.editedType?.displayText ?? column.typeDisplay,
                nullable: column.nullable,
                isPrimaryKey:
                    baselineColumn !== undefined
                        ? availableValue(baselineColumn.inPrimaryKey) === true
                        : false,
                isForeignKey: fkColumns?.has(column.name) === true,
                isIdentity: baselineColumn?.isIdentity === true,
                isComputed: baselineColumn?.isComputed === true,
            };
        });
        const node: SchemaGraphNodeProjection = {
            id: nodeIdOf(table),
            objectId: table.ref.kind === "existing" ? table.ref.objectId : -1,
            schema: table.schema,
            name: table.name,
            columns,
        };
        nodes.push(node);
        nodeById.set(node.id, node);
        nodeIdByTableKey.set(key, node.id);
    }

    const edges: SchemaGraphEdgeProjection[] = [];
    const danglingEdges: SchemaGraphEdgeProjection[] = [];
    for (const [, fk] of editable.foreignKeys) {
        const sourceNodeId = nodeIdByTableKey.get(fk.fromTableKey);
        const targetNodeId = nodeIdByTableKey.get(fk.toTableKey);
        const edge: SchemaGraphEdgeProjection = {
            id:
                fk.ref.kind === "existing"
                    ? `fk:${fk.ref.constraintObjectId}`
                    : `new-fk:${fk.ref.localId}`,
            ...(fk.ref.kind === "existing"
                ? { constraintObjectId: fk.ref.constraintObjectId }
                : {}),
            name: fk.name,
            sourceNodeId: sourceNodeId ?? "",
            targetNodeId: targetNodeId ?? "",
            columnPairs: fk.columnPairs.map((pair) => ({ ...pair })),
            onDeleteLabel: actionLabel(fk.onDelete),
            onUpdateLabel: actionLabel(fk.onUpdate),
        };
        if (sourceNodeId === undefined || targetNodeId === undefined) {
            danglingEdges.push(edge);
        } else {
            edges.push(edge);
        }
    }

    return { nodes, edges, danglingEdges, nodeById };
}

export type GraphEditState = "added" | "modified";

export interface GraphEditStates {
    /** Node id → added/modified (dropped entities simply leave the graph). */
    nodes: Map<string, GraphEditState>;
    /** Edge id → added/modified. */
    edges: Map<string, GraphEditState>;
}

function nodeIdOfRef(ref: import("./schemaVisualizerEdit").TableRef): string {
    return ref.kind === "existing" ? `table:${ref.objectId}` : `new-table:${ref.localId}`;
}

function edgeIdOfRef(ref: import("./schemaVisualizerEdit").ForeignKeyRef): string {
    return ref.kind === "existing" ? `fk:${ref.constraintObjectId}` : `new-fk:${ref.localId}`;
}

/**
 * Which rendered entities the ACTIVE op log touches (change-highlight CSS;
 * legacy parity with the designer's added/modified edge tinting).
 */
export function collectGraphEditStates(
    ops: readonly import("./schemaVisualizerEdit").SchemaVisualizerEditOp[],
): GraphEditStates {
    const nodes = new Map<string, GraphEditState>();
    const edges = new Map<string, GraphEditState>();
    const markNode = (id: string, state: GraphEditState) => {
        if (nodes.get(id) !== "added") {
            nodes.set(id, state);
        }
    };
    const markEdge = (id: string, state: GraphEditState) => {
        if (edges.get(id) !== "added") {
            edges.set(id, state);
        }
    };
    for (const op of ops) {
        switch (op.kind) {
            case "addTable":
                nodes.set(`new-table:${op.table.localId}`, "added");
                break;
            case "dropTable":
                break;
            case "renameTable":
            case "setTableSchema":
                markNode(nodeIdOfRef(op.table), "modified");
                break;
            case "addColumn":
            case "dropColumn":
            case "renameColumn":
            case "setColumnType":
            case "setColumnNullability":
                markNode(nodeIdOfRef(op.table), "modified");
                break;
            case "addForeignKey":
                edges.set(`new-fk:${op.foreignKey.localId}`, "added");
                break;
            case "dropForeignKey":
                break;
            case "setForeignKeyActions":
                markEdge(edgeIdOfRef(op.foreignKey), "modified");
                break;
        }
    }
    return { nodes, edges };
}
