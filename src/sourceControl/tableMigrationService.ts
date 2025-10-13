/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TableSQLParser } from "./tableSQLParser";
import { TableSchemaComparator } from "./tableSchemaComparator";
import { TableMigrationGenerator } from "./tableMigrationGenerator";
import {
    TableSchema,
    SchemaDifference,
    MigrationOptions,
    DataLossSummary,
} from "./tableMigrationTypes";

/**
 * Service for generating table migration scripts
 * Handles comparison of table schemas and generation of ALTER scripts
 */
export class TableMigrationService {
    private parser: TableSQLParser;
    private comparator: TableSchemaComparator;
    private generator: TableMigrationGenerator;

    constructor(options: MigrationOptions = {}) {
        this.parser = new TableSQLParser();
        this.comparator = new TableSchemaComparator();
        this.generator = new TableMigrationGenerator(options);
    }

    /**
     * Compare two SQL CREATE TABLE scripts and generate migration script
     * @param databaseSQL SQL content from the database (current state)
     * @param gitSQL SQL content from Git repository (target state)
     * @returns Migration SQL script to transform database to match Git
     */
    public generateMigrationScript(databaseSQL: string, gitSQL: string): string {
        const databaseSchema = this.parser.parse(databaseSQL);
        const gitSchema = this.parser.parse(gitSQL);

        // Compare database (before) to git (after)
        // This generates a script to transform database to match git
        const differences = this.comparator.compare(databaseSchema, gitSchema);

        return this.generator.generate(differences, gitSchema.name, gitSchema.schema);
    }

    /**
     * Analyze potential data loss from discarding changes
     * @param databaseSQL SQL content from the database (current state)
     * @param gitSQL SQL content from Git repository (target state)
     * @returns Summary of potential data loss
     */
    public analyzeDataLoss(databaseSQL: string, gitSQL: string): DataLossSummary {
        const databaseSchema = this.parser.parse(databaseSQL);
        const gitSchema = this.parser.parse(gitSQL);

        const differences = this.comparator.compare(databaseSchema, gitSchema);

        return this.generator.analyzeDataLoss(differences);
    }

    /**
     * Get structured differences between database and Git schemas
     * @param databaseSQL SQL content from the database (current state)
     * @param gitSQL SQL content from Git repository (target state)
     * @returns Schema differences object
     */
    public getDifferences(databaseSQL: string, gitSQL: string): SchemaDifference {
        const databaseSchema = this.parser.parse(databaseSQL);
        const gitSchema = this.parser.parse(gitSQL);

        return this.comparator.compare(databaseSchema, gitSchema);
    }

    /**
     * Parse a SQL CREATE TABLE script and return the table schema
     * @param sql SQL content
     * @returns Table schema object
     */
    public parseTableSchema(sql: string): TableSchema {
        return this.parser.parse(sql);
    }

    /**
     * Format a data loss summary into a human-readable message
     * @param summary Data loss summary
     * @returns Formatted message string
     */
    public formatDataLossSummary(summary: DataLossSummary): string {
        if (!summary.hasDataLoss) {
            return "No data loss expected from this operation.";
        }

        const messages: string[] = [];

        if (summary.droppedColumns.length > 0) {
            messages.push(
                `⚠️ ${summary.droppedColumns.length} column(s) will be DROPPED (data will be lost):\n` +
                    summary.droppedColumns.map((col) => `   • ${col}`).join("\n"),
            );
        }

        if (summary.modifiedColumns.length > 0) {
            messages.push(
                `⚠️ ${summary.modifiedColumns.length} column(s) will be MODIFIED (potential data loss):\n` +
                    summary.modifiedColumns
                        .map((col) => `   • ${col.name}: ${col.oldType} → ${col.newType}`)
                        .join("\n"),
            );
        }

        if (summary.droppedConstraints.length > 0) {
            messages.push(
                `⚠️ ${summary.droppedConstraints.length} constraint(s) will be DROPPED:\n` +
                    summary.droppedConstraints.map((con) => `   • ${con}`).join("\n"),
            );
        }

        if (summary.droppedIndexes.length > 0) {
            messages.push(
                `⚠️ ${summary.droppedIndexes.length} index(es) will be DROPPED:\n` +
                    summary.droppedIndexes.map((idx) => `   • ${idx}`).join("\n"),
            );
        }

        return messages.join("\n\n");
    }
}
