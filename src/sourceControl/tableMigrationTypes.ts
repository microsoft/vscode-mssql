/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Types for table schema comparison and migration script generation
 * Adapted from SQL Table Diff Parser for MSSQL extension integration
 */

/**
 * Represents a column in a SQL table
 */
export interface Column {
    name: string;
    dataType: string;
    nullable: boolean;
    identity?: {
        seed: number;
        increment: number;
    };
    defaultValue?: string;
}

/**
 * Represents an index on a SQL table
 */
export interface Index {
    name: string;
    columns: string[];
    type: "CLUSTERED" | "NONCLUSTERED";
    unique: boolean;
}

/**
 * Represents a constraint on a SQL table
 */
export interface Constraint {
    name: string;
    type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "DEFAULT";
    columns?: string[];
    definition?: string;
    clustered?: boolean;
}

/**
 * Represents a complete table schema
 */
export interface TableSchema {
    name: string;
    schema: string;
    columns: Column[];
    constraints: Constraint[];
    indexes: Index[];
}

/**
 * Represents a difference in columns
 */
export interface ColumnDifference {
    type: "added" | "removed" | "modified";
    column: Column;
    oldColumn?: Column;
}

/**
 * Represents a difference in indexes
 */
export interface IndexDifference {
    type: "added" | "removed";
    index: Index;
}

/**
 * Represents a difference in constraints
 */
export interface ConstraintDifference {
    type: "added" | "removed";
    constraint: Constraint;
}

/**
 * Represents all differences between two table schemas
 */
export interface SchemaDifference {
    columnDifferences: ColumnDifference[];
    indexDifferences: IndexDifference[];
    constraintDifferences: ConstraintDifference[];
}

/**
 * Configuration options for the migration generator
 */
export interface MigrationOptions {
    /**
     * Whether to include DROP statements for removed items
     */
    includeDrop?: boolean;

    /**
     * Whether to include comments in the generated SQL
     */
    includeComments?: boolean;

    /**
     * The target SQL dialect (currently only supports SQL Server)
     */
    dialect?: "sqlserver";
}

/**
 * Summary of potential data loss from a migration
 */
export interface DataLossSummary {
    hasDataLoss: boolean;
    droppedColumns: string[];
    droppedIndexes: string[];
    droppedConstraints: string[];
    modifiedColumns: Array<{ name: string; oldType: string; newType: string }>;
}
