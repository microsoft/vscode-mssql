/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edge, MarkerType, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const isDeleted = (value: { isDeleted?: boolean } | undefined): value is { isDeleted: true } =>
    value?.isDeleted === true;

export function filterDeletedNodes(
    nodes: Node<SchemaDesigner.TableWithDeletedFlag>[],
): Node<SchemaDesigner.TableWithDeletedFlag>[] {
    return nodes.filter((node) => !isDeleted(node.data));
}

export function filterDeletedEdges(
    edges: Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[],
): Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[] {
    return edges.filter((edge) => !isDeleted(edge.data));
}

export function mergeDeletedTableNodes(
    nodes: Node<SchemaDesigner.TableWithDeletedFlag>[],
    deletedNodes: Node<SchemaDesigner.TableWithDeletedFlag>[],
): Node<SchemaDesigner.TableWithDeletedFlag>[] {
    if (deletedNodes.length === 0) {
        return nodes;
    }

    const existingIds = new Set(nodes.map((node) => node.id));
    const filteredDeleted = deletedNodes.filter((node) => !existingIds.has(node.id));

    if (filteredDeleted.length === 0) {
        return nodes;
    }

    return [...nodes, ...filteredDeleted];
}

export function toSchemaTables(
    nodes: Node<SchemaDesigner.TableWithDeletedFlag>[],
): SchemaDesigner.Table[] {
    return filterDeletedNodes(nodes).map((node) => node.data);
}

export function mergeColumnsWithDeleted(
    columns: SchemaDesigner.Column[],
    deletedColumns: SchemaDesigner.Column[],
    baselineOrder: string[],
): SchemaDesigner.ColumnWithDeletedFlag[] {
    if (deletedColumns.length === 0) {
        return [...columns];
    }

    const merged: SchemaDesigner.ColumnWithDeletedFlag[] = [...columns];
    const baselineIndex = new Map(baselineOrder.map((columnId, index) => [columnId, index]));
    const deletedSorted = [...deletedColumns].sort((a, b) => {
        const aIndex = baselineIndex.get(a.id) ?? Number.POSITIVE_INFINITY;
        const bIndex = baselineIndex.get(b.id) ?? Number.POSITIVE_INFINITY;
        return aIndex - bIndex;
    });

    for (const deletedColumn of deletedSorted) {
        const deletedIndex = baselineIndex.get(deletedColumn.id);
        let insertAt = merged.length;
        if (deletedIndex !== undefined) {
            for (let i = 0; i < merged.length; i += 1) {
                const currentIndex = baselineIndex.get(merged[i].id);
                if (currentIndex !== undefined && currentIndex > deletedIndex) {
                    insertAt = i;
                    break;
                }
            }
        }
        merged.splice(insertAt, 0, { ...deletedColumn, isDeleted: true });
    }

    return merged;
}

export interface DeletedForeignKeyEdgeParams {
    baselineSchema: SchemaDesigner.Schema;
    currentNodes: Node<SchemaDesigner.TableWithDeletedFlag>[];
    deletedForeignKeyIds: Set<string>;
    deletedTableNodes?: Node<SchemaDesigner.TableWithDeletedFlag>[];
}

export function buildDeletedForeignKeyEdges({
    baselineSchema,
    currentNodes,
    deletedForeignKeyIds,
    deletedTableNodes = [],
}: DeletedForeignKeyEdgeParams): Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[] {
    if (!baselineSchema || deletedForeignKeyIds.size === 0) {
        return [];
    }

    const currentTablesById = new Map(currentNodes.map((node) => [node.id, node.data]));
    const currentNodesByName = new Map<string, Node<SchemaDesigner.TableWithDeletedFlag>>();
    const targetNodes =
        deletedTableNodes.length > 0 ? [...currentNodes, ...deletedTableNodes] : currentNodes;
    for (const node of targetNodes) {
        const key = `${node.data.schema}.${node.data.name}`;
        const existing = currentNodesByName.get(key);
        if (!existing) {
            currentNodesByName.set(key, node);
            continue;
        }

        const existingDeleted = isDeleted(existing.data);
        const nodeDeleted = isDeleted(node.data);
        if (existingDeleted && !nodeDeleted) {
            currentNodesByName.set(key, node);
        }
    }
    const baselineTablesByName = new Map(
        baselineSchema.tables.map((table) => [`${table.schema}.${table.name}`, table]),
    );

    const deletedEdges: Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[] = [];

    for (const baselineTable of baselineSchema.tables) {
        const currentSourceTable = currentTablesById.get(baselineTable.id);
        if (!currentSourceTable) {
            continue;
        }

        for (const fk of baselineTable.foreignKeys ?? []) {
            if (!deletedForeignKeyIds.has(fk.id)) {
                continue;
            }

            const targetNode = currentNodesByName.get(
                `${fk.referencedSchemaName}.${fk.referencedTableName}`,
            );
            if (!targetNode) {
                continue;
            }
            const baselineTarget = baselineTablesByName.get(
                `${fk.referencedSchemaName}.${fk.referencedTableName}`,
            );

            fk.columns.forEach((col, idx) => {
                const refCol = fk.referencedColumns[idx];
                if (!refCol) {
                    return;
                }

                const sourceColId =
                    currentSourceTable.columns.find((c) => c.name === col)?.id ??
                    baselineTable.columns.find((c) => c.name === col)?.id;
                const targetColId =
                    targetNode.data.columns.find((c) => c.name === refCol)?.id ??
                    baselineTarget?.columns.find((c) => c.name === refCol)?.id;

                const deletedForeignKey: SchemaDesigner.ForeignKey & { isDeleted: true } = {
                    ...fk,
                    columns: [col],
                    referencedColumns: [refCol],
                    isDeleted: true,
                };

                deletedEdges.push({
                    id: `deleted-fk-${fk.id}-${idx}`,
                    source: currentSourceTable.id,
                    target: targetNode.id,
                    sourceHandle: sourceColId ? `right-${sourceColId}` : undefined,
                    targetHandle: targetColId ? `left-${targetColId}` : undefined,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    data: deletedForeignKey,
                    className: "schema-designer-edge-deleted",
                    selectable: false,
                    focusable: false,
                    deletable: false,
                });
            });
        }
    }

    return deletedEdges;
}
