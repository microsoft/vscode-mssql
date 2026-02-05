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

// ============================================================================
// Per-Attribute Diff Map (O(1) lookups)
// ============================================================================

/**
 * Key format for DiffMap entries.
 * - For add/delete: `{category}-{objectId}` (e.g., "table-abc123")
 * - For modify: `{category}-{attribute}-{objectId}` (e.g., "column-name-abc123")
 */
export type DiffMapKey = string;

/**
 * Flat map for O(1) attribute-level change queries.
 * Use getDiffMapKey() to generate keys, and query helpers for lookups.
 */
export type DiffMap = Map<DiffMapKey, AttributeDiff>;

/**
 * Represents a single attribute-level change in the diff map.
 */
export interface AttributeDiff {
    /** The type of object (table, column, foreignKey) */
    category: ChangeCategory;
    /** The type of change (add, modify, delete) */
    action: ChangeAction;
    /** The ID of the changed object */
    objectId: string;
    /** The parent table ID (same as objectId for table changes) */
    tableId: string;
    /** The specific attribute that changed (only for 'modify' actions) */
    attribute?: string;
    /** The old value (for 'modify' and 'delete' actions) */
    oldValue?: unknown;
    /** The new value (for 'modify' and 'add' actions) */
    newValue?: unknown;
    /** The full added object (only for 'add' actions) */
    addedTable?: sd.SchemaDesigner.Table;
    addedColumn?: sd.SchemaDesigner.Column;
    addedForeignKey?: sd.SchemaDesigner.ForeignKey;
}

/**
 * Extended result from calculateSchemaDiff including both grouped summary and flat map.
 */
export interface SchemaDiffResult {
    /** Grouped changes by table (existing format) */
    summary: SchemaChangesSummary;
    /** Flat map for O(1) attribute lookups */
    diffMap: DiffMap;
    /** Quick lookup: which tables have any changes */
    changedTables: Set<string>;
    /** Quick lookup: which columns have any changes */
    changedColumns: Set<string>;
    /** Quick lookup: which foreign keys have any changes */
    changedForeignKeys: Set<string>;
}

/**
 * Generates a key for the DiffMap.
 * @param category - The category of object (table, column, foreignKey)
 * @param objectId - The ID of the object
 * @param attribute - Optional attribute name (for modify changes)
 */
export function getDiffMapKey(
    category: ChangeCategory,
    objectId: string,
    attribute?: string,
): DiffMapKey {
    return attribute ? `${category}-${attribute}-${objectId}` : `${category}-${objectId}`;
}

/**
 * Checks if a specific attribute changed for an object.
 */
export function hasAttributeChange(
    diffMap: DiffMap,
    category: ChangeCategory,
    objectId: string,
    attribute: string,
): boolean {
    return diffMap.has(getDiffMapKey(category, objectId, attribute));
}

/**
 * Gets the details of an attribute change.
 */
export function getAttributeChange(
    diffMap: DiffMap,
    category: ChangeCategory,
    objectId: string,
    attribute: string,
): AttributeDiff | undefined {
    return diffMap.get(getDiffMapKey(category, objectId, attribute));
}

/**
 * Checks if an object was added or deleted (not attribute-level).
 */
export function getObjectChange(
    diffMap: DiffMap,
    category: ChangeCategory,
    objectId: string,
): AttributeDiff | undefined {
    return diffMap.get(getDiffMapKey(category, objectId));
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
    const result = calculateSchemaDiffFull(oldSchema, newSchema);
    return result.summary;
}

/**
 * Compares two schemas and returns both grouped summary and flat diff map.
 * Use this when you need O(1) attribute-level lookups.
 *
 * @param oldSchema - The original schema (baseline)
 * @param newSchema - The current schema (with modifications)
 * @returns SchemaDiffResult with summary, diffMap, and quick lookup sets
 */
export function calculateSchemaDiffFull(
    oldSchema: sd.SchemaDesigner.Schema,
    newSchema: sd.SchemaDesigner.Schema,
): SchemaDiffResult {
    const oldTablesById = mapById(oldSchema.tables ?? []);
    const newTablesById = mapById(newSchema.tables ?? []);

    const allTableIds = new Set<string>([...oldTablesById.keys(), ...newTablesById.keys()]);
    const groupsByTableId = new Map<string, TableChangeGroup>();

    // Per-attribute diff map for O(1) lookups
    const diffMap: DiffMap = new Map();
    const changedTables = new Set<string>();
    const changedColumns = new Set<string>();
    const changedForeignKeys = new Set<string>();

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

            // Add to diffMap
            changedTables.add(newTable.id);
            diffMap.set(getDiffMapKey(ChangeCategory.Table, newTable.id), {
                category: ChangeCategory.Table,
                action: ChangeAction.Add,
                objectId: newTable.id,
                tableId: newTable.id,
                addedTable: newTable,
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

                // Add FK to diffMap
                changedForeignKeys.add(fk.id);
                diffMap.set(getDiffMapKey(ChangeCategory.ForeignKey, fk.id), {
                    category: ChangeCategory.ForeignKey,
                    action: ChangeAction.Add,
                    objectId: fk.id,
                    tableId: newTable.id,
                    addedForeignKey: fk,
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

            // Add to diffMap
            changedTables.add(oldTable.id);
            diffMap.set(getDiffMapKey(ChangeCategory.Table, oldTable.id), {
                category: ChangeCategory.Table,
                action: ChangeAction.Delete,
                objectId: oldTable.id,
                tableId: oldTable.id,
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

            // Add each property change to diffMap separately for O(1) lookups
            changedTables.add(newTable.id);
            for (const propChange of tablePropertyChanges) {
                diffMap.set(getDiffMapKey(ChangeCategory.Table, newTable.id, propChange.property), {
                    category: ChangeCategory.Table,
                    action: ChangeAction.Modify,
                    objectId: newTable.id,
                    tableId: newTable.id,
                    attribute: propChange.property,
                    oldValue: propChange.oldValue,
                    newValue: propChange.newValue,
                });
            }
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

                // Add to diffMap
                changedColumns.add(newColumn.id);
                changedTables.add(newTable.id);
                diffMap.set(getDiffMapKey(ChangeCategory.Column, newColumn.id), {
                    category: ChangeCategory.Column,
                    action: ChangeAction.Add,
                    objectId: newColumn.id,
                    tableId: newTable.id,
                    addedColumn: newColumn,
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

                // Add to diffMap
                changedColumns.add(oldColumn.id);
                changedTables.add(newTable.id);
                diffMap.set(getDiffMapKey(ChangeCategory.Column, oldColumn.id), {
                    category: ChangeCategory.Column,
                    action: ChangeAction.Delete,
                    objectId: oldColumn.id,
                    tableId: newTable.id,
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

                // Add each property change to diffMap separately
                changedColumns.add(newColumn.id);
                changedTables.add(newTable.id);
                for (const propChange of columnPropertyChanges) {
                    diffMap.set(
                        getDiffMapKey(ChangeCategory.Column, newColumn.id, propChange.property),
                        {
                            category: ChangeCategory.Column,
                            action: ChangeAction.Modify,
                            objectId: newColumn.id,
                            tableId: newTable.id,
                            attribute: propChange.property,
                            oldValue: propChange.oldValue,
                            newValue: propChange.newValue,
                        },
                    );
                }
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

                // Add to diffMap
                changedForeignKeys.add(newFk.id);
                diffMap.set(getDiffMapKey(ChangeCategory.ForeignKey, newFk.id), {
                    category: ChangeCategory.ForeignKey,
                    action: ChangeAction.Add,
                    objectId: newFk.id,
                    tableId: newTable.id,
                    addedForeignKey: newFk,
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

                // Add to diffMap
                changedForeignKeys.add(oldFk.id);
                diffMap.set(getDiffMapKey(ChangeCategory.ForeignKey, oldFk.id), {
                    category: ChangeCategory.ForeignKey,
                    action: ChangeAction.Delete,
                    objectId: oldFk.id,
                    tableId: newTable.id,
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

                // Add each property change to diffMap separately
                changedForeignKeys.add(newFk.id);
                for (const propChange of fkPropertyChanges) {
                    diffMap.set(
                        getDiffMapKey(ChangeCategory.ForeignKey, newFk.id, propChange.property),
                        {
                            category: ChangeCategory.ForeignKey,
                            action: ChangeAction.Modify,
                            objectId: newFk.id,
                            tableId: newTable.id,
                            attribute: propChange.property,
                            oldValue: propChange.oldValue,
                            newValue: propChange.newValue,
                        },
                    );
                }
            }
        }
    }

    const groups = [...groupsByTableId.values()].filter((g) => g.changes.length > 0);
    groups.sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b)));

    const totalChanges = groups.reduce((sum, g) => sum + g.changes.length, 0);

    const summary: SchemaChangesSummary = {
        groups,
        totalChanges,
        hasChanges: totalChanges > 0,
    };

    return {
        summary,
        diffMap,
        changedTables,
        changedColumns,
        changedForeignKeys,
    };
}
