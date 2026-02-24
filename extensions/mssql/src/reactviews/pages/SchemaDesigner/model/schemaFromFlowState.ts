/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const isDeleted = (value: { isDeleted?: boolean } | undefined): boolean =>
    value?.isDeleted === true;

export function buildSchemaFromFlowState(
    nodes: Node<SchemaDesigner.TableWithDeletedFlag>[],
    edges: Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[],
): SchemaDesigner.Schema {
    const filteredNodes = nodes.filter((node) => !isDeleted(node.data));

    const tables = filteredNodes.map((node) => ({
        ...node.data,
        foreignKeys: [] as SchemaDesigner.ForeignKey[],
    }));

    const tableById = new Map<string, (typeof tables)[number]>();
    for (const table of tables) {
        tableById.set(table.id, table);
    }

    edges.forEach((edge) => {
        if (!edge.data || isDeleted(edge.data)) {
            return;
        }

        const sourceTable = tableById.get(edge.source);
        const targetTable = tableById.get(edge.target);
        if (!sourceTable || !targetTable) {
            return;
        }

        const foreignKey: SchemaDesigner.ForeignKey = {
            id: edge.data.id,
            name: edge.data.name,
            columnIds: [...edge.data.columnIds],
            referencedTableId: edge.data.referencedTableId || edge.target,
            referencedColumnIds: [...edge.data.referencedColumnIds],
            onDeleteAction: edge.data.onDeleteAction,
            onUpdateAction: edge.data.onUpdateAction,
        };

        const existingForeignKey = sourceTable.foreignKeys.find((fk) => fk.id === foreignKey.id);
        if (existingForeignKey) {
            existingForeignKey.columnIds.push(foreignKey.columnIds[0]);
            existingForeignKey.referencedColumnIds.push(foreignKey.referencedColumnIds[0]);
            return;
        }

        sourceTable.foreignKeys.push(foreignKey);
    });

    return {
        tables,
    };
}
