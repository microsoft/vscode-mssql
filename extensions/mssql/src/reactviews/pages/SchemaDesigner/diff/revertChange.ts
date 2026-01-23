/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sd from "../../../../sharedInterfaces/schemaDesigner";
import { SchemaChange } from "./diffUtils";

/**
 * Result of canRevertChange check
 */
export interface CanRevertResult {
    canRevert: boolean;
    reason?: string;
}

/**
 * Represents the current schema state as tables (used to decouple from React Flow nodes)
 */
export interface SchemaState {
    tables: sd.SchemaDesigner.Table[];
}

/**
 * Localized messages for revert validation failures.
 * These should be provided by the caller from the localization system.
 */
export interface RevertMessages {
    cannotRevertForeignKey: string;
    cannotRevertDeletedColumn: string;
}

/**
 * Checks if a schema change can be reverted.
 *
 * Foreign keys referencing deleted tables/columns cannot be simply reverted.
 * Column deletions that affect deleted foreign keys cannot be reverted.
 *
 * @param change - The change to check
 * @param baselineSchema - The original schema (before changes)
 * @param currentSchema - The current schema state
 * @param allChanges - All current schema changes (needed for cross-reference checks)
 * @param messages - Localized messages for validation failures
 * @returns CanRevertResult indicating if the change can be reverted and why not
 */
export function canRevertChange(
    change: SchemaChange,
    baselineSchema: sd.SchemaDesigner.Schema,
    currentSchema: SchemaState,
    _allChanges: SchemaChange[],
    messages: RevertMessages,
): CanRevertResult {
    // For foreign key deletions, check if referenced table/column still exists
    if (change.category === "foreignKey" && change.action === "delete") {
        const baselineTable = baselineSchema.tables.find((t) => t.id === change.tableId);
        const baselineFk = baselineTable?.foreignKeys?.find((fk) => fk.id === change.objectId);

        if (baselineFk) {
            // Check if the referenced table still exists in current schema
            const referencedTableExists = currentSchema.tables.some(
                (table) =>
                    table.schema === baselineFk.referencedSchemaName &&
                    table.name === baselineFk.referencedTableName,
            );

            if (!referencedTableExists) {
                return { canRevert: false, reason: messages.cannotRevertForeignKey };
            }

            // Check if the referenced columns still exist
            const referencedTable = currentSchema.tables.find(
                (table) =>
                    table.schema === baselineFk.referencedSchemaName &&
                    table.name === baselineFk.referencedTableName,
            );

            if (referencedTable) {
                const missingColumns = baselineFk.referencedColumns.filter(
                    (col) => !referencedTable.columns.some((c) => c.name === col),
                );
                if (missingColumns.length > 0) {
                    return { canRevert: false, reason: messages.cannotRevertForeignKey };
                }
            }
        }
    }

    return { canRevert: true };
}

/**
 * Result of applying a revert operation
 */
export interface RevertResult {
    /** Updated tables after the revert */
    tables: sd.SchemaDesigner.Table[];
    /** Whether the revert was successful */
    success: boolean;
    /** Error message if the revert failed */
    error?: string;
}

/**
 * Creates a deep clone of an object
 */
function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Computes the reverted schema state for a given change.
 * This is a pure function that doesn't modify the input.
 *
 * @param change - The change to revert
 * @param baselineSchema - The original schema (before changes)
 * @param currentSchema - The current schema state
 * @returns RevertResult with the new schema state
 */
export function computeRevertedSchema(
    change: SchemaChange,
    baselineSchema: sd.SchemaDesigner.Schema,
    currentSchema: SchemaState,
): RevertResult {
    // Create a deep copy of current tables to avoid mutation
    const tables = deepClone(currentSchema.tables);

    if (change.category === "table") {
        return revertTableChange(change, baselineSchema, tables);
    } else if (change.category === "column") {
        return revertColumnChange(change, baselineSchema, tables);
    } else if (change.category === "foreignKey") {
        return revertForeignKeyChange(change, baselineSchema, tables);
    }

    return { tables, success: false, error: "Unknown change category" };
}

/**
 * Reverts a table-level change
 */
function revertTableChange(
    change: SchemaChange,
    baselineSchema: sd.SchemaDesigner.Schema,
    tables: sd.SchemaDesigner.Table[],
): RevertResult {
    if (change.action === "add") {
        // Revert add = delete the table
        const filteredTables = tables.filter((t) => t.id !== change.tableId);
        return { tables: filteredTables, success: true };
    } else if (change.action === "delete") {
        // Revert delete = restore the table from baseline (without foreign keys initially)
        const baselineTable = baselineSchema.tables.find((t) => t.id === change.tableId);
        if (baselineTable) {
            // Restore table without foreign keys (FKs can be restored separately)
            tables.push({ ...deepClone(baselineTable), foreignKeys: [] });
            return { tables, success: true };
        }
        return { tables, success: false, error: "Baseline table not found" };
    } else if (change.action === "modify") {
        // Revert modify = restore original name/schema properties
        const baselineTable = baselineSchema.tables.find((t) => t.id === change.tableId);
        const tableIndex = tables.findIndex((t) => t.id === change.tableId);

        if (baselineTable && tableIndex !== -1) {
            tables[tableIndex] = {
                ...tables[tableIndex],
                name: baselineTable.name,
                schema: baselineTable.schema,
            };
            return { tables, success: true };
        }
        return { tables, success: false, error: "Table not found" };
    }

    return { tables, success: false, error: "Unknown table action" };
}

/**
 * Reverts a column-level change
 */
function revertColumnChange(
    change: SchemaChange,
    baselineSchema: sd.SchemaDesigner.Schema,
    tables: sd.SchemaDesigner.Table[],
): RevertResult {
    const tableIndex = tables.findIndex((t) => t.id === change.tableId);
    const baselineTable = baselineSchema.tables.find((t) => t.id === change.tableId);

    if (tableIndex === -1) {
        return { tables, success: false, error: "Table not found" };
    }

    if (!baselineTable) {
        return { tables, success: false, error: "Baseline table not found" };
    }

    const table = tables[tableIndex];

    if (change.action === "add") {
        // Revert add = delete the column
        table.columns = table.columns.filter((c) => c.id !== change.objectId);
        return { tables, success: true };
    } else if (change.action === "delete") {
        // Revert delete = restore the column from baseline
        const baselineColumn = baselineTable.columns.find((c) => c.id === change.objectId);
        if (baselineColumn) {
            const baselineIndex = baselineTable.columns.findIndex(
                (c) => c.id === baselineColumn.id,
            );

            // Insert at the closest baseline-relative position without reordering existing columns.
            // Find the first existing column that appears after this column in the baseline ordering.
            let insertIndex = table.columns.length;
            if (baselineIndex !== -1) {
                for (let i = 0; i < table.columns.length; i++) {
                    const currentCol = table.columns[i];
                    const currentBaselineIndex = baselineTable.columns.findIndex(
                        (c) => c.id === currentCol.id,
                    );
                    if (currentBaselineIndex !== -1 && currentBaselineIndex > baselineIndex) {
                        insertIndex = i;
                        break;
                    }
                }
            }

            table.columns.splice(insertIndex, 0, deepClone(baselineColumn));
            return { tables, success: true };
        }
        return { tables, success: false, error: "Baseline column not found" };
    } else if (change.action === "modify") {
        // Revert modify = restore original column
        const baselineColumn = baselineTable.columns.find((c) => c.id === change.objectId);
        const colIndex = table.columns.findIndex((c) => c.id === change.objectId);

        if (baselineColumn && colIndex !== -1) {
            table.columns[colIndex] = deepClone(baselineColumn);
            return { tables, success: true };
        }
        return { tables, success: false, error: "Column not found" };
    }

    return { tables, success: false, error: "Unknown column action" };
}

/**
 * Reverts a foreign key change
 */
function revertForeignKeyChange(
    change: SchemaChange,
    baselineSchema: sd.SchemaDesigner.Schema,
    tables: sd.SchemaDesigner.Table[],
): RevertResult {
    const tableIndex = tables.findIndex((t) => t.id === change.tableId);

    if (tableIndex === -1) {
        return { tables, success: false, error: "Table not found" };
    }

    const table = tables[tableIndex];

    if (change.action === "add") {
        // Revert add = delete the FK
        table.foreignKeys = table.foreignKeys.filter((fk) => fk.id !== change.objectId);
        return { tables, success: true };
    }

    const baselineTable = baselineSchema.tables.find((t) => t.id === change.tableId);
    if (!baselineTable) {
        return { tables, success: false, error: "Baseline table not found" };
    }

    if (change.action === "delete") {
        // Revert delete = restore the FK from baseline
        const baselineFk = baselineTable.foreignKeys?.find((fk) => fk.id === change.objectId);
        if (baselineFk) {
            table.foreignKeys.push(deepClone(baselineFk));
            return { tables, success: true };
        }
        return { tables, success: false, error: "Baseline foreign key not found" };
    } else if (change.action === "modify") {
        // Revert modify = restore original FK
        const baselineFk = baselineTable.foreignKeys?.find((fk) => fk.id === change.objectId);
        const fkIndex = table.foreignKeys.findIndex((fk) => fk.id === change.objectId);

        if (baselineFk && fkIndex !== -1) {
            table.foreignKeys[fkIndex] = deepClone(baselineFk);
            return { tables, success: true };
        }
        return { tables, success: false, error: "Foreign key not found" };
    }

    return { tables, success: false, error: "Unknown foreign key action" };
}
