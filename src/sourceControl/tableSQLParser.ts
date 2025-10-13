/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TableSchema, Column, Constraint, Index } from "./tableMigrationTypes";

/**
 * Parses a SQL CREATE TABLE script and extracts the table schema
 */
export class TableSQLParser {
    /**
     * Parse a SQL file content and extract table schema
     */
    public parse(sqlContent: string): TableSchema {
        const cleanedContent = this.cleanSQL(sqlContent);

        const tableName = this.extractTableName(cleanedContent);
        const columns = this.extractColumns(cleanedContent);
        const constraints = this.extractConstraints(cleanedContent);
        const indexes = this.extractIndexes(sqlContent);

        return {
            name: tableName.name,
            schema: tableName.schema,
            columns,
            constraints,
            indexes,
        };
    }

    /**
     * Clean SQL content by removing comments and extra whitespace
     */
    private cleanSQL(sql: string): string {
        // Remove single-line comments
        let cleaned = sql.replace(/--[^\n]*/g, "");

        // Remove multi-line comments
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

        // Normalize whitespace
        cleaned = cleaned.replace(/\s+/g, " ").trim();

        return cleaned;
    }

    /**
     * Extract table name and schema from CREATE TABLE statement
     */
    private extractTableName(sql: string): { schema: string; name: string } {
        const match = sql.match(/CREATE\s+TABLE\s+\[?(\w+)\]?\.\[?(\w+)\]?/i);

        if (!match) {
            throw new Error("Could not find CREATE TABLE statement");
        }

        return {
            schema: match[1],
            name: match[2],
        };
    }

    /**
     * Extract columns from CREATE TABLE statement
     */
    private extractColumns(sql: string): Column[] {
        const columns: Column[] = [];

        // Extract only the CREATE TABLE portion (stop at GO or CREATE INDEX)
        const tableOnlySQL = this.extractTableDefinitionOnly(sql);

        // Extract the content between parentheses
        const tableDefMatch = tableOnlySQL.match(/CREATE\s+TABLE\s+[^\(]+\((.*)\)/is);
        if (!tableDefMatch) {
            return columns;
        }

        const tableDef = tableDefMatch[1];

        // Split by commas, but be careful with nested parentheses
        const parts = this.splitByComma(tableDef);

        for (const part of parts) {
            const trimmed = part.trim();

            // Skip constraints
            if (trimmed.match(/^CONSTRAINT\s+/i)) {
                continue;
            }

            // Parse column definition
            const column = this.parseColumnDefinition(trimmed);
            if (column) {
                columns.push(column);
            }
        }

        return columns;
    }

    /**
     * Parse a single column definition
     */
    private parseColumnDefinition(def: string): Column | null {
        // Match column name (with or without brackets)
        const nameMatch = def.match(/^\[?(\w+)\]?\s+/);
        if (!nameMatch) {
            return null;
        }

        const name = nameMatch[1];
        let remaining = def.substring(nameMatch[0].length);

        // Extract data type - handle [datatype] format as well
        const dataTypeMatch = remaining.match(/^\[?(\w+)\]?(\s*\([^)]+\))?/i);
        if (!dataTypeMatch) {
            return null;
        }

        const dataType = dataTypeMatch[0].replace(/\[|\]/g, "").trim();
        remaining = remaining.substring(dataTypeMatch[0].length);

        // Check for IDENTITY
        let identity: { seed: number; increment: number } | undefined;
        const identityMatch = remaining.match(/IDENTITY\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (identityMatch) {
            identity = {
                seed: parseInt(identityMatch[1]),
                increment: parseInt(identityMatch[2]),
            };
            remaining = remaining.replace(identityMatch[0], "");
        }

        // Check for NULL/NOT NULL
        const nullable = !remaining.match(/NOT\s+NULL/i);

        // Extract DEFAULT value
        let defaultValue: string | undefined;
        const defaultMatch = remaining.match(/DEFAULT\s+([^,\s]+(?:\s*\([^)]*\))?)/i);
        if (defaultMatch) {
            defaultValue = defaultMatch[1].trim();
        }

        return {
            name,
            dataType,
            nullable,
            identity,
            defaultValue,
        };
    }

    /**
     * Extract only the CREATE TABLE portion from SQL (excluding CREATE INDEX statements)
     */
    private extractTableDefinitionOnly(sql: string): string {
        // Find the CREATE TABLE statement and extract until the closing parenthesis
        const createTableStart = sql.search(/CREATE\s+TABLE/i);
        if (createTableStart === -1) {
            return sql;
        }

        // Find the matching closing parenthesis for the CREATE TABLE
        let depth = 0;
        let inTable = false;
        let endPos = createTableStart;

        for (let i = createTableStart; i < sql.length; i++) {
            if (sql[i] === "(") {
                depth++;
                inTable = true;
            } else if (sql[i] === ")") {
                depth--;
                if (inTable && depth === 0) {
                    endPos = i + 1;
                    break;
                }
            }
        }

        // Extract up to the end position, but also include ALTER TABLE statements
        // that might define constraints
        let result = sql.substring(0, endPos);

        // Look for ALTER TABLE ADD PRIMARY KEY/CONSTRAINT statements after CREATE TABLE
        const remainingSQL = sql.substring(endPos);
        const alterTableMatch = remainingSQL.match(
            /ALTER\s+TABLE\s+\[?\w+\]?\.\[?\w+\]?\s+ADD\s+(PRIMARY\s+KEY|CONSTRAINT\s+\[?\w+\]?)\s+[^G]*/gi,
        );

        if (alterTableMatch) {
            result += " " + alterTableMatch.join(" ");
        }

        return result;
    }

    /**
     * Extract constraints from CREATE TABLE statement
     */
    private extractConstraints(sql: string): Constraint[] {
        const constraints: Constraint[] = [];

        // First, try to extract inline constraints from CREATE TABLE
        // Use the proper method to extract table definition
        const tableDefStart = sql.search(/CREATE\s+TABLE\s+[^\(]+\(/i);
        if (tableDefStart !== -1) {
            let depth = 0;
            let startPos = -1;
            let endPos = -1;

            for (let i = tableDefStart; i < sql.length; i++) {
                if (sql[i] === "(") {
                    if (depth === 0) startPos = i + 1;
                    depth++;
                } else if (sql[i] === ")") {
                    depth--;
                    if (depth === 0) {
                        endPos = i;
                        break;
                    }
                }
            }

            if (startPos !== -1 && endPos !== -1) {
                const tableDef = sql.substring(startPos, endPos);
                const parts = this.splitByComma(tableDef);

                for (const part of parts) {
                    const trimmed = part.trim();

                    // Look for CONSTRAINT definitions
                    const constraintMatch = trimmed.match(/^CONSTRAINT\s+\[?(\w+)\]?\s+(.*)/i);
                    if (constraintMatch) {
                        const name = constraintMatch[1];
                        const definition = constraintMatch[2].trim();

                        const constraint = this.parseConstraintDefinition(name, definition);
                        if (constraint) {
                            constraints.push(constraint);
                        }
                    }
                }
            }
        }

        // Also look for ALTER TABLE ADD PRIMARY KEY/CONSTRAINT statements
        const alterTableRegex =
            /ALTER\s+TABLE\s+\[?\w+\]?\.\[?\w+\]?\s+ADD\s+(?:CONSTRAINT\s+\[?(\w+)\]?\s+)?PRIMARY\s+KEY\s+(CLUSTERED|NONCLUSTERED)?\s*\(\s*\[?(\w+)\]?\s+(?:ASC|DESC)?\s*\)/gi;

        let alterMatch;
        while ((alterMatch = alterTableRegex.exec(sql)) !== null) {
            const constraintName = alterMatch[1] || "PK_" + this.extractTableName(sql).name;
            const clustered = !alterMatch[2] || alterMatch[2].toUpperCase() === "CLUSTERED";
            const columnName = alterMatch[3];

            constraints.push({
                name: constraintName,
                type: "PRIMARY KEY",
                columns: [columnName],
                clustered: clustered,
            });
        }

        return constraints;
    }

    /**
     * Parse a constraint definition
     */
    private parseConstraintDefinition(name: string, definition: string): Constraint | null {
        // PRIMARY KEY
        if (definition.match(/^PRIMARY\s+KEY/i)) {
            const clusteredMatch = definition.match(/PRIMARY\s+KEY\s+(CLUSTERED|NONCLUSTERED)/i);
            const columnsMatch = definition.match(/\(\s*\[?(\w+)\]?(?:\s+ASC|\s+DESC)?\s*\)/i);

            return {
                name,
                type: "PRIMARY KEY",
                columns: columnsMatch ? [columnsMatch[1]] : [],
                clustered: !clusteredMatch || clusteredMatch[1].toUpperCase() === "CLUSTERED",
            };
        }

        // UNIQUE
        if (definition.match(/^UNIQUE/i)) {
            const columnsMatch = definition.match(/\(\s*\[?(\w+)\]?(?:\s+ASC|\s+DESC)?\s*\)/i);

            return {
                name,
                type: "UNIQUE",
                columns: columnsMatch ? [columnsMatch[1]] : [],
            };
        }

        // CHECK
        if (definition.match(/^CHECK/i)) {
            return {
                name,
                type: "CHECK",
                definition: definition,
            };
        }

        // FOREIGN KEY
        if (definition.match(/^FOREIGN\s+KEY/i)) {
            return {
                name,
                type: "FOREIGN KEY",
                definition: definition,
            };
        }

        return null;
    }

    /**
     * Extract indexes from the full SQL content (including CREATE INDEX statements)
     */
    private extractIndexes(sql: string): Index[] {
        const indexes: Index[] = [];

        // Match CREATE INDEX statements
        const indexRegex =
            /CREATE\s+(UNIQUE\s+)?(CLUSTERED|NONCLUSTERED)?\s*INDEX\s+\[?(\w+)\]?\s+ON\s+[^\(]+\(([^)]+)\)/gi;

        let match;
        while ((match = indexRegex.exec(sql)) !== null) {
            const unique = !!match[1];
            const type =
                (match[2]?.toUpperCase() as "CLUSTERED" | "NONCLUSTERED") || "NONCLUSTERED";
            const name = match[3];
            const columnsPart = match[4];

            // Parse columns (handle multiple columns and ASC/DESC)
            const columns = columnsPart
                .split(",")
                .map((col) => {
                    const colMatch = col.trim().match(/\[?(\w+)\]?/);
                    return colMatch ? colMatch[1] : "";
                })
                .filter((col) => col !== "");

            indexes.push({
                name,
                columns,
                type,
                unique,
            });
        }

        return indexes;
    }

    /**
     * Split a string by commas, respecting parentheses
     */
    private splitByComma(str: string): string[] {
        const parts: string[] = [];
        let current = "";
        let depth = 0;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if (char === "(") {
                depth++;
                current += char;
            } else if (char === ")") {
                depth--;
                current += char;
            } else if (char === "," && depth === 0) {
                parts.push(current);
                current = "";
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            parts.push(current);
        }

        return parts;
    }
}
