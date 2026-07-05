/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * T-SQL keyword data asset for the native TypeScript T-SQL language service.
 *
 * Provenance:
 *  - Generated: 2026-07-05 (hand-maintained; there is no build-time generator yet —
 *    update by editing this file directly).
 *  - Curated from the Microsoft Learn "Reserved Keywords (Transact-SQL)" list
 *    (https://learn.microsoft.com/en-us/sql/t-sql/language-elements/reserved-keywords-transact-sql),
 *    plus common contextual/clause keywords used by SQL Server tooling (built-in type
 *    names, MERGE/window/hint/isolation-level words, the GO batch separator, etc.).
 *  - Multi-word reserved entries (e.g. "WITHIN GROUP") are intentionally excluded;
 *    the tokenizer only deals in single words.
 *
 * This file must stay dependency-free: import NOTHING (an eslint rule bans imports
 * of vscode/node/other directories from src/sqlLanguage/data).
 */

export type KeywordCategory =
    | "statement" // can START a statement: SELECT, INSERT, CREATE, DECLARE, IF, WHILE, BEGIN, ...
    | "clause" // clause/connective words: FROM, WHERE, GROUP, BY, JOIN, ON, UNION, TOP, AS, ...
    | "type" // built-in type names: INT, BIGINT, VARCHAR, NVARCHAR, DATETIME2, ...
    | "function" // reserved function-like builtins: COALESCE, NULLIF, CONVERT, SESSION_USER, ...
    | "operator" // word operators: AND, OR, NOT, IN, LIKE, BETWEEN, EXISTS, ALL, ANY, SOME, IS, NULL, ESCAPE
    | "reserved" // reserved words that don't fit the above (fallback bucket)
    | "contextual"; // NOT reserved but keyword-like in context: OFFSET, MATCHED, PERSISTED, NOLOCK, ...

export interface KeywordInfo {
    /** Uppercase canonical text; doubles as the stable id. */
    readonly id: string;
    readonly category: KeywordCategory;
    /** True for words on the SQL Server reserved list (cannot be an unquoted identifier). */
    readonly reserved: boolean;
}

export const TSQL_KEYWORDS: readonly KeywordInfo[] = [
    // ------------------------------------------------------------------
    // statement — words that can start a statement
    // ------------------------------------------------------------------
    { id: "ALTER", category: "statement", reserved: true },
    { id: "BACKUP", category: "statement", reserved: true },
    { id: "BEGIN", category: "statement", reserved: true },
    { id: "BREAK", category: "statement", reserved: true },
    { id: "CHECKPOINT", category: "statement", reserved: true },
    { id: "CLOSE", category: "statement", reserved: true },
    { id: "COMMIT", category: "statement", reserved: true },
    { id: "CONTINUE", category: "statement", reserved: true },
    { id: "CREATE", category: "statement", reserved: true },
    { id: "DBCC", category: "statement", reserved: true },
    { id: "DEALLOCATE", category: "statement", reserved: true },
    { id: "DECLARE", category: "statement", reserved: true },
    { id: "DELETE", category: "statement", reserved: true },
    { id: "DENY", category: "statement", reserved: true },
    { id: "DROP", category: "statement", reserved: true },
    { id: "EXEC", category: "statement", reserved: true },
    { id: "EXECUTE", category: "statement", reserved: true },
    { id: "FETCH", category: "statement", reserved: true },
    { id: "GOTO", category: "statement", reserved: true },
    { id: "GRANT", category: "statement", reserved: true },
    { id: "IF", category: "statement", reserved: true },
    { id: "INSERT", category: "statement", reserved: true },
    { id: "KILL", category: "statement", reserved: true },
    { id: "MERGE", category: "statement", reserved: true },
    { id: "OPEN", category: "statement", reserved: true },
    { id: "PRINT", category: "statement", reserved: true },
    { id: "RAISERROR", category: "statement", reserved: true },
    { id: "READTEXT", category: "statement", reserved: true },
    { id: "RECONFIGURE", category: "statement", reserved: true },
    { id: "RESTORE", category: "statement", reserved: true },
    { id: "RETURN", category: "statement", reserved: true },
    { id: "REVERT", category: "statement", reserved: true },
    { id: "REVOKE", category: "statement", reserved: true },
    { id: "ROLLBACK", category: "statement", reserved: true },
    { id: "SAVE", category: "statement", reserved: true },
    { id: "SELECT", category: "statement", reserved: true },
    { id: "SET", category: "statement", reserved: true },
    { id: "SETUSER", category: "statement", reserved: true },
    { id: "SHUTDOWN", category: "statement", reserved: true },
    { id: "TRUNCATE", category: "statement", reserved: true },
    { id: "UPDATE", category: "statement", reserved: true },
    { id: "UPDATETEXT", category: "statement", reserved: true },
    { id: "USE", category: "statement", reserved: true },
    { id: "WAITFOR", category: "statement", reserved: true },
    { id: "WHILE", category: "statement", reserved: true },
    { id: "WRITETEXT", category: "statement", reserved: true },
    // Statement starters that are NOT on the reserved list.
    { id: "GO", category: "statement", reserved: false }, // batch separator (tooling construct)
    { id: "THROW", category: "statement", reserved: false },

    // ------------------------------------------------------------------
    // clause — clause and connective words (all reserved)
    // ------------------------------------------------------------------
    { id: "ADD", category: "clause", reserved: true },
    { id: "AS", category: "clause", reserved: true },
    { id: "ASC", category: "clause", reserved: true },
    { id: "AUTHORIZATION", category: "clause", reserved: true },
    { id: "BY", category: "clause", reserved: true },
    { id: "CASCADE", category: "clause", reserved: true },
    { id: "CASE", category: "clause", reserved: true },
    { id: "COLLATE", category: "clause", reserved: true },
    { id: "CROSS", category: "clause", reserved: true },
    { id: "DESC", category: "clause", reserved: true },
    { id: "DISTINCT", category: "clause", reserved: true },
    { id: "ELSE", category: "clause", reserved: true },
    { id: "END", category: "clause", reserved: true },
    { id: "EXCEPT", category: "clause", reserved: true },
    { id: "FOR", category: "clause", reserved: true },
    { id: "FROM", category: "clause", reserved: true },
    { id: "FULL", category: "clause", reserved: true },
    { id: "GROUP", category: "clause", reserved: true },
    { id: "HAVING", category: "clause", reserved: true },
    { id: "INNER", category: "clause", reserved: true },
    { id: "INTERSECT", category: "clause", reserved: true },
    { id: "INTO", category: "clause", reserved: true },
    { id: "JOIN", category: "clause", reserved: true },
    { id: "LEFT", category: "clause", reserved: true },
    { id: "OF", category: "clause", reserved: true },
    { id: "ON", category: "clause", reserved: true },
    { id: "OPTION", category: "clause", reserved: true },
    { id: "ORDER", category: "clause", reserved: true },
    { id: "OUTER", category: "clause", reserved: true },
    { id: "OVER", category: "clause", reserved: true },
    { id: "PERCENT", category: "clause", reserved: true },
    { id: "PIVOT", category: "clause", reserved: true },
    { id: "RIGHT", category: "clause", reserved: true },
    { id: "TABLESAMPLE", category: "clause", reserved: true },
    { id: "THEN", category: "clause", reserved: true },
    { id: "TO", category: "clause", reserved: true },
    { id: "TOP", category: "clause", reserved: true },
    { id: "UNION", category: "clause", reserved: true },
    { id: "UNPIVOT", category: "clause", reserved: true },
    { id: "VALUES", category: "clause", reserved: true },
    { id: "WHEN", category: "clause", reserved: true },
    { id: "WHERE", category: "clause", reserved: true },
    { id: "WITH", category: "clause", reserved: true },

    // ------------------------------------------------------------------
    // operator — word operators (all reserved)
    // ------------------------------------------------------------------
    { id: "ALL", category: "operator", reserved: true },
    { id: "AND", category: "operator", reserved: true },
    { id: "ANY", category: "operator", reserved: true },
    { id: "BETWEEN", category: "operator", reserved: true },
    { id: "ESCAPE", category: "operator", reserved: true },
    { id: "EXISTS", category: "operator", reserved: true },
    { id: "IN", category: "operator", reserved: true },
    { id: "IS", category: "operator", reserved: true },
    { id: "LIKE", category: "operator", reserved: true },
    { id: "NOT", category: "operator", reserved: true },
    { id: "NULL", category: "operator", reserved: true },
    { id: "OR", category: "operator", reserved: true },
    { id: "SOME", category: "operator", reserved: true },

    // ------------------------------------------------------------------
    // function — reserved function-like builtins (scalar builtins,
    // niladic functions, full-text predicates, and rowset functions)
    // ------------------------------------------------------------------
    { id: "COALESCE", category: "function", reserved: true },
    { id: "CONTAINS", category: "function", reserved: true },
    { id: "CONTAINSTABLE", category: "function", reserved: true },
    { id: "CONVERT", category: "function", reserved: true },
    { id: "CURRENT_DATE", category: "function", reserved: true },
    { id: "CURRENT_TIME", category: "function", reserved: true },
    { id: "CURRENT_TIMESTAMP", category: "function", reserved: true },
    { id: "CURRENT_USER", category: "function", reserved: true },
    { id: "FREETEXT", category: "function", reserved: true },
    { id: "FREETEXTTABLE", category: "function", reserved: true },
    { id: "NULLIF", category: "function", reserved: true },
    { id: "OPENDATASOURCE", category: "function", reserved: true },
    { id: "OPENQUERY", category: "function", reserved: true },
    { id: "OPENROWSET", category: "function", reserved: true },
    { id: "OPENXML", category: "function", reserved: true },
    { id: "SEMANTICKEYPHRASETABLE", category: "function", reserved: true },
    { id: "SEMANTICSIMILARITYDETAILSTABLE", category: "function", reserved: true },
    { id: "SEMANTICSIMILARITYTABLE", category: "function", reserved: true },
    { id: "SESSION_USER", category: "function", reserved: true },
    { id: "SYSTEM_USER", category: "function", reserved: true },
    { id: "TRY_CONVERT", category: "function", reserved: true },
    { id: "USER", category: "function", reserved: true },

    // ------------------------------------------------------------------
    // type — built-in type names (NOT reserved, except DOUBLE)
    // ------------------------------------------------------------------
    { id: "BIGINT", category: "type", reserved: false },
    { id: "BINARY", category: "type", reserved: false },
    { id: "BIT", category: "type", reserved: false },
    { id: "CHAR", category: "type", reserved: false },
    { id: "DATE", category: "type", reserved: false },
    { id: "DATETIME", category: "type", reserved: false },
    { id: "DATETIME2", category: "type", reserved: false },
    { id: "DATETIMEOFFSET", category: "type", reserved: false },
    { id: "DECIMAL", category: "type", reserved: false },
    { id: "DOUBLE", category: "type", reserved: true }, // DOUBLE PRECISION; on the reserved list
    { id: "FLOAT", category: "type", reserved: false },
    { id: "GEOGRAPHY", category: "type", reserved: false },
    { id: "GEOMETRY", category: "type", reserved: false },
    { id: "HIERARCHYID", category: "type", reserved: false },
    { id: "IMAGE", category: "type", reserved: false },
    { id: "INT", category: "type", reserved: false },
    { id: "INTEGER", category: "type", reserved: false },
    { id: "JSON", category: "type", reserved: false },
    { id: "MONEY", category: "type", reserved: false },
    { id: "NCHAR", category: "type", reserved: false },
    { id: "NTEXT", category: "type", reserved: false },
    { id: "NUMERIC", category: "type", reserved: false },
    { id: "NVARCHAR", category: "type", reserved: false },
    { id: "REAL", category: "type", reserved: false },
    { id: "ROWVERSION", category: "type", reserved: false },
    { id: "SMALLDATETIME", category: "type", reserved: false },
    { id: "SMALLINT", category: "type", reserved: false },
    { id: "SMALLMONEY", category: "type", reserved: false },
    { id: "SQL_VARIANT", category: "type", reserved: false },
    { id: "TEXT", category: "type", reserved: false },
    { id: "TIME", category: "type", reserved: false },
    { id: "TIMESTAMP", category: "type", reserved: false }, // legacy synonym of ROWVERSION; kept as a type
    { id: "TINYINT", category: "type", reserved: false },
    { id: "UNIQUEIDENTIFIER", category: "type", reserved: false },
    { id: "VARBINARY", category: "type", reserved: false },
    { id: "VARCHAR", category: "type", reserved: false },
    { id: "VECTOR", category: "type", reserved: false },
    { id: "XML", category: "type", reserved: false },

    // ------------------------------------------------------------------
    // reserved — remaining words on the reserved list (fallback bucket:
    // object nouns, constraint/DDL modifiers, legacy/discontinued words)
    // ------------------------------------------------------------------
    { id: "BROWSE", category: "reserved", reserved: true },
    { id: "BULK", category: "reserved", reserved: true },
    { id: "CHECK", category: "reserved", reserved: true },
    { id: "CLUSTERED", category: "reserved", reserved: true },
    { id: "COLUMN", category: "reserved", reserved: true },
    { id: "COMPUTE", category: "reserved", reserved: true },
    { id: "CONSTRAINT", category: "reserved", reserved: true },
    { id: "CURRENT", category: "reserved", reserved: true },
    { id: "CURSOR", category: "reserved", reserved: true },
    { id: "DATABASE", category: "reserved", reserved: true },
    { id: "DEFAULT", category: "reserved", reserved: true },
    { id: "DISK", category: "reserved", reserved: true },
    { id: "DISTRIBUTED", category: "reserved", reserved: true },
    { id: "DUMP", category: "reserved", reserved: true },
    { id: "ERRLVL", category: "reserved", reserved: true },
    { id: "EXIT", category: "reserved", reserved: true },
    { id: "EXTERNAL", category: "reserved", reserved: true },
    { id: "FILE", category: "reserved", reserved: true },
    { id: "FILLFACTOR", category: "reserved", reserved: true },
    { id: "FOREIGN", category: "reserved", reserved: true },
    { id: "FUNCTION", category: "reserved", reserved: true },
    { id: "HOLDLOCK", category: "reserved", reserved: true },
    { id: "IDENTITY", category: "reserved", reserved: true },
    { id: "IDENTITY_INSERT", category: "reserved", reserved: true },
    { id: "IDENTITYCOL", category: "reserved", reserved: true },
    { id: "INDEX", category: "reserved", reserved: true },
    { id: "KEY", category: "reserved", reserved: true },
    { id: "LINENO", category: "reserved", reserved: true },
    { id: "LOAD", category: "reserved", reserved: true },
    { id: "NATIONAL", category: "reserved", reserved: true },
    { id: "NOCHECK", category: "reserved", reserved: true },
    { id: "NONCLUSTERED", category: "reserved", reserved: true },
    { id: "OFF", category: "reserved", reserved: true },
    { id: "OFFSETS", category: "reserved", reserved: true },
    { id: "PLAN", category: "reserved", reserved: true },
    { id: "PRECISION", category: "reserved", reserved: true },
    { id: "PRIMARY", category: "reserved", reserved: true },
    { id: "PROC", category: "reserved", reserved: true },
    { id: "PROCEDURE", category: "reserved", reserved: true },
    { id: "PUBLIC", category: "reserved", reserved: true },
    { id: "READ", category: "reserved", reserved: true },
    { id: "REFERENCES", category: "reserved", reserved: true },
    { id: "REPLICATION", category: "reserved", reserved: true },
    { id: "RESTRICT", category: "reserved", reserved: true },
    { id: "ROWCOUNT", category: "reserved", reserved: true },
    { id: "ROWGUIDCOL", category: "reserved", reserved: true },
    { id: "RULE", category: "reserved", reserved: true },
    { id: "SCHEMA", category: "reserved", reserved: true },
    { id: "SECURITYAUDIT", category: "reserved", reserved: true },
    { id: "STATISTICS", category: "reserved", reserved: true },
    { id: "TABLE", category: "reserved", reserved: true },
    { id: "TEXTSIZE", category: "reserved", reserved: true },
    { id: "TRAN", category: "reserved", reserved: true },
    { id: "TRANSACTION", category: "reserved", reserved: true },
    { id: "TRIGGER", category: "reserved", reserved: true },
    { id: "TSEQUAL", category: "reserved", reserved: true },
    { id: "UNIQUE", category: "reserved", reserved: true },
    { id: "VARYING", category: "reserved", reserved: true },
    { id: "VIEW", category: "reserved", reserved: true },

    // ------------------------------------------------------------------
    // contextual — NOT reserved, but keyword-like in context (legal
    // identifiers; the language service classifies them as keyword-capable)
    // ------------------------------------------------------------------
    // OFFSET ... FETCH / window frames / ORDER BY modifiers
    { id: "OFFSET", category: "contextual", reserved: false },
    { id: "ROWS", category: "contextual", reserved: false },
    { id: "ROW", category: "contextual", reserved: false },
    { id: "ONLY", category: "contextual", reserved: false },
    { id: "PARTITION", category: "contextual", reserved: false },
    { id: "RANGE", category: "contextual", reserved: false },
    { id: "PRECEDING", category: "contextual", reserved: false },
    { id: "FOLLOWING", category: "contextual", reserved: false },
    { id: "UNBOUNDED", category: "contextual", reserved: false },
    { id: "TIES", category: "contextual", reserved: false },
    { id: "NEXT", category: "contextual", reserved: false },
    { id: "FIRST", category: "contextual", reserved: false },
    { id: "LAST", category: "contextual", reserved: false },
    // MERGE / DML output
    { id: "MATCHED", category: "contextual", reserved: false },
    { id: "TARGET", category: "contextual", reserved: false },
    { id: "SOURCE", category: "contextual", reserved: false },
    { id: "OUTPUT", category: "contextual", reserved: false },
    { id: "INSERTED", category: "contextual", reserved: false },
    { id: "DELETED", category: "contextual", reserved: false },
    // TRY...CATCH
    { id: "TRY", category: "contextual", reserved: false },
    { id: "CATCH", category: "contextual", reserved: false },
    // DDL modifiers
    { id: "PERSISTED", category: "contextual", reserved: false },
    { id: "INCLUDE", category: "contextual", reserved: false },
    { id: "RETURNS", category: "contextual", reserved: false },
    { id: "LOGIN", category: "contextual", reserved: false },
    // Table sources
    { id: "APPLY", category: "contextual", reserved: false },
    // Table hints
    { id: "NOLOCK", category: "contextual", reserved: false },
    { id: "READPAST", category: "contextual", reserved: false },
    { id: "XLOCK", category: "contextual", reserved: false },
    { id: "UPDLOCK", category: "contextual", reserved: false },
    { id: "ROWLOCK", category: "contextual", reserved: false },
    { id: "TABLOCK", category: "contextual", reserved: false },
    { id: "TABLOCKX", category: "contextual", reserved: false },
    // Isolation levels
    { id: "ISOLATION", category: "contextual", reserved: false },
    { id: "LEVEL", category: "contextual", reserved: false },
    { id: "SERIALIZABLE", category: "contextual", reserved: false },
    { id: "SNAPSHOT", category: "contextual", reserved: false },
    { id: "REPEATABLE", category: "contextual", reserved: false },
    { id: "COMMITTED", category: "contextual", reserved: false },
    { id: "UNCOMMITTED", category: "contextual", reserved: false },
    // Query hints
    { id: "RECOMPILE", category: "contextual", reserved: false },
    { id: "MAXDOP", category: "contextual", reserved: false },
    { id: "OPTIMIZE", category: "contextual", reserved: false },
    { id: "FAST", category: "contextual", reserved: false },
    { id: "FORCESEEK", category: "contextual", reserved: false },
    { id: "FORCESCAN", category: "contextual", reserved: false },
];

/** Uppercase text -> info. */
export const TSQL_KEYWORD_MAP: ReadonlyMap<string, KeywordInfo> = new Map(
    TSQL_KEYWORDS.map((k) => [k.id, k]),
);
