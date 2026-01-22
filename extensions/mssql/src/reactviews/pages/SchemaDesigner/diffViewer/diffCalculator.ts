/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

/**
 * Maps column names to their change types within a specific table.
 * Used by useColumnDiffIndicator hook to determine indicator color.
 */
export interface ColumnChangeMap {
    [columnName: string]: SchemaDesigner.SchemaChangeType;
}

/**
 * Maps table IDs to their column change maps.
 * Stored in DiffViewerState for efficient lookup.
 */
export interface TableColumnChanges {
    [tableId: string]: ColumnChangeMap;
}

/**
 * Information about a deleted column needed for inline display.
 * Includes original position to maintain visual ordering.
 */
export interface DeletedColumnInfo {
    /** Column name (for display) */
    name: string;
    /** Data type (for display in column list) */
    dataType: string;
    /** Whether this was a primary key column */
    isPrimaryKey: boolean;
    /** Original index in the column array (for sorting) */
    originalIndex: number;
}

/**
 * Maps table IDs to arrays of their deleted columns.
 * Used to render deleted columns inline in table nodes.
 */
export interface DeletedColumnsMap {
    [tableId: string]: DeletedColumnInfo[];
}

/**
 * Extended diff calculation result with column-level tracking.
 */
export interface ExtendedDiffResult extends SchemaDesigner.DiffCalculationResult {
    /** Column-level changes indexed by table ID and column name */
    tableColumnChanges: TableColumnChanges;
    /** Deleted columns indexed by table ID */
    deletedColumns: DeletedColumnsMap;
    /** Ghost nodes for deleted tables (T008) */
    ghostNodes: SchemaDesigner.GhostNodeData[];
    /** Ghost edges for deleted foreign keys (T009) */
    ghostEdges: SchemaDesigner.GhostEdgeData[];
    /** Rename info indexed by table ID (T034) */
    tableRenameInfo: { [tableId: string]: SchemaDesigner.RenameDisplayInfo };
    /** FK modification type indexed by FK ID (T042) */
    fkModificationType: { [fkId: string]: "property" | "structural" };
}

/**
 * Table positions indexed by table ID.
 * Used for ghost node positioning.
 */
export interface TablePositionMap {
    [tableId: string]: { x: number; y: number };
}

/**
 * Build ghost nodes from deleted tables (T008).
 * Creates GhostNodeData for tables that exist in original but not current schema.
 *
 * @param originalTables - Tables from the original schema
 * @param currentTableIds - Set of table IDs in the current schema
 * @param tablePositions - Map of table IDs to their positions
 * @returns Array of GhostNodeData for deleted tables
 */
export function buildGhostNodesFromDeletedTables(
    originalTables: SchemaDesigner.Table[],
    currentTableIds: Set<string>,
    tablePositions: TablePositionMap,
): SchemaDesigner.GhostNodeData[] {
    const ghostNodes: SchemaDesigner.GhostNodeData[] = [];

    for (const table of originalTables) {
        if (!currentTableIds.has(table.id)) {
            const position = tablePositions[table.id] || { x: 0, y: 0 };
            ghostNodes.push({
                ...table,
                isGhostNode: true,
                originalPosition: position,
            });
        }
    }

    return ghostNodes;
}

/**
 * Build ghost edges from deleted foreign keys (T009).
 * Creates GhostEdgeData for FKs that exist in original but not current schema.
 *
 * @param originalTables - Tables from the original schema
 * @param currentSchema - Current schema with tables
 * @returns Array of GhostEdgeData for deleted foreign keys
 */
export function buildGhostEdgesFromDeletedForeignKeys(
    originalTables: SchemaDesigner.Table[],
    currentSchema: SchemaDesigner.Schema,
): SchemaDesigner.GhostEdgeData[] {
    const ghostEdges: SchemaDesigner.GhostEdgeData[] = [];

    // Build a set of current FK IDs for quick lookup
    const currentFkIds = new Set<string>();
    for (const table of currentSchema.tables) {
        for (const fk of table.foreignKeys) {
            currentFkIds.add(fk.id);
        }
    }

    // Find deleted FKs from all original tables
    for (const table of originalTables) {
        for (const fk of table.foreignKeys) {
            if (!currentFkIds.has(fk.id)) {
                // Find the target table for this FK
                const targetTable = originalTables.find(
                    (t) =>
                        t.schema === fk.referencedSchemaName && t.name === fk.referencedTableName,
                );

                ghostEdges.push({
                    id: fk.id,
                    sourceTableId: table.id,
                    targetTableId: targetTable?.id || "",
                    sourceColumn: fk.columns[0] || "",
                    targetColumn: fk.referencedColumns[0] || "",
                    fkData: fk,
                });
            }
        }
    }

    return ghostEdges;
}

/**
 * Check if a foreign key change is structural (columns/references changed)
 * vs property-only (name, onDelete, onUpdate changed) (T041).
 *
 * @param originalFK - Original foreign key
 * @param currentFK - Current foreign key
 * @returns true if structural change, false if property-only change
 */
export function isStructuralFKChange(
    originalFK: SchemaDesigner.ForeignKey,
    currentFK: SchemaDesigner.ForeignKey,
): boolean {
    // Structural changes: columns or referenced columns/table changed
    const columnsChanged =
        JSON.stringify(originalFK.columns.sort()) !== JSON.stringify(currentFK.columns.sort());
    const referencedColumnsChanged =
        JSON.stringify(originalFK.referencedColumns.sort()) !==
        JSON.stringify(currentFK.referencedColumns.sort());
    const referencedTableChanged =
        originalFK.referencedSchemaName !== currentFK.referencedSchemaName ||
        originalFK.referencedTableName !== currentFK.referencedTableName;

    return columnsChanged || referencedColumnsChanged || referencedTableChanged;
}

/**
 * Generates a unique ID for a change
 */
function generateChangeId(): string {
    return `change-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates a display name for a table (schema.name format)
 */
function getTableDisplayName(table: SchemaDesigner.Table): string {
    return `${table.schema}.${table.name}`;
}

/**
 * Compares two columns and returns whether they are equal
 */
function columnsEqual(col1: SchemaDesigner.Column, col2: SchemaDesigner.Column): boolean {
    return (
        col1.name === col2.name &&
        col1.dataType === col2.dataType &&
        col1.maxLength === col2.maxLength &&
        col1.precision === col2.precision &&
        col1.scale === col2.scale &&
        col1.isPrimaryKey === col2.isPrimaryKey &&
        col1.isNullable === col2.isNullable &&
        col1.defaultValue === col2.defaultValue &&
        col1.isIdentity === col2.isIdentity &&
        col1.identitySeed === col2.identitySeed &&
        col1.identityIncrement === col2.identityIncrement &&
        col1.isComputed === col2.isComputed &&
        col1.computedFormula === col2.computedFormula &&
        col1.computedPersisted === col2.computedPersisted
    );
}

/**
 * Compares two foreign keys and returns whether they are equal
 */
function foreignKeysEqual(fk1: SchemaDesigner.ForeignKey, fk2: SchemaDesigner.ForeignKey): boolean {
    return (
        fk1.name === fk2.name &&
        fk1.referencedSchemaName === fk2.referencedSchemaName &&
        fk1.referencedTableName === fk2.referencedTableName &&
        fk1.onDeleteAction === fk2.onDeleteAction &&
        fk1.onUpdateAction === fk2.onUpdateAction &&
        JSON.stringify(fk1.columns.sort()) === JSON.stringify(fk2.columns.sort()) &&
        JSON.stringify(fk1.referencedColumns.sort()) ===
            JSON.stringify(fk2.referencedColumns.sort())
    );
}

/**
 * Creates a human-readable description for a column change
 */
function describeColumnChange(
    changeType: SchemaDesigner.SchemaChangeType,
    column: SchemaDesigner.Column,
    previousColumn?: SchemaDesigner.Column,
): string {
    const dataTypeDisplay = column.maxLength
        ? `${column.dataType}(${column.maxLength})`
        : column.dataType;

    switch (changeType) {
        case SchemaDesigner.SchemaChangeType.Addition:
            return `Added column '${column.name}' (${dataTypeDisplay})`;
        case SchemaDesigner.SchemaChangeType.Deletion:
            return `Deleted column '${column.name}'`;
        case SchemaDesigner.SchemaChangeType.Modification:
            if (previousColumn) {
                const changes: string[] = [];
                if (previousColumn.name !== column.name) {
                    changes.push(`renamed from '${previousColumn.name}'`);
                }
                if (previousColumn.dataType !== column.dataType) {
                    changes.push(`type changed to ${column.dataType}`);
                }
                if (previousColumn.maxLength !== column.maxLength) {
                    changes.push(`length changed to ${column.maxLength}`);
                }
                if (previousColumn.isNullable !== column.isNullable) {
                    changes.push(column.isNullable ? "now nullable" : "now not nullable");
                }
                if (previousColumn.isPrimaryKey !== column.isPrimaryKey) {
                    changes.push(
                        column.isPrimaryKey ? "added to primary key" : "removed from primary key",
                    );
                }
                return `Modified column '${column.name}': ${changes.join(", ") || "properties changed"}`;
            }
            return `Modified column '${column.name}'`;
    }
}

/**
 * Creates a human-readable description for a foreign key change
 */
function describeForeignKeyChange(
    changeType: SchemaDesigner.SchemaChangeType,
    fk: SchemaDesigner.ForeignKey,
): string {
    const target = `${fk.referencedSchemaName}.${fk.referencedTableName}`;
    switch (changeType) {
        case SchemaDesigner.SchemaChangeType.Addition:
            return `Added foreign key '${fk.name}' → ${target}`;
        case SchemaDesigner.SchemaChangeType.Deletion:
            return `Deleted foreign key '${fk.name}'`;
        case SchemaDesigner.SchemaChangeType.Modification:
            return `Modified foreign key '${fk.name}' → ${target}`;
    }
}

/**
 * Creates a human-readable description for a table change
 */
function describeTableChange(
    changeType: SchemaDesigner.SchemaChangeType,
    table: SchemaDesigner.Table,
): string {
    const displayName = getTableDisplayName(table);
    switch (changeType) {
        case SchemaDesigner.SchemaChangeType.Addition:
            return `Added table '${displayName}'`;
        case SchemaDesigner.SchemaChangeType.Deletion:
            return `Deleted table '${displayName}'`;
        case SchemaDesigner.SchemaChangeType.Modification:
            return `Modified table '${displayName}'`;
    }
}

/**
 * Calculates the aggregate state for a change group
 */
function calculateAggregateState(
    _changes: SchemaDesigner.SchemaChange[],
    tableExistedBefore: boolean,
    tableExistsNow: boolean,
): SchemaDesigner.SchemaChangeType {
    // If table didn't exist before and all changes are additions, it's a new table
    if (!tableExistedBefore && tableExistsNow) {
        return SchemaDesigner.SchemaChangeType.Addition;
    }
    // If table existed before but doesn't exist now, it's deleted
    if (tableExistedBefore && !tableExistsNow) {
        return SchemaDesigner.SchemaChangeType.Deletion;
    }
    // Otherwise it's modified
    return SchemaDesigner.SchemaChangeType.Modification;
}

/**
 * Service for calculating schema differences.
 *
 * Compares original schema (cached at session start) with current schema
 * (from ReactFlow state) to produce a list of changes grouped by table.
 *
 * Implements the IDiffCalculator interface from the contracts.
 */
export class DiffCalculator {
    /**
     * Calculate differences between original and current schema
     * @param input Original and current schema states
     * @returns Extended diff calculation result with changes grouped by table and column-level tracking
     */
    public calculateDiff(input: SchemaDesigner.DiffCalculationInput): ExtendedDiffResult {
        const { originalSchema, currentSchema } = input;
        const changes: SchemaDesigner.SchemaChange[] = [];
        const changesByTable = new Map<string, SchemaDesigner.SchemaChange[]>();

        // Column-level change tracking for UI indicators
        const tableColumnChanges: TableColumnChanges = {};
        const deletedColumns: DeletedColumnsMap = {};

        // Create lookup maps for efficient comparison
        const originalTablesMap = new Map(originalSchema.tables.map((t) => [t.id, t]));
        const currentTablesMap = new Map(currentSchema.tables.map((t) => [t.id, t]));

        // Track which tables existed before and exist now
        const tableExistence = new Map<string, { before: boolean; after: boolean }>();

        // Initialize existence tracking
        originalSchema.tables.forEach((t) => {
            tableExistence.set(t.id, { before: true, after: currentTablesMap.has(t.id) });
        });
        currentSchema.tables.forEach((t) => {
            if (!tableExistence.has(t.id)) {
                tableExistence.set(t.id, { before: false, after: true });
            }
        });

        // Find deleted tables
        Array.from(originalTablesMap.entries()).forEach(([tableId, originalTable]) => {
            if (!currentTablesMap.has(tableId)) {
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Deletion,
                    entityType: SchemaDesigner.SchemaEntityType.Table,
                    tableId,
                    tableName: getTableDisplayName(originalTable),
                    entityId: tableId,
                    entityName: originalTable.name,
                    previousValue: originalTable,
                    currentValue: undefined,
                    description: describeTableChange(
                        SchemaDesigner.SchemaChangeType.Deletion,
                        originalTable,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, tableId, change);
            }
        });

        // Find added tables and compare existing tables
        Array.from(currentTablesMap.entries()).forEach(([tableId, currentTable]) => {
            const originalTable = originalTablesMap.get(tableId);

            if (!originalTable) {
                // New table
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Addition,
                    entityType: SchemaDesigner.SchemaEntityType.Table,
                    tableId,
                    tableName: getTableDisplayName(currentTable),
                    entityId: tableId,
                    entityName: currentTable.name,
                    previousValue: undefined,
                    currentValue: currentTable,
                    description: describeTableChange(
                        SchemaDesigner.SchemaChangeType.Addition,
                        currentTable,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, tableId, change);

                // T050, T051: For new tables, also create separate FK entries for each foreign key
                // This enables granular undo and reveal for FKs on new tables
                currentTable.foreignKeys.forEach((fk) => {
                    const fkChange: SchemaDesigner.SchemaChange = {
                        id: generateChangeId(),
                        changeType: SchemaDesigner.SchemaChangeType.Addition,
                        entityType: SchemaDesigner.SchemaEntityType.ForeignKey,
                        tableId,
                        tableName: getTableDisplayName(currentTable),
                        entityId: fk.id,
                        entityName: fk.name,
                        previousValue: undefined,
                        currentValue: fk,
                        description: describeForeignKeyChange(
                            SchemaDesigner.SchemaChangeType.Addition,
                            fk,
                        ),
                    };
                    changes.push(fkChange);
                    this.addChangeToTable(changesByTable, tableId, fkChange);
                });
            } else {
                // Table exists in both - compare columns and foreign keys
                this.compareColumns(
                    originalTable,
                    currentTable,
                    changes,
                    changesByTable,
                    tableColumnChanges,
                    deletedColumns,
                );
                this.compareForeignKeys(originalTable, currentTable, changes, changesByTable);

                // Check if table properties changed (name, schema)
                if (
                    originalTable.name !== currentTable.name ||
                    originalTable.schema !== currentTable.schema
                ) {
                    const change: SchemaDesigner.SchemaChange = {
                        id: generateChangeId(),
                        changeType: SchemaDesigner.SchemaChangeType.Modification,
                        entityType: SchemaDesigner.SchemaEntityType.Table,
                        tableId,
                        tableName: getTableDisplayName(currentTable),
                        entityId: tableId,
                        entityName: currentTable.name,
                        previousValue: { name: originalTable.name, schema: originalTable.schema },
                        currentValue: { name: currentTable.name, schema: currentTable.schema },
                        description: `Renamed table from '${getTableDisplayName(originalTable)}' to '${getTableDisplayName(currentTable)}'`,
                    };
                    changes.push(change);
                    this.addChangeToTable(changesByTable, tableId, change);
                }
            }
        });

        // Build change groups
        const changeGroups: SchemaDesigner.ChangeGroup[] = [];
        Array.from(changesByTable.entries()).forEach(([tableId, tableChanges]) => {
            const existence = tableExistence.get(tableId) || { before: false, after: false };
            const table = currentTablesMap.get(tableId) || originalTablesMap.get(tableId);

            if (table && tableChanges.length > 0) {
                changeGroups.push({
                    tableId,
                    tableName: getTableDisplayName(table),
                    schemaName: table.schema,
                    aggregateState: calculateAggregateState(
                        tableChanges,
                        existence.before,
                        existence.after,
                    ),
                    changes: tableChanges,
                    isExpanded: true, // Default to expanded
                });
            }
        });

        // Sort groups by table name for consistent ordering
        changeGroups.sort((a, b) => a.tableName.localeCompare(b.tableName));

        // Calculate summary
        const summary: SchemaDesigner.ChangeCountSummary = {
            additions: changes.filter(
                (c) => c.changeType === SchemaDesigner.SchemaChangeType.Addition,
            ).length,
            modifications: changes.filter(
                (c) => c.changeType === SchemaDesigner.SchemaChangeType.Modification,
            ).length,
            deletions: changes.filter(
                (c) => c.changeType === SchemaDesigner.SchemaChangeType.Deletion,
            ).length,
            total: changes.length,
        };

        // Build ghost nodes for deleted tables (T010)
        const currentTableIdSet = new Set(currentSchema.tables.map((t) => t.id));
        // Note: Table positions are not available in schema objects.
        // For deleted tables, we use default position (0, 0).
        // In a future enhancement, positions could be captured when originalSchema is stored.
        const tablePositions: TablePositionMap = {};
        for (const table of originalSchema.tables) {
            tablePositions[table.id] = { x: 0, y: 0 };
        }
        const ghostNodes = buildGhostNodesFromDeletedTables(
            originalSchema.tables,
            currentTableIdSet,
            tablePositions,
        );

        // Build ghost edges for deleted foreign keys (T011)
        const ghostEdges = buildGhostEdgesFromDeletedForeignKeys(
            originalSchema.tables,
            currentSchema,
        );

        // Build table rename info (T034)
        const tableRenameInfo: { [tableId: string]: SchemaDesigner.RenameDisplayInfo } = {};
        for (const change of changes) {
            if (
                change.entityType === SchemaDesigner.SchemaEntityType.Table &&
                change.changeType === SchemaDesigner.SchemaChangeType.Modification &&
                change.previousValue &&
                change.currentValue
            ) {
                const prev = change.previousValue as { name: string; schema: string };
                const curr = change.currentValue as { name: string; schema: string };
                const schemaChanged = prev.schema !== curr.schema;
                const nameChanged = prev.name !== curr.name;

                if (schemaChanged || nameChanged) {
                    tableRenameInfo[change.tableId] = {
                        oldDisplayName: `${prev.schema}.${prev.name}`,
                        oldSchema: prev.schema,
                        oldName: prev.name,
                        schemaChanged,
                        nameChanged,
                    };
                }
            }
        }

        // Build FK modification type map (T042)
        const fkModificationType: { [fkId: string]: "property" | "structural" } = {};
        for (const change of changes) {
            if (
                change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey &&
                change.changeType === SchemaDesigner.SchemaChangeType.Modification &&
                change.previousValue &&
                change.currentValue
            ) {
                const originalFK = change.previousValue as SchemaDesigner.ForeignKey;
                const currentFK = change.currentValue as SchemaDesigner.ForeignKey;
                const isStructural = isStructuralFKChange(originalFK, currentFK);
                fkModificationType[change.entityId] = isStructural ? "structural" : "property";

                // For structural changes, also create a ghost edge for the old FK position (T044)
                if (isStructural) {
                    const sourceTable = originalSchema.tables.find((t) =>
                        t.foreignKeys.some((fk) => fk.id === change.entityId),
                    );
                    if (sourceTable) {
                        const targetTable = originalSchema.tables.find(
                            (t) =>
                                t.schema === originalFK.referencedSchemaName &&
                                t.name === originalFK.referencedTableName,
                        );
                        ghostEdges.push({
                            id: `${change.entityId}-old`,
                            sourceTableId: sourceTable.id,
                            targetTableId: targetTable?.id || "",
                            sourceColumn: originalFK.columns[0] || "",
                            targetColumn: originalFK.referencedColumns[0] || "",
                            fkData: originalFK,
                        });
                    }
                }
            }
        }

        return {
            changes,
            changeGroups,
            summary,
            hasChanges: changes.length > 0,
            tableColumnChanges,
            deletedColumns,
            ghostNodes,
            ghostEdges,
            tableRenameInfo,
            fkModificationType,
        };
    }

    /**
     * Compare columns between original and current table
     */
    private compareColumns(
        originalTable: SchemaDesigner.Table,
        currentTable: SchemaDesigner.Table,
        changes: SchemaDesigner.SchemaChange[],
        changesByTable: Map<string, SchemaDesigner.SchemaChange[]>,
        tableColumnChanges: TableColumnChanges,
        deletedColumnsMap: DeletedColumnsMap,
    ): void {
        const originalColumnsMap = new Map(originalTable.columns.map((c) => [c.id, c]));
        const currentColumnsMap = new Map(currentTable.columns.map((c) => [c.id, c]));
        const tableName = getTableDisplayName(currentTable);
        const tableId = currentTable.id;

        // Initialize column changes map for this table
        if (!tableColumnChanges[tableId]) {
            tableColumnChanges[tableId] = {};
        }

        // Find deleted columns and track them for inline display
        Array.from(originalColumnsMap.entries()).forEach(([columnId, originalColumn]) => {
            if (!currentColumnsMap.has(columnId)) {
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Deletion,
                    entityType: SchemaDesigner.SchemaEntityType.Column,
                    tableId: currentTable.id,
                    tableName,
                    entityId: columnId,
                    entityName: originalColumn.name,
                    previousValue: originalColumn,
                    currentValue: undefined,
                    description: describeColumnChange(
                        SchemaDesigner.SchemaChangeType.Deletion,
                        originalColumn,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, currentTable.id, change);

                // Track column change type by column name for UI indicator
                tableColumnChanges[tableId][originalColumn.name] =
                    SchemaDesigner.SchemaChangeType.Deletion;

                // Track deleted column info for inline display
                // Find original index in the original table's column array
                const originalIndex = originalTable.columns.findIndex((c) => c.id === columnId);
                if (!deletedColumnsMap[tableId]) {
                    deletedColumnsMap[tableId] = [];
                }
                deletedColumnsMap[tableId].push({
                    name: originalColumn.name,
                    dataType: originalColumn.dataType || "",
                    isPrimaryKey: originalColumn.isPrimaryKey || false,
                    originalIndex: originalIndex >= 0 ? originalIndex : 0,
                });
            }
        });

        // Find added and modified columns
        Array.from(currentColumnsMap.entries()).forEach(([columnId, currentColumn]) => {
            const originalColumn = originalColumnsMap.get(columnId);

            if (!originalColumn) {
                // New column
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Addition,
                    entityType: SchemaDesigner.SchemaEntityType.Column,
                    tableId: currentTable.id,
                    tableName,
                    entityId: columnId,
                    entityName: currentColumn.name,
                    previousValue: undefined,
                    currentValue: currentColumn,
                    description: describeColumnChange(
                        SchemaDesigner.SchemaChangeType.Addition,
                        currentColumn,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, currentTable.id, change);

                // Track column change type by column name for UI indicator
                tableColumnChanges[tableId][currentColumn.name] =
                    SchemaDesigner.SchemaChangeType.Addition;
            } else if (!columnsEqual(originalColumn, currentColumn)) {
                // Modified column
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Modification,
                    entityType: SchemaDesigner.SchemaEntityType.Column,
                    tableId: currentTable.id,
                    tableName,
                    entityId: columnId,
                    entityName: currentColumn.name,
                    previousValue: originalColumn,
                    currentValue: currentColumn,
                    description: describeColumnChange(
                        SchemaDesigner.SchemaChangeType.Modification,
                        currentColumn,
                        originalColumn,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, currentTable.id, change);

                // Track column change type by column name for UI indicator
                tableColumnChanges[tableId][currentColumn.name] =
                    SchemaDesigner.SchemaChangeType.Modification;
            }
        });
    }
    /**
     * Compare foreign keys between original and current table
     */
    private compareForeignKeys(
        originalTable: SchemaDesigner.Table,
        currentTable: SchemaDesigner.Table,
        changes: SchemaDesigner.SchemaChange[],
        changesByTable: Map<string, SchemaDesigner.SchemaChange[]>,
    ): void {
        const originalFKsMap = new Map(originalTable.foreignKeys.map((fk) => [fk.id, fk]));
        const currentFKsMap = new Map(currentTable.foreignKeys.map((fk) => [fk.id, fk]));
        const tableName = getTableDisplayName(currentTable);

        // Find deleted foreign keys
        Array.from(originalFKsMap.entries()).forEach(([fkId, originalFK]) => {
            if (!currentFKsMap.has(fkId)) {
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Deletion,
                    entityType: SchemaDesigner.SchemaEntityType.ForeignKey,
                    tableId: currentTable.id,
                    tableName,
                    entityId: fkId,
                    entityName: originalFK.name,
                    previousValue: originalFK,
                    currentValue: undefined,
                    description: describeForeignKeyChange(
                        SchemaDesigner.SchemaChangeType.Deletion,
                        originalFK,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, currentTable.id, change);
            }
        });

        // Find added and modified foreign keys
        Array.from(currentFKsMap.entries()).forEach(([fkId, currentFK]) => {
            const originalFK = originalFKsMap.get(fkId);

            if (!originalFK) {
                // New foreign key
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Addition,
                    entityType: SchemaDesigner.SchemaEntityType.ForeignKey,
                    tableId: currentTable.id,
                    tableName,
                    entityId: fkId,
                    entityName: currentFK.name,
                    previousValue: undefined,
                    currentValue: currentFK,
                    description: describeForeignKeyChange(
                        SchemaDesigner.SchemaChangeType.Addition,
                        currentFK,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, currentTable.id, change);
            } else if (!foreignKeysEqual(originalFK, currentFK)) {
                // Modified foreign key
                const change: SchemaDesigner.SchemaChange = {
                    id: generateChangeId(),
                    changeType: SchemaDesigner.SchemaChangeType.Modification,
                    entityType: SchemaDesigner.SchemaEntityType.ForeignKey,
                    tableId: currentTable.id,
                    tableName,
                    entityId: fkId,
                    entityName: currentFK.name,
                    previousValue: originalFK,
                    currentValue: currentFK,
                    description: describeForeignKeyChange(
                        SchemaDesigner.SchemaChangeType.Modification,
                        currentFK,
                    ),
                };
                changes.push(change);
                this.addChangeToTable(changesByTable, currentTable.id, change);
            }
        });
    }

    /**
     * Helper to add a change to the table's change list
     */
    private addChangeToTable(
        changesByTable: Map<string, SchemaDesigner.SchemaChange[]>,
        tableId: string,
        change: SchemaDesigner.SchemaChange,
    ): void {
        const tableChanges = changesByTable.get(tableId) || [];
        tableChanges.push(change);
        changesByTable.set(tableId, tableChanges);
    }
}

/**
 * Singleton instance for the diff calculator
 */
let diffCalculatorInstance: DiffCalculator | undefined = undefined;

/**
 * Get the singleton DiffCalculator instance
 */
export function getDiffCalculator(): DiffCalculator {
    if (!diffCalculatorInstance) {
        diffCalculatorInstance = new DiffCalculator();
    }
    return diffCalculatorInstance;
}
