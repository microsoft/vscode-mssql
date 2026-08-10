/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { TokenType } from "./lexer.js";

import {
    type Expression,
    type IdentifierNode,
    type PivotClause,
    type UnpivotClause,
    type ValuesTableExpression,
    type TableReference,
    type JoinNode,
    type JoinType,
    type JoinHint,
    type TemporalTableClause,
} from "../ast/types.js";

import { JoinKeywords, JoinTypes, Precedence } from "./grammar.js";

import { canStartAlias, isFromBoundary, isJoinToken } from "./boundaries.js";

import { ExpressionParser } from "./expressionParser.js";

export abstract class TableSourceParser extends ExpressionParser {
    /**
     * Parses the system-versioned-table qualifier that sits between a base table
     * name and its alias/hints. This is intentionally table-source grammar, not
     * a SELECT-level FOR clause (where FOR JSON/XML is handled).
     */
    protected parseForSystemTimeClause(): TemporalTableClause | null {
        if (!this.peekKeyword("FOR") || this.peek(1)?.value.toUpperCase() !== "SYSTEM_TIME") {
            return null;
        }

        const forToken = this.consume();
        const systemTimeToken = this.consume();
        let endOffset = systemTimeToken.offset + systemTimeToken.value.length;

        const expectWord = (value: string): void => {
            const token = this.peek();
            if (token?.value.toUpperCase() !== value) {
                throw new Error(`Expected ${value.replace("_", " ")} in FOR SYSTEM_TIME clause`);
            }
            this.consume();
            endOffset = token.offset + token.value.length;
        };

        const parseTemporalExpression = (): Expression => {
            const token = this.peek();
            if (
                !token ||
                token.type === TokenType.Semicolon ||
                token.type === TokenType.CloseParen ||
                token.type === TokenType.Comma ||
                (token.type === TokenType.Keyword &&
                    [
                        "WHERE",
                        "GROUP",
                        "HAVING",
                        "ORDER",
                        "JOIN",
                        "INNER",
                        "LEFT",
                        "RIGHT",
                        "FULL",
                        "CROSS",
                        "OUTER",
                        "ON",
                        "FOR",
                        "OPTION",
                    ].includes(token.value))
            ) {
                throw new Error("Expected temporal expression in FOR SYSTEM_TIME clause");
            }

            const expression = this.parseExpression(Precedence.COMPARE);
            endOffset = expression.end;
            return expression;
        };

        const qualifier = this.peek()?.value.toUpperCase();
        switch (qualifier) {
            case "AS": {
                expectWord("AS");
                expectWord("OF");
                const asOf = parseTemporalExpression();
                return { kind: "AS_OF", asOf, start: forToken.offset, end: endOffset };
            }
            case "FROM": {
                this.consume();
                endOffset = this.lastConsumedEnd();
                const from = parseTemporalExpression();
                expectWord("TO");
                const to = parseTemporalExpression();
                return { kind: "FROM_TO", from, to, start: forToken.offset, end: endOffset };
            }
            case "BETWEEN": {
                this.consume();
                endOffset = this.lastConsumedEnd();
                const from = parseTemporalExpression();
                expectWord("AND");
                const to = parseTemporalExpression();
                return { kind: "BETWEEN", from, to, start: forToken.offset, end: endOffset };
            }
            case "CONTAINED": {
                this.consume();
                endOffset = this.lastConsumedEnd();
                expectWord("IN");
                const openParen = this.match(TokenType.OpenParen);
                endOffset = openParen.offset + openParen.value.length;
                const from = parseTemporalExpression();
                const comma = this.match(TokenType.Comma);
                endOffset = comma.offset + comma.value.length;
                const to = parseTemporalExpression();
                const closeParen = this.match(TokenType.CloseParen);
                endOffset = closeParen.offset + closeParen.value.length;
                return { kind: "CONTAINED_IN", from, to, start: forToken.offset, end: endOffset };
            }
            case "ALL": {
                const allToken = this.consume();
                return {
                    kind: "ALL",
                    start: forToken.offset,
                    end: allToken.offset + allToken.value.length,
                };
            }
            default:
                throw new Error(
                    "Expected AS OF, FROM ... TO, BETWEEN ... AND, CONTAINED IN, or ALL after FOR SYSTEM_TIME",
                );
        }
    }

    protected parseParenthesizedTableReference(): TableReference {
        const openParen = this.match(TokenType.OpenParen);
        const inner = this.parseTableSource(openParen.offset);
        const closeParen = this.match(TokenType.CloseParen);

        return {
            ...inner,
            start: openParen.offset,
            end: closeParen.offset + closeParen.value.length,
        };
    }

    protected parseTableSourceExpression(): Expression | TableReference | null {
        const next = this.peek();
        const nextNext = this.peek(1);

        if (
            next?.type === TokenType.OpenParen &&
            (nextNext?.value === "VALUES" ||
                nextNext?.value === "SELECT" ||
                nextNext?.value === "WITH")
        ) {
            if (nextNext?.value === "VALUES") {
                return this.parseValuesTableExpression();
            }

            const openParen = this.consume();

            const query = this.parseQueryExpression();

            const closeParen = this.match(TokenType.CloseParen);

            return {
                type: "SubqueryExpression",
                query,
                start: openParen.offset,
                end: closeParen.offset + closeParen.value.length,
            };
        }

        if (next?.type === TokenType.OpenParen) {
            return this.parseParenthesizedTableReference();
        }

        const source = this.parseMultipartIdentifier();

        if (source.type === "Identifier" && this.peek()?.type === TokenType.OpenParen) {
            return this.parseTableValuedFunction(source);
        }

        return source;
    }

    protected parseValuesTableExpression(): ValuesTableExpression {
        const openParen = this.match(TokenType.OpenParen);
        this.matchKeyword("VALUES");

        const rows: Expression[][] = [];
        const errors: string[] = [];
        let incomplete = false;
        let endOffset = openParen.offset + openParen.value.length;

        while (this.peek()) {
            try {
                this.match(TokenType.OpenParen);

                const row = this.parseList(() => this.parseExpression(Precedence.LOWEST));

                rows.push(row);

                const closeRow = this.match(TokenType.CloseParen);
                endOffset = closeRow.offset + closeRow.value.length;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_VALUES_ROW",
                    e instanceof Error ? e.message : String(e),
                    this.peek()?.offset ?? endOffset,
                    this.peek()?.offset ?? endOffset,
                );

                break;
            }

            if (this.peek()?.type === TokenType.Comma) {
                this.consume();
                endOffset = this.lastConsumedEnd();
                continue;
            }

            break;
        }

        const closeParen = this.match(TokenType.CloseParen);
        endOffset = closeParen.offset + closeParen.value.length;

        return {
            type: "ValuesTableExpression",
            rows,
            start: openParen.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseFrom(): TableReference[] {
        const fromToken = this.matchKeyword("FROM");

        const errors: string[] = [];

        const refs: TableReference[] = [];

        try {
            while (this.pos < this.tokens.length) {
                // stop at next clause
                if (isFromBoundary(this.peek())) {
                    break;
                }

                const table = this.parseTableSource(fromToken.offset);

                refs.push(table);

                // comma-separated table sources
                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                // stop if next clause begins
                if (isFromBoundary(this.peek())) {
                    break;
                }

                // otherwise parseTableSource()
                // should already have consumed joins / alias.
                // no more table refs.
                break;
            }

            if (refs.length > 0) {
                return refs;
            }

            this.addRecoverableError(
                errors,
                "PARSE_FROM_EMPTY",
                "Expected table source after FROM",
                fromToken.offset,
                fromToken.offset + fromToken.value.length,
            );
        } catch (e) {
            this.addRecoverableError(
                errors,
                "PARSE_FROM",
                e instanceof Error ? e.message : String(e),
                fromToken.offset,
                fromToken.offset + fromToken.value.length,
            );

            this.recoverTo([
                "WHERE",
                "GROUP",
                "HAVING",
                "ORDER",
                "FOR",
                "OPTION",
                "OFFSET",
                "FETCH",
                "OUTPUT",
            ]);
        }

        return [
            {
                type: "TableReference",
                table: null,
                joins: [],
                start: fromToken.offset,
                end: fromToken.offset + fromToken.value.length,
                incomplete: true,
                errors: ["Expected table source after FROM", ...errors],
            },
        ];
    }

    protected parseTableSource(forcedStart?: number): TableReference {
        let incomplete = false;
        const errors: string[] = [];

        let source: Expression | TableReference | null = null;
        let alias: string | null = null;
        let aliasColumns: string[] | undefined;
        let hints: string[] | undefined;
        let pivot: PivotClause | null = null;
        let unpivot: UnpivotClause | null = null;
        let forSystemTime: TemporalTableClause | undefined;

        const startToken = this.peek();
        const startOffset = forcedStart ?? startToken?.offset ?? 0;
        let endOffset = startOffset;

        // ------------------------------------------------------------
        // 1. SOURCE
        // ------------------------------------------------------------
        try {
            source = this.parseTableSourceExpression();

            if (source) {
                endOffset = source.end;
            }
        } catch (e) {
            incomplete = true;
        }

        // A temporal-table qualifier belongs immediately after the base table,
        // before a table alias or hints. Without this branch SELECT's FOR parser
        // misdiagnoses SYSTEM_TIME as a malformed FOR JSON/XML clause.
        try {
            if (source?.type === "Identifier") {
                const temporal = this.parseForSystemTimeClause();
                if (temporal) {
                    forSystemTime = temporal;
                    endOffset = temporal.end;
                }
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_FOR_SYSTEM_TIME",
                e instanceof Error ? e.message : String(e),
                endOffset,
                this.lastConsumedEnd(),
            );
        }

        const parseOptionalAlias = (): string | null => {
            const token = this.peek();

            if (!source) {
                return null;
            }

            if (token?.value === "AS") {
                this.consume();

                const id = this.parseMultipartIdentifier();

                if (id.type === "Identifier") {
                    endOffset = id.end;
                    return id.name;
                }

                throw new Error("Wildcards cannot be used as table aliases");
            }

            if (token && this.peek(1)?.type === TokenType.Operator && this.peek(1)?.value === ":") {
                return null;
            }

            if (canStartAlias(token)) {
                const id = this.parseMultipartIdentifier();

                if (id.type === "Identifier") {
                    endOffset = id.end;
                    return id.name;
                }

                throw new Error("Wildcards cannot be used as table aliases");
            }

            return null;
        };

        // ------------------------------------------------------------
        // 2. ALIAS
        // ------------------------------------------------------------
        try {
            alias = parseOptionalAlias();
        } catch {
            incomplete = true;
        }

        try {
            if (
                alias &&
                (source?.type === "SubqueryExpression" ||
                    source?.type === "ValuesTableExpression" ||
                    source?.type === "FunctionCall") &&
                this.peek()?.type === TokenType.OpenParen
            ) {
                this.consume();

                aliasColumns = this.parseList(
                    () => {
                        const columnExpr = this.parseMultipartIdentifier(undefined, {
                            allowStructuralFirstSegment: true,
                        });

                        if (columnExpr.type === "Identifier" && columnExpr.name) {
                            return columnExpr.name;
                        }

                        throw new Error("Expected identifier in derived table column list");
                    },
                    {
                        isBoundary: this.isIdentifierListBoundary.bind(this),
                    },
                );

                const closeParen = this.match(TokenType.CloseParen);
                endOffset = closeParen.offset + closeParen.value.length;
            }
        } catch {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 3. MODERN HINTS
        // ------------------------------------------------------------
        try {
            if (source?.type === "Identifier" && this.peekKeyword("WITH")) {
                const parsed = this.parseTableHints();

                if (parsed.length) {
                    hints = parsed;
                    endOffset = this.lastConsumedEnd();
                }
            }
        } catch {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 4. LEGACY HINTS
        // ------------------------------------------------------------
        try {
            if (
                source?.type === "Identifier" &&
                alias &&
                this.peek()?.type === TokenType.OpenParen
            ) {
                const parsed = this.parseTableHints();

                if (parsed.length) {
                    hints = parsed;
                    endOffset = this.lastConsumedEnd();
                }
            }
        } catch {
            incomplete = true;
        }

        // ------------------------------------------------------------
        // 5. PIVOT / UNPIVOT
        // ------------------------------------------------------------
        try {
            if (this.peekKeyword("PIVOT")) {
                pivot = this.parsePivotClause(alias || undefined);
                alias = null;
                endOffset = pivot.end;

                const pivotAlias = parseOptionalAlias();

                if (pivotAlias) {
                    alias = pivotAlias;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_PIVOT_ALIAS",
                        "Expected alias after PIVOT clause",
                        endOffset,
                        endOffset,
                    );
                }
            } else if (this.peekKeyword("UNPIVOT")) {
                unpivot = this.parseUnpivotClause(alias || undefined);
                alias = null;
                endOffset = unpivot.end;

                const unpivotAlias = parseOptionalAlias();

                if (unpivotAlias) {
                    alias = unpivotAlias;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UNPIVOT_ALIAS",
                        "Expected alias after UNPIVOT clause",
                        endOffset,
                        endOffset,
                    );
                }
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                this.peekKeyword("UNPIVOT") ? "PARSE_UNPIVOT" : "PARSE_PIVOT",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        // ------------------------------------------------------------
        // 6. JOINS
        // ------------------------------------------------------------
        const joins: JoinNode[] = [];

        while (isJoinToken(this.peek(), this.peek(1))) {
            const join = this.parseJoin();

            joins.push(join);
            endOffset = join.end;

            if (join.errors?.length) {
                incomplete = true;

                for (const err of join.errors) {
                    this.addRecoverableError(errors, "PARSE_JOIN", err, join.start, join.end);
                }
            }
        }

        // ------------------------------------------------------------
        // 7. PIVOT / UNPIVOT after joined source
        // ------------------------------------------------------------
        try {
            if (!pivot && !unpivot) {
                if (this.peekKeyword("PIVOT")) {
                    pivot = this.parsePivotClause(alias || undefined);
                    alias = null;
                    endOffset = pivot.end;

                    const pivotAlias = parseOptionalAlias();

                    if (pivotAlias) {
                        alias = pivotAlias;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_PIVOT_ALIAS",
                            "Expected alias after PIVOT clause",
                            endOffset,
                            endOffset,
                        );
                    }
                } else if (this.peekKeyword("UNPIVOT")) {
                    unpivot = this.parseUnpivotClause(alias || undefined);
                    alias = null;
                    endOffset = unpivot.end;

                    const unpivotAlias = parseOptionalAlias();

                    if (unpivotAlias) {
                        alias = unpivotAlias;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_UNPIVOT_ALIAS",
                            "Expected alias after UNPIVOT clause",
                            endOffset,
                            endOffset,
                        );
                    }
                }
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                this.peekKeyword("UNPIVOT") ? "PARSE_UNPIVOT" : "PARSE_PIVOT",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        return {
            type: "TableReference",
            table: source,
            alias: alias || undefined,
            ...(aliasColumns?.length ? { aliasColumns } : {}),
            ...(forSystemTime ? { forSystemTime } : {}),
            hints,
            ...(pivot ? { pivot } : {}),
            ...(unpivot ? { unpivot } : {}),
            joins,
            start: startOffset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parsePivotClause(sourceAlias?: string): PivotClause {
        const pivotToken = this.matchKeyword("PIVOT");
        const errors: string[] = [];
        let incomplete = false;
        let endOffset = pivotToken.offset + pivotToken.value.length;

        this.match(TokenType.OpenParen);

        let aggregate: Expression | null = null;
        let forColumn: IdentifierNode | null = null;
        let inColumns: IdentifierNode[] = [];

        try {
            aggregate = this.parseExpression();
            endOffset = aggregate.end;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_PIVOT_AGGREGATE",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            this.matchKeyword("FOR");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_PIVOT_FOR",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            const id = this.parseMultipartIdentifier();

            if (id.type === "Identifier") {
                forColumn = id;
                endOffset = id.end;
            } else {
                throw new Error("Expected pivot FOR column");
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_PIVOT_COLUMN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            this.matchKeyword("IN");
            endOffset = this.lastConsumedEnd();
            this.match(TokenType.OpenParen);
            endOffset = this.lastConsumedEnd();

            inColumns = this.parseList(() => {
                const id = this.parseMultipartIdentifier();

                if (id.type === "Identifier") {
                    return id;
                }

                throw new Error("Expected pivot IN column");
            });

            if (inColumns.length > 0) {
                endOffset = inColumns[inColumns.length - 1].end;
            }

            const inClose = this.match(TokenType.CloseParen);
            endOffset = inClose.offset + inClose.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_PIVOT_IN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            const closeParen = this.match(TokenType.CloseParen);
            endOffset = closeParen.offset + closeParen.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_PIVOT_CLOSE_PAREN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        return {
            type: "PivotClause",
            aggregate,
            forColumn,
            inColumns,
            ...(sourceAlias ? { sourceAlias } : {}),
            start: pivotToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseUnpivotClause(sourceAlias?: string): UnpivotClause {
        const unpivotToken = this.matchKeyword("UNPIVOT");
        const errors: string[] = [];
        let incomplete = false;
        let endOffset = unpivotToken.offset + unpivotToken.value.length;

        this.match(TokenType.OpenParen);

        let valueColumn: IdentifierNode | null = null;
        let forColumn: IdentifierNode | null = null;
        let inColumns: IdentifierNode[] = [];

        try {
            const id = this.parseMultipartIdentifier();

            if (id.type === "Identifier") {
                valueColumn = id;
                endOffset = id.end;
            } else {
                throw new Error("Expected unpivot value column");
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_UNPIVOT_VALUE_COLUMN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            this.matchKeyword("FOR");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_UNPIVOT_FOR",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            const id = this.parseMultipartIdentifier();

            if (id.type === "Identifier") {
                forColumn = id;
                endOffset = id.end;
            } else {
                throw new Error("Expected unpivot FOR column");
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_UNPIVOT_COLUMN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            this.matchKeyword("IN");
            endOffset = this.lastConsumedEnd();
            this.match(TokenType.OpenParen);
            endOffset = this.lastConsumedEnd();

            inColumns = this.parseList(() => {
                const id = this.parseMultipartIdentifier();

                if (id.type === "Identifier") {
                    return id;
                }

                throw new Error("Expected unpivot IN column");
            });

            if (inColumns.length > 0) {
                endOffset = inColumns[inColumns.length - 1].end;
            }

            const inClose = this.match(TokenType.CloseParen);
            endOffset = inClose.offset + inClose.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_UNPIVOT_IN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        try {
            const closeParen = this.match(TokenType.CloseParen);
            endOffset = closeParen.offset + closeParen.value.length;
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_UNPIVOT_CLOSE_PAREN",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        return {
            type: "UnpivotClause",
            valueColumn,
            forColumn,
            inColumns,
            ...(sourceAlias ? { sourceAlias } : {}),
            start: unpivotToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    /**
     * Gold Standard Helper: Centralizes keywords that terminate a table reference.
     * Prevents "Select col NEW_KEYWORD" from breaking if NEW_KEYWORD is added to T-SQL.
     */

    protected parseTableHints(): string[] {
        const hints: string[] = [];

        if (this.peekKeyword("WITH")) {
            this.consume();
        }

        if (this.peek()?.type !== TokenType.OpenParen) {
            return hints;
        }

        this.consume(); // (

        let current: string[] = [];
        let depth = 0;

        while (this.peek()) {
            const token = this.peek()!;

            // hard recovery boundary
            if (
                depth === 0 &&
                (token.type === TokenType.Semicolon || this.isStructuralKeyword(token.value))
            ) {
                break;
            }

            // nested open
            if (token.type === TokenType.OpenParen) {
                depth++;
                current.push(token.value);
                this.consume();
                continue;
            }

            // close nested / outer
            if (token.type === TokenType.CloseParen) {
                if (depth > 0) {
                    depth--;
                    current.push(token.value);
                    this.consume();
                    continue;
                }

                // outer )
                const hint = current.join("").trim();
                if (hint) {
                    hints.push(hint);
                }

                current = [];
                this.consume();
                break;
            }

            // comma separator at top level
            if (depth === 0 && token.type === TokenType.Comma) {
                const hint = current.join("").trim();

                if (hint) {
                    hints.push(hint);
                }

                current = [];
                this.consume();
                continue;
            }

            current.push(token.value);
            this.consume();
        }

        const trailing = current.join("").trim();

        if (trailing) {
            hints.push(trailing);
        }

        return hints;
    }

    protected parseJoin(): JoinNode {
        const startToken = this.peek()!;

        let incomplete = false;
        const errors: string[] = [];

        // safe defaults
        let type: JoinType = JoinTypes.INNER;
        let rawType = startToken.value.toUpperCase();
        let joinHint: JoinHint | undefined;
        let endOffset = startToken.offset + startToken.value.length;

        // 1. Determine canonical Join Type
        const firstToken = this.consume();
        const first = firstToken.value.toUpperCase();
        endOffset = firstToken.offset + firstToken.value.length;

        try {
            switch (first) {
                case JoinKeywords.HASH:
                case JoinKeywords.MERGE:
                case JoinKeywords.LOOP:
                    joinHint = first as JoinHint;
                    rawType = `${first} JOIN`;

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push(`Expected JOIN after ${first}`);
                    }

                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.JOIN:
                    rawType = JoinKeywords.JOIN;
                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.INNER:
                    rawType = "INNER JOIN";

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = `INNER ${joinHint} JOIN`;
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push("Expected JOIN after INNER");
                    }

                    type = JoinTypes.INNER;
                    break;

                case JoinKeywords.LEFT:
                    if (this.peekKeyword(JoinKeywords.OUTER)) {
                        const outerToken = this.consume();
                        endOffset = outerToken.offset + outerToken.value.length;
                        rawType = "LEFT OUTER JOIN";
                    } else {
                        rawType = "LEFT JOIN";
                    }

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = rawType.replace(" JOIN", ` ${joinHint} JOIN`);
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push("Expected JOIN after LEFT");
                    }

                    type = JoinTypes.LEFT_OUTER;
                    break;

                case JoinKeywords.RIGHT:
                    if (this.peekKeyword(JoinKeywords.OUTER)) {
                        const outerToken = this.consume();
                        endOffset = outerToken.offset + outerToken.value.length;
                        rawType = "RIGHT OUTER JOIN";
                    } else {
                        rawType = "RIGHT JOIN";
                    }

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = rawType.replace(" JOIN", ` ${joinHint} JOIN`);
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push("Expected JOIN after RIGHT");
                    }

                    type = JoinTypes.RIGHT_OUTER;
                    break;

                case JoinKeywords.FULL:
                    if (this.peekKeyword(JoinKeywords.OUTER)) {
                        const outerToken = this.consume();
                        endOffset = outerToken.offset + outerToken.value.length;
                        rawType = "FULL OUTER JOIN";
                    } else {
                        rawType = "FULL JOIN";
                    }

                    if (
                        this.peekKeyword(JoinKeywords.HASH) ||
                        this.peekKeyword(JoinKeywords.MERGE) ||
                        this.peekKeyword(JoinKeywords.LOOP)
                    ) {
                        joinHint = this.consume().value as JoinHint;
                        endOffset = this.lastConsumedEnd();
                        rawType = rawType.replace(" JOIN", ` ${joinHint} JOIN`);
                    }

                    if (this.peekKeyword(JoinKeywords.JOIN)) {
                        const joinToken = this.consume();
                        endOffset = joinToken.offset + joinToken.value.length;
                    } else {
                        incomplete = true;
                        errors.push("Expected JOIN after FULL");
                    }

                    type = JoinTypes.FULL_OUTER;
                    break;

                case JoinKeywords.CROSS: {
                    const next = this.peek()?.value?.toUpperCase();

                    if (next === JoinKeywords.JOIN) {
                        const token = this.consume();
                        endOffset = token.offset + token.value.length;
                        rawType = "CROSS JOIN";
                        type = JoinTypes.CROSS;
                    } else if (next === JoinKeywords.APPLY) {
                        const token = this.consume();
                        endOffset = token.offset + token.value.length;
                        rawType = "CROSS APPLY";
                        type = JoinTypes.CROSS_APPLY;
                    } else {
                        incomplete = true;
                        errors.push("Expected JOIN or APPLY after CROSS");
                        rawType = "CROSS";
                        type = JoinTypes.CROSS;
                    }

                    break;
                }

                case JoinKeywords.OUTER: {
                    const next = this.peek()?.value?.toUpperCase();

                    if (next === JoinKeywords.APPLY) {
                        const token = this.consume();
                        endOffset = token.offset + token.value.length;
                        rawType = "OUTER APPLY";
                        type = JoinTypes.OUTER_APPLY;
                    } else {
                        incomplete = true;
                        errors.push("Expected APPLY after OUTER");
                        rawType = "OUTER";
                        type = JoinTypes.OUTER_APPLY;
                    }

                    break;
                }

                default:
                    incomplete = true;
                    errors.push(`Unsupported join type: ${first}`);
                    break;
            }
        } catch (e) {
            incomplete = true;
            errors.push(e instanceof Error ? e.message : String(e));
        }

        // 2. Join target
        let tableTarget: Expression | TableReference | null = null;
        let forSystemTime: TemporalTableClause | undefined;

        try {
            const nextToken = this.peek();

            if (!nextToken) {
                incomplete = true;
            } else if (
                nextToken.type === TokenType.OpenParen &&
                (this.peek(1)?.value === "SELECT" || this.peek(1)?.value === "WITH")
            ) {
                const openParen = this.consume();
                endOffset = openParen.offset + openParen.value.length;

                const subquery = this.parseQueryExpression();
                const closeParen = this.match(TokenType.CloseParen);

                tableTarget = {
                    type: "SubqueryExpression",
                    query: subquery,
                    start: openParen.offset,
                    end: closeParen.offset + closeParen.value.length,
                };

                endOffset = tableTarget.end;
            } else if (nextToken.type === TokenType.OpenParen) {
                tableTarget = this.parseTableSourceExpression();
                if (tableTarget) {
                    endOffset = tableTarget.end;
                }
            } else {
                tableTarget = this.parseTableSourceExpression();
                if (tableTarget) {
                    endOffset = tableTarget.end;
                }
            }
        } catch (e) {
            incomplete = true;

            errors.push(e instanceof Error ? e.message : String(e));
        }

        try {
            if (tableTarget?.type === "Identifier") {
                const temporal = this.parseForSystemTimeClause();
                if (temporal) {
                    forSystemTime = temporal;
                    endOffset = temporal.end;
                }
            }
        } catch (e) {
            incomplete = true;
            errors.push(e instanceof Error ? e.message : String(e));
        }

        // 3. Alias
        let alias: string | undefined;
        let aliasColumns: string[] | undefined;

        if (tableTarget) {
            try {
                if (this.peek()?.value === "AS") {
                    const asToken = this.consume();
                    endOffset = asToken.offset + asToken.value.length;

                    const aliasExpr = this.parseMultipartIdentifier();

                    // Validation: JOIN aliases must be identifiers, not wildcards
                    if (aliasExpr.type === "Identifier") {
                        alias = aliasExpr.name;
                        endOffset = aliasExpr.end;
                    } else {
                        throw new Error("Wildcards cannot be used as JOIN aliases");
                    }
                } else {
                    const potentialAlias = this.peek();

                    if (
                        potentialAlias &&
                        !(
                            this.peek(1)?.type === TokenType.Operator && this.peek(1)?.value === ":"
                        ) &&
                        canStartAlias(potentialAlias)
                    ) {
                        const aliasExpr = this.parseMultipartIdentifier();

                        // Validation: Implicit JOIN aliases must be identifiers
                        if (aliasExpr.type === "Identifier") {
                            alias = aliasExpr.name;
                            endOffset = aliasExpr.end;
                        } else {
                            throw new Error("Wildcards cannot be used as JOIN aliases");
                        }
                    }
                }
            } catch (e) {
                incomplete = true;

                errors.push(e instanceof Error ? e.message : String(e));
            }
        }

        if (
            alias &&
            (tableTarget?.type === "SubqueryExpression" ||
                tableTarget?.type === "ValuesTableExpression" ||
                tableTarget?.type === "FunctionCall") &&
            this.peek()?.type === TokenType.OpenParen
        ) {
            try {
                this.consume();

                aliasColumns = this.parseList(
                    () => {
                        const columnExpr = this.parseMultipartIdentifier(undefined, {
                            allowStructuralFirstSegment: true,
                        });

                        if (columnExpr.type === "Identifier" && columnExpr.name) {
                            return columnExpr.name;
                        }

                        throw new Error("Expected identifier in derived table column list");
                    },
                    {
                        isBoundary: this.isIdentifierListBoundary.bind(this),
                    },
                );

                const closeParen = this.match(TokenType.CloseParen);
                endOffset = closeParen.offset + closeParen.value.length;
            } catch (e) {
                incomplete = true;

                errors.push(e instanceof Error ? e.message : String(e));
            }
        }

        // 4. Hints
        let hints: string[] | undefined;

        if (
            tableTarget?.type === "Identifier" &&
            (this.peek()?.value === "WITH" || (this.peek()?.type === TokenType.OpenParen && alias))
        ) {
            try {
                hints = this.parseTableHints();
                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;

                errors.push(e instanceof Error ? e.message : String(e));
            }
        }

        // 5. ON clause
        let on: Expression | null = null;

        if (this.peekKeyword("ON")) {
            const onToken = this.consume();
            endOffset = onToken.offset + onToken.value.length;

            try {
                on = this.parseExpression();

                if (on) {
                    endOffset = on.end;
                }
            } catch (e) {
                incomplete = true;

                errors.push(e instanceof Error ? e.message : String(e));
            }
        } else if (
            type !== JoinTypes.CROSS &&
            type !== JoinTypes.CROSS_APPLY &&
            type !== JoinTypes.OUTER_APPLY
        ) {
            incomplete = true;
            errors.push("Expected ON clause");
        }

        return {
            type,
            rawType,
            ...(joinHint ? { joinHint } : {}),
            table: tableTarget,
            alias,
            ...(aliasColumns?.length ? { aliasColumns } : {}),
            ...(forSystemTime ? { forSystemTime } : {}),
            hints,
            on,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }
}
