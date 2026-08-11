/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";

import {
    type Statement,
    type QueryStatement,
    type WithNode,
    type SelectNode,
    type Expression,
    type IdentifierNode,
    type ForClause,
    type ForJsonOption,
    type ForXmlOption,
    type OptionClause,
    type QueryHint,
    type TableReference,
    type ColumnNode,
    type OrderByNode,
    type CTENode,
    type XmlNamespaceNode,
    type TopClause,
} from "../ast/types.js";

import { RESYNC_KEYWORDS } from "./grammar.js";

import { TableSourceParser } from "./tableSourceParser.js";

export abstract class QueryParser extends TableSourceParser {
    protected parseForJsonOption(): ForJsonOption {
        const optionToken = this.consume();
        const option = optionToken.value.toUpperCase();

        switch (option) {
            case "ROOT": {
                const value =
                    this.peek()?.type === TokenType.OpenParen
                        ? this.parseParenthesizedTokenText()
                        : undefined;

                return {
                    kind: "ROOT",
                    ...(value !== undefined ? { value } : {}),
                };
            }

            case "INCLUDE_NULL_VALUES":
                return { kind: "INCLUDE_NULL_VALUES" };

            case "WITHOUT_ARRAY_WRAPPER":
                return { kind: "WITHOUT_ARRAY_WRAPPER" };

            default:
                return {
                    kind: "UNKNOWN",
                    value: optionToken.value,
                };
        }
    }

    protected parseForXmlOption(): ForXmlOption {
        const optionToken = this.consume();
        const option = optionToken.value.toUpperCase();

        switch (option) {
            case "TYPE":
                return { kind: "TYPE" };

            case "ELEMENTS": {
                let xsinil = false;

                if (this.peekKeyword("XSINIL")) {
                    this.consume();
                    xsinil = true;
                }

                return {
                    kind: "ELEMENTS",
                    ...(xsinil ? { xsinil: true } : {}),
                };
            }

            case "ROOT": {
                const value =
                    this.peek()?.type === TokenType.OpenParen
                        ? this.parseParenthesizedTokenText()
                        : undefined;

                return {
                    kind: "ROOT",
                    ...(value !== undefined ? { value } : {}),
                };
            }

            case "BINARY":
                if (this.peekKeyword("BASE64")) {
                    this.consume();
                    return { kind: "BINARY_BASE64" };
                }

                return {
                    kind: "UNKNOWN",
                    value: optionToken.value,
                };

            case "XMLSCHEMA":
                return { kind: "XMLSCHEMA" };

            case "XMLDATA":
                return { kind: "XMLDATA" };

            default:
                return {
                    kind: "UNKNOWN",
                    value: optionToken.value,
                };
        }
    }

    protected parseOptionClause(): OptionClause {
        const optionToken = this.matchKeyword("OPTION");
        const errors: string[] = [];
        let incomplete = false;
        let endOffset = optionToken.offset + optionToken.value.length;
        const hints: QueryHint[] = [];

        if (this.peek()?.type !== TokenType.OpenParen) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_OPTION_OPEN",
                "Expected ( after OPTION",
                endOffset,
                endOffset,
            );

            return {
                type: "OptionClause",
                hints,
                start: optionToken.offset,
                end: endOffset,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {}),
            };
        }

        this.consume();
        endOffset = this.lastConsumedEnd();

        while (this.peek()) {
            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                endOffset = this.lastConsumedEnd();
                break;
            }

            const hintTokens: Token[] = [];
            let depth = 0;

            while (this.peek()) {
                const token = this.peek()!;

                if (
                    depth === 0 &&
                    (token.type === TokenType.Comma || token.type === TokenType.CloseParen)
                ) {
                    break;
                }

                if (token.type === TokenType.OpenParen) {
                    depth++;
                } else if (token.type === TokenType.CloseParen) {
                    depth--;
                }

                hintTokens.push(this.consume());
                endOffset = this.lastConsumedEnd();
            }

            if (hintTokens.length === 0) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_OPTION_EMPTY_HINT",
                    "Expected OPTION hint",
                    endOffset,
                    endOffset,
                );
            } else {
                hints.push(this.validateOptionHint(hintTokens, errors));
            }

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
                endOffset = this.lastConsumedEnd();
                continue;
            }
        }

        if (this.tokens[this.pos - 1]?.type !== TokenType.CloseParen) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_OPTION_CLOSE",
                "Expected ) after OPTION hints",
                endOffset,
                endOffset,
            );
        }

        return {
            type: "OptionClause",
            hints,
            start: optionToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected validateOptionHint(tokens: Token[], errors: string[]): QueryHint {
        const raw = this.stringifyTokens(tokens);
        const parts = tokens.map((t) => t.value.toUpperCase());

        const expectNumericValue = (kind: "MAXDOP" | "FAST" | "MAXRECURSION"): QueryHint => {
            const valueToken = tokens[1];
            const value = valueToken ? Number(valueToken.value) : Number.NaN;

            if (
                tokens.length !== 2 ||
                !valueToken ||
                valueToken.type !== TokenType.Number ||
                Number.isNaN(value)
            ) {
                this.addRecoverableError(
                    errors,
                    "PARSE_OPTION_HINT",
                    `Expected numeric value for OPTION ${kind}`,
                    tokens[0].offset,
                    tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length,
                );

                return { kind: "UNKNOWN", raw };
            }

            return { kind, raw, value };
        };

        if (parts.length === 1 && parts[0] === "RECOMPILE") {
            return { kind: "RECOMPILE", raw };
        }

        if (parts.length === 2 && parts[0] === "HASH" && parts[1] === "JOIN") {
            return { kind: "HASH_JOIN", raw };
        }

        if (parts.length === 2 && parts[0] === "MERGE" && parts[1] === "JOIN") {
            return { kind: "MERGE_JOIN", raw };
        }

        if (parts.length === 2 && parts[0] === "LOOP" && parts[1] === "JOIN") {
            return { kind: "LOOP_JOIN", raw };
        }

        if (parts.length === 2 && parts[0] === "HASH" && parts[1] === "GROUP") {
            return { kind: "HASH_GROUP", raw };
        }

        if (parts.length === 2 && parts[0] === "ORDER" && parts[1] === "GROUP") {
            return { kind: "ORDER_GROUP", raw };
        }

        if (parts.length === 2 && parts[0] === "MERGE" && parts[1] === "UNION") {
            return { kind: "MERGE_UNION", raw };
        }

        if (parts.length === 2 && parts[0] === "CONCAT" && parts[1] === "UNION") {
            return { kind: "CONCAT_UNION", raw };
        }

        if (parts.length === 2 && parts[0] === "FORCE" && parts[1] === "ORDER") {
            return { kind: "FORCE_ORDER", raw };
        }

        if (parts.length === 2 && parts[0] === "KEEP" && parts[1] === "PLAN") {
            return { kind: "KEEP_PLAN", raw };
        }

        if (parts.length === 1 && parts[0] === "KEEPFIXED_PLAN") {
            return { kind: "KEEPFIXED_PLAN", raw };
        }

        if (parts.length === 2 && parts[0] === "ROBUST" && parts[1] === "PLAN") {
            return { kind: "ROBUST_PLAN", raw };
        }

        if (parts[0] === "MAXDOP") {
            return expectNumericValue("MAXDOP");
        }

        if (parts[0] === "FAST") {
            return expectNumericValue("FAST");
        }

        if (parts[0] === "MAXRECURSION") {
            return expectNumericValue("MAXRECURSION");
        }

        if (parts[0] === "PARAMETERIZATION") {
            if (parts.length === 2 && (parts[1] === "SIMPLE" || parts[1] === "FORCED")) {
                return {
                    kind: "PARAMETERIZATION",
                    raw,
                    value: parts[1] as "SIMPLE" | "FORCED",
                };
            }

            this.addRecoverableError(
                errors,
                "PARSE_OPTION_HINT",
                "Expected SIMPLE or FORCED after OPTION PARAMETERIZATION",
                tokens[0].offset,
                tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length,
            );

            return { kind: "UNKNOWN", raw };
        }

        if (parts[0] === "OPTIMIZE" && parts[1] === "FOR") {
            if (
                tokens.length >= 4 &&
                tokens[2].type === TokenType.OpenParen &&
                tokens[tokens.length - 1].type === TokenType.CloseParen
            ) {
                return {
                    kind: "OPTIMIZE_FOR",
                    raw,
                    value: raw.substring(raw.indexOf("(") + 1, raw.lastIndexOf(")")),
                };
            }

            this.addRecoverableError(
                errors,
                "PARSE_OPTION_HINT",
                "Expected parenthesized arguments after OPTION OPTIMIZE FOR",
                tokens[0].offset,
                tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length,
            );

            return { kind: "UNKNOWN", raw };
        }

        if (parts[0] === "USE" && parts[1] === "HINT") {
            if (
                tokens.length >= 4 &&
                tokens[2].type === TokenType.OpenParen &&
                tokens[tokens.length - 1].type === TokenType.CloseParen
            ) {
                return {
                    kind: "USE_HINT",
                    raw,
                    value: raw.substring(raw.indexOf("(") + 1, raw.lastIndexOf(")")),
                };
            }

            this.addRecoverableError(
                errors,
                "PARSE_OPTION_HINT",
                "Expected parenthesized arguments after OPTION USE HINT",
                tokens[0].offset,
                tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length,
            );

            return { kind: "UNKNOWN", raw };
        }

        this.addRecoverableError(
            errors,
            "PARSE_OPTION_HINT",
            `Unsupported OPTION hint: ${raw}`,
            tokens[0].offset,
            tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length,
        );

        return { kind: "UNKNOWN", raw };
    }

    protected parseSetOperation(left: QueryStatement, minPrecedence: number = 1): QueryStatement {
        while (true) {
            const token = this.peek();
            if (!token) break;

            let op = token.value.toUpperCase();

            if (!["UNION", "EXCEPT", "INTERSECT"].includes(op)) {
                break;
            }

            // detect UNION ALL (lookahead only)
            let fullOp = op;
            let isUnionAll = false;

            if (op === "UNION" && this.peek(1)?.value?.toUpperCase() === "ALL") {
                fullOp = "UNION ALL";
                isUnionAll = true;
            }

            const precedence = this.getSetPrecedence(fullOp);

            // 🔥 precedence guard BEFORE consuming
            if (precedence < minPrecedence) {
                break;
            }

            // consume operator
            this.consume();
            if (isUnionAll) this.consume();

            let right: QueryStatement | null = null;

            const next = this.peek();
            if (next && next.type !== TokenType.Semicolon && next.value !== ")") {
                const rightStart = this.parseSetOperand();

                right = this.parseSetOperation(rightStart, precedence + 1);
            }

            // 🔥 recovery: keep left intact if RHS missing
            if (!right) {
                return left;
            }

            left = {
                type: "SetOperator",
                operator: fullOp as "UNION" | "UNION ALL" | "EXCEPT" | "INTERSECT",
                left,
                right,
                start: left.start,
                end: right.end,
            };
        }

        return left;
    }

    protected getSetPrecedence(op: string): number {
        switch (op) {
            case "INTERSECT":
                return 2;
            case "UNION":
            case "UNION ALL":
            case "EXCEPT":
                return 1;
            default:
                return 0;
        }
    }

    // A UNION/EXCEPT/INTERSECT operand may itself be parenthesized
    // (e.g. `A UNION (B EXCEPT C)`) to override the default precedence.
    // parseSelect() alone can't start on '(', so unwrap parens here and
    // delegate to parseQueryExpression() for the inner query/chain.
    protected parseSetOperand(): QueryStatement {
        if (this.peek()?.type !== TokenType.OpenParen) {
            return this.parseSelect();
        }

        const openParen = this.consume();
        const inner = this.parseQueryExpression();
        const closeParen = this.match(TokenType.CloseParen);

        return {
            ...inner,
            start: openParen.offset,
            end: closeParen.offset + closeParen.value.length,
        };
    }

    protected isParenthesizedQueryStatementStart(): boolean {
        if (this.peek()?.type !== TokenType.OpenParen) {
            return false;
        }

        let lookahead = 0;
        while (this.peek(lookahead)?.type === TokenType.OpenParen) {
            lookahead++;
        }

        const next = this.peek(lookahead);
        return next?.value === "SELECT";
    }

    protected parseParenthesizedQueryStatement(): Statement {
        const start = this.peek()!.offset;
        let parenDepth = 0;

        while (this.peek()?.type === TokenType.OpenParen) {
            this.consume();
            parenDepth++;
        }

        let query: QueryStatement = this.parseQueryExpression();

        while (parenDepth > 0 && this.peek()?.type === TokenType.CloseParen) {
            this.consume();
            parenDepth--;
        }

        if (query.type === "SelectStatement") {
            this.parseSelectTail(query);
        }

        // A parenthesized query can itself be the first operand of a
        // larger chain, e.g. `(SELECT 1) UNION (SELECT 2)`.
        if (
            this.peek() &&
            ["UNION", "EXCEPT", "INTERSECT"].includes(this.peek()!.value.toUpperCase())
        ) {
            query = this.parseSetOperation(query);
        }

        query.start = start;
        query.end = this.lastConsumedEnd();

        return query;
    }

    protected parseSelectTail(select: SelectNode): void {
        if (this.peekKeyword("ORDER")) {
            this.consume();
            this.matchKeyword("BY");

            select.orderBy = this.parseList(() => {
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
            });
        }

        if (this.peekKeyword("OFFSET")) {
            this.consume();
            select.offset = this.parseExpression();

            if (this.peekKeyword("ROW") || this.peekKeyword("ROWS")) {
                this.consume();
            }

            if (this.peekKeyword("FETCH")) {
                this.consume();

                if (this.peekKeyword("NEXT") || this.peekKeyword("FIRST")) {
                    this.consume();
                }

                select.fetch = this.parseExpression();

                if (this.peekKeyword("ROW") || this.peekKeyword("ROWS")) {
                    this.consume();
                }

                if (this.peekKeyword("ONLY")) {
                    this.consume();
                }
            }
        }

        if (this.peekKeyword("OPTION")) {
            select.optionClause = this.parseOptionClause();
        }

        select.end = this.lastConsumedEnd();
    }

    protected parseSelect(): QueryStatement {
        const startToken = this.matchKeyword("SELECT");

        // 1. DISTINCT / ALL
        let distinct = false;

        if (this.peekKeyword("DISTINCT")) {
            this.consume();
            distinct = true;
        } else if (this.peekKeyword("ALL")) {
            this.consume();
        }

        // 2. TOP
        let top: TopClause | null = null;

        if (this.peekKeyword("TOP")) {
            const topToken = this.matchKeyword("TOP");
            let topEnd = topToken.offset + topToken.value.length;
            let topIncomplete = false;
            const topErrors: string[] = [];

            const hasParens = this.peek()?.type === TokenType.OpenParen;
            if (hasParens) this.consume();

            let quantity: Expression | null = null;

            try {
                const next = this.peek();
                if (
                    !next ||
                    next.type === TokenType.Semicolon ||
                    (next.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(next.value) &&
                        (!hasParens || (next.value !== "SELECT" && next.value !== "WITH")))
                ) {
                    // nothing after TOP or TOP (
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_TOP_QUANTITY",
                        "Expected expression after TOP",
                        topEnd,
                        topEnd,
                    );
                } else if (hasParens && next.type === TokenType.CloseParen) {
                    // TOP () — empty parens, consume the ) and mark incomplete
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_TOP_QUANTITY",
                        "Expected expression after TOP",
                        topEnd,
                        topEnd,
                    );
                } else if (hasParens) {
                    // full expression allowed inside parens: TOP (@n), TOP (10 + 5)
                    if (this.peekKeyword("SELECT") || this.peekKeyword("WITH")) {
                        const query = this.parseQueryExpression() as QueryStatement;
                        quantity = {
                            type: "SubqueryExpression",
                            query,
                            start: query.start,
                            end: query.end,
                        };
                    } else {
                        quantity = this.parseExpression();
                    }
                    topEnd = quantity.end;
                } else {
                    // bare TOP n — exactly one token, no operators
                    const tok = this.consume();
                    const numVal = Number(tok.value);
                    quantity = {
                        type: "Literal",
                        variant: numVal !== numVal ? "string" : "number", // NaN check
                        value: numVal !== numVal ? tok.value : numVal,
                        start: tok.offset,
                        end: tok.offset + tok.value.length,
                    };
                    topEnd = quantity.end;
                }
            } catch (e) {
                topIncomplete = true;
                this.addRecoverableError(
                    topErrors,
                    "PARSE_TOP_QUANTITY",
                    e instanceof Error ? e.message : String(e),
                    topEnd,
                    topEnd,
                );
            }

            if (hasParens) {
                if (this.peek()?.type === TokenType.CloseParen) {
                    const closeParen = this.consume();
                    topEnd = closeParen.offset + closeParen.value.length;
                } else {
                    // SELECT TOP (10  — unclosed paren
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_TOP_CLOSE_PAREN",
                        "Expected ) after TOP expression",
                        topEnd,
                        topEnd,
                    );
                }
            }

            let percent = false;
            if (this.peekKeyword("PERCENT")) {
                const percentToken = this.consume();
                percent = true;
                topEnd = percentToken.offset + percentToken.value.length;
            }

            let withTies = false;
            let approximate = false;
            if (this.peekKeyword("WITH")) {
                const withToken = this.consume();
                topEnd = withToken.offset + withToken.value.length;
                if (this.peekKeyword("TIES")) {
                    const tiesToken = this.consume();
                    withTies = true;
                    topEnd = tiesToken.offset + tiesToken.value.length;
                } else if (
                    ["APPROX", "APPROXIMATE"].includes(this.peek()?.value.toUpperCase() ?? "")
                ) {
                    const approximateToken = this.consume();
                    approximate = true;
                    topEnd = approximateToken.offset + approximateToken.value.length;
                } else {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_TOP_WITH_TIES",
                        "Expected TIES after WITH",
                        topEnd,
                        topEnd,
                    );
                }
            }

            top = {
                type: "TopClause",
                quantity,
                percent,
                withTies,
                ...(approximate ? { approximate: true } : {}),
                start: topToken.offset,
                end: topEnd,
                ...(topIncomplete ? { incomplete: true } : {}),
                ...(topErrors.length ? { errors: topErrors } : {}),
            };
        }

        // Recovery state
        let incomplete = false;
        const errors: string[] = [];

        // 3. Columns
        let columns: ColumnNode[] = [];

        try {
            columns = this.parseList(() => this.parseColumn(), {
                isBoundary: (token?: Token) =>
                    !token ||
                    token.type === TokenType.Semicolon ||
                    token.type === TokenType.CloseParen ||
                    (token.type === TokenType.Keyword &&
                        [
                            "FROM",
                            "WHERE",
                            "GROUP",
                            "HAVING",
                            "ORDER",
                            "UNION",
                            "EXCEPT",
                            "INTERSECT",
                            "FOR",
                            "OPTION",
                            "OFFSET",
                            "FETCH",
                        ].includes(token.value.toUpperCase())),
            });

            if (columns.length === 0) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_EMPTY_COLUMNS",
                    "Expected SELECT column list",
                    startToken.offset,
                    startToken.offset + startToken.value.length,
                );

                this.resyncToSelectBoundary();
            }
        } catch (e) {
            columns = [];
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_SELECT_COLUMNS",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
            );
        }

        // Safe default end
        let endOffset =
            columns.length > 0
                ? columns[columns.length - 1].end
                : startToken.offset + startToken.value.length;

        // 3.5. INTO
        let into: IdentifierNode | null = null;

        if (this.peekKeyword("INTO")) {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                into = this.parseMultipartIdentifier() as IdentifierNode;
                endOffset = into.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_INTO",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 4. FROM
        let from: TableReference[] | null = null;

        if (this.peekKeyword("FROM")) {
            try {
                from = this.parseFrom();

                if (from.length > 0) {
                    endOffset = from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_EMPTY_FROM",
                        "Expected FROM source",
                        endOffset,
                    );
                }
            } catch (e) {
                from = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_FROM",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 5. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword("WHERE")) {
            const whereToken = this.consume();
            endOffset = whereToken.offset + whereToken.value.length;

            try {
                where = this.parseExpression();

                if (where) {
                    endOffset = where.end;
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_WHERE",
                    e instanceof Error ? e.message : String(e),
                    whereToken.offset,
                    endOffset,
                );
            }
        }

        // 6. GROUP BY
        let groupBy: Expression[] | null = null;

        if (this.peekKeyword("GROUP")) {
            const groupToken = this.consume();
            endOffset = groupToken.offset + groupToken.value.length;

            let hasBy = false;

            try {
                this.matchKeyword("BY");
                endOffset = this.lastConsumedEnd();
                hasBy = true;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_GROUP_BY",
                    e instanceof Error ? e.message : String(e),
                    groupToken.offset,
                    endOffset,
                );
            }

            if (hasBy) {
                try {
                    groupBy = this.parseList(() => this.parseExpression());

                    if (groupBy.length > 0) {
                        endOffset = groupBy[groupBy.length - 1].end;
                    } else {
                        groupBy = [];
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_SELECT_EMPTY_GROUP_BY",
                            "Expected GROUP BY expression",
                            endOffset,
                        );
                    }
                } catch (e) {
                    groupBy = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_GROUP_EXPR",
                        e instanceof Error ? e.message : String(e),
                        endOffset,
                    );
                }
            } else {
                groupBy = [];
            }
        }

        // 7. HAVING
        let having: Expression | null = null;

        if (this.peekKeyword("HAVING")) {
            const havingToken = this.consume();
            endOffset = havingToken.offset + havingToken.value.length;

            try {
                having = this.parseExpression();

                if (having) {
                    endOffset = having.end;
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_HAVING",
                    e instanceof Error ? e.message : String(e),
                    havingToken.offset,
                    endOffset,
                );
            }
        }

        // 8. ORDER BY
        let orderBy: OrderByNode[] | null = null;

        if (this.peekKeyword("ORDER")) {
            const orderToken = this.consume();
            endOffset = orderToken.offset + orderToken.value.length;

            let hasBy = false;

            try {
                this.matchKeyword("BY");
                endOffset = this.lastConsumedEnd();
                hasBy = true;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_ORDER_BY",
                    e instanceof Error ? e.message : String(e),
                    orderToken.offset,
                    endOffset,
                );
            }

            if (hasBy) {
                try {
                    orderBy = this.parseList(() => {
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
                    });

                    if (orderBy.length > 0) {
                        endOffset = orderBy[orderBy.length - 1].end;
                    } else {
                        orderBy = [];
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_SELECT_EMPTY_ORDER_BY",
                            "Expected ORDER BY expression",
                            endOffset,
                        );
                    }
                } catch (e) {
                    orderBy = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_ORDER_EXPR",
                        e instanceof Error ? e.message : String(e),
                        endOffset,
                    );
                }
            } else {
                orderBy = [];
            }
        }

        // 9. OFFSET
        let offset: Expression | null = null;

        if (this.peekKeyword("OFFSET")) {
            const offsetToken = this.consume();
            endOffset = offsetToken.offset + offsetToken.value.length;

            try {
                offset = this.parseExpression();
                endOffset = offset.end;

                if (this.peekKeyword("ROW") || this.peekKeyword("ROWS")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_OFFSET_ROWS",
                        "Expected ROW or ROWS after OFFSET",
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_OFFSET",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 10. FETCH NEXT / FIRST
        let fetch: Expression | null = null;
        let fetchApproximate = false;

        if (this.peekKeyword("FETCH")) {
            const fetchToken = this.consume();
            endOffset = fetchToken.offset + fetchToken.value.length;

            try {
                if (["APPROX", "APPROXIMATE"].includes(this.peek()?.value.toUpperCase() ?? "")) {
                    this.consume();
                    fetchApproximate = true;
                    endOffset = this.lastConsumedEnd();
                }
                const fetchMode = this.peek()?.value.toUpperCase();

                if (fetchMode === "NEXT" || fetchMode === "FIRST") {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_FETCH_NEXT",
                        "Expected NEXT or FIRST after FETCH",
                        endOffset,
                    );
                }

                fetch = this.parseExpression();
                endOffset = fetch.end;

                if (this.peekKeyword("ROW") || this.peekKeyword("ROWS")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_FETCH_ROWS",
                        "Expected ROW or ROWS after FETCH amount",
                        endOffset,
                    );
                }

                if (this.peekKeyword("ONLY")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_FETCH_ONLY",
                        "Expected ONLY after FETCH",
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_FETCH",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 11. FOR JSON / FOR XML
        let forClause: ForClause | null = null;

        if (this.peekKeyword("FOR")) {
            const forToken = this.consume();
            endOffset = forToken.offset + forToken.value.length;

            let mode: "JSON" | "XML" | null = null;

            if (this.peekKeyword("JSON")) {
                this.consume();
                mode = "JSON";
            } else if (this.peekKeyword("XML")) {
                this.consume();
                mode = "XML";
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_FOR",
                    "Expected JSON or XML after FOR",
                    endOffset,
                );
            }

            if (mode) {
                const next = this.peek();

                if (!next || next.type === TokenType.Semicolon) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_SELECT_FOR",
                        "Expected FOR directive",
                        endOffset,
                    );
                } else {
                    const directive = this.consume().value.toUpperCase();

                    if (mode === "JSON") {
                        if (directive !== "AUTO" && directive !== "PATH") {
                            incomplete = true;
                            this.addRecoverableError(
                                errors,
                                "PARSE_SELECT_FOR_JSON_DIRECTIVE",
                                "Expected AUTO or PATH after FOR JSON",
                                next.offset,
                                next.offset + next.value.length,
                            );
                        }
                        const options: ForJsonOption[] = [];

                        while (this.peek()?.type === TokenType.Comma) {
                            this.consume();
                            options.push(this.parseForJsonOption());
                        }

                        forClause = {
                            mode: "JSON",
                            directive: directive as "AUTO" | "PATH",
                            ...(options.length ? { options } : {}),
                        };
                    } else {
                        let argument: string | undefined;

                        if (this.peek()?.type === TokenType.OpenParen) {
                            argument = this.parseParenthesizedTokenText();
                        }

                        const options: ForXmlOption[] = [];

                        while (this.peek()?.type === TokenType.Comma) {
                            this.consume();
                            options.push(this.parseForXmlOption());
                        }

                        forClause = {
                            mode: "XML",
                            directive: directive as "AUTO" | "PATH" | "RAW" | "EXPLICIT",
                            ...(argument !== undefined ? { argument } : {}),
                            ...(options.length ? { options } : {}),
                        };
                    }

                    endOffset = this.lastConsumedEnd();
                }
            }
        }

        let optionClause: OptionClause | null = null;

        if (this.peekKeyword("OPTION")) {
            try {
                optionClause = this.parseOptionClause();
                endOffset = optionClause.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SELECT_OPTION",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        return {
            type: "SelectStatement",
            distinct,
            columns,
            ...(top ? { top } : {}),
            ...(into ? { into } : {}),
            ...(from ? { from } : {}),
            ...(where ? { where } : {}),
            ...(groupBy ? { groupBy } : {}),
            ...(having ? { having } : {}),
            ...(orderBy ? { orderBy } : {}),
            ...(offset ? { offset } : {}),
            ...(fetch ? { fetch } : {}),
            ...(fetchApproximate ? { fetchApproximate: true } : {}),
            ...(forClause ? { forClause } : {}),
            ...(optionClause ? { optionClause } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseColumn(): ColumnNode {
        let alias: string | undefined;

        let expression: Expression;

        let sourceName: string | undefined;

        let outputName = "";

        let wildcard = false;

        let incomplete = false;

        const errors: string[] = [];

        const STOP_KEYWORDS = [
            "FROM",
            "WHERE",
            "GROUP",
            "ORDER",
            "HAVING",

            "UNION",
            "ALL",
            "EXCEPT",
            "INTERSECT",

            "JOIN",
            "ON",
            "APPLY",
            "INTO",

            "OUTER",
            "VALUES",
            "FOR",

            "OPTION",
            "FETCH",
            "OFFSET",
            "CROSS",

            "PIVOT",
            "UNPIVOT",
            "WITHIN",

            "WHEN",
            "THEN",

            // block/control flow
            "BEGIN",
            "END",
            "ELSE",
            "CATCH",

            // statement starters
            ...Array.from(RESYNC_KEYWORDS),
        ];

        const startOffset = this.peek()?.offset ?? 0;

        const isKeywordIdentifierColumnStart = (): boolean => {
            const token = this.peek();

            if (token?.type !== TokenType.Keyword) {
                return false;
            }

            if (this.peek(1)?.type === TokenType.OpenParen) {
                return false;
            }

            if (
                [
                    "FROM",
                    "WHERE",
                    "GROUP",
                    "ORDER",
                    "HAVING",
                    "UNION",
                    "ALL",
                    "EXCEPT",
                    "INTERSECT",
                    "JOIN",
                    "ON",
                    "APPLY",
                    "INTO",
                    "OUTER",
                    "VALUES",
                    "FOR",
                    "OPTION",
                    "FETCH",
                    "OFFSET",
                    "CROSS",
                    "PIVOT",
                    "UNPIVOT",
                    "WITHIN",
                    "WHEN",
                    "THEN",
                    "BEGIN",
                    "END",
                    "ELSE",
                    "CATCH",
                ].includes(token.value)
            ) {
                return false;
            }

            return ![
                "NULL",
                "CASE",
                "EXISTS",
                "CAST",
                "TRY_CAST",
                "CONVERT",
                "PARSE",
                "TRY_PARSE",
                "NOT",
                "SELECT",
            ].includes(token.value);
        };

        const parseColumnAlias = (): string => {
            const nextToken = this.peek();

            if (!nextToken) {
                throw new Error("Expected column alias");
            }

            if (nextToken.type === TokenType.String) {
                const aliasToken = this.consume();

                return aliasToken.value.slice(1, -1);
            }

            const aliasExpr = this.parseMultipartIdentifier();

            if (aliasExpr.type === "Identifier") {
                return aliasExpr.name;
            }

            throw new Error("Wildcards cannot be used as column aliases");
        };

        // -------------------------------------------------
        // Expression parse with recovery
        // -------------------------------------------------

        try {
            // ---------------------------------------------
            // Assignment style:
            // Alias = Expression
            // ---------------------------------------------

            if (this.peek()?.type === TokenType.Identifier && this.peek(1)?.value === "=") {
                alias = this.consume().value;

                this.consume(); // =

                expression = this.parseExpression();
            }

            // ---------------------------------------------
            // Standard expression column
            // ---------------------------------------------
            else {
                if (isKeywordIdentifierColumnStart()) {
                    expression = this.parseMultipartIdentifier(undefined, {
                        allowStructuralFirstSegment: true,
                    });
                } else {
                    expression = this.parseExpression();
                }

                const nextToken = this.peek();

                const nextVal = nextToken?.value;

                // AS alias
                if (nextVal === "AS") {
                    this.consume();
                    alias = parseColumnAlias();
                }

                // implicit alias
                else if (
                    nextToken &&
                    nextToken.type !== TokenType.Semicolon &&
                    nextToken.type !== TokenType.Comma &&
                    (nextToken.type === TokenType.Identifier ||
                        nextToken.type === TokenType.String ||
                        nextToken.type === TokenType.Keyword) &&
                    !STOP_KEYWORDS.includes(nextVal!)
                ) {
                    alias = parseColumnAlias();
                }
            }
        } catch (e) {
            // -------------------------------------------------
            // Recovery
            // -------------------------------------------------

            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_COLUMN",
                e instanceof Error ? e.message : String(e),
                startOffset,
                this.peek()?.offset ?? startOffset,
            );

            this.resyncToSelectBoundary();

            // placeholder recovery expression
            expression = {
                type: "Identifier",
                name: "__ERROR__",
                parts: ["__ERROR__"],
                start: startOffset,
                end: this.peek()?.offset ?? startOffset,
            };
        }

        // -------------------------------------------------
        // Derive metadata
        // -------------------------------------------------

        switch (expression.type) {
            case "Identifier":
                sourceName =
                    expression.parts.length > 0
                        ? expression.parts[expression.parts.length - 1]
                        : expression.name;
                break;

            case "MemberExpression":
                sourceName = expression.property;
                break;

            case "WildcardExpression":
                wildcard = true;
                sourceName = "*";
                break;
        }

        // -------------------------------------------------
        // Output name
        // -------------------------------------------------

        outputName = alias ?? sourceName ?? "expression";

        // -------------------------------------------------
        // End offset
        // -------------------------------------------------

        const endOffset = alias ? this.lastConsumedEnd() : expression.end;

        return {
            type: "Column",
            expression,
            sourceName,
            alias,
            outputName,
            wildcard,
            start: startOffset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseWith(): WithNode {
        // Capture the 'WITH' token that was just peeked/consumed
        const startToken = this.matchKeyword("WITH");
        const ctes: CTENode[] = [];
        let xmlNamespaces: XmlNamespaceNode[] | undefined;
        let incomplete = false;
        const errors: string[] = [];

        if (this.peek()?.value?.toUpperCase() === "XMLNAMESPACES") {
            this.consume();
            this.match(TokenType.OpenParen);

            xmlNamespaces = this.parseList<XmlNamespaceNode>(() => {
                const declStart = this.peek()?.offset ?? this.lastConsumedEnd();

                if (this.peekKeyword("DEFAULT")) {
                    this.consume();
                    const uriToken = this.match(TokenType.String);

                    return {
                        uri: uriToken.value,
                        isDefault: true,
                        start: declStart,
                        end: uriToken.offset + uriToken.value.length,
                    };
                }

                const uriToken = this.match(TokenType.String);

                this.matchKeyword("AS");

                const prefixExpr = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });

                if (prefixExpr.type !== "Identifier") {
                    throw new Error("Expected XML namespace prefix");
                }

                return {
                    uri: uriToken.value,
                    prefix: prefixExpr.name,
                    start: declStart,
                    end: prefixExpr.end,
                };
            });

            this.match(TokenType.CloseParen);

            const bodyStart = this.peek()?.offset ?? this.lastConsumedEnd();
            let body = this.parseStatement();

            if (!body) {
                incomplete = true;

                const message = "XMLNAMESPACES must be followed by a query or DML statement.";

                this.addRecoverableError(
                    errors,
                    "PARSE_WITH_XMLNAMESPACES_BODY",
                    message,
                    bodyStart,
                    bodyStart + 1,
                );

                body = {
                    type: "ErrorStatement",
                    message,
                    start: bodyStart,
                    end: bodyStart + 1,
                };
            }

            return {
                type: "WithStatement",
                ctes,
                xmlNamespaces,
                body,
                start: startToken.offset,
                end: body.end,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {}),
            };
        }

        while (true) {
            // Use the multipart identifier for the CTE name
            const nameExpr = this.parseMultipartIdentifier();
            let columns: string[] | undefined = undefined;
            let name = "*";

            // Validation: CTE names must be identifiers, not wildcards
            if (nameExpr.type === "Identifier") {
                name = nameExpr.name;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_WITH_CTE_NAME",
                    "Wildcards are not allowed as CTE names",
                    nameExpr.start,
                    nameExpr.end,
                );
            }

            // Optional column list: WITH MyCTE (Col1, Col2)
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume();
                columns = this.parseList(
                    () => {
                        const columnExpr = this.parseMultipartIdentifier(undefined, {
                            allowStructuralFirstSegment: true,
                        });

                        if (columnExpr.type === "Identifier" && columnExpr.name) {
                            return columnExpr.name;
                        }

                        throw new Error("Expected identifier in CTE column list");
                    },
                    {
                        isBoundary: this.isIdentifierListBoundary.bind(this),
                    },
                );
                this.match(TokenType.CloseParen);
            }

            this.matchKeyword("AS");
            this.match(TokenType.OpenParen);

            // Parse the CTE query
            const query = this.parseQueryExpression() as QueryStatement;
            const closeParen = this.match(TokenType.CloseParen);

            ctes.push({
                name,
                columns,
                query,
                start: nameExpr.start,
                end: closeParen.offset + closeParen.value.length,
            });

            // T-SQL allows multiple CTEs separated by commas
            if (this.peek()?.value === ",") {
                this.consume();
            } else {
                break;
            }
        }

        // The statement that follows the CTE (SELECT, INSERT, UPDATE, DELETE)
        const bodyStart = this.peek()?.offset ?? this.lastConsumedEnd();
        let body = this.parseStatement();

        if (!body) {
            incomplete = true;

            const message =
                "A Common Table Expression (CTE) must be followed by a query or DML statement.";

            this.addRecoverableError(errors, "PARSE_WITH_BODY", message, bodyStart, bodyStart + 1);

            body = {
                type: "ErrorStatement",
                message,
                start: bodyStart,
                end: bodyStart + 1,
            };
        }

        return {
            type: "WithStatement",
            ctes,
            ...(xmlNamespaces ? { xmlNamespaces } : {}),
            body,
            start: startToken.offset,
            end: body.end,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseQueryExpression(): QueryStatement {
        const left = this.parseSelect();
        return this.parseSetOperation(left);
    }
}
