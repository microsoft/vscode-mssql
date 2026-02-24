/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sd from "../../../../sharedInterfaces/schemaDesigner";
import * as lodash from "lodash";

export enum ChangeAction {
    Add = "add",
    Modify = "modify",
    Delete = "delete",
}

export enum ChangeCategory {
    Table = "table",
    Column = "column",
    ForeignKey = "foreignKey",
}

export interface PropertyChange {
    property: string;
    displayName: string;
    oldValue: unknown;
    newValue: unknown;
}

export interface SchemaChange {
    id: string;
    action: ChangeAction;
    category: ChangeCategory;
    // Parent table info (for grouping)
    tableId: string;
    tableName: string;
    tableSchema: string;
    // For column/FK changes
    objectId?: string;
    objectName?: string;
    // Property-level changes (for 'modify' action)
    propertyChanges?: PropertyChange[];
}

export interface TableChangeGroup {
    tableId: string;
    tableName: string;
    tableSchema: string;
    isNew: boolean;
    isDeleted: boolean;
    changes: SchemaChange[];
}

export interface SchemaChangesSummary {
    groups: TableChangeGroup[];
    totalChanges: number;
    hasChanges: boolean;
}

export interface PropertyMetadata {
    key: string;
    displayName: string;
}

export const TABLE_PROPERTIES: PropertyMetadata[] = [
    { key: "name", displayName: "Name" },
    { key: "schema", displayName: "Schema" },
];

export const COLUMN_PROPERTIES: PropertyMetadata[] = [
    { key: "name", displayName: "Name" },
    { key: "dataType", displayName: "Data Type" },
    { key: "maxLength", displayName: "Max Length" },
    { key: "precision", displayName: "Precision" },
    { key: "scale", displayName: "Scale" },
    { key: "isPrimaryKey", displayName: "Primary Key" },
    { key: "isIdentity", displayName: "Identity" },
    { key: "identitySeed", displayName: "Identity Seed" },
    { key: "identityIncrement", displayName: "Identity Increment" },
    { key: "isNullable", displayName: "Nullable" },
    { key: "defaultValue", displayName: "Default Value" },
    { key: "isComputed", displayName: "Computed" },
    { key: "computedFormula", displayName: "Computed Formula" },
    { key: "computedPersisted", displayName: "Computed Persisted" },
];

export const FOREIGN_KEY_PROPERTIES: PropertyMetadata[] = [
    { key: "name", displayName: "Name" },
    { key: "columnIds", displayName: "Columns" },
    { key: "referencedTableId", displayName: "Referenced Table" },
    { key: "referencedColumnIds", displayName: "Referenced Columns" },
    { key: "onDeleteAction", displayName: "On Delete Action" },
    { key: "onUpdateAction", displayName: "On Update Action" },
];

export function diffObject<T extends object>(
    original: T,
    current: T,
    properties: PropertyMetadata[],
): PropertyChange[] {
    const changes: PropertyChange[] = [];

    for (const prop of properties) {
        const oldValue = (original as Record<string, unknown>)[prop.key];
        const newValue = (current as Record<string, unknown>)[prop.key];
        if (!lodash.isEqual(oldValue, newValue)) {
            changes.push({
                property: prop.key,
                displayName: prop.displayName,
                oldValue,
                newValue,
            });
        }
    }

    return changes;
}

function groupSortKey(group: Pick<TableChangeGroup, "tableSchema" | "tableName">): string {
    return `${group.tableSchema}.${group.tableName}`.toLowerCase();
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of items) {
        map.set(item.id, item);
    }
    return map;
}

/**
 * Compares two schemas and returns changes grouped by table.
 *
 * Tables:
 * - Added: New tables not present in oldSchema
 * - Deleted: Tables removed from oldSchema
 * - Modified: Tables with name/schema changes, or with column/FK modifications
 *
 * Columns (grouped under parent table):
 * - Added: New columns
 * - Deleted: Removed columns
 * - Modified: Columns with property changes (includes list of changed properties)
 *
 * Foreign Keys (grouped under source table):
 * - Added: New foreign keys
 * - Deleted: Removed foreign keys
 * - Modified: FKs with changes to name, columns, referenced table/columns, or actions
 *
 * @param oldSchema - The original schema (baseline)
 * @param newSchema - The current schema (with modifications)
 * @returns ChangesSummary with changes grouped by table
 */
export function calculateSchemaDiff(
    oldSchema: sd.SchemaDesigner.Schema,
    newSchema: sd.SchemaDesigner.Schema,
): SchemaChangesSummary {
    const oldTablesById = mapById(oldSchema.tables ?? []);
    const newTablesById = mapById(newSchema.tables ?? []);

    const allTableIds = new Set<string>([...oldTablesById.keys(), ...newTablesById.keys()]);
    const groupsByTableId = new Map<string, TableChangeGroup>();

    function getOrCreateGroup(
        table: sd.SchemaDesigner.Table,
        flags?: { isNew?: boolean; isDeleted?: boolean },
    ): TableChangeGroup {
        const existing = groupsByTableId.get(table.id);
        if (existing) {
            if (flags?.isNew) {
                existing.isNew = true;
            }
            if (flags?.isDeleted) {
                existing.isDeleted = true;
            }
            return existing;
        }

        const created: TableChangeGroup = {
            tableId: table.id,
            tableName: table.name,
            tableSchema: table.schema,
            isNew: Boolean(flags?.isNew),
            isDeleted: Boolean(flags?.isDeleted),
            changes: [],
        };
        groupsByTableId.set(table.id, created);
        return created;
    }

    function pushChange(group: TableChangeGroup, change: SchemaChange): void {
        group.changes.push(change);
    }

    for (const tableId of allTableIds) {
        const oldTable = oldTablesById.get(tableId);
        const newTable = newTablesById.get(tableId);

        // Table added
        if (!oldTable && newTable) {
            const group = getOrCreateGroup(newTable, { isNew: true });
            pushChange(group, {
                id: `table:add:${newTable.id}`,
                action: ChangeAction.Add,
                category: ChangeCategory.Table,
                tableId: newTable.id,
                tableName: newTable.name,
                tableSchema: newTable.schema,
            });

            // Also surface foreign keys created on the new table as separate changes.
            // This allows users to revert/delete individual FKs without deleting the table.
            for (const fk of newTable.foreignKeys ?? []) {
                pushChange(group, {
                    id: `foreignKey:add:${newTable.id}:${fk.id}`,
                    action: ChangeAction.Add,
                    category: ChangeCategory.ForeignKey,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: fk.id,
                    objectName: fk.name,
                });
            }

            continue;
        }

        // Table deleted
        if (oldTable && !newTable) {
            const group = getOrCreateGroup(oldTable, { isDeleted: true });
            pushChange(group, {
                id: `table:delete:${oldTable.id}`,
                action: ChangeAction.Delete,
                category: ChangeCategory.Table,
                tableId: oldTable.id,
                tableName: oldTable.name,
                tableSchema: oldTable.schema,
            });
            continue;
        }

        if (!oldTable || !newTable) {
            continue;
        }

        const group = getOrCreateGroup(newTable);

        // Table-level property changes
        const tablePropertyChanges = diffObject(oldTable, newTable, TABLE_PROPERTIES);

        const oldColumnOrder = (oldTable.columns ?? []).map((column) => column.id);
        const newColumnOrder = (newTable.columns ?? []).map((column) => column.id);
        if (!lodash.isEqual(oldColumnOrder, newColumnOrder)) {
            const oldColumnNamesById = new Map(
                (oldTable.columns ?? []).map((column) => [column.id, column.name]),
            );
            const newColumnNamesById = new Map(
                (newTable.columns ?? []).map((column) => [column.id, column.name]),
            );

            tablePropertyChanges.push({
                property: "columnOrder",
                displayName: "Column Order",
                oldValue: oldColumnOrder.map(
                    (columnId) => oldColumnNamesById.get(columnId) ?? columnId,
                ),
                newValue: newColumnOrder.map(
                    (columnId) => newColumnNamesById.get(columnId) ?? columnId,
                ),
            });
        }

        if (tablePropertyChanges.length > 0) {
            pushChange(group, {
                id: `table:modify:${newTable.id}`,
                action: ChangeAction.Modify,
                category: ChangeCategory.Table,
                tableId: newTable.id,
                tableName: newTable.name,
                tableSchema: newTable.schema,
                propertyChanges: tablePropertyChanges,
            });
        }

        // Column changes
        const oldColumnsById = mapById(oldTable.columns ?? []);
        const newColumnsById = mapById(newTable.columns ?? []);
        const allColumnIds = new Set<string>([...oldColumnsById.keys(), ...newColumnsById.keys()]);

        for (const columnId of allColumnIds) {
            const oldColumn = oldColumnsById.get(columnId);
            const newColumn = newColumnsById.get(columnId);

            if (!oldColumn && newColumn) {
                pushChange(group, {
                    id: `column:add:${newTable.id}:${newColumn.id}`,
                    action: ChangeAction.Add,
                    category: ChangeCategory.Column,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: newColumn.id,
                    objectName: newColumn.name,
                });
                continue;
            }

            if (oldColumn && !newColumn) {
                pushChange(group, {
                    id: `column:delete:${newTable.id}:${oldColumn.id}`,
                    action: ChangeAction.Delete,
                    category: ChangeCategory.Column,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: oldColumn.id,
                    objectName: oldColumn.name,
                });
                continue;
            }

            if (!oldColumn || !newColumn) {
                continue;
            }

            const columnPropertyChanges = diffObject(oldColumn, newColumn, COLUMN_PROPERTIES);
            if (columnPropertyChanges.length > 0) {
                pushChange(group, {
                    id: `column:modify:${newTable.id}:${newColumn.id}`,
                    action: ChangeAction.Modify,
                    category: ChangeCategory.Column,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: newColumn.id,
                    objectName: newColumn.name,
                    propertyChanges: columnPropertyChanges,
                });
            }
        }

        // Foreign key changes
        const oldFksById = mapById(oldTable.foreignKeys ?? []);
        const newFksById = mapById(newTable.foreignKeys ?? []);
        const allFkIds = new Set<string>([...oldFksById.keys(), ...newFksById.keys()]);

        for (const fkId of allFkIds) {
            const oldFk = oldFksById.get(fkId);
            const newFk = newFksById.get(fkId);

            if (!oldFk && newFk) {
                pushChange(group, {
                    id: `foreignKey:add:${newTable.id}:${newFk.id}`,
                    action: ChangeAction.Add,
                    category: ChangeCategory.ForeignKey,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: newFk.id,
                    objectName: newFk.name,
                });
                continue;
            }

            if (oldFk && !newFk) {
                pushChange(group, {
                    id: `foreignKey:delete:${newTable.id}:${oldFk.id}`,
                    action: ChangeAction.Delete,
                    category: ChangeCategory.ForeignKey,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: oldFk.id,
                    objectName: oldFk.name,
                });
                continue;
            }

            if (!oldFk || !newFk) {
                continue;
            }

            const oldLegacyForeignKey = oldFk as unknown as {
                columns?: string[];
                referencedSchemaName?: string;
                referencedTableName?: string;
                referencedColumns?: string[];
            };
            const newLegacyForeignKey = newFk as unknown as {
                columns?: string[];
                referencedSchemaName?: string;
                referencedTableName?: string;
                referencedColumns?: string[];
            };

            const oldColumnIds = Array.isArray(oldFk.columnsIds)
                ? oldFk.columnsIds
                : (oldLegacyForeignKey.columns ?? [])
                      .map(
                          (columnName) =>
                              oldTable.columns.find((column) => column.name === columnName)?.id ??
                              columnName,
                      )
                      .filter((columnId): columnId is string => Boolean(columnId));
            const newColumnIds = Array.isArray(newFk.columnsIds)
                ? newFk.columnsIds
                : (newLegacyForeignKey.columns ?? [])
                      .map(
                          (columnName) =>
                              newTable.columns.find((column) => column.name === columnName)?.id ??
                              columnName,
                      )
                      .filter((columnId): columnId is string => Boolean(columnId));

            const oldReferencedTableId =
                oldFk.referencedTableId ||
                oldSchema.tables.find(
                    (table) =>
                        table.schema === oldLegacyForeignKey.referencedSchemaName &&
                        table.name === oldLegacyForeignKey.referencedTableName,
                )?.id ||
                (oldLegacyForeignKey.referencedSchemaName && oldLegacyForeignKey.referencedTableName
                    ? oldLegacyForeignKey.referencedTableName
                    : "");
            const newReferencedTableId =
                newFk.referencedTableId ||
                newSchema.tables.find(
                    (table) =>
                        table.schema === newLegacyForeignKey.referencedSchemaName &&
                        table.name === newLegacyForeignKey.referencedTableName,
                )?.id ||
                (newLegacyForeignKey.referencedSchemaName && newLegacyForeignKey.referencedTableName
                    ? newLegacyForeignKey.referencedTableName
                    : "");

            const oldReferencedTable = oldSchema.tables.find(
                (table) => table.id === oldReferencedTableId,
            );
            const newReferencedTable = newSchema.tables.find(
                (table) => table.id === newReferencedTableId,
            );

            const oldReferencedColumnIds = Array.isArray(oldFk.referencedColumnsIds)
                ? oldFk.referencedColumnsIds
                : (oldLegacyForeignKey.referencedColumns ?? [])
                      .map(
                          (columnName) =>
                              oldReferencedTable?.columns.find(
                                  (column) => column.name === columnName,
                              )?.id ?? columnName,
                      )
                      .filter((columnId): columnId is string => Boolean(columnId));
            const newReferencedColumnIds = Array.isArray(newFk.referencedColumnsIds)
                ? newFk.referencedColumnsIds
                : (newLegacyForeignKey.referencedColumns ?? [])
                      .map(
                          (columnName) =>
                              newReferencedTable?.columns.find(
                                  (column) => column.name === columnName,
                              )?.id ?? columnName,
                      )
                      .filter((columnId): columnId is string => Boolean(columnId));

            const comparableOldForeignKey = {
                name: oldFk.name,
                columnIds: oldColumnIds,
                referencedTableId: oldReferencedTableId,
                referencedColumnIds: oldReferencedColumnIds,
                onDeleteAction: oldFk.onDeleteAction,
                onUpdateAction: oldFk.onUpdateAction,
            };

            const comparableNewForeignKey = {
                name: newFk.name,
                columnIds: newColumnIds,
                referencedTableId: newReferencedTableId,
                referencedColumnIds: newReferencedColumnIds,
                onDeleteAction: newFk.onDeleteAction,
                onUpdateAction: newFk.onUpdateAction,
            };

            const fkPropertyChanges = diffObject(
                comparableOldForeignKey,
                comparableNewForeignKey,
                FOREIGN_KEY_PROPERTIES,
            );

            const oldColumnsById = new Map(oldTable.columns.map((column) => [column.id, column]));
            const newColumnsById = new Map(newTable.columns.map((column) => [column.id, column]));
            const oldReferencedColumnsById = new Map(
                (oldReferencedTable?.columns ?? []).map((column) => [column.id, column]),
            );
            const newReferencedColumnsById = new Map(
                (newReferencedTable?.columns ?? []).map((column) => [column.id, column]),
            );

            const mapColumnIdsToNames = (
                ids: unknown,
                columnsById: Map<string, sd.SchemaDesigner.Column>,
            ): unknown => {
                if (!Array.isArray(ids)) {
                    return ids;
                }

                return ids.map((id) => {
                    if (typeof id !== "string") {
                        return id;
                    }

                    const column = columnsById.get(id);
                    return column?.name ?? id;
                });
            };

            const getTableDisplayName = (
                tableId: unknown,
                schema: sd.SchemaDesigner.Schema,
            ): unknown => {
                if (typeof tableId !== "string") {
                    return tableId;
                }

                const table = schema.tables.find((entry) => entry.id === tableId);
                return table?.name ?? tableId;
            };

            const displayFkPropertyChanges = fkPropertyChanges.map((propertyChange) => {
                switch (propertyChange.property) {
                    case "columnIds":
                        return {
                            ...propertyChange,
                            oldValue: mapColumnIdsToNames(propertyChange.oldValue, oldColumnsById),
                            newValue: mapColumnIdsToNames(propertyChange.newValue, newColumnsById),
                        };
                    case "referencedTableId":
                        return {
                            ...propertyChange,
                            oldValue: getTableDisplayName(propertyChange.oldValue, oldSchema),
                            newValue: getTableDisplayName(propertyChange.newValue, newSchema),
                        };
                    case "referencedColumnIds":
                        return {
                            ...propertyChange,
                            oldValue: mapColumnIdsToNames(
                                propertyChange.oldValue,
                                oldReferencedColumnsById,
                            ),
                            newValue: mapColumnIdsToNames(
                                propertyChange.newValue,
                                newReferencedColumnsById,
                            ),
                        };
                    default:
                        return propertyChange;
                }
            });
            if (fkPropertyChanges.length > 0) {
                pushChange(group, {
                    id: `foreignKey:modify:${newTable.id}:${newFk.id}`,
                    action: ChangeAction.Modify,
                    category: ChangeCategory.ForeignKey,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: newFk.id,
                    objectName: newFk.name,
                    propertyChanges: displayFkPropertyChanges,
                });
            }
        }
    }

    const groups = [...groupsByTableId.values()].filter((g) => g.changes.length > 0);
    groups.sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b)));

    const totalChanges = groups.reduce((sum, g) => sum + g.changes.length, 0);

    return {
        groups,
        totalChanges,
        hasChanges: totalChanges > 0,
    };
}
