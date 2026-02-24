/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionLineType, Edge, MarkerType, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export interface FlowComponents {
    nodes: Node<SchemaDesigner.Table>[];
    edges: Edge<SchemaDesigner.ForeignKey>[];
}

export function buildFlowComponentsFromSchema(schema: SchemaDesigner.Schema): FlowComponents {
    if (!schema) {
        return {
            nodes: [],
            edges: [],
        };
    }

    const nodes: Node<SchemaDesigner.Table>[] = schema.tables.map((table) => ({
        id: table.id,
        type: "tableNode",
        data: { ...table },
        position: { x: 0, y: 0 },
    }));

    const edges: Edge<SchemaDesigner.ForeignKey>[] = [];

    for (const table of schema.tables) {
        for (const foreignKey of table.foreignKeys) {
            const referencedTable = schema.tables.find(
                (candidate) => candidate.id === foreignKey.referencedTableId,
            );
            if (!referencedTable) {
                continue;
            }

            foreignKey.columnIds.forEach((sourceColumnId, index) => {
                const referencedColumnId = foreignKey.referencedColumnIds[index];
                if (!sourceColumnId || !referencedColumnId) {
                    return;
                }

                edges.push({
                    id: `${table.id}-${referencedTable.id}-${sourceColumnId}-${referencedColumnId}`,
                    source: table.id,
                    target: referencedTable.id,
                    sourceHandle: `right-${sourceColumnId}`,
                    targetHandle: `left-${referencedColumnId}`,
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                    },
                    data: {
                        ...foreignKey,
                        columnIds: [sourceColumnId],
                        referencedColumnIds: [referencedColumnId],
                    },
                    type:
                        table.id === referencedTable.id ? ConnectionLineType.SmoothStep : undefined,
                });
            });
        }
    }

    return {
        nodes,
        edges,
    };
}
