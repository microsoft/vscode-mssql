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
    { key: "columns", displayName: "Columns" },
    { key: "referencedSchemaName", displayName: "Referenced Schema" },
    { key: "referencedTableName", displayName: "Referenced Table" },
    { key: "referencedColumns", displayName: "Referenced Columns" },
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

    // Cache of oldName -> newName rename maps for tables whose columns were renamed.
    const columnRenameCache = new Map<string, Map<string, string>>();

    function getColumnRenameMap(tableId: string): Map<string, string> {
        const cached = columnRenameCache.get(tableId);
        if (cached) {
            return cached;
        }

        const oldTable = oldTablesById.get(tableId);
        const newTable = newTablesById.get(tableId);
        const renameMap = new Map<string, string>();

        if (oldTable && newTable) {
            const oldColsById = mapById(oldTable.columns ?? []);
            for (const newCol of newTable.columns ?? []) {
                const oldCol = oldColsById.get(newCol.id);
                if (oldCol && oldCol.name !== newCol.name) {
                    renameMap.set(oldCol.name, newCol.name);
                }
            }
        }

        columnRenameCache.set(tableId, renameMap);
        return renameMap;
    }

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

            const fkPropertyChanges = diffObject(oldFk, newFk, FOREIGN_KEY_PROPERTIES);
            if (fkPropertyChanges.length > 0) {
                // Hide FK modify changes that are purely derived from renaming a referenced column.
                // Users will revert the column rename (and we propagate edges/FKs) rather than reverting the FK.
                if (
                    fkPropertyChanges.length === 1 &&
                    fkPropertyChanges[0].property === "referencedColumns"
                ) {
                    const referencedTable = newSchema.tables.find(
                        (t) =>
                            t.schema === newFk.referencedSchemaName &&
                            t.name === newFk.referencedTableName,
                    );

                    if (referencedTable) {
                        const renameMap = getColumnRenameMap(referencedTable.id);
                        if (
                            renameMap.size > 0 &&
                            oldFk.referencedColumns.length === newFk.referencedColumns.length &&
                            oldFk.referencedColumns.every(
                                (oldCol, idx) =>
                                    renameMap.get(oldCol) === newFk.referencedColumns[idx],
                            )
                        ) {
                            continue;
                        }
                    }
                }

                pushChange(group, {
                    id: `foreignKey:modify:${newTable.id}:${newFk.id}`,
                    action: ChangeAction.Modify,
                    category: ChangeCategory.ForeignKey,
                    tableId: newTable.id,
                    tableName: newTable.name,
                    tableSchema: newTable.schema,
                    objectId: newFk.id,
                    objectName: newFk.name,
                    propertyChanges: fkPropertyChanges,
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
