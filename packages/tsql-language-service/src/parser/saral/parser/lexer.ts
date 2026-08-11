/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import type { ParseIssue } from "../ast/types.js";

export enum TokenType {
    Keyword,
    Identifier,
    Variable,
    TempTable,
    Operator,
    Number,
    String,
    OpenParen,
    CloseParen,
    Semicolon,
    EOF,
    Comma,
    Dot,
}

export interface Token {
    type: TokenType;
    value: string;
    raw?: string;
    line: number;
    col: number;
    offset: number; // Absolute character position for LSP integration
}

const COMPOSITE_START = new Set([">", "<", "!", "=", "+", "-", "*", "/", "%", "&", "^", "|"]);
const COMPOSITE_OPERATORS = new Set([
    ">=",
    "<=",
    "<>",
    "!=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "^=",
    "|=",
]);

export class Lexer {
    private pos = 0;
    private line = 1;
    private col = 1;
    private issues: ParseIssue[] = [];

    // Rule #3: Keywords are stored in UpperCase for normalized comparison
    private KEYWORDS = new Set([
        // ── Query clauses ─────────────────────────────────────────────────────────
        "SELECT",
        "DISTINCT",
        "TOP",
        "INTO",
        "FROM",
        "WHERE",
        "GROUP",
        "BY",
        "HAVING",
        "ORDER",
        "ASC",
        "DESC",

        // ── Pagination (OFFSET / FETCH) ───────────────────────────────────────────
        // SELECT * FROM T ORDER BY Id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY
        "OFFSET",
        "FETCH",
        "NEXT",
        "ROWS",
        "ONLY",

        // ── TOP modifier ─────────────────────────────────────────────────────────
        // SELECT TOP 10 PERCENT WITH TIES
        "PERCENT",
        "TIES",

        // ── Set operators ─────────────────────────────────────────────────────────
        "UNION",
        "EXCEPT",
        "INTERSECT",
        "ALL",

        // ── Joins ─────────────────────────────────────────────────────────────────
        "JOIN",
        "INNER",
        "LEFT",
        "RIGHT",
        "FULL",
        "OUTER",
        "CROSS",
        "APPLY",
        "HASH",
        "LOOP",
        "PIVOT",
        "UNPIVOT",

        // ── Logical operators ─────────────────────────────────────────────────────
        "AND",
        "OR",
        "NOT",

        // ── Predicates ────────────────────────────────────────────────────────────
        "IN",
        "BETWEEN",
        "LIKE",
        "EXISTS",
        "IS",
        "NULL",
        "CAST",
        "TRY_CAST",
        "CONVERT",
        "PARSE",
        "TRY_PARSE",

        // ── CASE expression ───────────────────────────────────────────────────────
        "CASE",
        "WHEN",
        "THEN",
        "ELSE",
        "END",

        // ── Window functions ──────────────────────────────────────────────────────
        // OVER (PARTITION BY ... ORDER BY ... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        "OVER",
        "PARTITION",
        "WITHIN",
        "UNBOUNDED",
        "PRECEDING",
        "FOLLOWING",
        "CURRENT",
        "RANGE",
        "ROW",
        // ROWS already listed under Pagination — serves double duty here

        // ── DML ───────────────────────────────────────────────────────────────────
        "INSERT",
        "VALUES",
        "UPDATE",
        "SET",
        "DELETE",
        "STATISTICS",
        "MERGE",
        "USING",
        "MATCHED",
        "SOURCE",
        "TARGET",
        "OUTPUT",
        "OUT", // OUTPUT clause + OUTPUT parameter modifier

        // ── DDL — CREATE ──────────────────────────────────────────────────────────
        "CREATE",
        "ALTER", // standalone ALTER and CREATE OR ALTER
        "DATABASE",
        "DROP",
        "TRUNCATE", // TRUNCATE TABLE

        // ── DDL — Object types ────────────────────────────────────────────────────
        "TABLE",
        "VIEW",
        "PROCEDURE",
        "PROC", // PROC is a shorthand alias for PROCEDURE
        "FUNCTION",
        "RETURNS",
        "TYPE", // CREATE TYPE ... AS TABLE
        "TRIGGER",
        "SCHEMA",
        "SEQUENCE",
        "SYNONYM",
        "ROLE",
        "MEMBER",
        "INDEX",
        "EXTERNAL",

        // ── DDL — Column / constraint modifiers ───────────────────────────────────
        // Only safe to keyword-ise because the parser has explicit DDL handling.
        // Do NOT add freely — DEFAULT, KEY, CHECK are common column names.
        // These should always be bracket-escaped by users: [Default], [Key].
        "ADD",
        "COLUMN",
        "CONSTRAINT",
        "DEFAULT",
        "CHECK",
        "PRIMARY",
        "KEY",
        "FOREIGN",
        "REFERENCES",
        "IDENTITY", // IDENTITY(1,1) in CREATE TABLE
        "PERSISTED",

        // ── Variables and declarations ────────────────────────────────────────────
        "DECLARE",
        "CURSOR",
        "LOCAL",
        "GLOBAL",
        "FORWARD_ONLY",
        "SCROLL",
        "STATIC",
        "KEYSET",
        "DYNAMIC",
        "FAST_FORWARD",
        "INSENSITIVE",
        "READ_ONLY",
        "SCROLL_LOCKS",
        "OPTIMISTIC",
        "OPEN",
        "CLOSE",
        "DEALLOCATE",
        "PRIOR",
        "LAST",
        "ABSOLUTE",
        "RELATIVE",

        // ── Control flow ─────────────────────────────────────────────────────────
        "IF",
        "ELSE",
        "BEGIN",
        "END",
        "WHILE",
        "BREAK",
        "CONTINUE",
        "RETURN",
        "GOTO", // rare but valid T-SQL
        "WAITFOR",
        "DELAY",

        // ── Error handling ────────────────────────────────────────────────────────
        "TRY",
        "CATCH",
        "THROW",
        "RAISERROR",

        // ── Execution ────────────────────────────────────────────────────────────
        "EXEC",
        "EXECUTE",
        "GRANT",
        "DENY",
        "TO",

        // ── CTEs and subquery hints ───────────────────────────────────────────────
        "WITH",
        "AS",
        "ON",

        // ── Miscellaneous statement-level keywords ────────────────────────────────
        "PRINT",
        "USE",
        "GO", // batch separator
        "OPTION", // OPTION (RECOMPILE), OPTION (MAXDOP N)

        // ── Table hints ───────────────────────────────────────────────────────────
        // Appear in WITH (NOLOCK), WITH (UPDLOCK), etc.
        // Safe to add — never used as bare column names in practice.
        "NOLOCK",
        "READPAST",
        "UPDLOCK",
        "XLOCK",
        "ROWLOCK",
        "TABLOCK",
        "PAGLOCK",
        "HOLDLOCK",
        "NOWAIT",
        "READCOMMITTED",
        "READUNCOMMITTED",
        "REPEATABLEREAD",
        "SERIALIZABLE",

        // ── Data type keywords ────────────────────────────────────────────────────
        // Only the ones that appear as standalone keywords in parser rules
        // (e.g. DECLARE @x TABLE, parameter types in CREATE PROCEDURE).
        // Full type names (NVARCHAR, DATETIME2 etc.) are parsed as identifiers.
        "INT",
        "BIGINT",
        "SMALLINT",
        "TINYINT",
        "BIT",
        "FLOAT",
        "REAL",
        "DECIMAL",
        "NUMERIC",
        "CHAR",
        "VARCHAR",
        "NCHAR",
        "NVARCHAR",
        "TEXT",
        "NTEXT",
        "DATE",
        "TIME",
        "DATETIME",
        "DATETIME2",
        "SMALLDATETIME",
        "UNIQUEIDENTIFIER",
        "VARBINARY",
        "BINARY",
        "IMAGE",
        "XML",
        "JSON",
        "FOR", // VARCHAR(MAX), NVARCHAR(MAX)

        // ── Transactions ──────────────────────────────────────────────────────────
        "TRANSACTION",
        "TRAN",
        "DISTRIBUTED",
        "COMMIT",
        "ROLLBACK",
        "SAVE",
    ]);

    constructor(private input: string) {}

    public getIssues(): ParseIssue[] {
        return [...this.issues];
    }

    private peek(offset: number = 0) {
        return this.input[this.pos + offset];
    }

    private consume() {
        const char = this.input[this.pos++];
        if (char === "\n") {
            this.line++;
            this.col = 1;
        } else if (char !== "\r") {
            this.col++;
        }
        return char;
    }

    public nextToken(): Token {
        this.skipWhitespaceAndComments();

        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;

        if (this.pos >= this.input.length) {
            return {
                type: TokenType.EOF,
                value: "",
                line: startLine,
                col: startCol,
                offset: startOffset,
            };
        }

        const char = this.peek();

        // 1. Strings (N'...' or '...')
        if (char === "'" || (char === "N" && this.peek(1) === "'")) {
            return this.readString(startLine, startCol, startOffset);
        }

        // 2. Rule #4: Explicit Dot Handling (Structural, not Operator)
        if (char === ".") {
            this.consume();
            return {
                type: TokenType.Dot,
                value: ".",
                line: startLine,
                col: startCol,
                offset: startOffset,
            };
        }

        if (char === ":" && this.peek(1) === ":") {
            this.consume();
            this.consume();
            return {
                type: TokenType.Dot,
                value: "::",
                line: startLine,
                col: startCol,
                offset: startOffset,
            };
        }

        // 3. Identifiers, Keywords, Variables, Temp Tables, and delimited identifiers.
        // Double quoted identifiers follow the same escaping rule as SQL Server strings
        // (a doubled quote represents one quote). The parser intentionally treats them
        // as identifiers: this is the common QUOTED_IDENTIFIER editor mode.
        if (/[a-zA-Z_@#$]/.test(char) || char === "[" || char === '"') {
            return this.readIdentifier(startLine, startCol, startOffset);
        }

        // 4. Rule #2: Robust Number Tokenization
        if (/[0-9]/.test(char)) {
            return this.readNumber(startLine, startCol, startOffset);
        }

        // 5. Rule #1: Composite Operators (>=, <=, <>, !=)

        if (COMPOSITE_START.has(char)) {
            let op = this.consume();
            const next = this.peek();
            let combined = op + next;

            if (COMPOSITE_OPERATORS.has(combined)) {
                op = combined;
                this.consume();
            }
            return {
                type: TokenType.Operator,
                value: op,
                line: startLine,
                col: startCol,
                offset: startOffset,
            };
        }

        // 6. Standard Punctuation & Fallback Operators
        this.consume();
        return {
            type: this.getCharTokenType(char),
            value: char,
            line: startLine,
            col: startCol,
            offset: startOffset,
        };
    }

    private readNumber(line: number, col: number, offset: number): Token {
        let val = "";
        let hasDot = false;

        if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
            val += this.consume();
            val += this.consume();

            while (this.pos < this.input.length && /[0-9a-fA-F]/.test(this.peek())) {
                val += this.consume();
            }

            return { type: TokenType.Number, value: val, line, col, offset };
        }

        while (this.pos < this.input.length) {
            const ch = this.peek();
            if (/[0-9]/.test(ch)) {
                val += this.consume();
            } else if (ch === "." && !hasDot && /[0-9]/.test(this.peek(1))) {
                // Rule #2: Only consume dot if followed by a digit
                hasDot = true;
                val += this.consume();
            } else {
                break;
            }
        }

        if (
            (this.peek() === "e" || this.peek() === "E") &&
            /[+-]?[0-9]/.test(`${this.peek(1) ?? ""}${this.peek(2) ?? ""}`)
        ) {
            val += this.consume();

            if (this.peek() === "+" || this.peek() === "-") {
                val += this.consume();
            }

            while (this.pos < this.input.length && /[0-9]/.test(this.peek())) {
                val += this.consume();
            }
        }

        return { type: TokenType.Number, value: val, line, col, offset };
    }

    private readIdentifier(line: number, col: number, startOffset: number): Token {
        let opener = "";
        let content = "";
        let closer = "";

        if (this.peek() === "[") {
            opener = this.consume(); // [
            while (this.pos < this.input.length) {
                // Escaped closing bracket inside bracketed identifier: ]]
                if (this.peek() === "]" && this.peek(1) === "]") {
                    content += this.consume();
                    content += this.consume();
                    continue;
                }

                if (this.peek() === "]") {
                    closer = this.consume(); // ]
                    break;
                }

                content += this.consume();
            }
        } else if (this.peek() === '"') {
            opener = this.consume();
            while (this.pos < this.input.length) {
                // Escaped quote in a quoted identifier: ""
                if (this.peek() === '"' && this.peek(1) === '"') {
                    content += this.consume();
                    content += this.consume();
                    continue;
                }

                if (this.peek() === '"') {
                    closer = this.consume();
                    break;
                }

                content += this.consume();
            }
        } else {
            while (this.pos < this.input.length && /[a-zA-Z0-9_@#$]/.test(this.peek())) {
                content += this.consume();
            }
        }

        const fullValue = `${opener}${content}${closer}`;

        if (opener === "[" && closer !== "]") {
            this.issues.push({
                code: "LEX_UNTERMINATED_BRACKET_IDENTIFIER",
                message: "Unterminated bracketed identifier",
                start: startOffset,
                end: startOffset + fullValue.length,
            });
        } else if (opener === '"' && closer !== '"') {
            this.issues.push({
                code: "LEX_UNTERMINATED_QUOTED_IDENTIFIER",
                message: "Unterminated quoted identifier",
                start: startOffset,
                end: startOffset + fullValue.length,
            });
        }

        // Rule #3: Check normalized keywords
        if (opener === "" && !content.startsWith("@") && !content.startsWith("#")) {
            const upper = content.toUpperCase();
            if (this.KEYWORDS.has(upper)) {
                return {
                    type: TokenType.Keyword,
                    value: upper,
                    raw: content,
                    line,
                    col,
                    offset: startOffset,
                };
            }
        }

        let type = TokenType.Identifier;
        if (content.startsWith("@")) type = TokenType.Variable;
        else if (content.startsWith("#")) type = TokenType.TempTable;

        return { type, value: fullValue, line, col, offset: startOffset };
    }

    private readString(line: number, col: number, startOffset: number): Token {
        let value = "";
        if (this.peek() === "N") value += this.consume();

        const quote = this.consume();
        value += quote;
        let terminated = false;

        while (this.pos < this.input.length) {
            if (this.peek() === "'" && this.peek(1) === "'") {
                value += this.consume();
                value += this.consume();
            } else if (this.peek() === "'") {
                value += this.consume();
                terminated = true;
                break;
            } else {
                value += this.consume();
            }
        }

        if (!terminated) {
            this.issues.push({
                code: "LEX_UNTERMINATED_STRING",
                message: "Unterminated string literal",
                start: startOffset,
                end: startOffset + value.length,
            });
        }

        return { type: TokenType.String, value, line, col, offset: startOffset };
    }

    private getCharTokenType(char: string): TokenType {
        switch (char) {
            case "(":
                return TokenType.OpenParen;
            case ")":
                return TokenType.CloseParen;
            case ";":
                return TokenType.Semicolon;
            case ",":
                return TokenType.Comma;
            case ".":
                return TokenType.Dot;
            default:
                return TokenType.Operator;
        }
    }

    private skipWhitespaceAndComments() {
        while (this.pos < this.input.length) {
            const char = this.peek();

            if (/\s/.test(char)) {
                this.consume();
                continue;
            }

            if (this.input.startsWith("--", this.pos)) {
                while (this.pos < this.input.length && this.peek() !== "\n") {
                    this.consume();
                }
                continue;
            }

            if (this.input.startsWith("/*", this.pos)) {
                const startOffset = this.pos;
                this.consume(); // /
                this.consume(); // *

                let depth = 1;

                while (this.pos < this.input.length && depth > 0) {
                    if (this.input.startsWith("/*", this.pos)) {
                        this.consume(); // /
                        this.consume(); // *
                        depth++;
                        continue;
                    }

                    if (this.input.startsWith("*/", this.pos)) {
                        this.consume(); // *
                        this.consume(); // /
                        depth--;
                        continue;
                    }

                    this.consume();
                }

                if (depth > 0) {
                    this.issues.push({
                        code: "LEX_UNTERMINATED_BLOCK_COMMENT",
                        message: "Unterminated block comment",
                        start: startOffset,
                        end: this.pos,
                    });
                }
                continue;
            }
            break;
        }
    }
}
