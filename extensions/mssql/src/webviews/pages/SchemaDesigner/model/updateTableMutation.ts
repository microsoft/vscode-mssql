/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edge, MarkerType, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { buildForeignKeyEdgeId } from "../schemaDesignerEdgeUtils";

export interface UpdateTableMutationParams {
    existingNodes: Node<SchemaDesigner.Table>[];
    existingEdges: Edge<SchemaDesigner.ForeignKey>[];
    updatedTable: SchemaDesigner.Table;
}

export type UpdateTableMutationResult =
    | {
          success: false;
      }
    | {
          success: true;
          nodes: Node<SchemaDesigner.Table>[];
          edges: Edge<SchemaDesigner.ForeignKey>[];
      };

export function applyUpdateTableMutation(
    params: UpdateTableMutationParams,
): UpdateTableMutationResult {
    const { existingNodes, existingEdges, updatedTable } = params;

    const nodeById = new Map<string, Node<SchemaDesigner.Table>>();
    for (const node of existingNodes) {
        nodeById.set(node.id, node);
    }

    const existingTableNode = nodeById.get(updatedTable.id);
    if (!existingTableNode) {
        return { success: false };
    }

    const updatedColumnIds = new Set(updatedTable.columns.map((column) => column.id));

    const baseEdges = existingEdges.map((edge) => ({
        ...edge,
        data: edge.data ? { ...edge.data } : edge.data,
    }));

    function getColumnIdFromHandle(
        handle: string | null | undefined,
        expectedPrefix: string,
    ): string | undefined {
        if (!handle || !handle.startsWith(expectedPrefix)) {
            return undefined;
        }

        return handle.slice(expectedPrefix.length);
    }

    function getReferencedColumnId(edge: Edge<SchemaDesigner.ForeignKey>): string | undefined {
        return (
            edge.data?.referencedColumnsIds?.[0] ??
            getColumnIdFromHandle(edge.targetHandle, "left-")
        );
    }

    const nodes = existingNodes.map((node) =>
        node.id === updatedTable.id ? { ...node, data: updatedTable } : node,
    );

    const edges = baseEdges.filter((edge) => {
        if (edge.source === updatedTable.id) {
            return false;
        }

        if (edge.target !== updatedTable.id) {
            return true;
        }

        const referencedColumnId = getReferencedColumnId(edge);
        return !!referencedColumnId && updatedColumnIds.has(referencedColumnId);
    });

    updatedTable.foreignKeys.forEach((foreignKey) => {
        const referencedTable = nodeById.get(foreignKey.referencedTableId);
        if (!referencedTable) {
            return;
        }

        foreignKey.columnsIds.forEach((sourceColumnId, index) => {
            const referencedColumnId = foreignKey.referencedColumnsIds[index];
            if (!sourceColumnId || !referencedColumnId) {
                return;
            }

            edges.push({
                id: buildForeignKeyEdgeId(
                    updatedTable.id,
                    referencedTable.id,
                    sourceColumnId,
                    referencedColumnId,
                ),
                source: updatedTable.id,
                target: referencedTable.id,
                sourceHandle: `right-${sourceColumnId}`,
                targetHandle: `left-${referencedColumnId}`,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                },
                data: {
                    ...foreignKey,
                    columnsIds: [sourceColumnId],
                    referencedColumnsIds: [referencedColumnId],
                },
            });
        });
    });

    return {
        success: true,
        nodes,
        edges,
    };
}
