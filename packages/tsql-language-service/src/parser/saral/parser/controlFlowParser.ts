/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";

import {
    type Statement,
    type QueryStatement,
    type IfNode,
    type BlockNode,
    type WhileNode,
    type Expression,
    type ContinueNode,
    type BreakNode,
    type GotoNode,
    type LabelNode,
    type DeclareCursorNode,
    type OpenCursorNode,
    type FetchCursorNode,
    type CloseCursorNode,
    type DeallocateCursorNode,
    type TryCatchNode,
    type ThrowNode,
    type TransactionAction,
    type TransactionNode,
} from "../ast/types.js";

import { Precedence, RESYNC_KEYWORDS } from "./grammar.js";

import { StatementParser } from "./statementParser.js";

export abstract class ControlFlowParser extends StatementParser {
    protected isLabelStatementStart(): boolean {
        const token = this.peek();
        const next = this.peek(1);

        if (!token || !next) {
            return false;
        }

        const validName = token.type === TokenType.Identifier || token.type === TokenType.Keyword;

        return validName && next.type === TokenType.Operator && next.value === ":";
    }

    protected isCursorDeclarationStart(): boolean {
        if (!this.peekKeyword("DECLARE")) {
            return false;
        }

        const nameToken = this.peek(1);
        const cursorToken = this.peek(2);

        const validName =
            nameToken &&
            (nameToken.type === TokenType.Identifier || nameToken.type === TokenType.Keyword);

        return !!(validName && cursorToken?.value === "CURSOR");
    }

    protected parseIf(): IfNode {
        const startToken = this.matchKeyword("IF");

        let incomplete = false;

        const errors: string[] = [];

        let condition: Expression | null = null;

        let thenBranch: Statement | null = null;

        let elseBranch: Statement | undefined;

        let endOffset = startToken.offset + startToken.value.length;

        try {
            const next = this.peek();

            if (
                next &&
                next.type !== TokenType.Semicolon &&
                !this.isStructuralKeyword(next.value)
            ) {
                condition = this.parseExpression(
                    Precedence.LOWEST,
                    new Set(["BEGIN", "ELSE", "END"]),
                );

                if (condition) {
                    endOffset = condition.end;
                }

                if (condition.type === "Identifier" && condition.name === "SELECT") {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_IF_CONDITION",
                        "Incomplete IF condition",
                        condition.start,
                        condition.end,
                    );
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_IF_CONDITION",
                    "Expected IF condition",
                    startToken.offset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_IF_CONDITION",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );
        }

        try {
            const stmt = this.parseStatement();

            if (stmt) {
                thenBranch = stmt;
                endOffset = stmt.end;

                if ((stmt as any).incomplete) {
                    incomplete = true;
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_IF_THEN",
                    "Expected statement after IF condition",
                    endOffset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_IF_THEN",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        if (this.peekKeyword("ELSE")) {
            const elseToken = this.consume();

            try {
                const stmt = this.parseStatement();

                if (stmt) {
                    elseBranch = stmt;
                    endOffset = stmt.end;

                    if ((stmt as any).incomplete) {
                        incomplete = true;
                    }
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_IF_ELSE",
                        "Expected statement after ELSE",
                        elseToken.offset,
                        elseToken.offset + elseToken.value.length,
                    );
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_IF_ELSE",
                    e instanceof Error ? e.message : String(e),
                    elseToken.offset,
                    endOffset,
                );
            }
        }

        return {
            type: "IfStatement",
            condition: condition!,
            thenBranch: thenBranch!,
            elseBranch,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseBlock(): BlockNode {
        const startToken = this.matchKeyword("BEGIN");

        let incomplete = false;
        const errors: string[] = [];

        const body: Statement[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        while (this.pos < this.tokens.length && !this.peekKeyword("END")) {
            try {
                const beforePos = this.pos;
                const stmt = this.parseStatement();

                if (stmt) {
                    body.push(stmt);
                    endOffset = stmt.end;
                } else {
                    if (this.pos > beforePos) {
                        continue;
                    }

                    if (
                        this.peekKeyword("END") ||
                        this.peekKeyword("ELSE") ||
                        this.peekKeyword("CATCH")
                    ) {
                        break;
                    }

                    if (this.peek()?.type === TokenType.Semicolon) {
                        this.consume();
                        continue;
                    }

                    break;
                }
            } catch {
                incomplete = true;

                this.resyncToBlockBoundary();
            }
        }

        try {
            if (this.peekKeyword("END")) {
                const endToken = this.consume();

                endOffset = endToken.offset + endToken.value.length;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_BLOCK_END",
                    "Expected END for BEGIN block",
                    endOffset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_BLOCK_END",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        return {
            type: "BlockStatement",
            body,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseWhile(): WhileNode {
        const startToken = this.matchKeyword("WHILE");

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        let condition: Expression | null = null;
        let body: Statement | null = null;

        try {
            const next = this.peek();

            if (
                next &&
                next.type !== TokenType.Semicolon &&
                !(next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value))
            ) {
                condition = this.parseExpression();

                endOffset = condition.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_WHILE_CONDITION",
                    "Expected WHILE condition",
                    endOffset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_WHILE_CONDITION",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            const next = this.peek();

            if (next && next.type !== TokenType.Semicolon) {
                body = this.parseStatement();

                if (body) {
                    endOffset = body.end;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_WHILE_BODY",
                        "Expected WHILE body statement",
                        endOffset,
                        endOffset,
                    );
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_WHILE_BODY",
                    "Expected WHILE body statement",
                    endOffset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_WHILE_BODY",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );

            this.recoverTo([";"]);
        }

        return {
            type: "WhileStatement",
            condition,
            body,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseTryCatch(): TryCatchNode {
        // BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH
        const startToken = this.matchKeyword("BEGIN");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        // 1. TRY keyword after BEGIN
        try {
            this.matchKeyword("TRY");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_TRY_KEYWORD",
                "Expected TRY after BEGIN",
                endOffset,
            );
        }

        // 2. TRY block body — statements until END TRY
        const tryBody: Statement[] = [];

        while (
            this.pos < this.tokens.length &&
            !(this.peek()?.value === "END" && this.peek(1)?.value === "TRY")
        ) {
            const beforePos = this.pos;
            const stmt = this.parseStatement();
            if (stmt) {
                tryBody.push(stmt);
                endOffset = stmt.end;
            } else {
                if (this.pos > beforePos) {
                    continue;
                }

                if (this.peek()?.type === TokenType.Semicolon) {
                    this.consume();
                    continue;
                }

                break;
            }
        }

        // 3. END TRY
        try {
            this.matchKeyword("END");
            this.matchKeyword("TRY");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(errors, "PARSE_TRY_END", "Expected END TRY", endOffset);
        }

        const tryBlock: BlockNode = {
            type: "BlockStatement",
            body: tryBody,
            start: startToken.offset,
            end: this.lastConsumedEnd(),
        };

        // 4. BEGIN CATCH
        const catchStart = this.peek()?.offset ?? endOffset;

        try {
            this.matchKeyword("BEGIN");
            this.matchKeyword("CATCH");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CATCH_BEGIN",
                "Expected BEGIN CATCH after END TRY",
                endOffset,
            );
        }

        // 5. CATCH block body — statements until END CATCH
        const catchBody: Statement[] = [];

        while (
            this.pos < this.tokens.length &&
            !(this.peek()?.value === "END" && this.peek(1)?.value === "CATCH")
        ) {
            const beforePos = this.pos;
            const stmt = this.parseStatement();
            if (stmt) {
                catchBody.push(stmt);
                endOffset = stmt.end;
            } else {
                if (this.pos > beforePos) {
                    continue;
                }

                if (this.peek()?.type === TokenType.Semicolon) {
                    this.consume();
                    continue;
                }

                break;
            }
        }

        // 6. END CATCH
        try {
            this.matchKeyword("END");
            this.matchKeyword("CATCH");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(errors, "PARSE_CATCH_END", "Expected END CATCH", endOffset);
        }

        const catchBlock: BlockNode = {
            type: "BlockStatement",
            body: catchBody,
            start: catchStart,
            end: this.lastConsumedEnd(),
        };

        return {
            type: "TryCatchStatement",
            tryBlock,
            catchBlock,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseThrow(): ThrowNode {
        const startToken = this.matchKeyword("THROW");
        let endOffset = startToken.offset + startToken.value.length;

        let incomplete = false;
        const errors: string[] = [];

        let errorNumber: Expression | null | undefined;
        let message: Expression | null | undefined;
        let state: Expression | null | undefined;

        // Bare THROW (re-throw inside CATCH) — no arguments
        const next = this.peek();
        const isBare =
            !next || next.type === TokenType.Semicolon || RESYNC_KEYWORDS.has(next.value);

        if (!isBare) {
            // THROW error_number, message, state
            try {
                errorNumber = this.parseExpression();
                endOffset = errorNumber.end;

                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();

                    message = this.parseExpression();
                    endOffset = message.end;
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_THROW_MESSAGE",
                        "Expected message argument in THROW",
                        endOffset,
                    );
                }

                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();

                    state = this.parseExpression();
                    endOffset = state.end;
                } else if (message) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_THROW_STATE",
                        "Expected state argument in THROW",
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_THROW_ARGS",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        return {
            type: "ThrowStatement",
            ...(errorNumber !== undefined ? { errorNumber } : {}),
            ...(message !== undefined ? { message } : {}),
            ...(state !== undefined ? { state } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseBreak(): BreakNode {
        const token = this.matchKeyword("BREAK");
        return {
            type: "BreakStatement",
            start: token.offset,
            end: token.offset + token.value.length,
        };
    }

    protected parseContinue(): ContinueNode {
        const token = this.matchKeyword("CONTINUE");
        return {
            type: "ContinueStatement",
            start: token.offset,
            end: token.offset + token.value.length,
        };
    }

    protected parseGoto(): GotoNode {
        const token = this.matchKeyword("GOTO");
        let incomplete = false;
        const errors: string[] = [];
        let label: string | null = null;
        let endOffset = token.offset + token.value.length;

        const next = this.peek();

        if (next && (next.type === TokenType.Identifier || next.type === TokenType.Keyword)) {
            label = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_GOTO_LABEL",
                "Expected label after GOTO",
                endOffset,
                endOffset,
            );
        }

        return {
            type: "GotoStatement",
            label,
            start: token.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseLabel(): LabelNode {
        const nameToken = this.consume();
        const colonToken = this.consume();

        return {
            type: "LabelStatement",
            name: nameToken.value,
            start: nameToken.offset,
            end: colonToken.offset + colonToken.value.length,
        };
    }

    protected parseDeclareCursor(): DeclareCursorNode {
        const startToken = this.matchKeyword("DECLARE");
        let incomplete = false;
        const errors: string[] = [];
        let name: string | null = null;
        let query: QueryStatement | null = null;
        const options: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        const nameToken = this.peek();
        if (
            nameToken &&
            (nameToken.type === TokenType.Identifier || nameToken.type === TokenType.Keyword)
        ) {
            name = this.consume().value;
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CURSOR_NAME",
                "Expected cursor name after DECLARE",
                endOffset,
                endOffset,
            );
        }

        if (this.peekKeyword("CURSOR")) {
            this.consume();
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CURSOR_KEYWORD",
                "Expected CURSOR keyword in cursor declaration",
                endOffset,
                endOffset,
            );
        }

        while (this.peek()) {
            const value = this.peek()!.value;
            if (value === "FOR") {
                break;
            }
            if (
                this.peek()?.type === TokenType.Semicolon ||
                (this.peek()?.type === TokenType.Keyword && RESYNC_KEYWORDS.has(this.peek()!.value))
            ) {
                break;
            }

            options.push(this.consume().value);
            endOffset = this.lastConsumedEnd();
        }

        if (this.peekKeyword("FOR")) {
            this.consume();
            endOffset = this.lastConsumedEnd();
            try {
                query = this.parseQueryExpression();
                endOffset = query.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CURSOR_QUERY",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                    endOffset,
                );
            }
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CURSOR_FOR",
                "Expected FOR query in cursor declaration",
                endOffset,
                endOffset,
            );
        }

        return {
            type: "DeclareCursorStatement",
            name,
            ...(options.length ? { options } : {}),
            query,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseCursorName(
        errors: string[],
        errorCode: string,
        errorMessage: string,
        fallbackOffset: number,
    ): { name: string | null; incomplete: boolean; endOffset: number } {
        if (
            this.peek() &&
            (this.peek()!.type === TokenType.Identifier ||
                this.peek()!.type === TokenType.Keyword ||
                // OPEN/FETCH/CLOSE/DEALLOCATE @cursorVar — a cursor stored
                // in a variable (SET @c = CURSOR FOR ...), as opposed to a
                // named cursor (DECLARE c CURSOR FOR ...).
                this.peek()!.type === TokenType.Variable)
        ) {
            const name = this.consume().value;
            return { name, incomplete: false, endOffset: this.lastConsumedEnd() };
        }

        this.addRecoverableError(errors, errorCode, errorMessage, fallbackOffset, fallbackOffset);
        return { name: null, incomplete: true, endOffset: fallbackOffset };
    }

    protected parseOpenCursor(): OpenCursorNode {
        const startToken = this.matchKeyword("OPEN");
        const errors: string[] = [];

        const { name, incomplete, endOffset } = this.parseCursorName(
            errors,
            "PARSE_CURSOR_OPEN_NAME",
            "Expected cursor name after OPEN",
            startToken.offset + startToken.value.length,
        );

        return {
            type: "OpenCursorStatement",
            name,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseFetchCursor(): FetchCursorNode {
        const startToken = this.matchKeyword("FETCH");
        let incomplete = false;
        const errors: string[] = [];
        let direction: string | undefined;
        let offset: Expression | null | undefined;
        let name: string | null = null;
        let into: string[] | undefined;
        let endOffset = startToken.offset + startToken.value.length;

        const directionToken = this.peek();
        if (
            directionToken &&
            ["NEXT", "PRIOR", "FIRST", "LAST", "ABSOLUTE", "RELATIVE"].includes(
                directionToken.value,
            )
        ) {
            direction = this.consume().value;
            endOffset = this.lastConsumedEnd();

            if (direction === "ABSOLUTE" || direction === "RELATIVE") {
                try {
                    offset = this.parseExpression();
                    endOffset = offset.end;
                } catch (e) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_CURSOR_FETCH_OFFSET",
                        e instanceof Error ? e.message : String(e),
                        endOffset,
                        endOffset,
                    );
                }
            }
        }

        if (this.peekKeyword("FROM")) {
            this.consume();
            endOffset = this.lastConsumedEnd();
        }

        {
            const cursorName = this.parseCursorName(
                errors,
                "PARSE_CURSOR_FETCH_NAME",
                "Expected cursor name after FETCH",
                endOffset,
            );
            name = cursorName.name;
            endOffset = cursorName.endOffset;
            incomplete = incomplete || cursorName.incomplete;
        }

        if (this.peekKeyword("INTO")) {
            this.consume();
            endOffset = this.lastConsumedEnd();
            into = this.parseList(
                () => {
                    const token = this.peek();
                    if (!token || token.type !== TokenType.Variable) {
                        throw new Error("Expected variable in FETCH INTO list");
                    }
                    return this.consume().value;
                },
                {
                    isBoundary: (token?: Token) =>
                        !token ||
                        token.type === TokenType.Semicolon ||
                        (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value)),
                },
            );
            endOffset = this.lastConsumedEnd();
        }

        return {
            type: "FetchCursorStatement",
            ...(direction ? { direction } : {}),
            ...(offset !== undefined ? { offset } : {}),
            name,
            ...(into ? { into } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseCloseCursor(): CloseCursorNode {
        const startToken = this.matchKeyword("CLOSE");
        const errors: string[] = [];

        const { name, incomplete, endOffset } = this.parseCursorName(
            errors,
            "PARSE_CURSOR_CLOSE_NAME",
            "Expected cursor name after CLOSE",
            startToken.offset + startToken.value.length,
        );

        return {
            type: "CloseCursorStatement",
            name,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseDeallocateCursor(): DeallocateCursorNode {
        const startToken = this.matchKeyword("DEALLOCATE");
        const errors: string[] = [];

        const { name, incomplete, endOffset } = this.parseCursorName(
            errors,
            "PARSE_CURSOR_DEALLOCATE_NAME",
            "Expected cursor name after DEALLOCATE",
            startToken.offset + startToken.value.length,
        );

        return {
            type: "DeallocateCursorStatement",
            name,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseTransaction(): TransactionNode {
        const startToken = this.consume(); // BEGIN / COMMIT / ROLLBACK / SAVE

        const action = startToken.value as TransactionAction;

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        let distributed = false;
        let name: string | undefined;

        // -------------------------------------------------
        // BEGIN DISTRIBUTED TRANSACTION
        // -------------------------------------------------

        if (action === "BEGIN" && this.peekKeyword("DISTRIBUTED")) {
            this.consume();

            distributed = true;

            endOffset = this.lastConsumedEnd();
        }

        // -------------------------------------------------
        // Optional TRAN / TRANSACTION
        // -------------------------------------------------

        const nextValue = this.peek()?.value?.toUpperCase();

        if (nextValue === "TRANSACTION" || nextValue === "TRAN") {
            this.consume();

            endOffset = this.lastConsumedEnd();
        }

        // -------------------------------------------------
        // Optional transaction/savepoint name
        //
        // CRITICAL:
        // Do NOT consume statement keywords
        // like UPDATE/SELECT/INSERT/etc
        // as transaction names.
        // -------------------------------------------------

        const next = this.peek();

        const hasName =
            next &&
            next.type !== TokenType.Semicolon &&
            this.peek(1)?.value !== ":" &&
            (next.type === TokenType.Identifier || next.type === TokenType.Variable);

        if (hasName) {
            try {
                name = this.consume().value;

                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_TRANSACTION_NAME",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // -------------------------------------------------
        // SAVE TRAN requires name
        // -------------------------------------------------
        else if (action === "SAVE") {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_TRANSACTION_SAVE_NAME",
                "SAVE TRANSACTION requires a savepoint name",
                endOffset,
            );
        }

        return {
            type: "TransactionStatement",
            action,

            ...(name !== undefined ? { name } : {}),

            ...(distributed ? { distributed: true } : {}),

            start: startToken.offset,
            end: endOffset,

            ...(incomplete ? { incomplete: true } : {}),

            ...(errors.length ? { errors } : {}),
        };
    }
}
