/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDifference, MigrationOptions, DataLossSummary } from "./tableMigrationTypes";

/**
 * Generates SQL migration scripts from schema differences
 */
export class TableMigrationGenerator {
    constructor(private options: MigrationOptions = {}) {}

    /**
     * Generate a migration script from schema differences
     */
    public generate(diff: SchemaDifference, tableName: string, schema: string = "dbo"): string {
        const statements: string[] = [];

        // Add header comment
        if (this.options.includeComments !== false) {
            statements.push(`-- Migration script for table [${schema}].[${tableName}]`);
            statements.push(`-- Generated: ${new Date().toISOString()}`);
            statements.push("");
        }

        const fullTableName = `[${schema}].[${tableName}]`;

        // Drop columns
        const droppedColumns = diff.columnDifferences.filter((d) => d.type === "removed");
        for (const colDiff of droppedColumns) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Drop column ${colDiff.column.name}`);
            }
            statements.push(`ALTER TABLE ${fullTableName} DROP COLUMN [${colDiff.column.name}];`);
        }

        // Add columns
        const addedColumns = diff.columnDifferences.filter((d) => d.type === "added");
        for (const colDiff of addedColumns) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Add column ${colDiff.column.name}`);
            }
            const nullable = colDiff.column.nullable ? "NULL" : "NOT NULL";
            const defaultClause = colDiff.column.defaultValue
                ? ` DEFAULT ${colDiff.column.defaultValue}`
                : "";
            statements.push(
                `ALTER TABLE ${fullTableName} ADD [${colDiff.column.name}] ${colDiff.column.dataType} ${nullable}${defaultClause};`,
            );
        }

        // Modify columns
        const modifiedColumns = diff.columnDifferences.filter((d) => d.type === "modified");
        for (const colDiff of modifiedColumns) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Modify column ${colDiff.column.name}`);
            }
            const nullable = colDiff.column.nullable ? "NULL" : "NOT NULL";
            statements.push(
                `ALTER TABLE ${fullTableName} ALTER COLUMN [${colDiff.column.name}] ${colDiff.column.dataType} ${nullable};`,
            );

            // Handle default value changes separately
            if (colDiff.oldColumn) {
                if (colDiff.oldColumn.defaultValue && !colDiff.column.defaultValue) {
                    // Drop default constraint
                    statements.push(
                        `-- Drop default constraint for ${colDiff.column.name} (manual intervention may be required)`,
                    );
                } else if (colDiff.column.defaultValue) {
                    // Add/modify default constraint
                    statements.push(
                        `-- Add/modify default constraint for ${colDiff.column.name} (manual intervention may be required)`,
                    );
                }
            }
        }

        // Drop constraints
        const droppedConstraints = diff.constraintDifferences.filter((d) => d.type === "removed");
        for (const constraintDiff of droppedConstraints) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Drop constraint ${constraintDiff.constraint.name}`);
            }
            statements.push(
                `ALTER TABLE ${fullTableName} DROP CONSTRAINT [${constraintDiff.constraint.name}];`,
            );
        }

        // Add constraints
        const addedConstraints = diff.constraintDifferences.filter((d) => d.type === "added");
        for (const constraintDiff of addedConstraints) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Add constraint ${constraintDiff.constraint.name}`);
            }
            statements.push(
                `ALTER TABLE ${fullTableName} ADD CONSTRAINT [${constraintDiff.constraint.name}] ${constraintDiff.constraint.definition};`,
            );
        }

        // Drop indexes
        const droppedIndexes = diff.indexDifferences.filter((d) => d.type === "removed");
        for (const indexDiff of droppedIndexes) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Drop index ${indexDiff.index.name}`);
            }
            statements.push(`DROP INDEX [${indexDiff.index.name}] ON ${fullTableName};`);
        }

        // Add indexes
        const addedIndexes = diff.indexDifferences.filter((d) => d.type === "added");
        for (const indexDiff of addedIndexes) {
            if (this.options.includeComments !== false) {
                statements.push(`-- Add index ${indexDiff.index.name}`);
            }
            const unique = indexDiff.index.unique ? "UNIQUE " : "";
            const clustered = indexDiff.index.type === "CLUSTERED" ? "CLUSTERED " : "NONCLUSTERED ";
            const columns = indexDiff.index.columns.join(", ");
            statements.push(
                `CREATE ${unique}${clustered}INDEX [${indexDiff.index.name}] ON ${fullTableName} (${columns});`,
            );
        }

        return statements.join("\n");
    }

    /**
     * Analyze potential data loss from schema changes
     */
    public analyzeDataLoss(diff: SchemaDifference): DataLossSummary {
        const summary: DataLossSummary = {
            hasDataLoss: false,
            droppedColumns: [],
            modifiedColumns: [],
            droppedConstraints: [],
            droppedIndexes: [],
        };

        // Dropped columns always cause data loss
        const droppedColumns = diff.columnDifferences.filter((d) => d.type === "removed");
        if (droppedColumns.length > 0) {
            summary.hasDataLoss = true;
            summary.droppedColumns = droppedColumns.map((colDiff) => colDiff.column.name);
        }

        // Modified columns may cause data loss
        const modifiedColumns = diff.columnDifferences.filter((d) => d.type === "modified");
        for (const colDiff of modifiedColumns) {
            if (colDiff.oldColumn) {
                const canLoseData = this.canModificationCauseDataLoss(
                    colDiff.oldColumn.dataType,
                    colDiff.column.dataType,
                );
                if (canLoseData) {
                    summary.hasDataLoss = true;
                    summary.modifiedColumns.push({
                        name: colDiff.column.name,
                        oldType: colDiff.oldColumn.dataType,
                        newType: colDiff.column.dataType,
                    });
                }
            }
        }

        // Dropped constraints (especially unique/primary key) may prevent data operations
        const droppedConstraints = diff.constraintDifferences.filter((d) => d.type === "removed");
        if (droppedConstraints.length > 0) {
            summary.droppedConstraints = droppedConstraints.map(
                (constraintDiff) => constraintDiff.constraint.name,
            );
        }

        // Dropped indexes (especially unique) may affect queries
        const droppedIndexes = diff.indexDifferences.filter((d) => d.type === "removed");
        if (droppedIndexes.length > 0) {
            summary.droppedIndexes = droppedIndexes.map((indexDiff) => indexDiff.index.name);
        }

        return summary;
    }

    /**
     * Check if a data type modification can cause data loss
     */
    private canModificationCauseDataLoss(oldType: string, newType: string): boolean {
        const oldTypeNorm = oldType.toLowerCase();
        const newTypeNorm = newType.toLowerCase();

        // Same type = no data loss
        if (oldTypeNorm === newTypeNorm) {
            return false;
        }

        // String type size reductions
        if (oldTypeNorm.startsWith("varchar") && newTypeNorm.startsWith("varchar")) {
            const oldSize = this.extractSize(oldTypeNorm);
            const newSize = this.extractSize(newTypeNorm);
            if (oldSize > newSize) {
                return true;
            }
        }

        if (oldTypeNorm.startsWith("nvarchar") && newTypeNorm.startsWith("nvarchar")) {
            const oldSize = this.extractSize(oldTypeNorm);
            const newSize = this.extractSize(newTypeNorm);
            if (oldSize > newSize) {
                return true;
            }
        }

        if (oldTypeNorm.startsWith("char") && newTypeNorm.startsWith("char")) {
            const oldSize = this.extractSize(oldTypeNorm);
            const newSize = this.extractSize(newTypeNorm);
            if (oldSize > newSize) {
                return true;
            }
        }

        // Numeric precision reductions
        if (
            (oldTypeNorm.startsWith("decimal") || oldTypeNorm.startsWith("numeric")) &&
            (newTypeNorm.startsWith("decimal") || newTypeNorm.startsWith("numeric"))
        ) {
            const oldPrecision = this.extractPrecision(oldTypeNorm);
            const newPrecision = this.extractPrecision(newTypeNorm);
            if (oldPrecision.precision > newPrecision.precision) {
                return true;
            }
            if (oldPrecision.scale > newPrecision.scale) {
                return true;
            }
        }

        // Integer size reductions
        const intTypes = ["bigint", "int", "smallint", "tinyint"];
        const oldIntIndex = intTypes.indexOf(oldTypeNorm);
        const newIntIndex = intTypes.indexOf(newTypeNorm);
        if (oldIntIndex !== -1 && newIntIndex !== -1 && oldIntIndex < newIntIndex) {
            return true;
        }

        // DateTime precision changes
        if (oldTypeNorm === "datetime2" && newTypeNorm === "datetime") {
            return true;
        }

        // Assume other type changes may cause data loss
        return true;
    }

    /**
     * Extract size from type definition (e.g., "varchar(50)" -> 50)
     */
    private extractSize(type: string): number {
        const match = type.match(/\((\d+)\)/);
        if (match) {
            return parseInt(match[1], 10);
        }
        if (type.includes("(max)")) {
            return Number.MAX_SAFE_INTEGER;
        }
        return 0;
    }

    /**
     * Extract precision and scale from type definition (e.g., "decimal(10,2)" -> {precision: 10, scale: 2})
     */
    private extractPrecision(type: string): { precision: number; scale: number } {
        const match = type.match(/\((\d+),\s*(\d+)\)/);
        if (match) {
            return {
                precision: parseInt(match[1], 10),
                scale: parseInt(match[2], 10),
            };
        }
        return { precision: 0, scale: 0 };
    }
}
