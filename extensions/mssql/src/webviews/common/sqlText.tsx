/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens as fluentTokens } from "@fluentui/react-components";
import { HTMLAttributes, useMemo } from "react";

export type SqlTextTokenKind =
    | "text"
    | "keyword"
    | "function"
    | "type"
    | "string"
    | "number"
    | "comment"
    | "identifier"
    | "variable"
    | "operator";

export interface SqlTextToken {
    kind: SqlTextTokenKind;
    text: string;
}

export const SQL_TEXT_LINE_BREAK = "↵";

const sqlKeywords = new Set([
    "ADD",
    "ALL",
    "ALTER",
    "AND",
    "ANY",
    "APPLY",
    "AS",
    "ASC",
    "BACKUP",
    "BEGIN",
    "BETWEEN",
    "BREAK",
    "BY",
    "CASE",
    "CATCH",
    "CHECK",
    "COMMIT",
    "CONSTRAINT",
    "CONTINUE",
    "CREATE",
    "CROSS",
    "CURRENT",
    "DATABASE",
    "DEFAULT",
    "DELETE",
    "DESC",
    "DISTINCT",
    "DROP",
    "ELSE",
    "END",
    "ESCAPE",
    "EXCEPT",
    "EXEC",
    "EXECUTE",
    "EXISTS",
    "FETCH",
    "FOR",
    "FOREIGN",
    "FROM",
    "FULL",
    "FUNCTION",
    "GO",
    "GRANT",
    "GROUP",
    "HAVING",
    "IF",
    "IN",
    "INDEX",
    "INNER",
    "INSERT",
    "INTERSECT",
    "INTO",
    "IS",
    "JOIN",
    "KEY",
    "LEFT",
    "LIKE",
    "MERGE",
    "NEXT",
    "NOT",
    "NULL",
    "OFFSET",
    "ON",
    "OPEN",
    "OPTION",
    "OR",
    "ORDER",
    "OUTER",
    "OUTPUT",
    "OVER",
    "PARTITION",
    "PRIMARY",
    "PRINT",
    "PROCEDURE",
    "RAISERROR",
    "REFERENCES",
    "RESTORE",
    "RETURN",
    "REVOKE",
    "RIGHT",
    "ROLLBACK",
    "ROW",
    "ROWS",
    "SELECT",
    "SET",
    "TABLE",
    "THEN",
    "THROW",
    "TOP",
    "TRANSACTION",
    "TRIGGER",
    "TRUNCATE",
    "TRY",
    "UNION",
    "UNIQUE",
    "UPDATE",
    "USE",
    "VALUES",
    "VIEW",
    "WHEN",
    "WHERE",
    "WHILE",
    "WINDOW",
    "WITH",
]);

const sqlFunctions = new Set([
    "ABS",
    "AVG",
    "CAST",
    "CEILING",
    "CHARINDEX",
    "COALESCE",
    "CONCAT",
    "CONCAT_WS",
    "CONVERT",
    "COUNT",
    "CURRENT_TIMESTAMP",
    "DATEADD",
    "DATEDIFF",
    "DATENAME",
    "DATEPART",
    "DENSE_RANK",
    "EOMONTH",
    "FLOOR",
    "FORMAT",
    "GETDATE",
    "GETUTCDATE",
    "IIF",
    "ISNULL",
    "JSON_QUERY",
    "JSON_VALUE",
    "LAG",
    "LEAD",
    "LEFT",
    "LEN",
    "LOWER",
    "LTRIM",
    "MAX",
    "MIN",
    "NEWID",
    "NULLIF",
    "OBJECT_ID",
    "OPENJSON",
    "PARSENAME",
    "RANK",
    "REPLACE",
    "REPLICATE",
    "RIGHT",
    "ROUND",
    "ROW_NUMBER",
    "RTRIM",
    "STUFF",
    "SUBSTRING",
    "SUM",
    "SYSDATETIME",
    "SUSER_SNAME",
    "TRIM",
    "TRY_CAST",
    "TRY_CONVERT",
    "UPPER",
]);

const sqlTypes = new Set([
    "BIGINT",
    "BINARY",
    "BIT",
    "CHAR",
    "CURSOR",
    "DATE",
    "DATETIME",
    "DATETIME2",
    "DATETIMEOFFSET",
    "DECIMAL",
    "FLOAT",
    "GEOGRAPHY",
    "GEOMETRY",
    "HIERARCHYID",
    "IMAGE",
    "INT",
    "INTEGER",
    "MONEY",
    "NCHAR",
    "NTEXT",
    "NUMERIC",
    "NVARCHAR",
    "REAL",
    "ROWVERSION",
    "SMALLDATETIME",
    "SMALLINT",
    "SMALLMONEY",
    "SQL_VARIANT",
    "TEXT",
    "TIME",
    "TIMESTAMP",
    "TINYINT",
    "UNIQUEIDENTIFIER",
    "VARBINARY",
    "VARCHAR",
    "VECTOR",
    "XML",
]);

const sqlOperators = ["!<", "!>", "!=", "*=", "+=", "-=", "/=", "::", "<=", "<>", ">=", "||"];

const useStyles = makeStyles({
    root: {
        color: fluentTokens.colorNeutralForeground1,
        fontFamily: fluentTokens.fontFamilyMonospace,
        whiteSpace: "pre-wrap",
    },
    singleLine: {
        display: "block",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    keyword: {
        color: "var(--vscode-textLink-foreground)",
        fontWeight: fluentTokens.fontWeightSemibold,
    },
    function: {
        color: "var(--vscode-symbolIcon-functionForeground, var(--vscode-charts-purple))",
    },
    type: {
        color: "var(--vscode-symbolIcon-classForeground, var(--vscode-charts-blue))",
    },
    string: {
        color: "var(--vscode-debugTokenExpression-string, var(--vscode-charts-orange))",
    },
    number: {
        color: "var(--vscode-debugTokenExpression-number, var(--vscode-charts-green))",
    },
    comment: {
        color: "var(--vscode-editorCodeLens-foreground, var(--vscode-descriptionForeground))",
        fontStyle: "italic",
    },
    identifier: {
        color: "var(--vscode-symbolIcon-fieldForeground, var(--vscode-editor-foreground))",
    },
    variable: {
        color: "var(--vscode-symbolIcon-variableForeground, var(--vscode-charts-yellow))",
    },
    operator: {
        color: "var(--vscode-symbolIcon-operatorForeground, var(--vscode-charts-purple))",
    },
});

function isWhitespace(character: string): boolean {
    return /\s/.test(character);
}

function isWordStart(character: string): boolean {
    return /[A-Za-z_]/.test(character);
}

function isWordPart(character: string): boolean {
    return /[A-Za-z0-9_$#@]/.test(character);
}

function pushToken(tokens: SqlTextToken[], kind: SqlTextTokenKind, text: string): void {
    if (!text) {
        return;
    }

    const previous = tokens.at(-1);
    if (previous?.kind === kind) {
        previous.text += text;
    } else {
        tokens.push({ kind, text });
    }
}

function readDelimitedValue(
    sql: string,
    start: number,
    delimiter: string,
    escapedDelimiter: string,
): number {
    let index = start + 1;
    while (index < sql.length) {
        if (sql.startsWith(escapedDelimiter, index)) {
            index += escapedDelimiter.length;
        } else if (sql[index] === delimiter) {
            return index + 1;
        } else {
            index++;
        }
    }
    return sql.length;
}

function readNumber(sql: string, start: number): number {
    let index = start;

    if (sql.startsWith("0x", start) || sql.startsWith("0X", start)) {
        index += 2;
        while (index < sql.length && /[0-9A-Fa-f]/.test(sql[index])) {
            index++;
        }
        return index;
    }

    while (index < sql.length && /\d/.test(sql[index])) {
        index++;
    }
    if (sql[index] === "." && /\d/.test(sql[index + 1] ?? "")) {
        index++;
        while (index < sql.length && /\d/.test(sql[index])) {
            index++;
        }
    }
    if (sql[index] === "e" || sql[index] === "E") {
        let exponentIndex = index + 1;
        if (sql[exponentIndex] === "+" || sql[exponentIndex] === "-") {
            exponentIndex++;
        }
        const exponentStart = exponentIndex;
        while (exponentIndex < sql.length && /\d/.test(sql[exponentIndex])) {
            exponentIndex++;
        }
        if (exponentIndex > exponentStart) {
            index = exponentIndex;
        }
    }
    return index;
}

function getWordKind(text: string, isFunctionInvocation: boolean): SqlTextTokenKind {
    const upperText = text.toUpperCase();
    if (sqlTypes.has(upperText)) {
        return "type";
    }
    if (
        sqlFunctions.has(upperText) &&
        (isFunctionInvocation || upperText === "CURRENT_TIMESTAMP")
    ) {
        return "function";
    }
    return sqlKeywords.has(upperText) ? "keyword" : "text";
}

/**
 * Tokenizes SQL for lightweight, display-only syntax coloring.
 * Input text is preserved exactly and remains escaped by React when rendered.
 */
export function tokenizeSqlText(sql: string): SqlTextToken[] {
    const tokens: SqlTextToken[] = [];
    let index = 0;

    while (index < sql.length) {
        const start = index;
        const character = sql[index];

        if (isWhitespace(character)) {
            while (index < sql.length && isWhitespace(sql[index])) {
                index++;
            }
            pushToken(tokens, "text", sql.slice(start, index));
            continue;
        }

        if (sql.startsWith("--", index)) {
            const carriageReturn = sql.indexOf("\r", index + 2);
            const lineFeed = sql.indexOf("\n", index + 2);
            const lineEnd = [carriageReturn, lineFeed]
                .filter((candidate) => candidate !== -1)
                .reduce((earliest, candidate) => Math.min(earliest, candidate), sql.length);
            index = lineEnd;
            pushToken(tokens, "comment", sql.slice(start, index));
            continue;
        }

        if (sql.startsWith("/*", index)) {
            const commentEnd = sql.indexOf("*/", index + 2);
            index = commentEnd === -1 ? sql.length : commentEnd + 2;
            pushToken(tokens, "comment", sql.slice(start, index));
            continue;
        }

        if ((character === "N" || character === "n") && sql[index + 1] === "'") {
            index = readDelimitedValue(sql, index + 1, "'", "''");
            pushToken(tokens, "string", sql.slice(start, index));
            continue;
        }

        if (character === "'") {
            index = readDelimitedValue(sql, index, "'", "''");
            pushToken(tokens, "string", sql.slice(start, index));
            continue;
        }

        if (character === '"') {
            index = readDelimitedValue(sql, index, '"', '""');
            pushToken(tokens, "identifier", sql.slice(start, index));
            continue;
        }

        if (character === "[") {
            index = readDelimitedValue(sql, index, "]", "]]");
            pushToken(tokens, "identifier", sql.slice(start, index));
            continue;
        }

        if (/\d/.test(character)) {
            index = readNumber(sql, index);
            pushToken(tokens, "number", sql.slice(start, index));
            continue;
        }

        if (character === "@" || character === "#") {
            index++;
            while (index < sql.length && isWordPart(sql[index])) {
                index++;
            }
            pushToken(tokens, "variable", sql.slice(start, index));
            continue;
        }

        if (isWordStart(character)) {
            index++;
            while (index < sql.length && isWordPart(sql[index])) {
                index++;
            }
            const text = sql.slice(start, index);
            let nextTokenIndex = index;
            while (nextTokenIndex < sql.length && isWhitespace(sql[nextTokenIndex])) {
                nextTokenIndex++;
            }
            pushToken(tokens, getWordKind(text, sql[nextTokenIndex] === "("), text);
            continue;
        }

        const operator = sqlOperators.find((candidate) => sql.startsWith(candidate, index));
        if (operator) {
            index += operator.length;
            pushToken(tokens, "operator", operator);
            continue;
        }

        if ("+-*/%=<>!|&^~".includes(character)) {
            index++;
            pushToken(tokens, "operator", character);
            continue;
        }

        index++;
        pushToken(tokens, "text", character);
    }

    return tokens;
}

export function tokenizeSingleLineSqlText(sql: string): SqlTextToken[] {
    return tokenizeSqlText(sql).map((token) => ({
        ...token,
        text: token.text.replace(/\r\n|\r|\n/g, ` ${SQL_TEXT_LINE_BREAK} `),
    }));
}

export interface SqlTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
    text: string;
    singleLine?: boolean;
    showLineBreaks?: boolean;
}

/**
 * Renders lightweight, theme-aware SQL syntax coloring without an editor runtime.
 */
export function SqlText({
    text,
    singleLine = false,
    showLineBreaks = false,
    className,
    ...spanProps
}: SqlTextProps) {
    const classes = useStyles();
    const sqlTokens = useMemo(
        () => (showLineBreaks ? tokenizeSingleLineSqlText(text) : tokenizeSqlText(text)),
        [showLineBreaks, text],
    );
    const tokenClasses: Record<SqlTextTokenKind, string | undefined> = {
        text: undefined,
        keyword: classes.keyword,
        function: classes.function,
        type: classes.type,
        string: classes.string,
        number: classes.number,
        comment: classes.comment,
        identifier: classes.identifier,
        variable: classes.variable,
        operator: classes.operator,
    };

    return (
        <span
            {...spanProps}
            className={mergeClasses(classes.root, singleLine && classes.singleLine, className)}>
            {sqlTokens.map((token, index) => (
                <span className={tokenClasses[token.kind]} key={index}>
                    {token.text}
                </span>
            ))}
        </span>
    );
}
