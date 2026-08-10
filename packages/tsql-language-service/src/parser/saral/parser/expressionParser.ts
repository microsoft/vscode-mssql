/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";

import {
    type QueryStatement,
    type Expression,
    type IdentifierNode,
    type FunctionCallNode,
    type GroupingExpression,
    type SubqueryExpression,
    type OverExpression,
    type MemberExpression,
    type WildcardExpression,
    type WindowDefinition,
    type FrameBoundary,
    type FrameClause,
    type FrameUnit,
    type CastExpression,
    type OpenJsonColumnDefinition,
    type BuiltInArgumentNode,
    type OrderByNode,
    type ExistsExpression,
} from "../ast/types.js";

import { PRECEDENCE_MAP, Precedence, RESYNC_KEYWORDS, STRUCTURAL_KEYWORDS } from "./grammar.js";

import { ParserBase } from "./parserBase.js";

export abstract class ExpressionParser extends ParserBase {
    protected parseWithinGroupClause(): OrderByNode[] {
        this.matchKeyword("WITHIN");
        this.matchKeyword("GROUP");
        this.match(TokenType.OpenParen);
        this.matchKeyword("ORDER");
        this.matchKeyword("BY");

        const orderBy = this.parseList(
            () => {
                const expr = this.parseExpression();

                let direction: "ASC" | "DESC" = "ASC";
                let itemEnd = expr.end;

                if (this.peekKeyword("DESC")) {
                    const dirToken = this.consume();
                    direction = "DESC";
                    itemEnd = dirToken.offset + dirToken.value.length;
                } else if (this.peekKeyword("ASC")) {
                    const dirToken = this.consume();
                    direction = "ASC";
                    itemEnd = dirToken.offset + dirToken.value.length;
                }

                return {
                    expression: expr,
                    direction,
                    start: expr.start,
                    end: itemEnd,
                } as OrderByNode;
            },
            {
                isBoundary: (token?: Token) => !token || token.type === TokenType.CloseParen,
            },
        );

        this.match(TokenType.CloseParen);

        return orderBy;
    }

    protected parseExpression(
        precedence: Precedence = Precedence.LOWEST,
        stopTokens?: Set<string>,
    ): Expression {
        let left = this.parsePrefix();

        while (this.pos < this.tokens.length) {
            const startPos = this.pos;

            const nextToken = this.peek();

            // RULE #1:
            // hard stop at statement terminator
            if (!nextToken || nextToken.type === TokenType.Semicolon) {
                break;
            }

            // RULE #2:
            // normalize DOT token
            const val = nextToken.type === TokenType.Dot ? "." : nextToken.value;

            // RULE #3:
            // statement/query structural boundaries
            //
            // IMPORTANT:
            // only terminate at LOWEST precedence
            // otherwise recursive Pratt parsing breaks.
            if (nextToken.type === TokenType.Keyword) {
                // explicit grammar-owned stops
                if (stopTokens?.has(val)) {
                    break;
                }

                // legacy fallback behavior
                if (
                    !stopTokens &&
                    precedence === Precedence.LOWEST &&
                    (STRUCTURAL_KEYWORDS.has(val) ||
                        RESYNC_KEYWORDS.has(val) ||
                        val === "BEGIN" ||
                        val === "END" ||
                        val === "ELSE" ||
                        val === "CATCH")
                ) {
                    break;
                }
            }

            const nextPrecedence = PRECEDENCE_MAP[val] ?? Precedence.LOWEST;

            if (val === "WITHIN" && left.type === "FunctionCall") {
                const withinGroup = this.parseWithinGroupClause();

                left = {
                    ...left,
                    withinGroup,
                    end:
                        withinGroup.length > 0
                            ? withinGroup[withinGroup.length - 1].end
                            : this.lastConsumedEnd(),
                };

                continue;
            }

            // RULE #4:
            // Pratt precedence termination
            if (nextPrecedence <= precedence) {
                break;
            }

            // consume operator
            const operatorToken = this.consume();

            const operator = operatorToken.value;

            // -------------------------------------------------
            // IS [NOT] NULL
            // -------------------------------------------------

            if (val === "IS") {
                let isNot = false;

                if (this.peek()?.value === "NOT") {
                    this.consume();
                    isNot = true;
                }

                const nullToken = this.matchValue("NULL");

                left = {
                    type: "UnaryExpression",
                    operator: isNot ? "IS NOT NULL" : "IS NULL",
                    right: left,
                    start: left.start,
                    end: nullToken.offset + nullToken.value.length,
                };
            }

            // -------------------------------------------------
            // NOT IN / NOT BETWEEN / NOT LIKE / prefix NOT
            // -------------------------------------------------
            else if (val === "NOT") {
                const next = this.peek();

                const nextVal = next?.value;

                // NOT IN
                if (nextVal === "IN") {
                    this.consume();

                    left = this.parseInExpression(left, true);
                }

                // NOT BETWEEN
                else if (nextVal === "BETWEEN") {
                    this.consume();

                    left = this.parseBetweenExpression(left, true, nextPrecedence);
                }

                // NOT LIKE
                else if (nextVal === "LIKE") {
                    this.consume();

                    const right = this.parseExpression(nextPrecedence, stopTokens);

                    left = {
                        type: "BinaryExpression",
                        left,
                        operator: "NOT LIKE",
                        right,
                        start: left.start,
                        end: right.end,
                    };
                }

                // prefix NOT
                else {
                    const right = this.parseExpression(Precedence.PREFIX, stopTokens);

                    left = {
                        type: "UnaryExpression",
                        operator: "NOT",
                        right,
                        start: operatorToken.offset,
                        end: right.end,
                    };
                }
            }

            // -------------------------------------------------
            // BETWEEN
            // -------------------------------------------------
            else if (val === "BETWEEN") {
                left = this.parseBetweenExpression(left, false, nextPrecedence);
            }

            // -------------------------------------------------
            // IN
            // -------------------------------------------------
            else if (val === "IN") {
                left = this.parseInExpression(left, false);
            }

            // -------------------------------------------------
            // COLLATE
            // -------------------------------------------------
            else if (val === "COLLATE") {
                const collationToken = this.consume();

                left = {
                    type: "BinaryExpression",
                    left,
                    operator: "COLLATE",
                    right: {
                        type: "Literal",
                        value: collationToken.value,
                        variant: "string",
                        start: collationToken.offset,
                        end: collationToken.offset + collationToken.value.length,
                    },
                    start: left.start,
                    end: collationToken.offset + collationToken.value.length,
                };
            }

            // -------------------------------------------------
            // Standard binary operators
            // -------------------------------------------------
            else {
                const right = this.parseExpression(nextPrecedence, stopTokens);

                left = {
                    type: "BinaryExpression",
                    left,
                    operator: operator.toUpperCase(),
                    right,
                    start: left.start,
                    end: right.end,
                };
            }

            // RULE #5:
            // infinite loop protection
            if (this.pos === startPos) {
                throw new Error(`Parser stuck at token ${val} (offset: ${nextToken.offset}).`);
            }
        }

        return left;
    }

    /**
     * Helper to handle the common logic for IN and NOT IN
     */

    protected parseInExpression(left: Expression, isNot: boolean): Expression {
        // 1. Consume the opening parenthesis
        this.match(TokenType.OpenParen);

        let subquery: QueryStatement | undefined = undefined;
        let list: Expression[] | undefined = undefined;

        // 2. Determine if it's a subquery or a literal list
        // Use parseQueryExpression to support UNION/EXCEPT inside IN clauses
        if (this.peekKeyword("SELECT")) {
            subquery = this.parseQueryExpression();
        } else {
            // Gold Standard: Use the centralized list helper for consistency
            list = this.parseList(() => this.parseExpression(Precedence.LOWEST));
        }

        // 3. Consume the closing parenthesis and capture it for the end offset
        const closeParen = this.match(TokenType.CloseParen);

        return {
            type: "InExpression",
            left,
            list,
            subquery,
            isNot,
            // Range starts at the beginning of the subject (left)
            // and ends at the closing paren of the IN clause
            start: left.start,
            end: closeParen.offset + closeParen.value.length,
        };
    }

    /**
     * Helper to handle the common logic for BETWEEN and NOT BETWEEN
     */

    protected parseBetweenExpression(
        left: Expression,
        isNot: boolean,
        precedence: number,
    ): Expression {
        const lowerBound = this.parseExpression(precedence);
        this.matchKeyword("AND");
        const upperBound = this.parseExpression(precedence);

        return {
            type: "BetweenExpression",
            left,
            lowerBound,
            upperBound,
            isNot,
            start: left.start, // NodeLocation offset
            end: upperBound.end, // NodeLocation offset
        };
    }

    protected parsePrefix(): Expression {
        const token = this.consume();

        if (!token) {
            throw new Error("Expected expression");
        }

        const value = token.value;
        const upperValue = value.toUpperCase();

        const start = token.offset;

        switch (token.type) {
            // -------------------------------------------------
            // Numeric literal
            // -------------------------------------------------

            case TokenType.Number:
                return {
                    type: "Literal",
                    value: Number(value),
                    variant: "number",
                    start,
                    end: start + value.length,
                };

            // -------------------------------------------------
            // Variable
            // -------------------------------------------------

            case TokenType.Variable:
                return {
                    type: "Variable",
                    name: value,
                    start,
                    end: start + value.length,
                };

            // -------------------------------------------------
            // String literal
            // -------------------------------------------------

            case TokenType.String: {
                const content =
                    value.startsWith("'") && value.endsWith("'")
                        ? value.substring(1, value.length - 1)
                        : value;

                return {
                    type: "Literal",
                    value: content,
                    variant: "string",
                    start,
                    end: start + value.length,
                };
            }

            // -------------------------------------------------
            // Temp table
            // -------------------------------------------------

            case TokenType.TempTable:
                return this.parseMultipartIdentifier(token);

            // -------------------------------------------------
            // Operators
            // -------------------------------------------------

            case TokenType.Operator:
                // wildcard
                if (value === "*") {
                    return {
                        type: "WildcardExpression",
                        start,
                        end: start + 1,
                    } as WildcardExpression;
                }

                // folded negative number
                if (value === "-") {
                    const next = this.peek();

                    if (next?.type === TokenType.Number) {
                        const numToken = this.consume();

                        return {
                            type: "Literal",
                            value: Number(`-${numToken.value}`),
                            variant: "number",
                            start,
                            end: numToken.offset + numToken.value.length,
                        };
                    }

                    // unary minus
                    const right = this.parseExpression(Precedence.PREFIX);

                    return {
                        type: "UnaryExpression",
                        operator: "-",
                        right,
                        start,
                        end: right.end,
                    };
                }

                // unary plus
                if (value === "+") {
                    const next = this.peek();

                    if (next?.type === TokenType.Number) {
                        const numToken = this.consume();

                        return {
                            type: "Literal",
                            value: Number(numToken.value),
                            variant: "number",
                            start,
                            end: numToken.offset + numToken.value.length,
                        };
                    }

                    const right = this.parseExpression(Precedence.PREFIX);

                    return {
                        type: "UnaryExpression",
                        operator: "+",
                        right,
                        start,
                        end: right.end,
                    };
                }

                // bitwise not
                if (value === "~") {
                    const right = this.parseExpression(Precedence.PREFIX);

                    return {
                        type: "UnaryExpression",
                        operator: "~",
                        right,
                        start,
                        end: right.end,
                    };
                }

                throw new Error(`Unexpected operator in prefix position: ${value}`);

            // -------------------------------------------------
            // IDENTIFIERS + EXPRESSION KEYWORDS
            // -------------------------------------------------

            case TokenType.Identifier:
            case TokenType.Keyword: {
                // ---------------------------------------------
                // Dedicated keyword expressions FIRST
                // ---------------------------------------------

                // NULL literal
                if (upperValue === "NULL") {
                    return {
                        type: "Literal",
                        value: null,
                        variant: "null",
                        start,
                        end: start + value.length,
                    };
                }

                // CASE expression
                if (upperValue === "CASE") {
                    return this.parseCaseExpression();
                }

                // EXISTS (...)
                if (upperValue === "EXISTS") {
                    return this.parseExists(token);
                }

                // CAST / TRY_CAST / CONVERT / PARSE / TRY_PARSE
                if (
                    upperValue === "CAST" ||
                    upperValue === "TRY_CAST" ||
                    upperValue === "CONVERT" ||
                    upperValue === "PARSE" ||
                    upperValue === "TRY_PARSE"
                ) {
                    this.pos--;

                    return this.parseCastExpression();
                }

                // NOT / NOT EXISTS
                if (upperValue === "NOT") {
                    // NOT EXISTS (...)
                    if (this.peekKeyword("EXISTS")) {
                        const existsToken = this.consume();

                        const existsExpr = this.parseExists(existsToken);

                        return {
                            type: "UnaryExpression",
                            operator: "NOT",
                            right: existsExpr,
                            start,
                            end: existsExpr.end,
                        };
                    }

                    // generic NOT
                    const right = this.parseExpression(Precedence.NOT);

                    return {
                        type: "UnaryExpression",
                        operator: "NOT",
                        right,
                        start,
                        end: right.end,
                    };
                }

                const canBeFunctionCall = this.peek()?.type === TokenType.OpenParen;

                if (
                    token.type === TokenType.Keyword &&
                    canBeFunctionCall &&
                    (RESYNC_KEYWORDS.has(value) || STRUCTURAL_KEYWORDS.has(value))
                ) {
                    return this.parseTableValuedFunction({
                        type: "Identifier",
                        name: value,
                        parts: [value],
                        start,
                        end: start + value.length,
                    });
                }

                // ---------------------------------------------
                // Reject statement keywords unless they are
                // being used as function names like LEFT(...)
                // ---------------------------------------------

                if (
                    token.type === TokenType.Keyword &&
                    !canBeFunctionCall &&
                    (RESYNC_KEYWORDS.has(value) || STRUCTURAL_KEYWORDS.has(value))
                ) {
                    this.pos--;

                    throw new Error(`Unexpected keyword in expression: ${value}`);
                }

                // ---------------------------------------------
                // Multipart identifier
                // ---------------------------------------------

                this.pos--;

                const idNode = this.parseMultipartIdentifier();

                // ---------------------------------------------
                // Function call
                // ---------------------------------------------

                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume(); // (

                    const args: Expression[] = [];
                    let distinct = false;

                    if (idNode.type !== "Identifier") {
                        throw new Error("Wildcards cannot be used as function names");
                    }

                    if (this.peekKeyword("DISTINCT")) {
                        this.consume();
                        distinct = true;
                    }

                    // subquery arg
                    if (this.peekKeyword("SELECT")) {
                        const subquery = this.parseSelect() as QueryStatement;

                        const closeParen = this.match(TokenType.CloseParen);

                        args.push({
                            type: "SubqueryExpression",
                            query: subquery,
                            start: subquery.start,
                            end: closeParen.offset + closeParen.value.length,
                        });
                    }

                    // normal args
                    else {
                        const upperName = idNode.name.toUpperCase();
                        const isBuiltInKeywordArgFunc =
                            upperName === "DATEDIFF" ||
                            upperName === "DATEADD" ||
                            upperName === "DATEPART" ||
                            upperName === "DATENAME";

                        if (isBuiltInKeywordArgFunc && this.peek()) {
                            const next = this.peek()!;
                            if (
                                next.type === TokenType.Identifier ||
                                next.type === TokenType.Keyword
                            ) {
                                const kwArg = this.consume();
                                args.push({
                                    type: "BuiltInArgument",
                                    value: kwArg.value,
                                    start: kwArg.offset,
                                    end: kwArg.offset + kwArg.value.length,
                                } as BuiltInArgumentNode);

                                if (this.peek()?.type === TokenType.Comma) {
                                    this.consume();
                                }
                            }
                        }

                        args.push(...this.parseList(() => this.parseExpression(Precedence.LOWEST)));
                    }

                    const closeParen = this.match(TokenType.CloseParen);

                    const receiver = this.parseSqlMethodReceiver(idNode);
                    let result: Expression = {
                        type: "FunctionCall",

                        name: idNode.name,

                        args,

                        ...(receiver ? { receiver } : {}),

                        ...(distinct ? { distinct: true } : {}),

                        start: idNode.start,

                        end: closeParen.offset + closeParen.value.length,
                    };

                    // window function
                    if (this.peekKeyword("OVER")) {
                        result = this.parseOverClause(result);
                    }

                    return result;
                }

                return idNode;
            }

            // -------------------------------------------------
            // Parentheses
            // -------------------------------------------------

            case TokenType.OpenParen:
                // subquery
                if (this.peekKeyword("SELECT")) {
                    const query = this.parseSelect() as QueryStatement;

                    const closeParen = this.match(TokenType.CloseParen);

                    return {
                        type: "SubqueryExpression",
                        query,
                        start,
                        end: closeParen.offset + closeParen.value.length,
                    } satisfies SubqueryExpression;
                }

                // grouping
                const inner = this.parseExpression(Precedence.LOWEST);

                const closeParen = this.match(TokenType.CloseParen);

                return {
                    type: "GroupingExpression",
                    expression: inner,
                    start,
                    end: closeParen.offset + closeParen.value.length,
                } satisfies GroupingExpression;

            // -------------------------------------------------
            // Fallback
            // -------------------------------------------------

            default:
                if (
                    token.type === TokenType.Semicolon ||
                    token.type === TokenType.CloseParen ||
                    token.type === TokenType.Comma
                ) {
                    this.pos--;
                }

                throw new Error(
                    `Unexpected token at line ${token.line}: ${token.value} (${TokenType[token.type]})`,
                );
        }
    }

    /**
     * Helper to keep parsePrefix clean
     */

    protected parseExists(existsToken: Token): ExistsExpression {
        // EXISTS (
        this.match(TokenType.OpenParen);

        // subquery
        const subquery = this.parseSelect() as QueryStatement;

        // )
        const closeParen = this.match(TokenType.CloseParen);

        return {
            type: "ExistsExpression",
            query: subquery,
            start: existsToken.offset,
            end: closeParen.offset + closeParen.value.length,
        };
    }

    protected canStartExpressionToken(token: Token | undefined): boolean {
        if (!token) {
            return false;
        }

        if (token.type === TokenType.Semicolon || token.type === TokenType.Comma) {
            return false;
        }

        if (token.type === TokenType.Keyword && this.isStructuralKeyword(token.value)) {
            return this.peek(1)?.type === TokenType.OpenParen;
        }

        return !RESYNC_KEYWORDS.has(token.value);
    }

    protected parseCaseExpression(): Expression {
        // CASE token already consumed
        const startToken = this.tokens[this.pos - 1];

        const startOffset = startToken.offset;

        let incomplete = false;

        let input: Expression | undefined = undefined;

        const branches: {
            when: Expression;
            then: Expression;
        }[] = [];

        let elseBranch: Expression | undefined = undefined;

        // -------------------------------------------------
        // Simple CASE input
        // -------------------------------------------------

        try {
            if (this.peek()?.value !== "WHEN") {
                input = this.parseExpression(Precedence.LOWEST, new Set(["WHEN"]));
            }
        } catch {
            incomplete = true;

            this.resyncToCaseBoundary();
        }

        // -------------------------------------------------
        // WHEN / THEN branches
        // -------------------------------------------------

        while (this.peek()?.value === "WHEN") {
            this.consume(); // WHEN

            let when: Expression;
            let then: Expression;

            // -----------------------------
            // WHEN expression
            // -----------------------------

            try {
                when = this.parseExpression(Precedence.LOWEST, new Set(["THEN"]));
            } catch {
                incomplete = true;

                this.resyncToCaseBoundary();

                when = {
                    type: "Identifier",
                    name: "__ERROR__",
                    parts: ["__ERROR__"],
                    start: this.peek()?.offset ?? startOffset,
                    end: this.peek()?.offset ?? startOffset,
                };
            }

            // -----------------------------
            // THEN
            // -----------------------------

            try {
                this.matchKeyword("THEN");
            } catch {
                incomplete = true;

                this.addIssue(
                    "PARSE_CASE_THEN",
                    "Expected THEN in CASE expression",
                    this.peek()?.offset ?? startOffset,
                    this.peek()?.offset ?? startOffset,
                );

                this.resyncToCaseBoundary();
            }

            // -----------------------------
            // THEN expression
            // -----------------------------

            if (
                !this.peek() ||
                this.peek()?.type === TokenType.Semicolon ||
                (this.peek()?.type === TokenType.Keyword && RESYNC_KEYWORDS.has(this.peek()!.value))
            ) {
                incomplete = true;

                then = {
                    type: "Identifier",
                    name: "__ERROR__",
                    parts: ["__ERROR__"],
                    start: this.peek()?.offset ?? startOffset,
                    end: this.peek()?.offset ?? startOffset,
                };

                branches.push({
                    when,
                    then,
                });

                break;
            } else {
                try {
                    then = this.parseExpression(
                        Precedence.LOWEST,
                        new Set(["WHEN", "ELSE", "END"]),
                    );
                } catch {
                    incomplete = true;

                    this.resyncToCaseBoundary();

                    then = {
                        type: "Identifier",
                        name: "__ERROR__",
                        parts: ["__ERROR__"],
                        start: this.peek()?.offset ?? startOffset,
                        end: this.peek()?.offset ?? startOffset,
                    };
                }
            }

            branches.push({
                when,
                then,
            });
        }

        // -------------------------------------------------
        // ELSE branch
        // -------------------------------------------------

        if (this.peek()?.value === "ELSE") {
            this.consume(); // ELSE

            try {
                elseBranch = this.parseExpression(Precedence.LOWEST, new Set(["END"]));
            } catch {
                incomplete = true;

                this.resyncToCaseBoundary();
            }
        }

        // -------------------------------------------------
        // END
        // -------------------------------------------------

        let endOffset = startOffset;

        try {
            const endToken = this.matchKeyword("END");

            endOffset = endToken.offset + endToken.value.length;
        } catch {
            incomplete = true;

            // preserve outer parser state
            const current = this.peek();

            if (current) {
                endOffset = current.offset;
            }
        }

        // -------------------------------------------------
        // Final node
        // -------------------------------------------------

        return {
            type: "CaseExpression",
            input,
            branches,
            elseBranch,
            start: startOffset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
        };
    }

    protected parseOverClause(expr: Expression): OverExpression {
        const overToken = this.matchKeyword("OVER");
        this.match(TokenType.OpenParen);

        const windowStart = overToken.offset;
        let windowIncomplete = false;
        const windowErrors: string[] = [];

        let partitionBy: Expression[] | undefined = undefined;
        if (this.peekKeyword("PARTITION")) {
            try {
                this.consume(); // PARTITION
                this.matchKeyword("BY");
                partitionBy = this.parseList(() => this.parseExpression());
            } catch (e) {
                windowIncomplete = true;
                this.addRecoverableError(
                    windowErrors,
                    "PARSE_OVER_PARTITION_BY",
                    e instanceof Error ? e.message : String(e),
                    this.lastConsumedEnd(),
                );
            }
        }

        let orderBy: OrderByNode[] | undefined = undefined;
        if (this.peekKeyword("ORDER")) {
            try {
                this.consume(); // ORDER
                this.matchKeyword("BY");
                orderBy = this.parseList(() => {
                    const e = this.parseExpression();
                    let direction: "ASC" | "DESC" = "ASC";
                    let itemEnd = e.end;

                    if (this.peekKeyword("DESC")) {
                        const dirToken = this.consume();
                        direction = "DESC";
                        itemEnd = dirToken.offset + dirToken.value.length;
                    } else if (this.peekKeyword("ASC")) {
                        const dirToken = this.consume();
                        itemEnd = dirToken.offset + dirToken.value.length;
                    }

                    return {
                        expression: e,
                        direction,
                        start: e.start,
                        end: itemEnd,
                    } as OrderByNode;
                });
            } catch (e) {
                windowIncomplete = true;
                this.addRecoverableError(
                    windowErrors,
                    "PARSE_OVER_ORDER_BY",
                    e instanceof Error ? e.message : String(e),
                    this.lastConsumedEnd(),
                );
            }
        }

        // Frame clause — ROWS|RANGE BETWEEN ... AND ... or ROWS|RANGE <boundary>
        let frame: FrameClause | undefined = undefined;
        if (this.peekKeyword("ROWS") || this.peekKeyword("RANGE")) {
            frame = this.parseFrameClause();
            if (frame.incomplete) {
                windowIncomplete = true;
                windowErrors.push(...(frame.errors ?? []));
            }
        }

        // Defensive close paren — frame error recovery may have consumed it
        // or the user may have an unclosed OVER clause mid-edit
        let windowEnd = this.lastConsumedEnd();
        if (this.peek()?.type === TokenType.CloseParen) {
            const closeParen = this.consume();
            windowEnd = closeParen.offset + closeParen.value.length;
        } else {
            windowIncomplete = true;
            this.addRecoverableError(
                windowErrors,
                "PARSE_OVER_CLOSE_PAREN",
                "Expected ) to close OVER clause",
                windowEnd,
            );
        }

        const window: WindowDefinition = {
            type: "WindowDefinition",
            partitionBy,
            orderBy,
            ...(frame ? { frame } : {}),
            start: windowStart,
            end: windowEnd,
            ...(windowIncomplete ? { incomplete: true } : {}),
            ...(windowErrors.length ? { errors: windowErrors } : {}),
        };

        return {
            type: "OverExpression",
            expression: expr,
            window,
            start: expr.start,
            end: windowEnd,
        };
    }

    protected parseFrameClause(): FrameClause {
        const unitToken = this.consume(); // ROWS or RANGE
        const unit = unitToken.value.toUpperCase() as FrameUnit;
        let frameEnd = unitToken.offset + unitToken.value.length;
        let incomplete = false;
        const errors: string[] = [];

        let from: FrameBoundary | null = null;
        let to: FrameBoundary | undefined = undefined;

        if (this.peekKeyword("BETWEEN")) {
            this.consume(); // BETWEEN
            frameEnd = this.lastConsumedEnd();

            // parse start boundary
            try {
                const result = this.parseFrameBoundary();
                from = result.boundary;
                frameEnd = result.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_FRAME_START_BOUNDARY",
                    e instanceof Error ? e.message : String(e),
                    frameEnd,
                    frameEnd,
                );
            }

            // AND
            if (this.peekKeyword("AND")) {
                this.consume();
                frameEnd = this.lastConsumedEnd();

                // parse end boundary
                try {
                    const result = this.parseFrameBoundary();
                    to = result.boundary;
                    frameEnd = result.end;
                } catch (e) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_FRAME_END_BOUNDARY",
                        e instanceof Error ? e.message : String(e),
                        frameEnd,
                        frameEnd,
                    );
                }
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_FRAME_AND",
                    "Expected AND in frame clause BETWEEN",
                    frameEnd,
                    frameEnd,
                );

                // Recovery: if the user omitted AND but immediately wrote a
                // valid end boundary, consume it so the OVER clause can still
                // close cleanly and outer statement parsing stays aligned.
                if (this.canStartFrameBoundary(this.peek())) {
                    try {
                        const result = this.parseFrameBoundary();
                        to = result.boundary;
                        frameEnd = result.end;
                    } catch {
                        // Keep the original AND error only.
                    }
                }
            }
        } else {
            // single boundary form: ROWS UNBOUNDED PRECEDING etc.
            const next = this.peek();
            if (
                !next ||
                next.type === TokenType.CloseParen ||
                next.type === TokenType.Semicolon ||
                (next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value))
            ) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_FRAME_BOUNDARY",
                    "Expected frame boundary after ROWS/RANGE",
                    frameEnd,
                    frameEnd,
                );
            } else {
                try {
                    const result = this.parseFrameBoundary();
                    from = result.boundary;
                    frameEnd = result.end;
                } catch (e) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_FRAME_BOUNDARY",
                        e instanceof Error ? e.message : String(e),
                        frameEnd,
                        frameEnd,
                    );
                }
            }
        }

        return {
            type: "FrameClause",
            unit,
            from,
            ...(to ? { to } : {}),
            start: unitToken.offset,
            end: frameEnd,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseFrameBoundary(): { boundary: FrameBoundary; end: number } {
        const next = this.peek();

        if (!next) {
            throw new Error("Expected frame boundary");
        }

        // UNBOUNDED PRECEDING | UNBOUNDED FOLLOWING
        if (this.peekKeyword("UNBOUNDED")) {
            this.consume();

            if (this.peekKeyword("PRECEDING")) {
                const t = this.consume();
                return {
                    boundary: { type: "UNBOUNDED_PRECEDING" },
                    end: t.offset + t.value.length,
                };
            } else if (this.peekKeyword("FOLLOWING")) {
                const t = this.consume();
                return {
                    boundary: { type: "UNBOUNDED_FOLLOWING" },
                    end: t.offset + t.value.length,
                };
            } else {
                throw new Error("Expected PRECEDING or FOLLOWING after UNBOUNDED");
            }
        }

        // CURRENT ROW
        if (this.peekKeyword("CURRENT")) {
            this.consume();
            const rowToken = this.matchKeyword("ROW");
            return {
                boundary: { type: "CURRENT_ROW" },
                end: rowToken.offset + rowToken.value.length,
            };
        }

        // <expr> PRECEDING | <expr> FOLLOWING
        const value = this.parseExpression();

        if (this.peekKeyword("PRECEDING")) {
            const t = this.consume();
            return {
                boundary: { type: "PRECEDING", value },
                end: t.offset + t.value.length,
            };
        } else if (this.peekKeyword("FOLLOWING")) {
            const t = this.consume();
            return {
                boundary: { type: "FOLLOWING", value },
                end: t.offset + t.value.length,
            };
        } else {
            throw new Error("Expected PRECEDING or FOLLOWING after frame expression");
        }
    }

    protected canStartFrameBoundary(token?: Token): boolean {
        if (!token) {
            return false;
        }

        if (this.peekKeyword("UNBOUNDED") || this.peekKeyword("CURRENT")) {
            return true;
        }

        if (token.type === TokenType.CloseParen || token.type === TokenType.Semicolon) {
            return false;
        }

        if (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value)) {
            return false;
        }

        return true;
    }

    protected hasName(expr: Expression): expr is (IdentifierNode | MemberExpression) & Expression {
        return expr.type === "Identifier" || expr.type === "MemberExpression";
    }

    protected parseDataType(): string {
        return this.collectTypeTokens({
            extraStopTokenTypes: [TokenType.Semicolon],
            extraStopKeywords: ["OUTPUT", "OUT", "READONLY"],
            stopOnResyncKeywords: true,
            stopOnVariable: true,
            stopOnAssignmentOperator: true,
        });
    }

    protected parseCastExpression(): CastExpression {
        const keyword = this.consume();

        const kind = keyword.value.toUpperCase() as
            | "CAST"
            | "TRY_CAST"
            | "CONVERT"
            | "PARSE"
            | "TRY_PARSE";

        let incomplete = false;
        const errors: string[] = [];

        const start = keyword.offset;
        let end = keyword.offset + keyword.value.length;

        // fallback defaults
        let expression: Expression = {
            type: "Literal",
            value: null,
            variant: "null",
            start,
            end,
        };

        let dataType = "";
        let style: Expression | null = null;
        let culture: Expression | null = null;

        // --------------------------------
        // opening (
        // --------------------------------
        if (this.peek()?.type !== TokenType.OpenParen) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_CAST_OPEN",
                `Expected ( after ${kind}`,
                end,
                end,
            );

            return {
                type: "CastExpression",
                kind,
                expression,
                dataType,
                start,
                end,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {}),
            };
        }

        this.consume(); // (
        end = this.lastConsumedEnd();

        try {
            // --------------------------------
            // CONVERT(type, expr)
            // --------------------------------
            if (kind === "CONVERT") {
                dataType = this.parseDataTypeName();
                end = this.lastConsumedEnd();

                if (this.peek()?.type !== TokenType.Comma) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_CONVERT_COMMA",
                        "Expected comma in CONVERT",
                        end,
                        end,
                    );
                } else {
                    this.consume(); // ,
                    end = this.lastConsumedEnd();

                    if (this.peek()) {
                        expression = this.parseExpression();
                        end = expression.end;

                        if (this.peek()?.type === TokenType.Comma) {
                            this.consume(); // ,
                            end = this.lastConsumedEnd();

                            if (this.peek()) {
                                style = this.parseExpression();
                                end = style.end;
                            }
                        }
                    }
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    end = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_CAST_CLOSE",
                        `Expected ) after ${kind}`,
                        end,
                        end,
                    );
                }

                return {
                    type: "CastExpression",
                    kind,
                    expression,
                    dataType,
                    ...(style ? { style } : {}),
                    start,
                    end,
                    ...(incomplete ? { incomplete: true } : {}),
                    ...(errors.length ? { errors } : {}),
                };
            }

            // --------------------------------
            // CAST(expr AS type)
            // TRY_CAST(expr AS type)
            // PARSE(expr AS type [USING culture])
            // TRY_PARSE(expr AS type [USING culture])
            // --------------------------------
            if (this.peek()) {
                expression = this.parseExpression();
                end = expression.end;
            }

            if (!this.peekKeyword("AS")) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CAST_AS",
                    `Expected AS in ${kind}`,
                    end,
                    end,
                );
            } else {
                this.consume(); // AS
                end = this.lastConsumedEnd();

                dataType = this.parseDataTypeName(
                    kind === "PARSE" || kind === "TRY_PARSE" ? ["USING"] : [],
                );
                end = this.lastConsumedEnd();

                if ((kind === "PARSE" || kind === "TRY_PARSE") && this.peekKeyword("USING")) {
                    this.consume();
                    end = this.lastConsumedEnd();

                    if (this.peek()) {
                        culture = this.parseExpression();
                        end = culture.end;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_CAST_USING",
                            `Expected culture expression after USING in ${kind}`,
                            end,
                            end,
                        );
                    }
                }
            }

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                end = this.lastConsumedEnd();
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CAST_CLOSE",
                    `Expected ) after ${kind}`,
                    end,
                    end,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_CAST",
                e instanceof Error ? e.message : String(e),
                end,
                end,
            );
        }

        return {
            type: "CastExpression",
            kind,
            expression,
            dataType,
            ...(style ? { style } : {}),
            ...(culture ? { culture } : {}),
            start,
            end,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseDataTypeName(stopKeywords: string[] = []): string {
        return this.collectTypeTokens({
            extraStopKeywords: stopKeywords,
        });
    }

    /**
     * SQL type methods look lexically like multipart function names. Preserve their receiver so
     * semantic consumers can distinguish `t.XmlData.nodes(...)` from a schema-qualified UDF.
     */
    protected parseSqlMethodReceiver(idNode: IdentifierNode): IdentifierNode | undefined {
        const method = idNode.parts.at(-1);
        if (
            !method ||
            idNode.parts.length < 2 ||
            !["nodes", "value", "exist", "query", "modify"].includes(method.toLowerCase())
        ) {
            return undefined;
        }

        const parts = idNode.parts.slice(0, -1);
        return {
            type: "Identifier",
            name: parts.join("."),
            parts,
            start: idNode.start,
            end: idNode.end - method.length - 1,
        };
    }

    // Lives here (rather than TableSourceParser) because parsePrefix
    // above also needs it: keywords like LEFT/RIGHT followed by "(" are
    // parsed as function calls via this same path.
    protected parseTableValuedFunction(idNode: IdentifierNode): FunctionCallNode {
        this.match(TokenType.OpenParen);

        const args: Expression[] = [];
        let distinct = false;

        if (this.peekKeyword("DISTINCT")) {
            this.consume();
            distinct = true;
        }

        if (this.peek()?.type !== TokenType.CloseParen) {
            args.push(...this.parseList(() => this.parseExpression(Precedence.LOWEST)));
        }

        const closeParen = this.match(TokenType.CloseParen);

        let openJsonWith: OpenJsonColumnDefinition[] | undefined;

        if (idNode.name.toUpperCase() === "OPENJSON" && this.peekKeyword("WITH")) {
            openJsonWith = this.parseOpenJsonWithClause();
        }

        const receiver = this.parseSqlMethodReceiver(idNode);
        return {
            type: "FunctionCall",
            name: idNode.name,
            args,
            ...(receiver ? { receiver } : {}),
            start: idNode.start,
            end: openJsonWith?.length
                ? openJsonWith[openJsonWith.length - 1].end
                : closeParen.offset + closeParen.value.length,
            ...(distinct ? { distinct: true } : {}),
            ...(openJsonWith ? { openJsonWith } : {}),
        };
    }

    protected parseOpenJsonWithClause(): OpenJsonColumnDefinition[] {
        this.matchKeyword("WITH");
        this.match(TokenType.OpenParen);

        const columns: OpenJsonColumnDefinition[] = [];

        while (this.peek()) {
            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                break;
            }

            const startToken = this.peek()!;
            const nameExpr = this.parseMultipartIdentifier();

            if (nameExpr.type !== "Identifier") {
                throw new Error("Wildcards are not allowed as OPENJSON column names");
            }

            const dataType = this.collectTypeTokens({
                extraStopTokenTypes: [TokenType.String],
            });

            let path: string | undefined;
            let asJson = false;

            if (this.peek()?.type === TokenType.String) {
                path = this.consume().value;
            }

            if (this.peekKeyword("AS")) {
                this.consume();
                this.matchKeyword("JSON");
                asJson = true;
            }

            columns.push({
                name: nameExpr.name,
                dataType,
                ...(path ? { path } : {}),
                ...(asJson ? { asJson: true } : {}),
                start: startToken.offset,
                end: this.lastConsumedEnd(),
            });

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
                continue;
            }

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                break;
            }
        }

        return columns;
    }
}
