/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SchemaVisualizerCatalogModel → SchemaGraphProjection (SV-R2; addendum
 * §4.1). The graph shape the webview renders: plain serializable facts,
 * stable ids (§4.4 — layout positions and selections key off these across
 * refreshes), NO generation anywhere.
 *
 * - Edges whose endpoints are not in the projected node set (raced DDL,
 *   filtered subset) are returned in `danglingEdges`, never silently
 *   dropped (§17.2) and never rendered as broken arrows.
 * - `nodeById` supports O(1) edge wiring downstream — the legacy
 *   per-edge `nodes.find` scan is the exact hazard A-13 calls out.
 */

import {
    availableValue,
    SchemaVisualizerCatalogModel,
    VisualizerForeignKey,
} from "./schemaVisualizerModel";

export interface SchemaGraphColumnProjection {
    id: string;
    name: string;
    typeDisplay: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    /** True when the column participates in any outgoing FK pair. */
    isForeignKey: boolean;
    isIdentity: boolean;
    isComputed: boolean;
}

export interface SchemaGraphNodeProjection {
    id: string;
    objectId: number;
    schema: string;
    name: string;
    columns: SchemaGraphColumnProjection[];
}

export interface SchemaGraphEdgeProjection {
    id: string;
    constraintObjectId?: number;
    name: string;
    sourceNodeId: string;
    targetNodeId: string;
    columnPairs: Array<{ fromColumnName: string; toColumnName: string }>;
    /** Render label; "Unknown" MUST be shown as unknown, never NO_ACTION. */
    onDeleteLabel: string;
    onUpdateLabel: string;
}

export interface SchemaGraphProjection {
    nodes: SchemaGraphNodeProjection[];
    edges: SchemaGraphEdgeProjection[];
    /** Edges with a missing endpoint (raced DDL / subset) — surfaced, not lost. */
    danglingEdges: SchemaGraphEdgeProjection[];
    /** O(1) node lookup for layout/selection (A-13). */
    nodeById: ReadonlyMap<string, SchemaGraphNodeProjection>;
}

export interface GraphProjectionOptions {
    /** Restrict to these table objectIds (large-catalog subset mode §11.3). */
    includeObjectIds?: ReadonlySet<number>;
}

function actionLabel(fk: VisualizerForeignKey, side: "onDelete" | "onUpdate"): string {
    const value = availableValue(fk[side]);
    return value ?? "Unknown";
}

export function projectGraph(
    model: SchemaVisualizerCatalogModel,
    options?: GraphProjectionOptions,
): SchemaGraphProjection {
    const include = options?.includeObjectIds;

    // Column names participating in outgoing FK pairs, per table objectId.
    const fkColumnsByTable = new Map<number, Set<string>>();
    for (const fk of model.foreignKeys) {
        let set = fkColumnsByTable.get(fk.fromObjectId);
        if (set === undefined) {
            set = new Set();
            fkColumnsByTable.set(fk.fromObjectId, set);
        }
        for (const pair of fk.columnPairs) {
            set.add(pair.fromColumnName);
        }
    }

    const nodes: SchemaGraphNodeProjection[] = [];
    const nodeById = new Map<string, SchemaGraphNodeProjection>();
    const nodeByObjectId = new Map<number, SchemaGraphNodeProjection>();
    for (const table of model.tables) {
        if (include !== undefined && !include.has(table.identity.objectId)) {
            continue;
        }
        const fkColumns = fkColumnsByTable.get(table.identity.objectId);
        const node: SchemaGraphNodeProjection = {
            id: table.graphId,
            objectId: table.identity.objectId,
            schema: table.schema,
            name: table.name,
            columns: table.columns.map((column) => ({
                id: column.graphId,
                name: column.name,
                typeDisplay: column.typeDisplay,
                nullable: column.nullable,
                isPrimaryKey: availableValue(column.inPrimaryKey) === true,
                isForeignKey: fkColumns?.has(column.name) === true,
                isIdentity: column.isIdentity,
                isComputed: column.isComputed,
            })),
        };
        nodes.push(node);
        nodeById.set(node.id, node);
        nodeByObjectId.set(node.objectId, node);
    }

    const edges: SchemaGraphEdgeProjection[] = [];
    const danglingEdges: SchemaGraphEdgeProjection[] = [];
    for (const fk of model.foreignKeys) {
        const source = nodeByObjectId.get(fk.fromObjectId);
        const target = nodeByObjectId.get(fk.toObjectId);
        const edge: SchemaGraphEdgeProjection = {
            id: fk.graphId,
            name: fk.name,
            sourceNodeId: source?.id ?? `table:${fk.fromObjectId}`,
            targetNodeId: target?.id ?? `table:${fk.toObjectId}`,
            columnPairs: fk.columnPairs.map((pair) => ({
                fromColumnName: pair.fromColumnName,
                toColumnName: pair.toColumnName,
            })),
            onDeleteLabel: actionLabel(fk, "onDelete"),
            onUpdateLabel: actionLabel(fk, "onUpdate"),
        };
        if (fk.identity.constraintObjectId !== undefined) {
            edge.constraintObjectId = fk.identity.constraintObjectId;
        }
        (source !== undefined && target !== undefined ? edges : danglingEdges).push(edge);
    }

    return { nodes, edges, danglingEdges, nodeById };
}
