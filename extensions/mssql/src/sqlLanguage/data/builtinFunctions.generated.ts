/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * T-SQL built-in function data asset for the native TypeScript T-SQL language service.
 *
 * Provenance:
 *  - Generated: 2026-07-05 (hand-maintained; there is no build-time generator yet —
 *    update by editing this file directly).
 *  - Curated from the Microsoft Learn Transact-SQL function reference
 *    (https://learn.microsoft.com/en-us/sql/t-sql/functions/functions): the scalar,
 *    aggregate, ranking, analytic, and JSON builtins most commonly used in SQL Server
 *    workloads, with signatures and return-type displays taken from the individual
 *    function pages.
 *  - Trailing optional parameters are modeled with `optional: true` on a single
 *    signature; separate signatures are used only where the shapes genuinely differ
 *    (e.g. COUNT(*) vs COUNT(expression)).
 *  - Deliberately excluded: @@-prefixed values (@@ROWCOUNT, @@IDENTITY, @@TRANCOUNT, ...)
 *    — the tokenizer treats them as variables, not functions; table-valued builtins
 *    (STRING_SPLIT, OPENJSON, GENERATE_SERIES, ...); and CASE, which is a language
 *    element rather than a function. The "configuration" category is reserved for
 *    future use — SQL Server's configuration functions are all @@-prefixed.
 *
 * This file must stay dependency-free: import NOTHING (an eslint rule bans imports
 * of vscode/node/other directories from src/sqlLanguage/data).
 */

export interface BuiltinParameter {
    readonly name: string;
    readonly typeDisplay: string;
    readonly optional?: boolean;
}

export interface BuiltinSignature {
    /** Display label, e.g. "SUBSTRING(expression, start, length)". */
    readonly label: string;
    readonly parameters: readonly BuiltinParameter[];
    /** Return-type display, e.g. "int", "varchar", "same as input". */
    readonly returnType: string;
}

export interface BuiltinFunctionInfo {
    /** Canonical UPPERCASE name, e.g. "SUBSTRING"; doubles as the stable id. */
    readonly name: string;
    readonly category:
        | "aggregate"
        | "string"
        | "date"
        | "mathematical"
        | "conversion"
        | "logical"
        | "metadata"
        | "security"
        | "system"
        | "ranking"
        | "analytic"
        | "json"
        | "cryptographic"
        | "configuration";
    readonly signatures: readonly BuiltinSignature[];
    /** One-line description shown in completion/hover. */
    readonly description: string;
    /** learn.microsoft.com link. */
    readonly docUrl?: string;
    /** True for parenthesis-free builtins (CURRENT_TIMESTAMP, SESSION_USER, ...). */
    readonly niladic?: boolean;
}

export const TSQL_BUILTIN_FUNCTIONS: readonly BuiltinFunctionInfo[] = [
    // ------------------------------------------------------------------
    // aggregate
    // ------------------------------------------------------------------
    {
        name: "COUNT",
        category: "aggregate",
        description: "Returns the number of items in a group as an int.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/count-transact-sql",
        signatures: [
            {
                label: "COUNT(*)",
                parameters: [],
                returnType: "int",
            },
            {
                label: "COUNT([ALL | DISTINCT] expression)",
                parameters: [{ name: "expression", typeDisplay: "any scalar (non-BLOB)" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "COUNT_BIG",
        category: "aggregate",
        description: "Returns the number of items in a group as a bigint.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/count-big-transact-sql",
        signatures: [
            {
                label: "COUNT_BIG(*)",
                parameters: [],
                returnType: "bigint",
            },
            {
                label: "COUNT_BIG([ALL | DISTINCT] expression)",
                parameters: [{ name: "expression", typeDisplay: "any scalar (non-BLOB)" }],
                returnType: "bigint",
            },
        ],
    },
    {
        name: "SUM",
        category: "aggregate",
        description: "Returns the sum of all (or only the DISTINCT) values in the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sum-transact-sql",
        signatures: [
            {
                label: "SUM([ALL | DISTINCT] expression)",
                parameters: [{ name: "expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "AVG",
        category: "aggregate",
        description: "Returns the average of the values in a group; null values are ignored.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/avg-transact-sql",
        signatures: [
            {
                label: "AVG([ALL | DISTINCT] expression)",
                parameters: [{ name: "expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "MIN",
        category: "aggregate",
        description: "Returns the minimum value in the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/min-transact-sql",
        signatures: [
            {
                label: "MIN([ALL | DISTINCT] expression)",
                parameters: [
                    {
                        name: "expression",
                        typeDisplay: "numeric, character, or datetime expression",
                    },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "MAX",
        category: "aggregate",
        description: "Returns the maximum value in the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/max-transact-sql",
        signatures: [
            {
                label: "MAX([ALL | DISTINCT] expression)",
                parameters: [
                    {
                        name: "expression",
                        typeDisplay: "numeric, character, or datetime expression",
                    },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "STRING_AGG",
        category: "aggregate",
        description: "Concatenates string values, placing a separator between them.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/string-agg-transact-sql",
        signatures: [
            {
                label: "STRING_AGG(expression, separator) [WITHIN GROUP (ORDER BY ...)]",
                parameters: [
                    { name: "expression", typeDisplay: "nvarchar or varchar expression" },
                    { name: "separator", typeDisplay: "nvarchar or varchar literal" },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "STDEV",
        category: "aggregate",
        description: "Returns the statistical standard deviation of all values in the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/stdev-transact-sql",
        signatures: [
            {
                label: "STDEV([ALL | DISTINCT] expression)",
                parameters: [{ name: "expression", typeDisplay: "numeric expression" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "VAR",
        category: "aggregate",
        description: "Returns the statistical variance of all values in the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/var-transact-sql",
        signatures: [
            {
                label: "VAR([ALL | DISTINCT] expression)",
                parameters: [{ name: "expression", typeDisplay: "numeric expression" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "GROUPING",
        category: "aggregate",
        description: "Indicates whether a GROUP BY column is aggregated (1) or not (0) in rollups.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/grouping-transact-sql",
        signatures: [
            {
                label: "GROUPING(column_expression)",
                parameters: [
                    { name: "column_expression", typeDisplay: "column in the GROUP BY list" },
                ],
                returnType: "tinyint",
            },
        ],
    },
    {
        name: "APPROX_COUNT_DISTINCT",
        category: "aggregate",
        description: "Returns the approximate number of unique non-null values in a group.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/approx-count-distinct-transact-sql",
        signatures: [
            {
                label: "APPROX_COUNT_DISTINCT(expression)",
                parameters: [{ name: "expression", typeDisplay: "any scalar (non-BLOB)" }],
                returnType: "bigint",
            },
        ],
    },

    // ------------------------------------------------------------------
    // string
    // ------------------------------------------------------------------
    {
        name: "SUBSTRING",
        category: "string",
        description: "Returns part of a character, binary, text, or ntext expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/substring-transact-sql",
        signatures: [
            {
                label: "SUBSTRING(expression, start, length)",
                parameters: [
                    { name: "expression", typeDisplay: "character or binary expression" },
                    { name: "start", typeDisplay: "int" },
                    { name: "length", typeDisplay: "int" },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "LEN",
        category: "string",
        description: "Returns the number of characters in a string, excluding trailing spaces.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/len-transact-sql",
        signatures: [
            {
                label: "LEN(string_expression)",
                parameters: [{ name: "string_expression", typeDisplay: "character expression" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "DATALENGTH",
        category: "string",
        description: "Returns the number of bytes used to represent any expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datalength-transact-sql",
        signatures: [
            {
                label: "DATALENGTH(expression)",
                parameters: [{ name: "expression", typeDisplay: "any" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "LEFT",
        category: "string",
        description: "Returns the leftmost characters of a string, up to the specified count.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/left-transact-sql",
        signatures: [
            {
                label: "LEFT(character_expression, integer_expression)",
                parameters: [
                    { name: "character_expression", typeDisplay: "character expression" },
                    { name: "integer_expression", typeDisplay: "int" },
                ],
                returnType: "varchar or nvarchar",
            },
        ],
    },
    {
        name: "RIGHT",
        category: "string",
        description: "Returns the rightmost characters of a string, up to the specified count.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/right-transact-sql",
        signatures: [
            {
                label: "RIGHT(character_expression, integer_expression)",
                parameters: [
                    { name: "character_expression", typeDisplay: "character expression" },
                    { name: "integer_expression", typeDisplay: "int" },
                ],
                returnType: "varchar or nvarchar",
            },
        ],
    },
    {
        name: "LTRIM",
        category: "string",
        description: "Removes leading spaces (or the specified characters) from a string.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ltrim-transact-sql",
        signatures: [
            {
                label: "LTRIM(character_expression [, characters])",
                parameters: [
                    { name: "character_expression", typeDisplay: "character expression" },
                    {
                        name: "characters",
                        typeDisplay: "characters to remove (SQL Server 2022+)",
                        optional: true,
                    },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "RTRIM",
        category: "string",
        description: "Removes trailing spaces (or the specified characters) from a string.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/rtrim-transact-sql",
        signatures: [
            {
                label: "RTRIM(character_expression [, characters])",
                parameters: [
                    { name: "character_expression", typeDisplay: "character expression" },
                    {
                        name: "characters",
                        typeDisplay: "characters to remove (SQL Server 2022+)",
                        optional: true,
                    },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "TRIM",
        category: "string",
        description: "Removes leading and trailing spaces (or specified characters) from a string.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/trim-transact-sql",
        signatures: [
            {
                label: "TRIM([characters FROM] string)",
                parameters: [
                    { name: "characters", typeDisplay: "characters to remove", optional: true },
                    { name: "string", typeDisplay: "character expression" },
                ],
                returnType: "varchar or nvarchar",
            },
        ],
    },
    {
        name: "UPPER",
        category: "string",
        description: "Returns the input with lowercase characters converted to uppercase.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/upper-transact-sql",
        signatures: [
            {
                label: "UPPER(character_expression)",
                parameters: [{ name: "character_expression", typeDisplay: "character expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "LOWER",
        category: "string",
        description: "Returns the input with uppercase characters converted to lowercase.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/lower-transact-sql",
        signatures: [
            {
                label: "LOWER(character_expression)",
                parameters: [{ name: "character_expression", typeDisplay: "character expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "REPLACE",
        category: "string",
        description: "Replaces all occurrences of a specified string value with another value.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/replace-transact-sql",
        signatures: [
            {
                label: "REPLACE(string_expression, string_pattern, string_replacement)",
                parameters: [
                    { name: "string_expression", typeDisplay: "character expression" },
                    { name: "string_pattern", typeDisplay: "character expression" },
                    { name: "string_replacement", typeDisplay: "character expression" },
                ],
                returnType: "varchar or nvarchar",
            },
        ],
    },
    {
        name: "CHARINDEX",
        category: "string",
        description: "Returns the starting position of a substring in a string (0 if not found).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/charindex-transact-sql",
        signatures: [
            {
                label: "CHARINDEX(expressionToFind, expressionToSearch [, start_location])",
                parameters: [
                    { name: "expressionToFind", typeDisplay: "character expression" },
                    { name: "expressionToSearch", typeDisplay: "character expression" },
                    { name: "start_location", typeDisplay: "int", optional: true },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "PATINDEX",
        category: "string",
        description: "Returns the start of the first occurrence of a pattern (0 if not found).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/patindex-transact-sql",
        signatures: [
            {
                label: "PATINDEX('%pattern%', expression)",
                parameters: [
                    { name: "pattern", typeDisplay: "string pattern with wildcards" },
                    { name: "expression", typeDisplay: "character expression" },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "CONCAT",
        category: "string",
        description: "Joins two or more strings end-to-end; null arguments become empty strings.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/concat-transact-sql",
        signatures: [
            {
                label: "CONCAT(string_value1, string_value2 [, string_valueN ...])",
                parameters: [
                    { name: "string_value1", typeDisplay: "string" },
                    { name: "string_value2", typeDisplay: "string" },
                    { name: "string_valueN", typeDisplay: "string (repeatable)", optional: true },
                ],
                returnType: "string",
            },
        ],
    },
    {
        name: "CONCAT_WS",
        category: "string",
        description: "Concatenates values with a separator between each; skips null values.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/concat-ws-transact-sql",
        signatures: [
            {
                label: "CONCAT_WS(separator, argument1, argument2 [, argumentN ...])",
                parameters: [
                    { name: "separator", typeDisplay: "string" },
                    { name: "argument1", typeDisplay: "string" },
                    { name: "argument2", typeDisplay: "string" },
                    { name: "argumentN", typeDisplay: "string (repeatable)", optional: true },
                ],
                returnType: "string",
            },
        ],
    },
    {
        name: "FORMAT",
        category: "string",
        description: "Formats a value with the specified .NET format string and optional culture.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/format-transact-sql",
        signatures: [
            {
                label: "FORMAT(value, format [, culture])",
                parameters: [
                    { name: "value", typeDisplay: "numeric or date/time expression" },
                    { name: "format", typeDisplay: "nvarchar .NET format string" },
                    { name: "culture", typeDisplay: "nvarchar, e.g. 'en-US'", optional: true },
                ],
                returnType: "nvarchar",
            },
        ],
    },
    {
        name: "STUFF",
        category: "string",
        description:
            "Deletes a length of characters and inserts another string at the start position.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/stuff-transact-sql",
        signatures: [
            {
                label: "STUFF(character_expression, start, length, replace_with_expression)",
                parameters: [
                    { name: "character_expression", typeDisplay: "character or binary expression" },
                    { name: "start", typeDisplay: "int" },
                    { name: "length", typeDisplay: "int" },
                    { name: "replace_with_expression", typeDisplay: "character expression" },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "REPLICATE",
        category: "string",
        description: "Repeats a string value a specified number of times.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/replicate-transact-sql",
        signatures: [
            {
                label: "REPLICATE(string_expression, integer_expression)",
                parameters: [
                    { name: "string_expression", typeDisplay: "character or binary expression" },
                    { name: "integer_expression", typeDisplay: "int" },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "REVERSE",
        category: "string",
        description: "Returns the characters of a string value in reverse order.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/reverse-transact-sql",
        signatures: [
            {
                label: "REVERSE(string_expression)",
                parameters: [{ name: "string_expression", typeDisplay: "character expression" }],
                returnType: "varchar or nvarchar",
            },
        ],
    },
    {
        name: "SPACE",
        category: "string",
        description: "Returns a string of repeated spaces.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/space-transact-sql",
        signatures: [
            {
                label: "SPACE(integer_expression)",
                parameters: [{ name: "integer_expression", typeDisplay: "int" }],
                returnType: "varchar",
            },
        ],
    },
    {
        name: "STR",
        category: "string",
        description: "Returns character data converted from numeric data.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/str-transact-sql",
        signatures: [
            {
                label: "STR(float_expression [, length [, decimal]])",
                parameters: [
                    { name: "float_expression", typeDisplay: "approximate numeric expression" },
                    { name: "length", typeDisplay: "int (default 10)", optional: true },
                    { name: "decimal", typeDisplay: "int (default 0)", optional: true },
                ],
                returnType: "varchar",
            },
        ],
    },
    {
        name: "CHAR",
        category: "string",
        description: "Converts an int ASCII code (0-255) to a character.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/char-transact-sql",
        signatures: [
            {
                label: "CHAR(integer_expression)",
                parameters: [{ name: "integer_expression", typeDisplay: "int (0-255)" }],
                returnType: "char(1)",
            },
        ],
    },
    {
        name: "ASCII",
        category: "string",
        description: "Returns the ASCII code value of the leftmost character of an expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ascii-transact-sql",
        signatures: [
            {
                label: "ASCII(character_expression)",
                parameters: [{ name: "character_expression", typeDisplay: "char or varchar" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "NCHAR",
        category: "string",
        description: "Returns the Unicode character with the specified integer code.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/nchar-transact-sql",
        signatures: [
            {
                label: "NCHAR(integer_expression)",
                parameters: [{ name: "integer_expression", typeDisplay: "int" }],
                returnType: "nchar(1)",
            },
        ],
    },
    {
        name: "UNICODE",
        category: "string",
        description: "Returns the Unicode code point of the first character of the input.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/unicode-transact-sql",
        signatures: [
            {
                label: "UNICODE(ncharacter_expression)",
                parameters: [{ name: "ncharacter_expression", typeDisplay: "nchar or nvarchar" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "QUOTENAME",
        category: "string",
        description: "Adds delimiters to make the input a valid delimited identifier.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/quotename-transact-sql",
        signatures: [
            {
                label: "QUOTENAME(character_string [, quote_character])",
                parameters: [
                    { name: "character_string", typeDisplay: "sysname (up to 128 chars)" },
                    {
                        name: "quote_character",
                        typeDisplay: "one of [] \" ' ( ) > < {} (default [])",
                        optional: true,
                    },
                ],
                returnType: "nvarchar(258)",
            },
        ],
    },
    {
        name: "TRANSLATE",
        category: "string",
        description: "Replaces, one-for-one, each listed character with its replacement character.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/translate-transact-sql",
        signatures: [
            {
                label: "TRANSLATE(inputString, characters, translations)",
                parameters: [
                    { name: "inputString", typeDisplay: "character expression" },
                    { name: "characters", typeDisplay: "characters to replace" },
                    { name: "translations", typeDisplay: "replacement characters (same length)" },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "STRING_ESCAPE",
        category: "string",
        description: "Escapes special characters in text for the specified escape type (json).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/string-escape-transact-sql",
        signatures: [
            {
                label: "STRING_ESCAPE(text, type)",
                parameters: [
                    { name: "text", typeDisplay: "nvarchar expression" },
                    { name: "type", typeDisplay: "'json'" },
                ],
                returnType: "nvarchar",
            },
        ],
    },

    // ------------------------------------------------------------------
    // date
    // ------------------------------------------------------------------
    {
        name: "GETDATE",
        category: "date",
        description: "Returns the current database server date and time as datetime.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/getdate-transact-sql",
        signatures: [{ label: "GETDATE()", parameters: [], returnType: "datetime" }],
    },
    {
        name: "GETUTCDATE",
        category: "date",
        description: "Returns the current UTC date and time as datetime.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/getutcdate-transact-sql",
        signatures: [{ label: "GETUTCDATE()", parameters: [], returnType: "datetime" }],
    },
    {
        name: "SYSDATETIME",
        category: "date",
        description: "Returns the current database server date and time as datetime2(7).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sysdatetime-transact-sql",
        signatures: [{ label: "SYSDATETIME()", parameters: [], returnType: "datetime2(7)" }],
    },
    {
        name: "SYSUTCDATETIME",
        category: "date",
        description: "Returns the current UTC date and time as datetime2(7).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sysutcdatetime-transact-sql",
        signatures: [{ label: "SYSUTCDATETIME()", parameters: [], returnType: "datetime2(7)" }],
    },
    {
        name: "SYSDATETIMEOFFSET",
        category: "date",
        description: "Returns the current date and time including the server's time zone offset.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sysdatetimeoffset-transact-sql",
        signatures: [
            { label: "SYSDATETIMEOFFSET()", parameters: [], returnType: "datetimeoffset(7)" },
        ],
    },
    {
        name: "DATEADD",
        category: "date",
        description: "Adds a number of datepart intervals to the specified date.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/dateadd-transact-sql",
        signatures: [
            {
                label: "DATEADD(datepart, number, date)",
                parameters: [
                    { name: "datepart", typeDisplay: "datepart keyword (year, month, day, ...)" },
                    { name: "number", typeDisplay: "int" },
                    { name: "date", typeDisplay: "date/time expression" },
                ],
                returnType: "same as date input",
            },
        ],
    },
    {
        name: "DATEDIFF",
        category: "date",
        description: "Returns the count of datepart boundaries crossed between two dates as int.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql",
        signatures: [
            {
                label: "DATEDIFF(datepart, startdate, enddate)",
                parameters: [
                    { name: "datepart", typeDisplay: "datepart keyword (year, month, day, ...)" },
                    { name: "startdate", typeDisplay: "date/time expression" },
                    { name: "enddate", typeDisplay: "date/time expression" },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "DATEDIFF_BIG",
        category: "date",
        description:
            "Returns the count of datepart boundaries crossed between two dates as bigint.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-big-transact-sql",
        signatures: [
            {
                label: "DATEDIFF_BIG(datepart, startdate, enddate)",
                parameters: [
                    { name: "datepart", typeDisplay: "datepart keyword (year, month, day, ...)" },
                    { name: "startdate", typeDisplay: "date/time expression" },
                    { name: "enddate", typeDisplay: "date/time expression" },
                ],
                returnType: "bigint",
            },
        ],
    },
    {
        name: "DATENAME",
        category: "date",
        description: "Returns a character string representing the specified datepart of a date.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datename-transact-sql",
        signatures: [
            {
                label: "DATENAME(datepart, date)",
                parameters: [
                    { name: "datepart", typeDisplay: "datepart keyword (month, weekday, ...)" },
                    { name: "date", typeDisplay: "date/time expression" },
                ],
                returnType: "nvarchar",
            },
        ],
    },
    {
        name: "DATEPART",
        category: "date",
        description: "Returns an integer representing the specified datepart of a date.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql",
        signatures: [
            {
                label: "DATEPART(datepart, date)",
                parameters: [
                    { name: "datepart", typeDisplay: "datepart keyword (year, month, day, ...)" },
                    { name: "date", typeDisplay: "date/time expression" },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "DAY",
        category: "date",
        description: "Returns the day-of-month integer for the specified date.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/day-transact-sql",
        signatures: [
            {
                label: "DAY(date)",
                parameters: [{ name: "date", typeDisplay: "date/time expression" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "MONTH",
        category: "date",
        description: "Returns the month integer for the specified date.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/month-transact-sql",
        signatures: [
            {
                label: "MONTH(date)",
                parameters: [{ name: "date", typeDisplay: "date/time expression" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "YEAR",
        category: "date",
        description: "Returns the year integer for the specified date.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/year-transact-sql",
        signatures: [
            {
                label: "YEAR(date)",
                parameters: [{ name: "date", typeDisplay: "date/time expression" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "EOMONTH",
        category: "date",
        description: "Returns the last day of the month of a date, with an optional month offset.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/eomonth-transact-sql",
        signatures: [
            {
                label: "EOMONTH(start_date [, month_to_add])",
                parameters: [
                    { name: "start_date", typeDisplay: "date/time expression" },
                    { name: "month_to_add", typeDisplay: "int", optional: true },
                ],
                returnType: "date",
            },
        ],
    },
    {
        name: "DATEFROMPARTS",
        category: "date",
        description: "Returns a date value from integer year, month, and day parts.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datefromparts-transact-sql",
        signatures: [
            {
                label: "DATEFROMPARTS(year, month, day)",
                parameters: [
                    { name: "year", typeDisplay: "int" },
                    { name: "month", typeDisplay: "int" },
                    { name: "day", typeDisplay: "int" },
                ],
                returnType: "date",
            },
        ],
    },
    {
        name: "DATETIME2FROMPARTS",
        category: "date",
        description: "Returns a datetime2 value from its integer parts at the given precision.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datetime2fromparts-transact-sql",
        signatures: [
            {
                label: "DATETIME2FROMPARTS(year, month, day, hour, minute, seconds, fractions, precision)",
                parameters: [
                    { name: "year", typeDisplay: "int" },
                    { name: "month", typeDisplay: "int" },
                    { name: "day", typeDisplay: "int" },
                    { name: "hour", typeDisplay: "int" },
                    { name: "minute", typeDisplay: "int" },
                    { name: "seconds", typeDisplay: "int" },
                    { name: "fractions", typeDisplay: "int" },
                    { name: "precision", typeDisplay: "int (0-7)" },
                ],
                returnType: "datetime2(precision)",
            },
        ],
    },
    {
        name: "DATETRUNC",
        category: "date",
        description: "Returns a date truncated to the specified datepart boundary.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/datetrunc-transact-sql",
        signatures: [
            {
                label: "DATETRUNC(datepart, date)",
                parameters: [
                    { name: "datepart", typeDisplay: "datepart keyword (year, month, day, ...)" },
                    { name: "date", typeDisplay: "date/time expression" },
                ],
                returnType: "same as date input",
            },
        ],
    },
    {
        name: "SWITCHOFFSET",
        category: "date",
        description:
            "Changes the time zone offset of a datetimeoffset, preserving the UTC instant.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/switchoffset-transact-sql",
        signatures: [
            {
                label: "SWITCHOFFSET(datetimeoffset_expression, timezoneoffset)",
                parameters: [
                    { name: "datetimeoffset_expression", typeDisplay: "datetimeoffset" },
                    { name: "timezoneoffset", typeDisplay: "'{+|-}hh:mm' or minutes (int)" },
                ],
                returnType: "datetimeoffset",
            },
        ],
    },
    {
        name: "TODATETIMEOFFSET",
        category: "date",
        description: "Converts a datetime2 value to datetimeoffset using the given offset.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/todatetimeoffset-transact-sql",
        signatures: [
            {
                label: "TODATETIMEOFFSET(expression, timezoneoffset)",
                parameters: [
                    { name: "expression", typeDisplay: "datetime2 expression" },
                    { name: "timezoneoffset", typeDisplay: "'{+|-}hh:mm' or minutes (int)" },
                ],
                returnType: "datetimeoffset",
            },
        ],
    },
    {
        name: "ISDATE",
        category: "date",
        description: "Returns 1 if the expression is a valid date, time, or datetime; otherwise 0.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/isdate-transact-sql",
        signatures: [
            {
                label: "ISDATE(expression)",
                parameters: [{ name: "expression", typeDisplay: "character expression" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "CURRENT_TIMESTAMP",
        category: "date",
        description: "ANSI SQL niladic equivalent of GETDATE(); current date and time as datetime.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/current-timestamp-transact-sql",
        niladic: true,
        signatures: [{ label: "CURRENT_TIMESTAMP", parameters: [], returnType: "datetime" }],
    },

    // ------------------------------------------------------------------
    // mathematical
    // ------------------------------------------------------------------
    {
        name: "ABS",
        category: "mathematical",
        description: "Returns the absolute (positive) value of the specified numeric expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/abs-transact-sql",
        signatures: [
            {
                label: "ABS(numeric_expression)",
                parameters: [{ name: "numeric_expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "CEILING",
        category: "mathematical",
        description: "Returns the smallest integer greater than or equal to the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ceiling-transact-sql",
        signatures: [
            {
                label: "CEILING(numeric_expression)",
                parameters: [{ name: "numeric_expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "FLOOR",
        category: "mathematical",
        description: "Returns the largest integer less than or equal to the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/floor-transact-sql",
        signatures: [
            {
                label: "FLOOR(numeric_expression)",
                parameters: [{ name: "numeric_expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "ROUND",
        category: "mathematical",
        description: "Rounds (or truncates, when function is nonzero) to the specified length.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/round-transact-sql",
        signatures: [
            {
                label: "ROUND(numeric_expression, length [, function])",
                parameters: [
                    { name: "numeric_expression", typeDisplay: "numeric expression" },
                    { name: "length", typeDisplay: "int" },
                    { name: "function", typeDisplay: "int (nonzero truncates)", optional: true },
                ],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "POWER",
        category: "mathematical",
        description: "Returns the value of the expression raised to the specified power.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/power-transact-sql",
        signatures: [
            {
                label: "POWER(float_expression, y)",
                parameters: [
                    { name: "float_expression", typeDisplay: "numeric expression" },
                    { name: "y", typeDisplay: "numeric expression" },
                ],
                returnType: "same as float_expression",
            },
        ],
    },
    {
        name: "SQRT",
        category: "mathematical",
        description: "Returns the square root of the specified float value.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sqrt-transact-sql",
        signatures: [
            {
                label: "SQRT(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "SQUARE",
        category: "mathematical",
        description: "Returns the square of the specified float value.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/square-transact-sql",
        signatures: [
            {
                label: "SQUARE(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "EXP",
        category: "mathematical",
        description: "Returns the exponential value (e^x) of the specified float expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/exp-transact-sql",
        signatures: [
            {
                label: "EXP(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "LOG",
        category: "mathematical",
        description: "Returns the natural logarithm, or the logarithm in the specified base.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/log-transact-sql",
        signatures: [
            {
                label: "LOG(float_expression [, base])",
                parameters: [
                    { name: "float_expression", typeDisplay: "float or convertible" },
                    { name: "base", typeDisplay: "int", optional: true },
                ],
                returnType: "float",
            },
        ],
    },
    {
        name: "LOG10",
        category: "mathematical",
        description: "Returns the base-10 logarithm of the specified float expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/log10-transact-sql",
        signatures: [
            {
                label: "LOG10(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "SIGN",
        category: "mathematical",
        description: "Returns -1, 0, or 1 indicating the sign of the expression.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sign-transact-sql",
        signatures: [
            {
                label: "SIGN(numeric_expression)",
                parameters: [{ name: "numeric_expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "RAND",
        category: "mathematical",
        description: "Returns a pseudo-random float between 0 and 1, optionally seeded.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/rand-transact-sql",
        signatures: [
            {
                label: "RAND([seed])",
                parameters: [
                    { name: "seed", typeDisplay: "tinyint, smallint, or int", optional: true },
                ],
                returnType: "float",
            },
        ],
    },
    {
        name: "PI",
        category: "mathematical",
        description: "Returns the constant value of pi as float.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/pi-transact-sql",
        signatures: [{ label: "PI()", parameters: [], returnType: "float" }],
    },
    {
        name: "DEGREES",
        category: "mathematical",
        description: "Converts an angle in radians to degrees.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/degrees-transact-sql",
        signatures: [
            {
                label: "DEGREES(numeric_expression)",
                parameters: [{ name: "numeric_expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "RADIANS",
        category: "mathematical",
        description: "Converts an angle in degrees to radians.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/radians-transact-sql",
        signatures: [
            {
                label: "RADIANS(numeric_expression)",
                parameters: [{ name: "numeric_expression", typeDisplay: "numeric expression" }],
                returnType: "same as input",
            },
        ],
    },
    {
        name: "SIN",
        category: "mathematical",
        description: "Returns the trigonometric sine of the angle in radians.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/sin-transact-sql",
        signatures: [
            {
                label: "SIN(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "COS",
        category: "mathematical",
        description: "Returns the trigonometric cosine of the angle in radians.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/cos-transact-sql",
        signatures: [
            {
                label: "COS(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "TAN",
        category: "mathematical",
        description: "Returns the trigonometric tangent of the angle in radians.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/tan-transact-sql",
        signatures: [
            {
                label: "TAN(float_expression)",
                parameters: [{ name: "float_expression", typeDisplay: "float or convertible" }],
                returnType: "float",
            },
        ],
    },

    // ------------------------------------------------------------------
    // conversion
    // ------------------------------------------------------------------
    {
        name: "CAST",
        category: "conversion",
        description: "Converts an expression to the specified data type (ANSI SQL syntax).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql",
        signatures: [
            {
                label: "CAST(expression AS data_type)",
                parameters: [
                    { name: "expression", typeDisplay: "any" },
                    { name: "data_type", typeDisplay: "target type, e.g. int, varchar(10)" },
                ],
                returnType: "data_type",
            },
        ],
    },
    {
        name: "CONVERT",
        category: "conversion",
        description: "Converts an expression to the specified data type, with an optional style.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql",
        signatures: [
            {
                label: "CONVERT(data_type [(length)], expression [, style])",
                parameters: [
                    { name: "data_type", typeDisplay: "target type, e.g. int, varchar(10)" },
                    { name: "expression", typeDisplay: "any" },
                    {
                        name: "style",
                        typeDisplay: "int (date/number format style)",
                        optional: true,
                    },
                ],
                returnType: "data_type",
            },
        ],
    },
    {
        name: "TRY_CAST",
        category: "conversion",
        description: "Converts to the specified data type; returns NULL if the cast fails.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/try-cast-transact-sql",
        signatures: [
            {
                label: "TRY_CAST(expression AS data_type)",
                parameters: [
                    { name: "expression", typeDisplay: "any" },
                    { name: "data_type", typeDisplay: "target type, e.g. int, varchar(10)" },
                ],
                returnType: "data_type (NULL on failure)",
            },
        ],
    },
    {
        name: "TRY_CONVERT",
        category: "conversion",
        description: "Converts to the specified data type; returns NULL if the conversion fails.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/try-convert-transact-sql",
        signatures: [
            {
                label: "TRY_CONVERT(data_type [(length)], expression [, style])",
                parameters: [
                    { name: "data_type", typeDisplay: "target type, e.g. int, varchar(10)" },
                    { name: "expression", typeDisplay: "any" },
                    {
                        name: "style",
                        typeDisplay: "int (date/number format style)",
                        optional: true,
                    },
                ],
                returnType: "data_type (NULL on failure)",
            },
        ],
    },
    {
        name: "PARSE",
        category: "conversion",
        description: "Converts a string to a date/time or number type using an optional culture.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/parse-transact-sql",
        signatures: [
            {
                label: "PARSE(string_value AS data_type [USING culture])",
                parameters: [
                    { name: "string_value", typeDisplay: "nvarchar(4000)" },
                    { name: "data_type", typeDisplay: "target date/time or numeric type" },
                    { name: "culture", typeDisplay: "language, e.g. 'en-US'", optional: true },
                ],
                returnType: "data_type",
            },
        ],
    },
    {
        name: "TRY_PARSE",
        category: "conversion",
        description: "Like PARSE, but returns NULL if the string cannot be parsed.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/try-parse-transact-sql",
        signatures: [
            {
                label: "TRY_PARSE(string_value AS data_type [USING culture])",
                parameters: [
                    { name: "string_value", typeDisplay: "nvarchar(4000)" },
                    { name: "data_type", typeDisplay: "target date/time or numeric type" },
                    { name: "culture", typeDisplay: "language, e.g. 'en-US'", optional: true },
                ],
                returnType: "data_type (NULL on failure)",
            },
        ],
    },

    // ------------------------------------------------------------------
    // logical / expression
    // ------------------------------------------------------------------
    {
        name: "COALESCE",
        category: "logical",
        description: "Returns the first non-null expression among its arguments.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/language-elements/coalesce-transact-sql",
        signatures: [
            {
                label: "COALESCE(expression1, expression2 [, expressionN ...])",
                parameters: [
                    { name: "expression1", typeDisplay: "any" },
                    { name: "expression2", typeDisplay: "any" },
                    { name: "expressionN", typeDisplay: "any (repeatable)", optional: true },
                ],
                returnType: "highest-precedence input type",
            },
        ],
    },
    {
        name: "NULLIF",
        category: "logical",
        description: "Returns NULL if the two expressions are equal; otherwise the first one.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/language-elements/nullif-transact-sql",
        signatures: [
            {
                label: "NULLIF(expression1, expression2)",
                parameters: [
                    { name: "expression1", typeDisplay: "any scalar" },
                    { name: "expression2", typeDisplay: "any scalar" },
                ],
                returnType: "same as expression1",
            },
        ],
    },
    {
        name: "ISNULL",
        category: "logical",
        description: "Replaces NULL with the specified replacement value.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/isnull-transact-sql",
        signatures: [
            {
                label: "ISNULL(check_expression, replacement_value)",
                parameters: [
                    { name: "check_expression", typeDisplay: "any" },
                    { name: "replacement_value", typeDisplay: "convertible to check_expression" },
                ],
                returnType: "same as check_expression",
            },
        ],
    },
    {
        name: "IIF",
        category: "logical",
        description:
            "Returns one of two values depending on whether the Boolean expression is true.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-iif-transact-sql",
        signatures: [
            {
                label: "IIF(boolean_expression, true_value, false_value)",
                parameters: [
                    { name: "boolean_expression", typeDisplay: "boolean expression" },
                    { name: "true_value", typeDisplay: "any" },
                    { name: "false_value", typeDisplay: "any" },
                ],
                returnType: "highest-precedence of true/false values",
            },
        ],
    },
    {
        name: "CHOOSE",
        category: "logical",
        description: "Returns the item at the specified 1-based index from a list of values.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-choose-transact-sql",
        signatures: [
            {
                label: "CHOOSE(index, val1, val2 [, valN ...])",
                parameters: [
                    { name: "index", typeDisplay: "int (1-based)" },
                    { name: "val1", typeDisplay: "any" },
                    { name: "val2", typeDisplay: "any" },
                    { name: "valN", typeDisplay: "any (repeatable)", optional: true },
                ],
                returnType: "highest-precedence input type",
            },
        ],
    },
    {
        name: "GREATEST",
        category: "logical",
        description: "Returns the maximum value from a list of expressions.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-greatest-transact-sql",
        signatures: [
            {
                label: "GREATEST(expression1 [, expressionN ...])",
                parameters: [
                    { name: "expression1", typeDisplay: "any comparable scalar" },
                    {
                        name: "expressionN",
                        typeDisplay: "any comparable scalar (repeatable)",
                        optional: true,
                    },
                ],
                returnType: "highest-precedence input type",
            },
        ],
    },
    {
        name: "LEAST",
        category: "logical",
        description: "Returns the minimum value from a list of expressions.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/logical-functions-least-transact-sql",
        signatures: [
            {
                label: "LEAST(expression1 [, expressionN ...])",
                parameters: [
                    { name: "expression1", typeDisplay: "any comparable scalar" },
                    {
                        name: "expressionN",
                        typeDisplay: "any comparable scalar (repeatable)",
                        optional: true,
                    },
                ],
                returnType: "highest-precedence input type",
            },
        ],
    },

    // ------------------------------------------------------------------
    // metadata
    // ------------------------------------------------------------------
    {
        name: "OBJECT_ID",
        category: "metadata",
        description: "Returns the database object id number of a schema-scoped object.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/object-id-transact-sql",
        signatures: [
            {
                label: "OBJECT_ID('object_name' [, 'object_type'])",
                parameters: [
                    { name: "object_name", typeDisplay: "'[database.][schema.]object'" },
                    {
                        name: "object_type",
                        typeDisplay: "type code, e.g. 'U', 'P', 'V'",
                        optional: true,
                    },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "OBJECT_NAME",
        category: "metadata",
        description: "Returns the object name for a schema-scoped object id.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/object-name-transact-sql",
        signatures: [
            {
                label: "OBJECT_NAME(object_id [, database_id])",
                parameters: [
                    { name: "object_id", typeDisplay: "int" },
                    { name: "database_id", typeDisplay: "int", optional: true },
                ],
                returnType: "sysname",
            },
        ],
    },
    {
        name: "OBJECT_SCHEMA_NAME",
        category: "metadata",
        description: "Returns the schema name of a schema-scoped object.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/object-schema-name-transact-sql",
        signatures: [
            {
                label: "OBJECT_SCHEMA_NAME(object_id [, database_id])",
                parameters: [
                    { name: "object_id", typeDisplay: "int" },
                    { name: "database_id", typeDisplay: "int", optional: true },
                ],
                returnType: "sysname",
            },
        ],
    },
    {
        name: "SCHEMA_NAME",
        category: "metadata",
        description: "Returns the schema name for a schema id (default: caller's default schema).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/schema-name-transact-sql",
        signatures: [
            {
                label: "SCHEMA_NAME([schema_id])",
                parameters: [{ name: "schema_id", typeDisplay: "int", optional: true }],
                returnType: "sysname",
            },
        ],
    },
    {
        name: "SCHEMA_ID",
        category: "metadata",
        description: "Returns the schema id for a schema name (default: caller's default schema).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/schema-id-transact-sql",
        signatures: [
            {
                label: "SCHEMA_ID([schema_name])",
                parameters: [{ name: "schema_name", typeDisplay: "sysname", optional: true }],
                returnType: "int",
            },
        ],
    },
    {
        name: "DB_NAME",
        category: "metadata",
        description: "Returns the database name for a database id (default: current database).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/db-name-transact-sql",
        signatures: [
            {
                label: "DB_NAME([database_id])",
                parameters: [{ name: "database_id", typeDisplay: "int", optional: true }],
                returnType: "nvarchar(128)",
            },
        ],
    },
    {
        name: "DB_ID",
        category: "metadata",
        description: "Returns the database id for a database name (default: current database).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/db-id-transact-sql",
        signatures: [
            {
                label: "DB_ID(['database_name'])",
                parameters: [{ name: "database_name", typeDisplay: "sysname", optional: true }],
                returnType: "int",
            },
        ],
    },
    {
        name: "COL_NAME",
        category: "metadata",
        description: "Returns the name of a column from its table id and column id.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/col-name-transact-sql",
        signatures: [
            {
                label: "COL_NAME(table_id, column_id)",
                parameters: [
                    { name: "table_id", typeDisplay: "int" },
                    { name: "column_id", typeDisplay: "int" },
                ],
                returnType: "sysname",
            },
        ],
    },
    {
        name: "COL_LENGTH",
        category: "metadata",
        description: "Returns the defined length of a column, in bytes.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/col-length-transact-sql",
        signatures: [
            {
                label: "COL_LENGTH('table', 'column')",
                parameters: [
                    { name: "table", typeDisplay: "nvarchar: '[schema.]table'" },
                    { name: "column", typeDisplay: "nvarchar column name" },
                ],
                returnType: "smallint",
            },
        ],
    },
    {
        name: "TYPE_NAME",
        category: "metadata",
        description: "Returns the unqualified type name for a type id.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/type-name-transact-sql",
        signatures: [
            {
                label: "TYPE_NAME(type_id)",
                parameters: [{ name: "type_id", typeDisplay: "int" }],
                returnType: "sysname",
            },
        ],
    },
    {
        name: "OBJECT_DEFINITION",
        category: "metadata",
        description: "Returns the T-SQL source text of the definition of a specified object.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/object-definition-transact-sql",
        signatures: [
            {
                label: "OBJECT_DEFINITION(object_id)",
                parameters: [{ name: "object_id", typeDisplay: "int" }],
                returnType: "nvarchar(max)",
            },
        ],
    },
    {
        name: "OBJECTPROPERTY",
        category: "metadata",
        description: "Returns information about a schema-scoped object property.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/objectproperty-transact-sql",
        signatures: [
            {
                label: "OBJECTPROPERTY(id, property)",
                parameters: [
                    { name: "id", typeDisplay: "int object id" },
                    { name: "property", typeDisplay: "property name, e.g. 'IsTable'" },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "COLUMNPROPERTY",
        category: "metadata",
        description: "Returns information about a column or procedure parameter.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/columnproperty-transact-sql",
        signatures: [
            {
                label: "COLUMNPROPERTY(id, column, property)",
                parameters: [
                    { name: "id", typeDisplay: "int table or procedure id" },
                    { name: "column", typeDisplay: "sysname column or parameter name" },
                    { name: "property", typeDisplay: "property name, e.g. 'IsIdentity'" },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "SERVERPROPERTY",
        category: "metadata",
        description: "Returns property information about the server instance.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/serverproperty-transact-sql",
        signatures: [
            {
                label: "SERVERPROPERTY('propertyname')",
                parameters: [
                    { name: "propertyname", typeDisplay: "property name, e.g. 'ProductVersion'" },
                ],
                returnType: "sql_variant",
            },
        ],
    },
    {
        name: "DATABASEPROPERTYEX",
        category: "metadata",
        description: "Returns the current setting of the specified database option or property.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/databasepropertyex-transact-sql",
        signatures: [
            {
                label: "DATABASEPROPERTYEX(database, property)",
                parameters: [
                    { name: "database", typeDisplay: "sysname database name" },
                    { name: "property", typeDisplay: "property name, e.g. 'Recovery'" },
                ],
                returnType: "sql_variant",
            },
        ],
    },
    {
        name: "IDENT_CURRENT",
        category: "metadata",
        description: "Returns the last identity value generated for a table, in any session/scope.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ident-current-transact-sql",
        signatures: [
            {
                label: "IDENT_CURRENT('table_or_view')",
                parameters: [{ name: "table_or_view", typeDisplay: "varchar name" }],
                returnType: "numeric(38,0)",
            },
        ],
    },
    {
        name: "IDENT_SEED",
        category: "metadata",
        description: "Returns the seed value of a table's identity column.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ident-seed-transact-sql",
        signatures: [
            {
                label: "IDENT_SEED('table_or_view')",
                parameters: [{ name: "table_or_view", typeDisplay: "varchar name" }],
                returnType: "numeric(38,0)",
            },
        ],
    },
    {
        name: "IDENT_INCR",
        category: "metadata",
        description: "Returns the increment value of a table's identity column.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ident-incr-transact-sql",
        signatures: [
            {
                label: "IDENT_INCR('table_or_view')",
                parameters: [{ name: "table_or_view", typeDisplay: "varchar name" }],
                returnType: "numeric(38,0)",
            },
        ],
    },
    {
        name: "SCOPE_IDENTITY",
        category: "metadata",
        description: "Returns the last identity value inserted in the same scope and session.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/scope-identity-transact-sql",
        signatures: [{ label: "SCOPE_IDENTITY()", parameters: [], returnType: "numeric(38,0)" }],
    },

    // ------------------------------------------------------------------
    // security
    // ------------------------------------------------------------------
    {
        name: "SUSER_NAME",
        category: "security",
        description: "Returns the login name for a principal id (default: current login).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/suser-name-transact-sql",
        signatures: [
            {
                label: "SUSER_NAME([server_user_id])",
                parameters: [{ name: "server_user_id", typeDisplay: "int", optional: true }],
                returnType: "nvarchar(128)",
            },
        ],
    },
    {
        name: "SUSER_SNAME",
        category: "security",
        description: "Returns the login name for a security id (default: current login).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/suser-sname-transact-sql",
        signatures: [
            {
                label: "SUSER_SNAME([server_user_sid])",
                parameters: [
                    { name: "server_user_sid", typeDisplay: "varbinary(85)", optional: true },
                ],
                returnType: "nvarchar(128)",
            },
        ],
    },
    {
        name: "USER_NAME",
        category: "security",
        description: "Returns the database user name for a user id (default: current user).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/user-name-transact-sql",
        signatures: [
            {
                label: "USER_NAME([id])",
                parameters: [{ name: "id", typeDisplay: "int", optional: true }],
                returnType: "nvarchar(128)",
            },
        ],
    },
    {
        name: "CURRENT_USER",
        category: "security",
        description: "Niladic; returns the name of the current database user.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/current-user-transact-sql",
        niladic: true,
        signatures: [{ label: "CURRENT_USER", parameters: [], returnType: "sysname" }],
    },
    {
        name: "SESSION_USER",
        category: "security",
        description: "Niladic; returns the database user name of the current session.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/session-user-transact-sql",
        niladic: true,
        signatures: [{ label: "SESSION_USER", parameters: [], returnType: "nvarchar(128)" }],
    },
    {
        name: "SYSTEM_USER",
        category: "security",
        description: "Niladic; returns the login name of the current security context.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/system-user-transact-sql",
        niladic: true,
        signatures: [{ label: "SYSTEM_USER", parameters: [], returnType: "nchar or nvarchar" }],
    },
    {
        name: "ORIGINAL_LOGIN",
        category: "security",
        description: "Returns the login that connected to the instance, ignoring impersonation.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/original-login-transact-sql",
        signatures: [{ label: "ORIGINAL_LOGIN()", parameters: [], returnType: "sysname" }],
    },
    {
        name: "IS_MEMBER",
        category: "security",
        description: "Returns 1 if the current user is a member of the Windows group or role.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/is-member-transact-sql",
        signatures: [
            {
                label: "IS_MEMBER('group_or_role')",
                parameters: [{ name: "group_or_role", typeDisplay: "sysname" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "IS_ROLEMEMBER",
        category: "security",
        description: "Returns 1 if the database principal is a member of the specified role.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/is-rolemember-transact-sql",
        signatures: [
            {
                label: "IS_ROLEMEMBER('role' [, 'database_principal'])",
                parameters: [
                    { name: "role", typeDisplay: "sysname" },
                    { name: "database_principal", typeDisplay: "sysname", optional: true },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "HAS_PERMS_BY_NAME",
        category: "security",
        description: "Evaluates the effective permission of the current user on a securable.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/has-perms-by-name-transact-sql",
        signatures: [
            {
                label: "HAS_PERMS_BY_NAME(securable, securable_class, permission [, sub_securable [, sub_securable_class]])",
                parameters: [
                    { name: "securable", typeDisplay: "sysname (NULL for server scope)" },
                    { name: "securable_class", typeDisplay: "'OBJECT', 'DATABASE', ..." },
                    { name: "permission", typeDisplay: "sysname, e.g. 'SELECT'" },
                    { name: "sub_securable", typeDisplay: "sysname", optional: true },
                    { name: "sub_securable_class", typeDisplay: "sysname", optional: true },
                ],
                returnType: "int",
            },
        ],
    },

    // ------------------------------------------------------------------
    // system
    // ------------------------------------------------------------------
    {
        name: "NEWID",
        category: "system",
        description: "Creates a unique value of type uniqueidentifier.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/newid-transact-sql",
        signatures: [{ label: "NEWID()", parameters: [], returnType: "uniqueidentifier" }],
    },
    {
        name: "NEWSEQUENTIALID",
        category: "system",
        description: "Creates ordered uniqueidentifiers; usable only in DEFAULT constraints.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/newsequentialid-transact-sql",
        signatures: [
            { label: "NEWSEQUENTIALID()", parameters: [], returnType: "uniqueidentifier" },
        ],
    },
    {
        name: "ISNUMERIC",
        category: "system",
        description:
            "Returns 1 when the expression evaluates to a valid numeric type; otherwise 0.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/isnumeric-transact-sql",
        signatures: [
            {
                label: "ISNUMERIC(expression)",
                parameters: [{ name: "expression", typeDisplay: "any" }],
                returnType: "int",
            },
        ],
    },
    {
        name: "HOST_NAME",
        category: "system",
        description: "Returns the workstation (client) name.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/host-name-transact-sql",
        signatures: [{ label: "HOST_NAME()", parameters: [], returnType: "nvarchar(128)" }],
    },
    {
        name: "APP_NAME",
        category: "system",
        description: "Returns the application name for the current session.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/app-name-transact-sql",
        signatures: [{ label: "APP_NAME()", parameters: [], returnType: "nvarchar(128)" }],
    },
    {
        name: "ERROR_NUMBER",
        category: "system",
        description: "Returns the error number of the error that caused the CATCH block to run.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/error-number-transact-sql",
        signatures: [{ label: "ERROR_NUMBER()", parameters: [], returnType: "int" }],
    },
    {
        name: "ERROR_MESSAGE",
        category: "system",
        description: "Returns the message text of the error that caused the CATCH block to run.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/error-message-transact-sql",
        signatures: [{ label: "ERROR_MESSAGE()", parameters: [], returnType: "nvarchar(4000)" }],
    },
    {
        name: "ERROR_SEVERITY",
        category: "system",
        description: "Returns the severity of the error that caused the CATCH block to run.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/error-severity-transact-sql",
        signatures: [{ label: "ERROR_SEVERITY()", parameters: [], returnType: "int" }],
    },
    {
        name: "ERROR_STATE",
        category: "system",
        description: "Returns the state number of the error that caused the CATCH block to run.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/error-state-transact-sql",
        signatures: [{ label: "ERROR_STATE()", parameters: [], returnType: "int" }],
    },
    {
        name: "ERROR_LINE",
        category: "system",
        description: "Returns the line number where the error occurred, inside a CATCH block.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/error-line-transact-sql",
        signatures: [{ label: "ERROR_LINE()", parameters: [], returnType: "int" }],
    },
    {
        name: "ERROR_PROCEDURE",
        category: "system",
        description: "Returns the name of the module where the error occurred, in a CATCH block.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/error-procedure-transact-sql",
        signatures: [{ label: "ERROR_PROCEDURE()", parameters: [], returnType: "nvarchar(128)" }],
    },
    {
        name: "XACT_STATE",
        category: "system",
        description: "Reports the transaction state: 1 active, -1 uncommittable, 0 none.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/xact-state-transact-sql",
        signatures: [{ label: "XACT_STATE()", parameters: [], returnType: "smallint" }],
    },
    {
        name: "ROWCOUNT_BIG",
        category: "system",
        description: "Returns the number of rows affected by the last statement as bigint.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/rowcount-big-transact-sql",
        signatures: [{ label: "ROWCOUNT_BIG()", parameters: [], returnType: "bigint" }],
    },
    {
        name: "FORMATMESSAGE",
        category: "system",
        description: "Constructs a message from sys.messages or a format string with placeholders.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/formatmessage-transact-sql",
        signatures: [
            {
                label: "FORMATMESSAGE(msg_number | 'msg_string' [, param_value ...])",
                parameters: [
                    {
                        name: "msg_number_or_string",
                        typeDisplay: "int message id or format string",
                    },
                    { name: "param_value", typeDisplay: "expression (repeatable)", optional: true },
                ],
                returnType: "nvarchar",
            },
        ],
    },
    {
        name: "COMPRESS",
        category: "system",
        description: "Compresses the input with the Gzip algorithm and returns varbinary(max).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/compress-transact-sql",
        signatures: [
            {
                label: "COMPRESS(expression)",
                parameters: [{ name: "expression", typeDisplay: "string or binary expression" }],
                returnType: "varbinary(max)",
            },
        ],
    },
    {
        name: "DECOMPRESS",
        category: "system",
        description: "Decompresses a Gzip-compressed varbinary value.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/decompress-transact-sql",
        signatures: [
            {
                label: "DECOMPRESS(expression)",
                parameters: [{ name: "expression", typeDisplay: "varbinary(max)" }],
                returnType: "varbinary(max)",
            },
        ],
    },
    {
        name: "CHECKSUM",
        category: "system",
        description: "Returns an int hash over a row or list of expressions, for hash indexes.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/checksum-transact-sql",
        signatures: [
            {
                label: "CHECKSUM(*)",
                parameters: [],
                returnType: "int",
            },
            {
                label: "CHECKSUM(expression [, expressionN ...])",
                parameters: [
                    { name: "expression", typeDisplay: "any scalar (non-BLOB)" },
                    { name: "expressionN", typeDisplay: "any scalar (repeatable)", optional: true },
                ],
                returnType: "int",
            },
        ],
    },

    // ------------------------------------------------------------------
    // cryptographic
    // ------------------------------------------------------------------
    {
        name: "HASHBYTES",
        category: "cryptographic",
        description: "Returns the hash of the input using the specified algorithm (e.g. SHA2_256).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/hashbytes-transact-sql",
        signatures: [
            {
                label: "HASHBYTES('algorithm', input)",
                parameters: [
                    { name: "algorithm", typeDisplay: "'SHA2_256', 'SHA2_512', 'MD5', ..." },
                    { name: "input", typeDisplay: "varchar, nvarchar, or varbinary" },
                ],
                returnType: "varbinary(8000)",
            },
        ],
    },

    // ------------------------------------------------------------------
    // ranking
    // ------------------------------------------------------------------
    {
        name: "ROW_NUMBER",
        category: "ranking",
        description: "Numbers the rows in the output of a result set partition, starting at 1.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql",
        signatures: [
            {
                label: "ROW_NUMBER() OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [],
                returnType: "bigint",
            },
        ],
    },
    {
        name: "RANK",
        category: "ranking",
        description: "Returns the rank of each row within a partition, with gaps after ties.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/rank-transact-sql",
        signatures: [
            {
                label: "RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [],
                returnType: "bigint",
            },
        ],
    },
    {
        name: "DENSE_RANK",
        category: "ranking",
        description: "Returns the rank of each row within a partition, without gaps.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/dense-rank-transact-sql",
        signatures: [
            {
                label: "DENSE_RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [],
                returnType: "bigint",
            },
        ],
    },
    {
        name: "NTILE",
        category: "ranking",
        description: "Distributes rows in a partition into the specified number of groups.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/ntile-transact-sql",
        signatures: [
            {
                label: "NTILE(integer_expression) OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [{ name: "integer_expression", typeDisplay: "int or bigint" }],
                returnType: "bigint",
            },
        ],
    },

    // ------------------------------------------------------------------
    // analytic
    // ------------------------------------------------------------------
    {
        name: "LAG",
        category: "analytic",
        description:
            "Accesses data from a previous row in the same result set, without a self-join.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/lag-transact-sql",
        signatures: [
            {
                label: "LAG(scalar_expression [, offset [, default]]) OVER (...)",
                parameters: [
                    { name: "scalar_expression", typeDisplay: "any scalar" },
                    { name: "offset", typeDisplay: "int (default 1)", optional: true },
                    { name: "default", typeDisplay: "same as scalar_expression", optional: true },
                ],
                returnType: "same as scalar_expression",
            },
        ],
    },
    {
        name: "LEAD",
        category: "analytic",
        description:
            "Accesses data from a following row in the same result set, without a self-join.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/lead-transact-sql",
        signatures: [
            {
                label: "LEAD(scalar_expression [, offset [, default]]) OVER (...)",
                parameters: [
                    { name: "scalar_expression", typeDisplay: "any scalar" },
                    { name: "offset", typeDisplay: "int (default 1)", optional: true },
                    { name: "default", typeDisplay: "same as scalar_expression", optional: true },
                ],
                returnType: "same as scalar_expression",
            },
        ],
    },
    {
        name: "FIRST_VALUE",
        category: "analytic",
        description: "Returns the first value in an ordered set of values.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/first-value-transact-sql",
        signatures: [
            {
                label: "FIRST_VALUE(scalar_expression) OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [{ name: "scalar_expression", typeDisplay: "any scalar" }],
                returnType: "same as scalar_expression",
            },
        ],
    },
    {
        name: "LAST_VALUE",
        category: "analytic",
        description: "Returns the last value in an ordered set of values.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/last-value-transact-sql",
        signatures: [
            {
                label: "LAST_VALUE(scalar_expression) OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [{ name: "scalar_expression", typeDisplay: "any scalar" }],
                returnType: "same as scalar_expression",
            },
        ],
    },
    {
        name: "CUME_DIST",
        category: "analytic",
        description: "Returns the cumulative distribution of a value within a group (0 < r <= 1).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/cume-dist-transact-sql",
        signatures: [
            {
                label: "CUME_DIST() OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [],
                returnType: "float",
            },
        ],
    },
    {
        name: "PERCENT_RANK",
        category: "analytic",
        description: "Returns the relative rank of a row within a group (0 to 1).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/percent-rank-transact-sql",
        signatures: [
            {
                label: "PERCENT_RANK() OVER ([PARTITION BY ...] ORDER BY ...)",
                parameters: [],
                returnType: "float",
            },
        ],
    },
    {
        name: "PERCENTILE_CONT",
        category: "analytic",
        description: "Interpolated (continuous) percentile of an ordered value distribution.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/percentile-cont-transact-sql",
        signatures: [
            {
                label: "PERCENTILE_CONT(numeric_literal) WITHIN GROUP (ORDER BY ...) OVER (...)",
                parameters: [{ name: "numeric_literal", typeDisplay: "float between 0.0 and 1.0" }],
                returnType: "float",
            },
        ],
    },
    {
        name: "PERCENTILE_DISC",
        category: "analytic",
        description: "Returns the first ordered value whose cumulative distribution >= percentile.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/percentile-disc-transact-sql",
        signatures: [
            {
                label: "PERCENTILE_DISC(numeric_literal) WITHIN GROUP (ORDER BY ...) OVER (...)",
                parameters: [{ name: "numeric_literal", typeDisplay: "float between 0.0 and 1.0" }],
                returnType: "same as ORDER BY expression",
            },
        ],
    },

    // ------------------------------------------------------------------
    // json
    // ------------------------------------------------------------------
    {
        name: "JSON_VALUE",
        category: "json",
        description: "Extracts a scalar value from a JSON string at the given path.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/json-value-transact-sql",
        signatures: [
            {
                label: "JSON_VALUE(expression, path)",
                parameters: [
                    { name: "expression", typeDisplay: "nvarchar containing JSON" },
                    { name: "path", typeDisplay: "SQL/JSON path, e.g. '$.info.name'" },
                ],
                returnType: "nvarchar(4000)",
            },
        ],
    },
    {
        name: "JSON_QUERY",
        category: "json",
        description: "Extracts an object or array from a JSON string at the given path.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/json-query-transact-sql",
        signatures: [
            {
                label: "JSON_QUERY(expression [, path])",
                parameters: [
                    { name: "expression", typeDisplay: "nvarchar containing JSON" },
                    { name: "path", typeDisplay: "SQL/JSON path (default '$')", optional: true },
                ],
                returnType: "nvarchar(max)",
            },
        ],
    },
    {
        name: "JSON_MODIFY",
        category: "json",
        description: "Updates a property value in a JSON string and returns the updated string.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/json-modify-transact-sql",
        signatures: [
            {
                label: "JSON_MODIFY(expression, path, newValue)",
                parameters: [
                    { name: "expression", typeDisplay: "nvarchar containing JSON" },
                    { name: "path", typeDisplay: "SQL/JSON path, e.g. '$.info.name'" },
                    { name: "newValue", typeDisplay: "nvarchar or NULL" },
                ],
                returnType: "nvarchar(max)",
            },
        ],
    },
    {
        name: "ISJSON",
        category: "json",
        description: "Tests whether a string contains valid JSON (optionally of a specific type).",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/isjson-transact-sql",
        signatures: [
            {
                label: "ISJSON(expression [, json_type_constraint])",
                parameters: [
                    { name: "expression", typeDisplay: "character expression" },
                    {
                        name: "json_type_constraint",
                        typeDisplay: "VALUE | ARRAY | OBJECT | SCALAR",
                        optional: true,
                    },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "JSON_PATH_EXISTS",
        category: "json",
        description: "Tests whether a specified SQL/JSON path exists in the input JSON string.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/json-path-exists-transact-sql",
        signatures: [
            {
                label: "JSON_PATH_EXISTS(value_expression, sql_json_path)",
                parameters: [
                    { name: "value_expression", typeDisplay: "nvarchar containing JSON" },
                    { name: "sql_json_path", typeDisplay: "SQL/JSON path, e.g. '$.info'" },
                ],
                returnType: "int",
            },
        ],
    },
    {
        name: "JSON_OBJECT",
        category: "json",
        description: "Constructs JSON object text from zero or more key:value pairs.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/json-object-transact-sql",
        signatures: [
            {
                label: "JSON_OBJECT([key : value [, ...]] [NULL ON NULL | ABSENT ON NULL])",
                parameters: [
                    {
                        name: "key : value",
                        typeDisplay: "string key : scalar/JSON value (repeatable)",
                        optional: true,
                    },
                ],
                returnType: "nvarchar(max)",
            },
        ],
    },
    {
        name: "JSON_ARRAY",
        category: "json",
        description: "Constructs JSON array text from zero or more expressions.",
        docUrl: "https://learn.microsoft.com/en-us/sql/t-sql/functions/json-array-transact-sql",
        signatures: [
            {
                label: "JSON_ARRAY([value [, ...]] [NULL ON NULL | ABSENT ON NULL])",
                parameters: [
                    {
                        name: "value",
                        typeDisplay: "scalar or JSON expression (repeatable)",
                        optional: true,
                    },
                ],
                returnType: "nvarchar(max)",
            },
        ],
    },
];

export const TSQL_BUILTIN_MAP: ReadonlyMap<string, BuiltinFunctionInfo> = new Map(
    TSQL_BUILTIN_FUNCTIONS.map((f): [string, BuiltinFunctionInfo] => [f.name, f]),
);
