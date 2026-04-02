/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

const toTableNameKey = (schema: string, name: string): string =>
    `${schema}.${name}`.toLocaleLowerCase();

export interface SchemaDesignerIndex {
    tableById: Map<string, SchemaDesigner.Table>;
    tableIdByQualifiedName: Map<string, string>;
    columnByIdByTableId: Map<string, Map<string, SchemaDesigner.Column>>;
    columnByNameByTableId: Map<string, Map<string, SchemaDesigner.Column>>;
    foreignKeyByIdByTableId: Map<string, Map<string, SchemaDesigner.ForeignKey>>;
}

export function createSchemaDesignerIndex(schema: SchemaDesigner.Schema): SchemaDesignerIndex {
    const tableById = new Map<string, SchemaDesigner.Table>();
    const tableIdByQualifiedName = new Map<string, string>();
    const columnByIdByTableId = new Map<string, Map<string, SchemaDesigner.Column>>();
    const columnByNameByTableId = new Map<string, Map<string, SchemaDesigner.Column>>();
    const foreignKeyByIdByTableId = new Map<string, Map<string, SchemaDesigner.ForeignKey>>();

    for (const table of schema.tables) {
        tableById.set(table.id, table);
        tableIdByQualifiedName.set(toTableNameKey(table.schema, table.name), table.id);

        const columnsById = new Map<string, SchemaDesigner.Column>();
        const columnsByName = new Map<string, SchemaDesigner.Column>();
        for (const column of table.columns) {
            columnsById.set(column.id, column);
            columnsByName.set(column.name.toLocaleLowerCase(), column);
        }
        columnByIdByTableId.set(table.id, columnsById);
        columnByNameByTableId.set(table.id, columnsByName);

        const foreignKeysById = new Map<string, SchemaDesigner.ForeignKey>();
        for (const foreignKey of table.foreignKeys) {
            foreignKeysById.set(foreignKey.id, foreignKey);
        }
        foreignKeyByIdByTableId.set(table.id, foreignKeysById);
    }

    return {
        tableById,
        tableIdByQualifiedName,
        columnByIdByTableId,
        columnByNameByTableId,
        foreignKeyByIdByTableId,
    };
}

export function getTableById(
    index: SchemaDesignerIndex,
    tableId: string,
): SchemaDesigner.Table | undefined {
    return index.tableById.get(tableId);
}

export function getTableByQualifiedName(
    index: SchemaDesignerIndex,
    schema: string,
    name: string,
): SchemaDesigner.Table | undefined {
    const tableId = index.tableIdByQualifiedName.get(toTableNameKey(schema, name));
    if (!tableId) {
        return undefined;
    }
    return index.tableById.get(tableId);
}

export function getColumnById(
    index: SchemaDesignerIndex,
    tableId: string,
    columnId: string,
): SchemaDesigner.Column | undefined {
    return index.columnByIdByTableId.get(tableId)?.get(columnId);
}

export function getColumnByName(
    index: SchemaDesignerIndex,
    tableId: string,
    columnName: string,
): SchemaDesigner.Column | undefined {
    return index.columnByNameByTableId.get(tableId)?.get(columnName.toLocaleLowerCase());
}

export function getForeignKeyById(
    index: SchemaDesignerIndex,
    tableId: string,
    foreignKeyId: string,
): SchemaDesigner.ForeignKey | undefined {
    return index.foreignKeyByIdByTableId.get(tableId)?.get(foreignKeyId);
}
