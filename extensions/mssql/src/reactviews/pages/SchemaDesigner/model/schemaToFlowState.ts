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

type ForeignKeyInput = SchemaDesigner.ForeignKey & {
    columnsIds?: string[];
    referencedColumnsIds?: string[];
};

const toStrictForeignKey = (foreignKey: ForeignKeyInput): SchemaDesigner.ForeignKey => ({
    ...foreignKey,
    columnsIds: foreignKey.columnsIds ?? foreignKey.columnsIds ?? [],
    referencedColumnsIds: foreignKey.referencedColumnsIds ?? foreignKey.referencedColumnsIds ?? [],
});

const toStrictSchema = (schema: SchemaDesigner.Schema): SchemaDesigner.Schema => ({
    tables: (schema.tables ?? []).map((table) => ({
        ...table,
        columns: table.columns ?? [],
        foreignKeys: (table.foreignKeys ?? []).map((foreignKey) =>
            toStrictForeignKey(foreignKey as ForeignKeyInput),
        ),
    })),
});

export function buildFlowComponentsFromSchema(schema: SchemaDesigner.Schema): FlowComponents {
    if (!schema) {
        return {
            nodes: [],
            edges: [],
        };
    }

    const strictSchema = toStrictSchema(schema);
    const tables = strictSchema.tables ?? [];
    const tableById = new Map(tables.map((table) => [table.id, table]));

    const nodes: Node<SchemaDesigner.Table>[] = tables.map((table) => ({
        id: table.id,
        type: "tableNode",
        data: {
            ...table,
            columns: table.columns ?? [],
            foreignKeys: table.foreignKeys ?? [],
        },
        position: { x: 0, y: 0 },
    }));

    const edges: Edge<SchemaDesigner.ForeignKey>[] = [];

    for (const table of tables) {
        for (const foreignKey of table.foreignKeys ?? []) {
            const referencedTable = tableById.get(foreignKey.referencedTableId);
            if (!referencedTable) {
                continue;
            }

            foreignKey.columnsIds.forEach((sourceColumnId, index) => {
                const referencedColumnId = foreignKey.referencedColumnsIds[index];
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
                        referencedTableId: referencedTable.id,
                        columnsIds: [sourceColumnId],
                        referencedColumnsIds: [referencedColumnId],
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
