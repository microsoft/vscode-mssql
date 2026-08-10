/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";

import {
    type NodeLocation,
    type QueryStatement,
    type InsertNode,
    type UpdateNode,
    type UpdateStatisticsNode,
    type DeleteNode,
    type MergeNode,
    type MergeWhenClause,
    type MergeDeleteAction,
    type MergeInsertAction,
    type MergeUpdateAction,
    type MergeAction,
    type StatisticsOptionNode,
    type Expression,
    type IdentifierNode,
    type OptionClause,
    type TableReference,
    type ColumnNode,
    type MergeMatchType,
    type UpdateAssignment,
    type OutputClauseNode,
    type OutputColumnNode,
    type TopClause,
} from "../ast/types.js";

import { Precedence, RESYNC_KEYWORDS, STRUCTURAL_KEYWORDS } from "./grammar.js";

import { QueryParser } from "./queryParser.js";

export abstract class DmlParser extends QueryParser {
    protected parseInsert(): InsertNode {
        const startToken = this.matchKeyword("INSERT");

        let incomplete = false;
        const errors: string[] = [];
        let output: OutputClauseNode | undefined;

        if (this.peekKeyword("INTO")) {
            this.consume();
        }

        let tableNode: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        // ✅ FIXED: ONLY stop at semicolon
        const syncToStatementBoundary = () => {
            while (this.peek()) {
                const t = this.peek()!;

                if (t.type === TokenType.Semicolon) {
                    return; // do NOT consume
                }

                this.consume();
            }
        };

        // 1) Target table
        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value) &&
                next.type !== TokenType.OpenParen &&
                next.type !== TokenType.Semicolon
            ) {
                tableNode = this.parseMultipartIdentifier();
                endOffset = tableNode.end;

                // detect invalid identifier like "dbo."
                if (
                    tableNode.type === "Identifier" &&
                    (tableNode.incomplete || tableNode.parts.includes(""))
                ) {
                    this.addRecoverableError(
                        errors,
                        "PARSE_INSERT_TABLE",
                        "Invalid table name in INSERT",
                        tableNode.start,
                        tableNode.end,
                    );

                    syncToStatementBoundary();

                    return {
                        type: "InsertStatement",
                        table: tableNode,
                        start: startToken.offset,
                        end: endOffset,
                        incomplete: true,
                        ...(errors.length ? { errors } : {}),
                    };
                }
            } else {
                this.addRecoverableError(
                    errors,
                    "PARSE_INSERT_TARGET",
                    "Expected target table",
                    startToken.offset,
                    endOffset,
                );

                syncToStatementBoundary();

                return {
                    type: "InsertStatement",
                    table: tableNode,
                    start: startToken.offset,
                    end: endOffset,
                    incomplete: true,
                    ...(errors.length ? { errors } : {}),
                };
            }
        } catch (e) {
            this.addRecoverableError(
                errors,
                "PARSE_INSERT_TARGET",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );

            syncToStatementBoundary();

            return {
                type: "InsertStatement",
                table: tableNode,
                start: startToken.offset,
                end: endOffset,
                incomplete: true,
                ...(errors.length ? { errors } : {}),
            };
        }

        // 2) Column list (unchanged)
        let columns: string[] | null = null;
        let columnNodes: IdentifierNode[] | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            const openParen = this.consume();
            endOffset = openParen.offset + openParen.value.length;

            try {
                if (this.peek()?.type !== TokenType.CloseParen) {
                    columnNodes = this.parseList(
                        () => {
                            const node = this.parseMultipartIdentifier(undefined, {
                                allowStructuralFirstSegment: true,
                            });
                            if (node.type === "Identifier") return node;
                            throw new Error("Wildcards are not allowed in an INSERT column list");
                        },
                        {
                            isBoundary: this.isIdentifierListBoundary.bind(this),
                        },
                    );
                    columns = columnNodes.map((node) => node.name);
                } else {
                    columns = [];
                    columnNodes = [];
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    const closeParen = this.consume();
                    endOffset = closeParen.offset + closeParen.value.length;
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_INSERT_COLUMNS_CLOSE",
                        "Expected ) after column list",
                        endOffset,
                        endOffset,
                    );
                }
            } catch (e) {
                columns = [];
                columnNodes = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_INSERT_COLUMNS",
                    e instanceof Error ? e.message : String(e),
                    openParen.offset,
                    endOffset,
                );

                this.recoverTo(["OUTPUT", "VALUES", "SELECT", "WITH", ";"]);
            }
        }

        // 3) OUTPUT (unchanged)
        if (this.peekKeyword("OUTPUT")) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_INSERT_OUTPUT",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                    endOffset,
                );

                this.recoverTo(["VALUES", "SELECT", "WITH", ";"]);
            }
        }

        // 4) VALUES / SELECT (unchanged)
        let values: Expression[][] | null = null;
        let selectQuery: QueryStatement | null = null;

        const nextVal = this.peek()?.value?.toUpperCase();

        if (nextVal === "VALUES") {
            const valuesToken = this.consume();
            endOffset = valuesToken.offset + valuesToken.value.length;

            values = [];
            let sawValuesRow = false;

            while (this.peek() && this.peek()!.type !== TokenType.Semicolon) {
                if (this.peek()!.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                if (this.peek()!.type !== TokenType.OpenParen) break;

                this.consume();
                sawValuesRow = true;

                const row: Expression[] = [];

                while (this.peek() && this.peek()!.type !== TokenType.CloseParen) {
                    if (this.peek()!.type === TokenType.Comma) {
                        this.consume();
                        continue;
                    }

                    try {
                        const expr = this.parseExpression(Precedence.LOWEST);
                        row.push(expr);
                        endOffset = expr.end;
                    } catch (e) {
                        incomplete = true;
                        break;
                    }
                }

                values.push(row);

                if (this.peek()?.type === TokenType.CloseParen) {
                    const close = this.consume();
                    endOffset = close.offset + close.value.length;
                }
            }

            if (!sawValuesRow) {
                values = [[]];
                incomplete = true;
            }
        } else if (nextVal === "SELECT" || nextVal === "WITH") {
            try {
                selectQuery = this.parseQueryExpression();
                endOffset = selectQuery.end;
            } catch (e) {
                incomplete = true;
            }
        }

        return {
            type: "InsertStatement",
            table: tableNode,
            ...(columns ? { columns } : {}),
            ...(columnNodes ? { columnNodes } : {}),
            ...(output ? { output } : {}),
            ...(values ? { values } : {}),
            ...(selectQuery ? { selectQuery } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseUpdate(): UpdateNode {
        const startToken = this.matchKeyword("UPDATE");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;
        let output: OutputClauseNode | undefined;
        let top: TopClause | null = null;

        if (this.peekKeyword("TOP")) {
            const topResult = this.parseDmlTopClause(errors, "UPDATE");

            top = topResult.top;
            endOffset = topResult.endOffset;
            incomplete = incomplete || topResult.incomplete;
        }

        // 1. Target
        let targetNode: Expression | null = null;
        let targetHints: string[] | undefined;

        try {
            const next = this.peek();

            if (next && !this.isStructuralKeyword(next.value)) {
                targetNode = this.parseMultipartIdentifier();

                endOffset = targetNode.end;

                if (this.peekKeyword("WITH") || this.peek()?.type === TokenType.OpenParen) {
                    targetHints = this.parseTableHints();
                    endOffset = this.lastConsumedEnd();
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_UPDATE_TARGET",
                    "Expected update target",
                    startToken.offset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_UPDATE_TARGET",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );

            this.recoverTo(["SET"]);
        }

        // 2. SET
        let sawSet = false;

        try {
            this.matchKeyword("SET");
            endOffset = this.lastConsumedEnd();
            sawSet = true;
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_UPDATE_SET",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // 3. Assignments
        let assignments: UpdateAssignment[] = [];

        if (sawSet) {
            try {
                const state = {
                    incomplete,
                    endOffset,
                };

                assignments = this.parseUpdateAssignments(errors, state);

                incomplete = state.incomplete;
                endOffset = state.endOffset;

                if (assignments.length === 0) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UPDATE_EMPTY_ASSIGNMENTS",
                        "Expected SET assignment",
                        endOffset,
                    );
                }
            } catch (e) {
                assignments = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_UPDATE_ASSIGNMENTS",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );

                this.recoverTo(["OUTPUT", "FROM", "WHERE"]);
            }
        }

        // 4. OUTPUT
        if (this.peekKeyword("OUTPUT")) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_UPDATE_OUTPUT",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );

                this.recoverTo(["FROM", "WHERE"]);
            }
        }

        // 5. FROM
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
                        "PARSE_UPDATE_EMPTY_FROM",
                        "Expected FROM source",
                        endOffset,
                    );
                }
            } catch (e) {
                from = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_UPDATE_FROM",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );

                this.recoverTo(["WHERE"]);
            }
        }

        // 6. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword("WHERE")) {
            const whereToken = this.consume();
            endOffset = whereToken.offset + whereToken.value.length;

            try {
                const next = this.peek();

                if (
                    next &&
                    !this.isStructuralKeyword(next.value) &&
                    next.type !== TokenType.Comma
                ) {
                    where = this.parseExpression();

                    if (where) {
                        endOffset = where.end;
                    }
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UPDATE_WHERE",
                        "Expected WHERE expression",
                        whereToken.offset,
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_UPDATE_WHERE",
                    e instanceof Error ? e.message : String(e),
                    whereToken.offset,
                    endOffset,
                );
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
                    "PARSE_UPDATE_OPTION",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        return {
            type: "UpdateStatement",
            ...(top ? { top } : {}),
            target: targetNode,
            ...(targetHints?.length ? { targetHints } : {}),
            ...(assignments?.length ? { assignments } : {}),
            ...(output ? { output } : {}),
            ...(from ? { from } : {}),
            ...(where ? { where } : {}),
            ...(optionClause ? { optionClause } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseUpdateStatistics(): UpdateStatisticsNode {
        const startToken = this.matchKeyword("UPDATE");
        this.matchKeyword("STATISTICS");

        let incomplete = false;
        const errors: string[] = [];
        let table: IdentifierNode | null = null;
        let statistics: string | null = null;
        let options: StatisticsOptionNode[] | undefined;

        try {
            const tableExpr = this.parseMultipartIdentifier();
            if (tableExpr.type === "Identifier") {
                table = tableExpr;
            } else {
                throw new Error("Expected table name after UPDATE STATISTICS");
            }

            const next = this.peek();
            if (next && !this.isUpdateStatisticsBoundary(next)) {
                if (next.type === TokenType.OpenParen) {
                    this.consume();
                    const statsNames = this.parseList<string>(() => this.consume().value, {
                        isBoundary: (token?: Token) =>
                            !token || token.type === TokenType.CloseParen,
                    });
                    this.match(TokenType.CloseParen);
                    statistics = statsNames.join(", ");
                } else {
                    statistics = this.consume().value;
                }
            }

            if (this.peekKeyword("WITH")) {
                this.consume();
                options = this.parseUpdateStatisticsOptions();
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_UPDATE_STATISTICS",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                this.lastConsumedEnd(),
            );
        }

        return {
            type: "UpdateStatisticsStatement",
            table,
            ...(statistics !== null ? { statistics } : {}),
            ...(options?.length ? { options } : {}),
            start: startToken.offset,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected isUpdateStatisticsBoundary(token?: Token): boolean {
        return (
            !token ||
            token.type === TokenType.Semicolon ||
            (token.type === TokenType.Keyword &&
                (token.value === "WITH" ||
                    STRUCTURAL_KEYWORDS.has(token.value) ||
                    RESYNC_KEYWORDS.has(token.value)))
        );
    }

    protected parseUpdateStatisticsOptions(): StatisticsOptionNode[] {
        return this.parseList<StatisticsOptionNode>(
            () => {
                const startToken = this.consume();
                let value: string | undefined;

                if (this.peek()?.value === "=") {
                    this.consume();

                    const parts: string[] = [];
                    while (this.peek()) {
                        const token = this.peek()!;
                        if (
                            token.type === TokenType.Comma ||
                            token.type === TokenType.Semicolon ||
                            (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value))
                        ) {
                            break;
                        }

                        parts.push(this.consume().value);
                    }

                    value = parts.join(" ").trim();
                }

                return {
                    type: "StatisticsOption",
                    name: startToken.value,
                    ...(value ? { value } : {}),
                    start: startToken.offset,
                    end: this.lastConsumedEnd(),
                };
            },
            {
                isBoundary: this.isUpdateStatisticsBoundary.bind(this),
            },
        );
    }

    protected parseDmlTopClause(
        errors: string[],
        codePrefix: "UPDATE" | "DELETE",
    ): {
        top: TopClause | null;
        endOffset: number;
        incomplete: boolean;
    } {
        let incomplete = false;
        let top: TopClause | null = null;
        let endOffset = this.peek()?.offset ?? this.lastConsumedEnd();

        if (!this.peekKeyword("TOP")) {
            return { top, endOffset, incomplete };
        }

        const topToken = this.consume();
        const topStart = topToken.offset;
        endOffset = topToken.offset + topToken.value.length;

        const hasParens = this.peek()?.type === TokenType.OpenParen;

        let quantity: Expression | null = null;
        let topEnd = endOffset;

        if (hasParens) {
            const openParen = this.consume();
            endOffset = openParen.offset + openParen.value.length;
        }

        try {
            const next = this.peek();

            if (
                !next ||
                next.type === TokenType.Semicolon ||
                (next.type === TokenType.Keyword &&
                    RESYNC_KEYWORDS.has(next.value) &&
                    (!hasParens || (next.value !== "SELECT" && next.value !== "WITH")))
            ) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    `PARSE_${codePrefix}_TOP`,
                    "Expected TOP value",
                    endOffset,
                    endOffset,
                );
            } else if (hasParens && next.type === TokenType.CloseParen) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    `PARSE_${codePrefix}_TOP`,
                    "Expected TOP value",
                    endOffset,
                    endOffset,
                );
            } else if (hasParens) {
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
                endOffset = quantity.end;
                topEnd = endOffset;
            } else {
                const quantityToken = this.consume();
                endOffset = quantityToken.offset + quantityToken.value.length;

                const numVal = Number(quantityToken.value);

                quantity = {
                    type: "Literal",
                    value: Number.isNaN(numVal) ? quantityToken.value : numVal,
                    variant: Number.isNaN(numVal) ? "string" : "number",
                    start: quantityToken.offset,
                    end: quantityToken.offset + quantityToken.value.length,
                };
                topEnd = quantity.end;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                `PARSE_${codePrefix}_TOP`,
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        if (hasParens) {
            if (this.peek()?.type === TokenType.CloseParen) {
                const closeParen = this.consume();
                endOffset = closeParen.offset + closeParen.value.length;
                topEnd = endOffset;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    `PARSE_${codePrefix}_TOP_CLOSE_PAREN`,
                    "Expected ) after TOP expression",
                    endOffset,
                    endOffset,
                );
            }
        }

        top = {
            type: "TopClause",
            quantity,
            percent: false,
            withTies: false,
            start: topStart,
            end: topEnd,
        };

        return { top, endOffset, incomplete };
    }

    protected parseDelete(): DeleteNode {
        const startToken = this.matchKeyword("DELETE");

        let incomplete = false;
        const errors: string[] = [];
        let output: OutputClauseNode | undefined;
        let top: TopClause | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        // Optional TOP clause
        if (this.peekKeyword("TOP")) {
            const topResult = this.parseDmlTopClause(errors, "DELETE");

            top = topResult.top;
            endOffset = topResult.endOffset;
            incomplete = incomplete || topResult.incomplete;
        }

        // Optional first FROM
        // DELETE FROM T ...
        if (this.peekKeyword("FROM")) {
            const fromToken = this.consume();
            endOffset = fromToken.offset + fromToken.value.length;
        }

        // 1. Target
        let target: Expression | null = null;

        try {
            const next = this.peek();

            if (
                next &&
                !this.isStructuralKeyword(next.value) &&
                next.type !== TokenType.Semicolon
            ) {
                target = this.parseMultipartIdentifier();

                endOffset = target.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DELETE_TARGET",
                    "Expected delete target",
                    startToken.offset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_DELETE_TARGET",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );

            this.recoverTo(["OUTPUT", "FROM", "WHERE"]);
        }

        // 2. OUTPUT
        // DELETE ... OUTPUT ...
        if (this.peekKeyword("OUTPUT")) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DELETE_OUTPUT",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );

                this.recoverTo(["FROM", "WHERE"]);
            }
        }

        // 3. Optional second FROM
        // DELETE Alias FROM TableSource ...
        let from: TableReference[] | null = null;

        if (this.peekKeyword("FROM")) {
            const fromToken = this.consume();
            endOffset = fromToken.offset + fromToken.value.length;

            try {
                from = this.parseList(() => this.parseTableSource(fromToken.offset));

                if (from.length > 0) {
                    endOffset = from[from.length - 1].end;
                } else {
                    from = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_DELETE_EMPTY_FROM",
                        "Expected FROM source",
                        fromToken.offset,
                        endOffset,
                    );
                }
            } catch (e) {
                from = [];
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DELETE_FROM",
                    e instanceof Error ? e.message : String(e),
                    fromToken.offset,
                    endOffset,
                );

                this.recoverTo(["WHERE"]);
            }
        }

        // 4. WHERE
        let where: Expression | null = null;

        if (this.peekKeyword("WHERE")) {
            const whereToken = this.consume();
            endOffset = whereToken.offset + whereToken.value.length;

            try {
                const next = this.peek();

                if (
                    next &&
                    !this.isStructuralKeyword(next.value) &&
                    next.type !== TokenType.Comma &&
                    next.type !== TokenType.Semicolon
                ) {
                    where = this.parseExpression(Precedence.LOWEST);

                    if (where) {
                        endOffset = where.end;
                    }
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_DELETE_WHERE",
                        "Expected WHERE expression",
                        whereToken.offset,
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DELETE_WHERE",
                    e instanceof Error ? e.message : String(e),
                    whereToken.offset,
                    endOffset,
                );
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
                    "PARSE_DELETE_OPTION",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        return {
            type: "DeleteStatement",
            ...(top ? { top } : {}),
            target,
            ...(output ? { output } : {}),
            ...(from ? { from } : {}),
            ...(where ? { where } : {}),
            ...(optionClause ? { optionClause } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseUpdateAssignments(
        errors: string[],
        state: { incomplete: boolean; endOffset: number },
    ): UpdateAssignment[] {
        const targetKindFor = (name: string): "column" | "variable" | undefined =>
            name ? (name.startsWith("@") ? "variable" : "column") : undefined;

        return this.parseList(
            () => {
                const assignmentStart = this.peek()?.offset ?? state.endOffset;

                let columnName = "";
                let columnNode: IdentifierNode | null = null;
                let value: Expression | null = null;
                let assignmentEnd = assignmentStart;

                // 1) column
                try {
                    const next = this.peek();

                    if (!next || this.isStructuralKeyword(next.value)) {
                        state.incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_UPDATE_ASSIGNMENT_COLUMN",
                            "Expected assignment column",
                            state.endOffset,
                        );

                        return {
                            type: "UpdateAssignment",
                            column: "",
                            columnNode: null,
                            start: assignmentStart,
                            end: assignmentEnd,
                            value: null,
                        };
                    }

                    const columnExpr = this.parseMultipartIdentifier(undefined, {
                        allowStructuralFirstSegment: true,
                    });

                    if (columnExpr.type === "Identifier") {
                        columnName = columnExpr.name;
                        columnNode = columnExpr;
                        state.endOffset = columnExpr.end;
                        assignmentEnd = columnExpr.end;
                    } else {
                        state.incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_UPDATE_ASSIGNMENT_TARGET",
                            "Wildcards are not allowed as update targets",
                            state.endOffset,
                        );

                        return {
                            type: "UpdateAssignment",
                            column: "",
                            columnNode: null,
                            start: assignmentStart,
                            end: assignmentEnd,
                            value: null,
                        };
                    }
                } catch (e) {
                    state.incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UPDATE_ASSIGNMENT_COLUMN",
                        e instanceof Error ? e.message : String(e),
                        state.endOffset,
                    );

                    return {
                        type: "UpdateAssignment",
                        column: "",
                        columnNode: null,
                        start: assignmentStart,
                        end: assignmentEnd,
                        value: null,
                    };
                }

                const assignmentToken = this.peek();
                const isSimpleAssignment = assignmentToken?.value === "=";
                const isCompoundAssignment =
                    !!assignmentToken?.value &&
                    this.getCompoundAssignmentBinaryOperator(assignmentToken.value) !== null;

                // 2) assignment operator
                if (!isSimpleAssignment && !isCompoundAssignment) {
                    state.incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UPDATE_ASSIGNMENT_EQUALS",
                        "Expected = or compound assignment operator",
                        state.endOffset,
                    );

                    return {
                        type: "UpdateAssignment",
                        column: columnName,
                        columnNode,
                        targetKind: targetKindFor(columnName),
                        start: assignmentStart,
                        end: assignmentEnd,
                        value: null,
                    };
                }

                const eqToken = this.consume();
                state.endOffset = eqToken.offset + eqToken.value.length;
                assignmentEnd = state.endOffset;

                const valueStarter = this.peek();
                const isMissingValueBoundary =
                    !valueStarter ||
                    valueStarter.type === TokenType.Comma ||
                    valueStarter.type === TokenType.Semicolon ||
                    (valueStarter.type === TokenType.Keyword &&
                        ["OUTPUT", "FROM", "WHERE", "OPTION"].includes(
                            valueStarter.value.toUpperCase(),
                        ));

                if (isMissingValueBoundary) {
                    state.incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UPDATE_ASSIGNMENT_VALUE",
                        "Expected assignment value",
                        state.endOffset,
                    );

                    return {
                        type: "UpdateAssignment",
                        column: columnName,
                        columnNode,
                        targetKind: targetKindFor(columnName),
                        start: assignmentStart,
                        end: assignmentEnd,
                        value: null,
                    };
                }

                // 3) value
                try {
                    const parsedValue = this.parseExpression();
                    value = isCompoundAssignment
                        ? this.buildCompoundAssignmentExpression(
                              columnNode ?? {
                                  type: "Identifier",
                                  name: columnName,
                                  parts: [columnName],
                                  start: assignmentStart,
                                  end: assignmentEnd,
                              },
                              eqToken,
                              parsedValue,
                          )
                        : parsedValue;

                    if (value) {
                        state.endOffset = value.end;
                        assignmentEnd = value.end;
                    }
                } catch (e) {
                    state.incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_UPDATE_ASSIGNMENT_VALUE",
                        e instanceof Error ? e.message : String(e),
                        state.endOffset,
                    );
                }

                return {
                    type: "UpdateAssignment",
                    column: columnName,
                    columnNode,
                    targetKind: targetKindFor(columnName),
                    start: assignmentStart,
                    end: assignmentEnd,
                    value,
                };
            },
            {
                isBoundary: (token?: Token) =>
                    !token ||
                    token.type === TokenType.Semicolon ||
                    (token.type === TokenType.Keyword &&
                        (token.value.toUpperCase() === "OUTPUT"
                            ? !(
                                  this.peek(1)?.value === "=" ||
                                  this.getCompoundAssignmentBinaryOperator(
                                      this.peek(1)?.value ?? "",
                                  ) !== null
                              )
                            : ["FROM", "WHERE", "OPTION"].includes(token.value.toUpperCase()))),
            },
        );
    }

    protected parseOutputClause(): OutputClauseNode {
        const startToken = this.matchKeyword("OUTPUT");

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        // 1. Columns
        let columns: OutputColumnNode[] = [];

        try {
            columns = this.parseList(() => {
                const start = this.peek()?.offset ?? startToken.offset;

                let sourceTable: "INSERTED" | "DELETED" | null = null;
                let sourceLocation: NodeLocation | undefined;

                const value = this.peek()?.value?.toUpperCase();

                // INSERTED / DELETED
                if (value === "INSERTED" || value === "DELETED") {
                    const token = this.consume();

                    sourceTable = value as "INSERTED" | "DELETED";

                    sourceLocation = {
                        start: token.offset,
                        end: token.offset + token.value.length,
                    };

                    if (this.peek()?.type === TokenType.Dot) {
                        this.consume();
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_OUTPUT_DOT",
                            "Expected . after " + value,
                            token.offset,
                            token.offset + token.value.length,
                        );
                    }
                }

                let column: ColumnNode;

                try {
                    column = this.parseColumn();
                    endOffset = column.end;
                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_OUTPUT_COLUMN",
                        e instanceof Error ? e.message : String(e),
                        start,
                        endOffset,
                    );

                    // fallback dummy column
                    column = {
                        type: "Column",
                        expression: {
                            type: "Identifier",
                            name: "",
                            parts: [],
                            start,
                            end: start,
                        },
                        sourceName: "",
                        outputName: "",
                        start,
                        end: start,
                    } as ColumnNode;
                }

                return {
                    type: "OutputColumn",
                    sourceTable,
                    sourceLocation,
                    column,
                    start,
                    end: column.end,
                } as OutputColumnNode;
            });

            if (columns.length === 0) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_OUTPUT_EMPTY",
                    "Expected OUTPUT column list",
                    startToken.offset,
                    endOffset,
                );
            }
        } catch (e) {
            columns = [];
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_OUTPUT",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );

            this.recoverTo(["INTO", "VALUES", "SELECT", "FROM", "WHERE"]);
        }

        // 2. INTO
        let intoTable: Expression | undefined;
        let intoColumns: string[] | undefined;
        let intoColumnNodes: IdentifierNode[] | undefined;

        if (this.peekKeyword("INTO")) {
            const intoToken = this.consume();
            endOffset = intoToken.offset + intoToken.value.length;

            try {
                const next = this.peek();

                if (
                    next &&
                    next.type !== TokenType.Semicolon &&
                    !this.isStructuralKeyword(next.value)
                ) {
                    intoTable = this.parseMultipartIdentifier();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_OUTPUT_INTO_TARGET",
                        "Expected INTO target table",
                        intoToken.offset,
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_OUTPUT_INTO_TARGET",
                    e instanceof Error ? e.message : String(e),
                    intoToken.offset,
                    endOffset,
                );
            }

            // INTO column list
            if (this.peek()?.type === TokenType.OpenParen) {
                const open = this.consume();
                endOffset = open.offset + open.value.length;

                try {
                    if (this.peek()?.type !== TokenType.CloseParen) {
                        intoColumnNodes = this.parseList(
                            () => {
                                const node = this.parseMultipartIdentifier(undefined, {
                                    allowStructuralFirstSegment: true,
                                });
                                if (node.type === "Identifier") return node;
                                throw new Error(
                                    "Wildcards are not allowed in an OUTPUT INTO column list",
                                );
                            },
                            {
                                isBoundary: this.isIdentifierListBoundary.bind(this),
                            },
                        );
                        intoColumns = intoColumnNodes.map((node) => node.name);
                    } else {
                        intoColumns = [];
                        intoColumnNodes = [];
                    }

                    if (this.peek()?.type === TokenType.CloseParen) {
                        const close = this.consume();
                        endOffset = close.offset + close.value.length;
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_OUTPUT_INTO_COLUMNS",
                            "Expected ) after INTO column list",
                            endOffset,
                            endOffset,
                        );
                    }
                } catch (e) {
                    intoColumns = [];
                    intoColumnNodes = [];
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_OUTPUT_INTO_COLUMNS",
                        e instanceof Error ? e.message : String(e),
                        open.offset,
                        endOffset,
                    );
                }
            }
        }

        return {
            type: "OutputClause",
            columns,
            intoTable,
            intoColumns,
            intoColumnNodes,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseMerge(): MergeNode {
        const startToken = this.matchKeyword("MERGE");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        let top: TopClause | null = null;
        let target: Expression | null = null;
        let targetAlias: string | undefined;
        let usingTable: TableReference | null = null;
        let on: Expression | null = null;
        const whenClauses: MergeWhenClause[] = [];
        let output: OutputClauseNode | undefined;

        // ------------------------------------------------------------
        // TOP(...)
        // ------------------------------------------------------------
        if (this.peekKeyword("TOP")) {
            const topToken = this.consume();
            let topEnd = topToken.offset + topToken.value.length;
            const topErrors: string[] = [];
            let topIncomplete = false;

            const hasParens = this.peek()?.type === TokenType.OpenParen;

            if (hasParens) {
                this.consume();
            }

            try {
                const next = this.peek();
                let quantity: Expression | null = null;

                if (
                    !next ||
                    next.type === TokenType.Semicolon ||
                    (next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value))
                ) {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_MERGE_TOP",
                        "Expected TOP value",
                        topEnd,
                        topEnd,
                    );
                } else if (hasParens && next.type === TokenType.CloseParen) {
                    topIncomplete = true;
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_MERGE_TOP",
                        "Expected TOP value",
                        topEnd,
                        topEnd,
                    );
                } else if (hasParens) {
                    quantity = this.parseExpression();
                    topEnd = quantity.end;
                } else {
                    const quantityToken = this.consume();
                    const numVal = Number(quantityToken.value);
                    quantity = {
                        type: "Literal",
                        variant: numVal !== numVal ? "string" : "number",
                        value: numVal !== numVal ? quantityToken.value : numVal,
                        start: quantityToken.offset,
                        end: quantityToken.offset + quantityToken.value.length,
                    };
                    topEnd = quantity.end;
                }

                top = {
                    type: "TopClause",
                    quantity,
                    percent: false,
                    withTies: false,
                    start: topToken.offset,
                    end: topEnd,
                    ...(topIncomplete ? { incomplete: true } : {}),
                    ...(topErrors.length ? { errors: topErrors } : {}),
                };
                endOffset = top.end;
            } catch {
                this.addRecoverableError(
                    topErrors,
                    "PARSE_MERGE_TOP",
                    "Expected TOP value",
                    topEnd,
                    topEnd,
                );

                top = {
                    type: "TopClause",
                    quantity: null,
                    percent: false,
                    withTies: false,
                    start: topToken.offset,
                    end: topEnd,
                    incomplete: true,
                    errors: topErrors,
                };
                endOffset = top.end;
            }

            if (hasParens) {
                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                    if (top) {
                        top.end = endOffset;
                    }
                } else {
                    this.addRecoverableError(
                        topErrors,
                        "PARSE_MERGE_TOP_CLOSE_PAREN",
                        "Expected ) after TOP expression",
                        topEnd,
                        topEnd,
                    );
                    if (top) {
                        top.incomplete = true;
                        top.errors = topErrors;
                    }
                }
            }
        }

        // ------------------------------------------------------------
        // TARGET
        // MERGE [INTO] dbo.Table WITH (...) AS t
        // ------------------------------------------------------------
        try {
            if (this.peekKeyword("INTO")) {
                this.consume();
                endOffset = this.lastConsumedEnd();
            }

            target = this.parseMultipartIdentifier();
            endOffset = target.end;

            // optional hints
            if (this.peek()?.value === "WITH" || this.peek()?.type === TokenType.OpenParen) {
                this.parseTableHints();
                endOffset = this.lastConsumedEnd();
            }

            // optional AS
            if (this.peek()?.value === "AS") {
                this.consume();
            }

            // alias
            const next = this.peek();

            if (
                next &&
                (next.type === TokenType.Identifier || next.type === TokenType.Keyword) &&
                next.value !== "USING"
            ) {
                const aliasExpr = this.parseMultipartIdentifier();

                if (aliasExpr.type === "Identifier") {
                    targetAlias = aliasExpr.name;
                    endOffset = aliasExpr.end;
                }
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_MERGE_TARGET",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );
        }

        // ------------------------------------------------------------
        // USING
        // ------------------------------------------------------------
        try {
            this.matchKeyword("USING");

            usingTable = this.parseTableSource();
            endOffset = usingTable.end;
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_MERGE_USING",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // ------------------------------------------------------------
        // ON
        // ------------------------------------------------------------
        try {
            this.matchKeyword("ON");

            on = this.parseExpression();

            if (on) {
                endOffset = on.end;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_MERGE_ON",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // ------------------------------------------------------------
        // WHEN ...
        // ------------------------------------------------------------
        while (this.peekKeyword("WHEN")) {
            try {
                const clause = this.parseMergeWhenClause();

                whenClauses.push(clause);
                endOffset = clause.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_MERGE_WHEN",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );

                this.recoverTo(["WHEN", "OUTPUT", ";"]);
            }
        }

        // ------------------------------------------------------------
        // OUTPUT
        // ------------------------------------------------------------
        if (this.peekKeyword("OUTPUT")) {
            try {
                output = this.parseOutputClause();
                endOffset = output.end;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_MERGE_OUTPUT",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
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
                    "PARSE_MERGE_OPTION",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        return {
            type: "MergeStatement",
            top,
            target,
            targetAlias,
            using: usingTable,
            on,
            whenClauses,
            output,
            ...(optionClause ? { optionClause } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseMergeWhenClause(): MergeWhenClause {
        const whenToken = this.matchKeyword("WHEN");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = whenToken.offset + whenToken.value.length;

        let condition: MergeMatchType = "MATCHED";
        let predicate: Expression | null = null;
        let action: MergeAction;

        // ------------------------------------------------------------
        // MATCH TYPE
        // ------------------------------------------------------------
        try {
            if (this.peekKeyword("NOT")) {
                this.consume();

                this.matchKeyword("MATCHED");
                condition = "NOT MATCHED";
                endOffset = this.lastConsumedEnd();

                if (this.peekKeyword("BY")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();

                    if (this.peekKeyword("SOURCE")) {
                        this.consume();
                        condition = "NOT MATCHED BY SOURCE";
                        endOffset = this.lastConsumedEnd();
                    } else if (this.peekKeyword("TARGET")) {
                        this.consume();
                        condition = "NOT MATCHED BY TARGET";
                        endOffset = this.lastConsumedEnd();
                    } else {
                        throw new Error("Expected SOURCE or TARGET after BY in MERGE clause");
                    }
                }
            } else {
                this.matchKeyword("MATCHED");
                condition = "MATCHED";
                endOffset = this.lastConsumedEnd();
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_MERGE_MATCH_TYPE",
                e instanceof Error ? e.message : String(e),
                whenToken.offset,
                endOffset,
            );
        }

        // ------------------------------------------------------------
        // optional AND predicate
        // ------------------------------------------------------------
        if (this.peekKeyword("AND")) {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                predicate = this.parseExpression();

                if (predicate) {
                    endOffset = predicate.end;
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_MERGE_PREDICATE",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // ------------------------------------------------------------
        // THEN
        // ------------------------------------------------------------
        try {
            this.matchKeyword("THEN");
            endOffset = this.lastConsumedEnd();
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_MERGE_THEN",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // ------------------------------------------------------------
        // ACTION
        // ------------------------------------------------------------
        try {
            action = this.parseMergeAction();
            endOffset = action.end;
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_MERGE_ACTION",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );

            action = {
                type: "MergeDeleteAction",
                start: endOffset,
                end: endOffset,
                incomplete: true,
            } as MergeDeleteAction;
        }

        return {
            type: "MergeWhenClause",
            condition,
            predicate,
            action,
            start: whenToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseMergeAction(): MergeAction {
        const token = this.peek();

        if (!token) {
            throw new Error("Expected MERGE action");
        }

        // ------------------------------------------------------------
        // DELETE
        // ------------------------------------------------------------
        if (this.peekKeyword("DELETE")) {
            const del = this.consume();

            const action: MergeDeleteAction = {
                type: "MergeDeleteAction",
                start: del.offset,
                end: del.offset + del.value.length,
            };

            return action;
        }

        // ------------------------------------------------------------
        // UPDATE SET ...
        // ------------------------------------------------------------
        if (this.peekKeyword("UPDATE")) {
            const updateToken = this.consume();

            let endOffset = updateToken.offset + updateToken.value.length;

            const errors: string[] = [];
            const state = {
                incomplete: false,
                endOffset,
            };

            this.matchKeyword("SET");

            endOffset = this.lastConsumedEnd();
            state.endOffset = endOffset;

            const assignments = this.parseUpdateAssignments(errors, state);

            endOffset = state.endOffset;

            const action: MergeUpdateAction = {
                type: "MergeUpdateAction",
                assignments,
                start: updateToken.offset,
                end: endOffset,
                ...(state.incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {}),
            };

            return action;
        }

        // ------------------------------------------------------------
        // INSERT
        // ------------------------------------------------------------
        if (this.peekKeyword("INSERT")) {
            const insertToken = this.consume();

            let endOffset = insertToken.offset + insertToken.value.length;

            let columns: string[] | null = null;
            let columnNodes: IdentifierNode[] | null = null;
            let values: Expression[] | null = null;
            let selectQuery: QueryStatement | null = null;

            // optional column list
            if (this.peek()?.type === TokenType.OpenParen) {
                this.consume();

                columnNodes = this.parseList(() => {
                    const id = this.parseMultipartIdentifier();

                    if (id.type !== "Identifier") {
                        throw new Error("Invalid INSERT column");
                    }

                    return id;
                });

                columns = columnNodes.map((x) => x.name);

                this.match(TokenType.CloseParen);
                endOffset = this.lastConsumedEnd();
            }

            // VALUES (...)
            if (this.peekKeyword("VALUES")) {
                this.consume();

                this.match(TokenType.OpenParen);

                values = this.parseList(() => this.parseExpression());

                this.match(TokenType.CloseParen);

                endOffset = this.lastConsumedEnd();
            }

            // INSERT ... SELECT ...
            else if (this.peekKeyword("SELECT") || this.peekKeyword("WITH")) {
                selectQuery = this.parseQueryExpression();

                endOffset = selectQuery.end;
            } else {
                throw new Error("Expected VALUES or SELECT after INSERT");
            }

            const action: MergeInsertAction = {
                type: "MergeInsertAction",
                columns,
                columnNodes,
                values,
                selectQuery,
                start: insertToken.offset,
                end: endOffset,
            };

            return action;
        }

        throw new Error(`Unsupported MERGE action: ${token.value}`);
    }
}
