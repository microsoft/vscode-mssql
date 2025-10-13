/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Service for detecting DDL (Data Definition Language) statements in SQL queries
 */
export class DdlDetectionService {
    // DDL keywords that modify schema structure
    private static readonly DDL_KEYWORDS = [
        // Table operations
        "CREATE TABLE",
        "ALTER TABLE",
        "DROP TABLE",
        "RENAME TABLE",
        "TRUNCATE TABLE",

        // View operations
        "CREATE VIEW",
        "ALTER VIEW",
        "DROP VIEW",

        // Stored Procedure operations
        "CREATE PROCEDURE",
        "CREATE PROC",
        "ALTER PROCEDURE",
        "ALTER PROC",
        "DROP PROCEDURE",
        "DROP PROC",

        // Function operations
        "CREATE FUNCTION",
        "ALTER FUNCTION",
        "DROP FUNCTION",

        // Index operations
        "CREATE INDEX",
        "CREATE UNIQUE INDEX",
        "CREATE CLUSTERED INDEX",
        "CREATE NONCLUSTERED INDEX",
        "DROP INDEX",
        "ALTER INDEX",

        // Schema operations
        "CREATE SCHEMA",
        "ALTER SCHEMA",
        "DROP SCHEMA",

        // Type operations
        "CREATE TYPE",
        "DROP TYPE",

        // Trigger operations
        "CREATE TRIGGER",
        "ALTER TRIGGER",
        "DROP TRIGGER",

        // Sequence operations
        "CREATE SEQUENCE",
        "ALTER SEQUENCE",
        "DROP SEQUENCE",

        // Synonym operations
        "CREATE SYNONYM",
        "DROP SYNONYM",

        // Database operations (less common but still DDL)
        "CREATE DATABASE",
        "ALTER DATABASE",
        "DROP DATABASE",
    ];

    /**
     * Check if a SQL query contains DDL statements
     * @param queryText The SQL query text to analyze
     * @returns True if the query contains DDL statements
     */
    public static containsDdl(queryText: string): boolean {
        if (!queryText || queryText.trim().length === 0) {
            return false;
        }

        // Normalize the query text for analysis
        const normalizedQuery = this.normalizeQuery(queryText);

        // Check for DDL keywords
        return this.DDL_KEYWORDS.some((keyword) => {
            // Create a regex pattern that matches the keyword as a whole word
            // This prevents false positives like "CREATE" in a comment or string
            const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, "\\s+")}\\b`, "i");
            return pattern.test(normalizedQuery);
        });
    }

    /**
     * Normalize query text for DDL detection
     * Removes comments and string literals to avoid false positives
     */
    private static normalizeQuery(queryText: string): string {
        let normalized = queryText;

        // Remove single-line comments (-- comment)
        normalized = normalized.replace(/--[^\n\r]*/g, " ");

        // Remove multi-line comments (/* comment */)
        normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, " ");

        // Remove string literals (both single and double quotes)
        // This prevents detecting DDL keywords inside strings
        normalized = normalized.replace(/'(?:[^']|'')*'/g, " ");
        normalized = normalized.replace(/"(?:[^"]|"")*"/g, " ");

        // Remove square bracket identifiers [table name]
        normalized = normalized.replace(/\[[^\]]*\]/g, " ");

        return normalized;
    }

    /**
     * Extract DDL statement types from a query
     * Useful for logging and telemetry
     */
    public static extractDdlTypes(queryText: string): string[] {
        if (!queryText || queryText.trim().length === 0) {
            return [];
        }

        const normalizedQuery = this.normalizeQuery(queryText);
        const foundTypes: string[] = [];

        for (const keyword of this.DDL_KEYWORDS) {
            const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, "\\s+")}\\b`, "i");
            if (pattern.test(normalizedQuery)) {
                foundTypes.push(keyword);
            }
        }

        return foundTypes;
    }
}
