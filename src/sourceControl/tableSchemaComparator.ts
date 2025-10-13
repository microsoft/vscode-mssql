/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    TableSchema,
    Column,
    Index,
    Constraint,
    SchemaDifference,
    ColumnDifference,
    IndexDifference,
    ConstraintDifference,
} from "./tableMigrationTypes";

/**
 * Compares two table schemas and identifies differences
 */
export class TableSchemaComparator {
    /**
     * Compare two table schemas and return the differences
     */
    public compare(beforeSchema: TableSchema, afterSchema: TableSchema): SchemaDifference {
        const columnDifferences = this.compareColumns(beforeSchema.columns, afterSchema.columns);
        const indexDifferences = this.compareIndexes(beforeSchema.indexes, afterSchema.indexes);
        const constraintDifferences = this.compareConstraints(
            beforeSchema.constraints,
            afterSchema.constraints,
        );

        return {
            columnDifferences,
            indexDifferences,
            constraintDifferences,
        };
    }

    /**
     * Compare columns between two schemas
     */
    private compareColumns(beforeColumns: Column[], afterColumns: Column[]): ColumnDifference[] {
        const differences: ColumnDifference[] = [];

        // Find added and modified columns
        for (const afterCol of afterColumns) {
            const beforeCol = beforeColumns.find((c) => c.name === afterCol.name);

            if (!beforeCol) {
                // Column was added
                differences.push({
                    type: "added",
                    column: afterCol,
                });
            } else if (!this.columnsEqual(beforeCol, afterCol)) {
                // Column was modified
                differences.push({
                    type: "modified",
                    column: afterCol,
                    oldColumn: beforeCol,
                });
            }
        }

        // Find removed columns
        for (const beforeCol of beforeColumns) {
            const afterCol = afterColumns.find((c) => c.name === beforeCol.name);

            if (!afterCol) {
                differences.push({
                    type: "removed",
                    column: beforeCol,
                });
            }
        }

        return differences;
    }

    /**
     * Check if two columns are equal
     */
    private columnsEqual(col1: Column, col2: Column): boolean {
        return (
            col1.name === col2.name &&
            col1.dataType === col2.dataType &&
            col1.nullable === col2.nullable &&
            col1.defaultValue === col2.defaultValue &&
            this.identityEqual(col1.identity, col2.identity)
        );
    }

    /**
     * Check if two identity specifications are equal
     */
    private identityEqual(
        id1: { seed: number; increment: number } | undefined,
        id2: { seed: number; increment: number } | undefined,
    ): boolean {
        if (!id1 && !id2) return true;
        if (!id1 || !id2) return false;
        return id1.seed === id2.seed && id1.increment === id2.increment;
    }

    /**
     * Compare indexes between two schemas
     */
    private compareIndexes(beforeIndexes: Index[], afterIndexes: Index[]): IndexDifference[] {
        const differences: IndexDifference[] = [];

        // Find added indexes
        for (const afterIdx of afterIndexes) {
            const beforeIdx = beforeIndexes.find((i) => i.name === afterIdx.name);

            if (!beforeIdx) {
                differences.push({
                    type: "added",
                    index: afterIdx,
                });
            } else if (!this.indexesEqual(beforeIdx, afterIdx)) {
                // If index definition changed, treat as remove + add
                differences.push({
                    type: "removed",
                    index: beforeIdx,
                });
                differences.push({
                    type: "added",
                    index: afterIdx,
                });
            }
        }

        // Find removed indexes
        for (const beforeIdx of beforeIndexes) {
            const afterIdx = afterIndexes.find((i) => i.name === beforeIdx.name);

            if (!afterIdx) {
                differences.push({
                    type: "removed",
                    index: beforeIdx,
                });
            }
        }

        return differences;
    }

    /**
     * Check if two indexes are equal
     */
    private indexesEqual(idx1: Index, idx2: Index): boolean {
        return (
            idx1.name === idx2.name &&
            idx1.type === idx2.type &&
            idx1.unique === idx2.unique &&
            this.arraysEqual(idx1.columns, idx2.columns)
        );
    }

    /**
     * Compare constraints between two schemas
     */
    private compareConstraints(
        beforeConstraints: Constraint[],
        afterConstraints: Constraint[],
    ): ConstraintDifference[] {
        const differences: ConstraintDifference[] = [];

        // Find added constraints
        for (const afterCon of afterConstraints) {
            const beforeCon = beforeConstraints.find((c) => c.name === afterCon.name);

            if (!beforeCon) {
                differences.push({
                    type: "added",
                    constraint: afterCon,
                });
            } else if (!this.constraintsEqual(beforeCon, afterCon)) {
                // If constraint definition changed, treat as remove + add
                differences.push({
                    type: "removed",
                    constraint: beforeCon,
                });
                differences.push({
                    type: "added",
                    constraint: afterCon,
                });
            }
        }

        // Find removed constraints
        for (const beforeCon of beforeConstraints) {
            const afterCon = afterConstraints.find((c) => c.name === beforeCon.name);

            if (!afterCon) {
                differences.push({
                    type: "removed",
                    constraint: beforeCon,
                });
            }
        }

        return differences;
    }

    /**
     * Check if two constraints are equal
     */
    private constraintsEqual(con1: Constraint, con2: Constraint): boolean {
        if (con1.type !== con2.type) return false;
        if (con1.definition !== con2.definition) return false;
        if (con1.clustered !== con2.clustered) return false;

        if (con1.columns && con2.columns) {
            return this.arraysEqual(con1.columns, con2.columns);
        }

        return !con1.columns && !con2.columns;
    }

    /**
     * Check if two arrays are equal
     */
    private arraysEqual(arr1: string[], arr2: string[]): boolean {
        if (arr1.length !== arr2.length) return false;
        return arr1.every((val, idx) => val === arr2[idx]);
    }
}
