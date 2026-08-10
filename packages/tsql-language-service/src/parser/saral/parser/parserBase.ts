/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { Lexer, type Token, TokenType } from "./lexer.js";

import {
    type ParseIssue,
    type Statement,
    type QueryStatement,
    type ConstraintNode,
    type TableIndexNode,
    type Expression,
    type IdentifierNode,
    type WildcardExpression,
    type ColumnDefinition,
} from "../ast/types.js";

import { RESYNC_KEYWORDS, STRUCTURAL_KEYWORDS } from "./grammar.js";

import { stringifyExpression as stringifyExpressionNode } from "./expressionStringifier.js";

export abstract class ParserBase {
    protected tokens: Token[] = [];
    protected pos = 0;
    protected issues: ParseIssue[] = [];
    protected inputLength = 0;

    constructor(lexer: Lexer) {
        let t: Token;
        while ((t = lexer.nextToken()).type !== TokenType.EOF) {
            this.tokens.push(t);
        }
        this.inputLength = t.offset;
        this.issues.push(...lexer.getIssues());
    }

    protected peek(offset: number = 0) {
        return this.tokens[this.pos + offset];
    }

    protected consume() {
        return this.tokens[this.pos++];
    }

    /**
     * Ensures the current token is of a specific type and consumes it.
     * If not, it throws a helpful error.
     */

    protected match(...types: TokenType[]): Token {
        const token = this.peek();
        if (token && types.includes(token.type)) {
            return this.consume();
        }
        const expected = types.map((t) => TokenType[t]).join(" or ");
        throw new Error(`Expected ${expected} but found ${token?.value} at line ${token?.line}`);
    }

    /**
     * Ensures the current token has a specific value (case-sensitive) and consumes it.
     * Perfect for keywords like 'AND' in the BETWEEN clause.
     */

    protected matchValue(value: string): Token {
        const token = this.peek();
        if (!token || token.value !== value) {
            throw new Error(
                `Expected '${value}' at line ${token?.line}, but found '${token?.value}'`,
            );
        }
        return this.consume();
    }

    protected parseMultipartIdentifier(
        firstConsumed?: Token,
        options?: {
            allowStructuralFirstSegment?: boolean;
        },
    ): Expression {
        const segments: Token[] = [];
        const allowStructuralFirstSegment = options?.allowStructuralFirstSegment ?? false;

        const startToken = firstConsumed ?? this.peek();
        let startOffset = startToken?.offset ?? 0;
        let endOffset = startOffset;

        // --- 1. First segment (never throw) ---
        const first = firstConsumed ?? this.peek();

        if (
            !first ||
            ![
                TokenType.Identifier,
                TokenType.Keyword,
                TokenType.Variable,
                TokenType.TempTable,
            ].includes(first.type) ||
            (first.type === TokenType.Keyword &&
                this.isStructuralKeyword(first.value) &&
                !allowStructuralFirstSegment)
        ) {
            const message = `Expected identifier`;

            this.addRecoverableError([], "PARSE_IDENTIFIER", message, startOffset, startOffset + 1);

            return {
                type: "Identifier",
                name: "",
                parts: [],
                start: startOffset,
                end: startOffset,
                incomplete: true,
                errors: [message],
            } as IdentifierNode;
        }

        const consumedFirst = firstConsumed ?? this.consume();
        segments.push(consumedFirst);

        startOffset = consumedFirst.offset;
        endOffset = consumedFirst.offset + consumedFirst.value.length;

        // --- 2. Dot chain ---
        while (this.peek()?.type === TokenType.Dot) {
            const dot = this.consume();
            endOffset = dot.offset + dot.value.length;

            // wildcard: alias.*
            if (this.peek()?.value === "*") {
                const star = this.consume();

                const prefixParts = segments.map((t, i) => this.getIdentifierSegmentText(t, i > 0));

                const prefixNode: IdentifierNode = {
                    type: "Identifier",
                    name: prefixParts.join("."),
                    parts: prefixParts,
                    start: startOffset,
                    end:
                        segments[segments.length - 1].offset +
                        segments[segments.length - 1].value.length,
                };

                return {
                    type: "WildcardExpression",
                    tablePrefix: prefixNode,
                    start: startOffset,
                    end: star.offset + star.value.length,
                } as WildcardExpression;
            }

            const next = this.peek();

            // ❗ Missing segment (dbo.)
            // After a dot, hard token boundaries stop us. FROM is also a boundary: consuming it as
            // a member in `SELECT alias. FROM ...` loses the intact FROM clause during editing.
            // Structural keywords are NOT boundaries here — they are valid
            // name segments in dot-chain position: dbo.Order, dbo.User, dbo.Select.
            // Whether the user SHOULD bracket-escape them ([Order]) is a linter
            // concern, not a parser concern.
            if (
                !next ||
                next.type === TokenType.Semicolon ||
                next.type === TokenType.CloseParen ||
                next.type === TokenType.OpenParen ||
                (next.type === TokenType.Keyword && next.value === "FROM")
            ) {
                const message = "Expected identifier after dot";

                this.addRecoverableError(
                    [],
                    "PARSE_IDENTIFIER_DOT",
                    message,
                    dot.offset,
                    endOffset,
                );

                return {
                    type: "Identifier",
                    name:
                        segments.map((t, i) => this.getIdentifierSegmentText(t, i > 0)).join(".") +
                        ".",
                    parts: [...segments.map((t, i) => this.getIdentifierSegmentText(t, i > 0)), ""],
                    start: startOffset,
                    end: endOffset,
                    incomplete: true,
                    errors: [message],
                } as IdentifierNode;
            }

            // Consume the next segment unconditionally — after a dot, any token
            // (including keywords like ORDER, GROUP, USER) is a valid name part.
            const consumedNext = this.consume();
            segments.push(consumedNext);
            endOffset = consumedNext.offset + consumedNext.value.length;
        }

        // --- 3. Final node ---
        const last = segments[segments.length - 1];

        return {
            type: "Identifier",
            name: segments.map((t, i) => this.getIdentifierSegmentText(t, i > 0)).join("."),
            parts: segments.map((t, i) => this.getIdentifierSegmentText(t, i > 0)),
            start: startOffset,
            end: last.offset + last.value.length,
        } as IdentifierNode;
    }

    protected getIdentifierSegmentText(token: Token, preserveRawKeyword = false): string {
        if (preserveRawKeyword && token.type === TokenType.Keyword && token.raw) {
            return token.raw;
        }
        return token.value;
    }

    protected parseParenthesizedTokenText(): string {
        this.match(TokenType.OpenParen);

        let depth = 1;
        let text = "";

        while (this.peek() && depth > 0) {
            const token = this.consume();

            if (token.type === TokenType.OpenParen) {
                depth++;
            } else if (token.type === TokenType.CloseParen) {
                depth--;

                if (depth === 0) {
                    break;
                }
            }

            text += token.value;
        }

        return text;
    }

    protected stringifyTokens(tokens: Token[]): string {
        let text = "";

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const prev = tokens[i - 1];

            const needsSpace =
                i > 0 &&
                token.type !== TokenType.CloseParen &&
                token.type !== TokenType.Comma &&
                token.type !== TokenType.Dot &&
                prev?.type !== TokenType.OpenParen &&
                prev?.type !== TokenType.Dot;

            if (needsSpace) {
                text += " ";
            }

            text += token.value;
        }

        return text;
    }

    protected addRecoverableError(
        errors: string[],
        code: string,
        message: string,
        fallbackStart?: number,
        fallbackEnd?: number,
    ): void {
        errors.push(message);

        const token = this.peek();

        this.addIssue(
            code,
            message,
            fallbackStart ?? token?.offset ?? 0,
            fallbackEnd ?? (token ? token.offset + token.value.length : (fallbackStart ?? 0) + 1),
        );
    }

    protected isStructuralKeyword(value: string): boolean {
        return STRUCTURAL_KEYWORDS.has(value); // O(1), no allocation, no toUpperCase
    }

    protected getCompoundAssignmentBinaryOperator(operator: string): string | null {
        switch (operator) {
            case "+=":
                return "+";
            case "-=":
                return "-";
            case "*=":
                return "*";
            case "/=":
                return "/";
            case "%=":
                return "%";
            case "&=":
                return "&";
            case "^=":
                return "^";
            case "|=":
                return "|";
            default:
                return null;
        }
    }

    protected buildCompoundAssignmentExpression(
        left: Expression,
        operatorToken: Token,
        right: Expression | null,
    ): Expression {
        const binaryOperator = this.getCompoundAssignmentBinaryOperator(operatorToken.value);

        if (!binaryOperator) {
            return right ?? left;
        }

        return {
            type: "BinaryExpression",
            left,
            operator: binaryOperator,
            right,
            start: left.start,
            end: right?.end ?? operatorToken.offset + operatorToken.value.length,
        };
    }

    protected matchKeyword(value: string): Token {
        const token = this.peek();
        // Lexer now returns keywords in UPPERCASE.
        // We normalize the 'value' argument once to ensure a perfect match.
        if (token && token.type === TokenType.Keyword && token.value === value) {
            return this.consume();
        }

        throw new Error(
            `Expected keyword "${value.toUpperCase()}" but found "${token?.value}" at line ${token?.line}`,
        );
    }

    protected peekKeyword(value: string): boolean {
        const token = this.peek();
        // Compare against the Uppercase version since Lexer normalized it
        return token?.type === TokenType.Keyword && token.value === value;
    }

    protected parseList<T>(
        parserFn: () => T,
        options?: {
            isBoundary?: (token?: Token) => boolean;
        },
    ): T[] {
        const list: T[] = [];
        const isBoundary = options?.isBoundary ?? this.isDefaultListBoundary.bind(this);

        // ---------------------------------------------
        // Empty list
        // ---------------------------------------------

        if (isBoundary(this.peek())) {
            return list;
        }

        // ---------------------------------------------
        // Parse recoverably
        // ---------------------------------------------

        while (this.pos < this.tokens.length) {
            const beforePos = this.pos;

            try {
                const item = parserFn();

                list.push(item);
            } catch {
                // -------------------------------------
                // Recovery:
                // move to next comma or clause boundary
                // -------------------------------------

                this.resyncToBoundary(isBoundary);

                // no forward progress possible
                if (this.pos === beforePos) {
                    break;
                }
            }

            // -----------------------------------------
            // Comma continuation
            // -----------------------------------------

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();

                // trailing comma
                if (isBoundary(this.peek())) {
                    break;
                }

                continue;
            }

            break;
        }

        return list;
    }

    protected isIdentifierListBoundary(token?: Token): boolean {
        return !token || token.type === TokenType.CloseParen;
    }

    protected isDefaultListBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (token.type === TokenType.Semicolon || token.type === TokenType.CloseParen) {
            return true;
        }

        if (
            token === this.peek() &&
            token.type === TokenType.Keyword &&
            this.peek(1)?.type === TokenType.OpenParen
        ) {
            return false;
        }

        return (
            token.type === TokenType.Keyword &&
            (STRUCTURAL_KEYWORDS.has(token.value) || RESYNC_KEYWORDS.has(token.value))
        );
    }

    protected lastConsumedEnd(): number {
        const last = this.tokens[this.pos - 1];
        if (!last) return 0;
        return last.offset + last.value.length;
    }

    protected collectTypeTokens(options?: {
        extraStopTokenTypes?: TokenType[];
        extraStopKeywords?: Iterable<string>;
        stopOnResyncKeywords?: boolean;
        stopOnVariable?: boolean;
        stopOnAssignmentOperator?: boolean;
    }): string {
        const parts: string[] = [];
        let parenDepth = 0;

        const stopTokenTypes = new Set<TokenType>([
            TokenType.Comma,
            TokenType.CloseParen,
            ...(options?.extraStopTokenTypes ?? []),
        ]);

        const stopKeywords = new Set<string>(
            ["AS", ...(options?.extraStopKeywords ?? [])].map((k) => k.toUpperCase()),
        );

        while (this.peek()) {
            const token = this.peek()!;
            const value = token.value.toUpperCase();

            // -----------------------------
            // top-level stop conditions
            // -----------------------------
            if (parenDepth === 0) {
                if (stopTokenTypes.has(token.type)) {
                    break;
                }

                // next variable declaration
                if (options?.stopOnVariable && token.type === TokenType.Variable) {
                    break;
                }

                // assignment begins default value
                if (
                    options?.stopOnAssignmentOperator &&
                    token.type === TokenType.Operator &&
                    token.value === "="
                ) {
                    break;
                }

                // statement boundary — DECLARE, SELECT, IF, CREATE etc.
                if (
                    options?.stopOnResyncKeywords &&
                    token.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(value)
                ) {
                    break;
                }

                // modifiers / clause boundaries
                // (value-only check, not type-restricted — e.g. READONLY
                // is not a lexer keyword, so it lexes as an Identifier)
                if (stopKeywords.has(value)) {
                    break;
                }
            }

            // -----------------------------
            // parentheses
            // -----------------------------
            if (token.type === TokenType.OpenParen) {
                parenDepth++;
            }

            parts.push(token.value);
            this.consume();

            if (token.type === TokenType.CloseParen) {
                parenDepth--;
            }
        }

        return parts.join("");
    }

    protected recoverTo(values: string[]) {
        while (this.peek()) {
            const token = this.peek();

            if (values.includes(token.value)) {
                return;
            }

            this.consume();
        }
    }

    protected addIssue(code: string, message: string, start: number, end: number): void {
        this.issues.push({
            code,
            message,
            start,
            end,
        });
    }

    protected stringifyExpression(expr: Expression | null): string {
        return stringifyExpressionNode(expr);
    }

    protected resync(): void {
        // 1. Always move forward at least one token to avoid infinite loops
        this.consume();

        // 2. Skip tokens until we find a semicolon or a major statement keyword
        while (this.pos < this.tokens.length) {
            const val = this.peek()?.value;
            if (this.peek()?.type === TokenType.Semicolon) {
                this.consume();
                break;
            }
            if (RESYNC_KEYWORDS.has(val!)) break;
            this.consume();
        }
    }

    protected recoverToStatementBoundary(extra: string[] = []) {
        this.recoverTo([";", ...extra, ...RESYNC_KEYWORDS]);
    }

    /**
     * Skips an unmodeled statement's whole definition. Stopping at a resync keyword is wrong here
     * because the definition itself contains them — `CREATE EXTERNAL TABLE ... WITH (...)` would
     * resume inside the WITH and be misread as a CTE.
     */
    protected skipToStatementTerminator(): void {
        let depth = 0;
        while (this.pos < this.tokens.length) {
            const token = this.peek();
            if (depth === 0 && token.value.toUpperCase() === "GO") {
                return;
            }
            if (token.type === TokenType.OpenParen) {
                depth++;
            } else if (token.type === TokenType.CloseParen) {
                depth = Math.max(0, depth - 1);
            } else if (depth === 0 && token.type === TokenType.Semicolon) {
                this.consume();
                return;
            }
            this.consume();
        }
    }

    protected resyncToBlockBoundary(): void {
        // consumeCommaAsBoundary: false — block bodies routinely contain
        // commas (e.g. inside expressions); only END/ELSE/CATCH/semicolon
        // should stop the resync.
        this.resyncToBoundary(
            (token) =>
                token?.value === "END" || token?.value === "ELSE" || token?.value === "CATCH",
            { consumeCommaAsBoundary: false },
        );
    }

    // Not reimplemented in terms of resyncToBoundary: this needs a third
    // behavior — consume-then-stop — for WHEN/THEN/ELSE (so the CASE
    // parser resumes right after them), which resyncToBoundary's
    // stop-without-consuming contract doesn't support.

    protected resyncToCaseBoundary(): void {
        while (this.pos < this.tokens.length) {
            const token = this.peek();

            if (!token) {
                return;
            }

            // ---------------------------------------------
            // Statement boundary
            //
            // Leave semicolon for outer statement/parser.
            // ---------------------------------------------

            if (token.type === TokenType.Semicolon) {
                return;
            }

            // ---------------------------------------------
            // CASE-owned boundaries
            //
            // Consume WHEN / THEN / ELSE so CASE parser
            // can continue safely.
            // ---------------------------------------------

            if (
                token.type === TokenType.Keyword &&
                (token.value === "WHEN" || token.value === "THEN" || token.value === "ELSE")
            ) {
                this.consume();
                return;
            }

            // ---------------------------------------------
            // END belongs to CASE parser itself.
            // Do NOT consume it here.
            // ---------------------------------------------

            if (token.type === TokenType.Keyword && token.value === "END") {
                return;
            }

            // ---------------------------------------------
            // Outer statement recovery boundary
            // ---------------------------------------------

            if (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value)) {
                return;
            }

            this.consume();
        }
    }

    protected resyncToBoundary(
        isBoundary: (token?: Token) => boolean,
        options?: { consumeCommaAsBoundary?: boolean },
    ): void {
        const consumeCommaAsBoundary = options?.consumeCommaAsBoundary ?? true;

        while (this.pos < this.tokens.length) {
            const token = this.peek();

            if (!token) {
                return;
            }

            // ---------------------------------------------
            // Column separator
            //
            // Consume comma so caller resumes at next
            // column expression cleanly.
            // ---------------------------------------------

            if (consumeCommaAsBoundary && token.type === TokenType.Comma) {
                this.consume();
                return;
            }

            // ---------------------------------------------
            // Statement boundary
            //
            // Leave semicolon for outer parser loop.
            // ---------------------------------------------

            if (token.type === TokenType.Semicolon) {
                return;
            }

            if (isBoundary(token)) {
                return;
            }

            this.consume();
        }
    }

    protected resyncToSelectBoundary(): void {
        this.resyncToBoundary(this.isDefaultListBoundary.bind(this));
    }

    // ---------------------------------------------------------------
    // Forward seams.
    //
    // These cut across the layered class chain: lower layers need to
    // call into logic that can only be implemented once higher-level
    // grammar (queries, full statements, table definitions) exists.
    // Declaring them abstract here lets every layer call `this.x()`
    // while the concrete implementation lives further up the chain
    // (QueryParser, CreateParser, and the final Parser class).
    // ---------------------------------------------------------------

    protected abstract parseStatement(): Statement | null;
    protected abstract parseSelect(): QueryStatement;
    protected abstract parseQueryExpression(): QueryStatement;
    protected abstract parseTableColumns(): {
        columns: ColumnDefinition[];
        constraints: ConstraintNode[];
        indexes: TableIndexNode[];
        incomplete?: boolean;
    };
}
