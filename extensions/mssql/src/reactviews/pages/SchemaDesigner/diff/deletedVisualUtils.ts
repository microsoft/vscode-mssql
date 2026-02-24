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
    const currentNodesById = new Map<string, Node<SchemaDesigner.TableWithDeletedFlag>>();
    for (const node of targetNodes) {
        currentNodesById.set(node.id, node);
        currentNodesById.set(node.data.id, node);
    }
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

            const legacyForeignKey = fk as unknown as {
                referencedSchemaName?: string;
                referencedTableName?: string;
                columns?: string[];
                referencedColumns?: string[];
            };

            const referencedTableKey =
                legacyForeignKey.referencedSchemaName && legacyForeignKey.referencedTableName
                    ? `${legacyForeignKey.referencedSchemaName}.${legacyForeignKey.referencedTableName}`
                    : undefined;

            const targetNode =
                currentNodesById.get(fk.referencedTableId) ??
                (referencedTableKey ? currentNodesByName.get(referencedTableKey) : undefined);
            if (!targetNode) {
                continue;
            }
            const baselineTarget =
                baselineSchema.tables.find((table) => table.id === fk.referencedTableId) ??
                (referencedTableKey ? baselineTablesByName.get(referencedTableKey) : undefined);

            const normalizedColumnIds = Array.isArray(fk.columnsIds)
                ? fk.columnsIds
                : (legacyForeignKey.columns ?? [])
                      .map(
                          (columnName) =>
                              currentSourceTable.columns.find(
                                  (column) => column.name === columnName,
                              )?.id ??
                              baselineTable.columns.find((column) => column.name === columnName)
                                  ?.id,
                      )
                      .filter((value): value is string => Boolean(value));

            const normalizedReferencedColumnIds = Array.isArray(fk.referencedColumnsIds)
                ? fk.referencedColumnsIds
                : (legacyForeignKey.referencedColumns ?? [])
                      .map(
                          (columnName) =>
                              targetNode.data.columns.find((column) => column.name === columnName)
                                  ?.id ??
                              baselineTarget?.columns.find((column) => column.name === columnName)
                                  ?.id,
                      )
                      .filter((value): value is string => Boolean(value));

            normalizedColumnIds.forEach((columnId, idx) => {
                const referencedColumnId = normalizedReferencedColumnIds[idx];
                if (!referencedColumnId) {
                    return;
                }

                const legacySourceColumnName = legacyForeignKey.columns?.[idx];
                const legacyReferencedColumnName = legacyForeignKey.referencedColumns?.[idx];

                const sourceColId =
                    currentSourceTable.columns.find((c) => c.id === columnId)?.id ??
                    baselineTable.columns.find((c) => c.id === columnId)?.id ??
                    (legacySourceColumnName
                        ? currentSourceTable.columns.find((c) => c.name === legacySourceColumnName)
                              ?.id
                        : undefined);
                const targetColId =
                    targetNode.data.columns.find((c) => c.id === referencedColumnId)?.id ??
                    baselineTarget?.columns.find((c) => c.id === referencedColumnId)?.id ??
                    (legacyReferencedColumnName
                        ? targetNode.data.columns.find((c) => c.name === legacyReferencedColumnName)
                              ?.id
                        : undefined);

                const deletedForeignKey: SchemaDesigner.ForeignKey & { isDeleted: true } = {
                    ...fk,
                    columnsIds: [columnId],
                    referencedColumnsIds: [referencedColumnId],
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
