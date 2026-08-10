/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { TokenType } from "./lexer.js";

import {
    type Program,
    type ParseResult,
    type Statement,
    type ErrorNode,
    type BatchSeparatorNode,
} from "../ast/types.js";

import { type JoinKeyword, JoinKeywords } from "./grammar.js";

import { AlterDropParser } from "./alterDropParser.js";

export { JoinKeywords };
export type { JoinKeyword };

export class Parser extends AlterDropParser {
    public parse(): ParseResult {
        const statements: Statement[] = [];

        while (this.pos < this.tokens.length) {
            const token = this.peek();

            // Handle T-SQL batch separator
            if (this.isBatchSeparator()) {
                statements.push(this.parseBatchSeparator());
                continue;
            }

            const beforePos = this.pos;

            let stmt: Statement | null = null;

            try {
                stmt = this.parseStatement();
            } catch (e) {
                // Defensive catch — should be rare now
                const message = e instanceof Error ? e.message : String(e);

                this.addIssue(
                    "PARSE_FATAL",
                    message,
                    token?.offset ?? 0,
                    token ? token.offset + token.value.length : 0,
                );

                //this.resync();
            }

            if (stmt) {
                statements.push(stmt);
            }

            // Ensure forward progress (VERY important)
            if (this.pos === beforePos) {
                const stuckToken = this.peek();

                if (stuckToken) {
                    this.addIssue(
                        "PARSE_STUCK",
                        `Parser could not consume token: ${stuckToken.value}`,
                        stuckToken.offset,
                        stuckToken.offset + stuckToken.value.length,
                    );

                    this.consume(); // force advance
                } else {
                    break;
                }
            }
        }

        const ast: Program = {
            type: "Program",
            start: 0,
            end: this.inputLength,
            body: statements,
        };

        return {
            ast,
            issues: this.issues,
        };
    }

    private parseBatchSeparator(): BatchSeparatorNode {
        const goToken = this.matchValue("GO");
        let end = goToken.offset + goToken.value.length;
        let count: number | undefined;

        if (this.peek()?.type === TokenType.Number) {
            const countToken = this.consume();
            count = Number(countToken.value);
            end = countToken.offset + countToken.value.length;
        }

        return {
            type: "BatchSeparatorStatement",
            start: goToken.offset,
            end,
            ...(count !== undefined ? { count } : {}),
        };
    }

    /**
     * SQLCMD's GO is a client-side batch separator, not a T-SQL keyword.  It is
     * recognized only when it is the sole code token on a physical line, with an
     * optional integer repetition count.  Keeping this rule here (rather than in
     * the lexer) lets ordinary identifiers named GO still participate in a query.
     *
     * This intentionally mirrors the conservative rule used by the incremental
     * batch partitioner so whole-document and incremental parsing stay equivalent.
     */
    private isBatchSeparator(): boolean {
        const go = this.peek();
        if (go?.value !== "GO") {
            return false;
        }

        const previous = this.tokens[this.pos - 1];
        if (previous?.line === go.line) {
            return false;
        }

        const next = this.peek(1);
        if (!next || next.line > go.line) {
            return true;
        }

        // GO <count> is valid only when the count is an integer and nothing
        // else follows on that line.  Decimal/negative counts deliberately
        // remain regular malformed input and receive a parser diagnostic.
        if (next.type !== TokenType.Number || !/^\d+$/u.test(next.value)) {
            return false;
        }

        const afterCount = this.peek(2);
        return !afterCount || afterCount.line > go.line;
    }

    protected parseStatement(): Statement | null {
        const token = this.peek();
        if (!token) return null;

        if (this.isLabelStatementStart()) {
            return this.parseLabel();
        }

        if (this.isParenthesizedQueryStatementStart()) {
            return this.parseParenthesizedQueryStatement();
        }

        if (this.peekKeyword("ELSE") || this.peekKeyword("END") || this.peekKeyword("CATCH")) {
            return null;
        }

        let stmt: Statement | null = null;
        const startOffset = token.offset;

        try {
            const val = token.value;

            switch (val) {
                case "SELECT":
                    stmt = this.parseQueryExpression();
                    break;
                case "INSERT":
                    stmt = this.parseInsert();
                    break;
                case "UPDATE":
                    stmt =
                        this.peek(1)?.value.toUpperCase() === "STATISTICS"
                            ? this.parseUpdateStatistics()
                            : this.parseUpdate();
                    break;
                case "DELETE":
                    stmt = this.parseDelete();
                    break;
                case "DECLARE":
                    stmt = this.isCursorDeclarationStart()
                        ? this.parseDeclareCursor()
                        : this.parseDeclare();
                    break;
                case "MERGE":
                    stmt = this.parseMerge();
                    break;
                case "SET":
                    stmt = this.parseSet();
                    break;
                case "CREATE":
                    stmt = this.parseCreate(false);
                    break;
                case "ALTER":
                    // Check if this is an ALTER TABLE statement
                    if (this.peek(1)?.value.toUpperCase() === "TABLE") {
                        stmt = this.parseAlterTable();
                    } else if (this.peek(1)?.value.toUpperCase() === "DATABASE") {
                        stmt = this.parseAlterDatabase();
                    } else if (this.peek(1)?.value.toUpperCase() === "ROLE") {
                        stmt = this.parseAlterRole();
                    } else if (this.peek(1)?.value.toUpperCase() === "INDEX") {
                        stmt = this.parseAlterIndex();
                    } else {
                        // Fallback for ALTER PROC, ALTER VIEW, etc.
                        stmt = this.parseCreate(true);
                    }
                    break;
                case "DROP":
                    stmt = this.parseDrop();
                    break;
                case "IF":
                    stmt = this.parseIf();
                    break;
                case "WITH":
                    stmt = this.parseWith();
                    break;
                case "PRINT":
                    stmt = this.parsePrint();
                    break;
                case "RETURN":
                    stmt = this.parseReturn();
                    break;
                case "RAISERROR":
                    stmt = this.parseRaiseError();
                    break;
                case "EXEC":
                case "EXECUTE":
                    stmt = this.parseExecute();
                    break;
                case "GRANT":
                case "DENY":
                    stmt = this.parsePermission();
                    break;
                case "USE":
                    stmt = this.parseUse();
                    break;
                case "WHILE":
                    stmt = this.parseWhile();
                    break;
                case "TRY":
                    stmt = this.parseTryCatch();
                    break;
                case "THROW":
                    stmt = this.parseThrow();
                    break;
                case "BREAK":
                    stmt = this.parseBreak();
                    break;
                case "CONTINUE":
                    stmt = this.parseContinue();
                    break;
                case "GOTO":
                    stmt = this.parseGoto();
                    break;
                case "WAITFOR":
                    stmt = this.parseWaitFor();
                    break;
                case "OPEN":
                    stmt = this.parseOpenCursor();
                    break;
                case "FETCH":
                    stmt = this.parseFetchCursor();
                    break;
                case "CLOSE":
                    stmt = this.parseCloseCursor();
                    break;
                case "DEALLOCATE":
                    stmt = this.parseDeallocateCursor();
                    break;
                case "BEGIN":
                    if (this.peek(1)?.value === "TRY") {
                        stmt = this.parseTryCatch();
                    } else if (
                        this.peek(1)?.value === "TRANSACTION" ||
                        this.peek(1)?.value === "TRAN" ||
                        this.peek(1)?.value === "DISTRIBUTED"
                    ) {
                        stmt = this.parseTransaction();
                    } else {
                        stmt = this.parseBlock();
                    }
                    break;
                case "COMMIT":
                case "ROLLBACK":
                case "SAVE":
                    stmt = this.parseTransaction();
                    break;
                case "TRUNCATE":
                    return this.parseTruncate();
                case "GO":
                    // An inline GO must not disappear silently.  Treating it as
                    // a separator would disagree with SQLCMD batching and could
                    // split an editor document at a surprising location.
                    this.addIssue(
                        "PARSE_GO_SEPARATOR",
                        "GO must appear by itself on a line, optionally followed by an integer count",
                        token.offset,
                        token.offset + token.value.length,
                    );
                    this.resync();
                    return {
                        type: "ErrorStatement",
                        message:
                            "GO must appear by itself on a line, optionally followed by an integer count",
                        start: token.offset,
                        end: token.offset + token.value.length,
                    } as ErrorNode;

                case "WHEN":
                case "THEN":
                case "ELSE":
                case "END":
                    throw new Error(
                        `Unexpected keyword: ${token.value}. This must be part of an expression.`,
                    );

                default:
                    if (token.type === TokenType.Semicolon) {
                        this.consume();
                        return null;
                    }
                    throw new Error(`Unexpected token: ${token.value}`);
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);

            const errorEnd = this.peek()
                ? this.peek()!.offset + this.peek()!.value.length
                : startOffset + 1;

            const errors: string[] = [];

            // FIX: use centralized error pipeline
            this.addRecoverableError(
                errors,
                "PARSE_STATEMENT_ERROR",
                errorMsg,
                startOffset,
                errorEnd,
            );

            this.resync();

            return {
                type: "ErrorStatement",
                message: errorMsg,
                start: startOffset,
                end: errorEnd,
                ...(errors.length ? { errors } : {}),
            } as ErrorNode;
        }

        // Preserve semicolon handling
        if (stmt && this.peek()?.type === TokenType.Semicolon) {
            this.consume();
        }

        return stmt;
    }
}
