/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * T-SQL snippet data asset for the native TypeScript T-SQL language service.
 *
 * Provenance:
 *  - Generated: 2026-07-05 (hand-maintained; there is no build-time generator yet —
 *    update by editing this file directly).
 *  - Curated skeletons for the statements most commonly typed by hand in SQL Server
 *    tooling (DML, DDL, CTEs, error handling, transactions, cursors, window functions),
 *    following the uppercase-keyword style used elsewhere in the language service.
 *  - Bodies use VS Code snippet syntax: $1..$n tabstops and ${1:placeholder} defaults,
 *    with \n line breaks. Repeated tabstop numbers are mirrored edits.
 *
 * This file must stay dependency-free: import NOTHING (an eslint rule bans imports
 * of vscode/node/other directories from src/sqlLanguage/data).
 */

export interface SqlSnippetInfo {
    /** Display label, e.g. "SELECT ... FROM". */
    readonly name: string;
    /** Filter/trigger word, e.g. "select". */
    readonly prefix: string;
    /** Snippet body with $1..$n / ${1:placeholder} tabstops and \n line breaks. */
    readonly body: string;
    readonly description: string;
}

export const TSQL_SNIPPETS: readonly SqlSnippetInfo[] = [
    {
        name: "SELECT ... FROM ... WHERE",
        prefix: "select",
        body: "SELECT ${1:column_list}\nFROM ${2:table_or_view}\nWHERE ${3:condition};",
        description: "Basic SELECT statement with a WHERE clause.",
    },
    {
        name: "SELECT TOP (n) ... FROM",
        prefix: "selecttop",
        body: "SELECT TOP (${1:10}) ${2:column_list}\nFROM ${3:table_or_view}\nORDER BY ${4:column} ${5:DESC};",
        description: "SELECT the top n rows with an ORDER BY clause.",
    },
    {
        name: "INSERT INTO ... VALUES",
        prefix: "insert",
        body: "INSERT INTO ${1:table} (${2:column_list})\nVALUES (${3:value_list});",
        description: "Insert a row of literal values into a table.",
    },
    {
        name: "INSERT INTO ... SELECT",
        prefix: "insertselect",
        body: "INSERT INTO ${1:target_table} (${2:column_list})\nSELECT ${3:column_list}\nFROM ${4:source_table}\nWHERE ${5:condition};",
        description: "Insert rows from a query into a table.",
    },
    {
        name: "UPDATE ... SET ... WHERE",
        prefix: "update",
        body: "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
        description: "Update rows that match a condition.",
    },
    {
        name: "DELETE FROM ... WHERE",
        prefix: "delete",
        body: "DELETE FROM ${1:table}\nWHERE ${2:condition};",
        description: "Delete rows that match a condition.",
    },
    {
        name: "MERGE skeleton",
        prefix: "merge",
        body: "MERGE ${1:target_table} AS target\nUSING ${2:source_table} AS source\n    ON target.${3:key} = source.${3:key}\nWHEN MATCHED THEN\n    UPDATE SET target.${4:column} = source.${4:column}\nWHEN NOT MATCHED BY TARGET THEN\n    INSERT (${5:column_list})\n    VALUES (${6:value_list})\nWHEN NOT MATCHED BY SOURCE THEN\n    DELETE;",
        description:
            "MERGE with matched, not-matched-by-target, and not-matched-by-source branches.",
    },
    {
        name: "CTE (WITH ... AS)",
        prefix: "cte",
        body: "WITH ${1:cte_name} AS (\n    SELECT ${2:column_list}\n    FROM ${3:table}\n)\nSELECT ${4:column_list}\nFROM ${1:cte_name};",
        description: "Common table expression followed by a SELECT.",
    },
    {
        name: "Recursive CTE",
        prefix: "cterecursive",
        body: "WITH ${1:cte_name} AS (\n    -- Anchor member\n    SELECT ${2:column_list}, 0 AS RecursionLevel\n    FROM ${3:table}\n    WHERE ${4:anchor_condition}\n    UNION ALL\n    -- Recursive member\n    SELECT ${5:t.column_list}, c.RecursionLevel + 1\n    FROM ${3:table} AS t\n    INNER JOIN ${1:cte_name} AS c\n        ON t.${6:parent_key} = c.${7:key}\n)\nSELECT *\nFROM ${1:cte_name}\nOPTION (MAXRECURSION ${8:100});",
        description: "Recursive common table expression with anchor and recursive members.",
    },
    {
        name: "CREATE TABLE with primary key",
        prefix: "createtable",
        body: "CREATE TABLE ${1:dbo}.${2:TableName} (\n    ${3:Id} INT IDENTITY(1, 1) NOT NULL,\n    ${4:Name} NVARCHAR(${5:100}) NOT NULL,\n    CONSTRAINT PK_${2:TableName} PRIMARY KEY CLUSTERED (${3:Id})\n);",
        description: "Create a table with an identity column and a clustered primary key.",
    },
    {
        name: "CREATE PROCEDURE",
        prefix: "createproc",
        body: "CREATE PROCEDURE ${1:dbo}.${2:ProcedureName}\n    ${3:@Param1} ${4:INT}\nAS\nBEGIN\n    SET NOCOUNT ON;\n\n    ${5:-- procedure body}\nEND;",
        description: "Create a stored procedure with SET NOCOUNT ON in a BEGIN/END block.",
    },
    {
        name: "CREATE OR ALTER VIEW",
        prefix: "createview",
        body: "CREATE OR ALTER VIEW ${1:dbo}.${2:ViewName}\nAS\nSELECT ${3:column_list}\nFROM ${4:table};",
        description: "Create or alter a view over a SELECT statement.",
    },
    {
        name: "CREATE INDEX",
        prefix: "createindex",
        body: "CREATE NONCLUSTERED INDEX ${1:IX_TableName_ColumnName}\n    ON ${2:dbo}.${3:TableName} (${4:column_list});",
        description: "Create a nonclustered index on one or more columns.",
    },
    {
        name: "CREATE FUNCTION (scalar)",
        prefix: "createfunction",
        body: "CREATE FUNCTION ${1:dbo}.${2:FunctionName}\n(\n    ${3:@Param1} ${4:INT}\n)\nRETURNS ${5:INT}\nAS\nBEGIN\n    RETURN ${6:@Param1};\nEND;",
        description: "Create a scalar user-defined function.",
    },
    {
        name: "BEGIN TRY / CATCH with THROW",
        prefix: "trycatch",
        body: "BEGIN TRY\n    ${1:-- statements}\nEND TRY\nBEGIN CATCH\n    ${2:-- handle error}\n    THROW;\nEND CATCH;",
        description: "Structured error handling that rethrows with THROW.",
    },
    {
        name: "BEGIN TRAN / COMMIT / ROLLBACK",
        prefix: "begintran",
        body: "BEGIN TRANSACTION;\n\nBEGIN TRY\n    ${1:-- statements}\n\n    COMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH\n    IF @@TRANCOUNT > 0\n        ROLLBACK TRANSACTION;\n    THROW;\nEND CATCH;",
        description: "Transaction wrapped in TRY/CATCH: commit on success, roll back on error.",
    },
    {
        name: "IF EXISTS",
        prefix: "ifexists",
        body: "IF EXISTS (\n    SELECT 1\n    FROM ${1:table}\n    WHERE ${2:condition}\n)\nBEGIN\n    ${3:-- statements}\nEND;",
        description: "Conditional block guarded by an EXISTS check.",
    },
    {
        name: "WHILE loop",
        prefix: "while",
        body: "DECLARE ${1:@i} INT = ${2:0};\n\nWHILE ${1:@i} < ${3:10}\nBEGIN\n    ${4:-- statements}\n    SET ${1:@i} += 1;\nEND;",
        description: "WHILE loop over a counter variable.",
    },
    {
        name: "CURSOR skeleton",
        prefix: "cursor",
        body: "DECLARE ${1:@value} ${2:INT};\n\nDECLARE ${3:cursor_name} CURSOR LOCAL FAST_FORWARD FOR\n    SELECT ${4:column}\n    FROM ${5:table};\n\nOPEN ${3:cursor_name};\nFETCH NEXT FROM ${3:cursor_name} INTO ${1:@value};\n\nWHILE @@FETCH_STATUS = 0\nBEGIN\n    ${6:-- statements}\n    FETCH NEXT FROM ${3:cursor_name} INTO ${1:@value};\nEND;\n\nCLOSE ${3:cursor_name};\nDEALLOCATE ${3:cursor_name};",
        description: "Full cursor lifecycle: declare, open, fetch loop, close, deallocate.",
    },
    {
        name: "EXISTS subquery",
        prefix: "exists",
        body: "SELECT ${1:column_list}\nFROM ${2:outer_table} AS o\nWHERE EXISTS (\n    SELECT 1\n    FROM ${3:inner_table} AS i\n    WHERE i.${4:key} = o.${4:key}\n);",
        description: "SELECT filtered by a correlated EXISTS subquery.",
    },
    {
        name: "INNER JOIN ... ON",
        prefix: "join",
        body: "SELECT ${1:column_list}\nFROM ${2:left_table} AS l\nINNER JOIN ${3:right_table} AS r\n    ON l.${4:key} = r.${5:key};",
        description: "Two-table INNER JOIN skeleton with aliases.",
    },
    {
        name: "GROUP BY with HAVING",
        prefix: "groupby",
        body: "SELECT ${1:group_column}, COUNT(*) AS ${2:RowCount}\nFROM ${3:table}\nGROUP BY ${1:group_column}\nHAVING COUNT(*) > ${4:1};",
        description: "Aggregate query with GROUP BY and a HAVING filter.",
    },
    {
        name: "ROW_NUMBER() OVER",
        prefix: "rownumber",
        body: "SELECT ${1:column_list},\n    ROW_NUMBER() OVER (\n        PARTITION BY ${2:partition_column}\n        ORDER BY ${3:order_column} ${4:DESC}\n    ) AS ${5:RowNum}\nFROM ${6:table};",
        description: "Window function numbering rows within each partition.",
    },
];
