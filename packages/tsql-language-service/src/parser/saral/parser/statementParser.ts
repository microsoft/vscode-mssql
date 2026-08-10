/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";

import {
    type Statement,
    type DeclareNode,
    type SetNode,
    type QueryStatement,
    type PrintNode,
    type RaiseErrorNode,
    type ExecuteNode,
    type PermissionNode,
    type UseNode,
    type ConstraintNode,
    type TruncateNode,
    type Expression,
    type IdentifierNode,
    type ReturnNode,
    type VariableDeclaration,
    type ColumnDefinition,
    type ExecArgument,
    type WaitForNode,
} from "../ast/types.js";

import { RESYNC_KEYWORDS } from "./grammar.js";

import { DmlParser } from "./dmlParser.js";

export abstract class StatementParser extends DmlParser {
    protected parseUse(): UseNode {
        const startToken = this.matchKeyword("USE");
        let incomplete = false;
        const errors: string[] = [];
        let database: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        try {
            const next = this.peek();

            if (
                next &&
                next.type !== TokenType.Semicolon &&
                !this.isStructuralKeyword(next.value)
            ) {
                database = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });
                endOffset = database.end;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_USE_DATABASE",
                    "Expected database name after USE",
                    endOffset,
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_USE_DATABASE",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );
        }

        return {
            type: "UseStatement",
            database,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parsePermission(): PermissionNode {
        const actionToken = this.consume();
        const action = actionToken.value.toUpperCase() as PermissionNode["action"];
        let endOffset = actionToken.offset + actionToken.value.length;
        let incomplete = false;
        const errors: string[] = [];

        const permissions: string[] = [];
        let currentPermission: string[] = [];

        while (this.peek()) {
            const token = this.peek()!;
            const upper = token.value.toUpperCase();

            if (upper === "ON") {
                break;
            }

            this.consume();
            endOffset = token.offset + token.value.length;

            if (token.type === TokenType.Comma) {
                if (currentPermission.length) {
                    permissions.push(currentPermission.join(" "));
                    currentPermission = [];
                }
                continue;
            }

            currentPermission.push(token.value);
        }

        if (currentPermission.length) {
            permissions.push(currentPermission.join(" "));
        }

        let securableClass: string | undefined;
        let securable: IdentifierNode | null | undefined;
        let principal: IdentifierNode | null | undefined;
        let asPrincipal: IdentifierNode | null | undefined;

        try {
            if (!this.peekKeyword("ON")) {
                throw new Error(`Expected ON in ${action}`);
            }
            this.consume();

            const classParts: string[] = [];
            while (this.peek()) {
                const token = this.peek()!;
                if (token.value.toUpperCase() === "TO") {
                    break;
                }

                if (token.value === "::") {
                    this.consume();
                    endOffset = token.offset + token.value.length;
                    break;
                }

                classParts.push(this.consume().value);
                endOffset = token.offset + token.value.length;
            }

            if (classParts.length) {
                securableClass = classParts.join(" ").trim();
            }

            const securableExpr = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });
            securable = securableExpr.type === "Identifier" ? securableExpr : null;
            endOffset = this.lastConsumedEnd();

            this.matchKeyword("TO");

            const principalExpr = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });
            principal = principalExpr.type === "Identifier" ? principalExpr : null;
            endOffset = this.lastConsumedEnd();

            if (this.peekKeyword("AS")) {
                this.consume();
                const asExpr = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });
                asPrincipal = asExpr.type === "Identifier" ? asExpr : null;
                endOffset = this.lastConsumedEnd();
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_PERMISSION",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        return {
            type: "PermissionStatement",
            action,
            permissions,
            ...(securableClass ? { securableClass } : {}),
            ...(securable !== undefined ? { securable } : {}),
            ...(principal !== undefined ? { principal } : {}),
            ...(asPrincipal !== undefined ? { asPrincipal } : {}),
            start: actionToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseDeclare(): DeclareNode {
        const startToken = this.matchKeyword("DECLARE");

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        let variables: VariableDeclaration[] = [];

        try {
            variables = this.parseList<VariableDeclaration>(() => {
                const declStart = this.peek()?.offset ?? endOffset;

                let name = "";
                let dataType = "";

                let columns: ColumnDefinition[] | undefined;

                let constraints: ConstraintNode[] | undefined;

                let initialValue: Expression | undefined;

                // 1) variable name
                try {
                    const nameToken = this.match(TokenType.Variable);

                    name = nameToken.value;

                    endOffset = nameToken.offset + nameToken.value.length;
                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_DECLARE_NAME",
                        e instanceof Error ? e.message : String(e),
                        declStart,
                        endOffset,
                    );

                    this.recoverToStatementBoundary([","]);
                }

                //optional AS
                //
                // T-SQL supports:
                //
                // DECLARE @X INT
                // DECLARE @X AS INT
                if (this.peekKeyword("AS")) {
                    const asToken = this.consume();

                    endOffset = asToken.offset + asToken.value.length;
                }

                // 2) TABLE variable
                if (this.peekKeyword("TABLE")) {
                    const tableToken = this.consume();

                    dataType = "TABLE";

                    endOffset = tableToken.offset + tableToken.value.length;

                    try {
                        const tableDef = this.parseTableColumns();

                        columns = tableDef.columns;

                        constraints = tableDef.constraints;

                        // IMPORTANT:
                        // propagate child recoverability
                        if (tableDef.incomplete) {
                            incomplete = true;
                        }

                        endOffset = this.lastConsumedEnd();
                    } catch (e) {
                        columns = [];
                        constraints = [];

                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_DECLARE_TABLE_COLUMNS",
                            e instanceof Error ? e.message : String(e),
                            tableToken.offset,
                            endOffset,
                        );

                        // IMPORTANT:
                        // avoid swallowing next statement
                        this.recoverToStatementBoundary([")"]);

                        endOffset = this.lastConsumedEnd();
                    }

                    return {
                        name,
                        dataType,
                        columns,
                        ...(constraints?.length ? { constraints } : {}),
                        start: declStart,
                        end: endOffset,
                    };
                }

                // 3) scalar datatype

                // 4) scalar datatype
                try {
                    const next = this.peek();

                    if (
                        next &&
                        next.type !== TokenType.Comma &&
                        next.type !== TokenType.Semicolon &&
                        next.value !== "=" &&
                        !RESYNC_KEYWORDS.has(next.value)
                    ) {
                        dataType = this.parseDataType();

                        endOffset = this.lastConsumedEnd();
                    } else if (name) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_DECLARE_DATATYPE",
                            "Expected datatype",
                            declStart,
                            endOffset,
                        );
                    }
                } catch (e) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_DECLARE_DATATYPE",
                        e instanceof Error ? e.message : String(e),
                        declStart,
                        endOffset,
                    );

                    this.recoverToStatementBoundary([","]);

                    endOffset = this.lastConsumedEnd();
                }

                // 4) initializer
                if (this.peek()?.value === "=") {
                    const eqToken = this.consume();

                    endOffset = eqToken.offset + eqToken.value.length;

                    try {
                        const next = this.peek();

                        if (
                            next &&
                            next.type !== TokenType.Comma &&
                            next.type !== TokenType.Semicolon &&
                            !RESYNC_KEYWORDS.has(next.value)
                        ) {
                            initialValue = this.parseExpression();

                            endOffset = initialValue.end;
                        } else {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                "PARSE_DECLARE_INITIALIZER",
                                "Expected expression",
                                eqToken.offset,
                                endOffset,
                            );

                            this.recoverToStatementBoundary([","]);
                        }
                    } catch (e) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_DECLARE_INITIALIZER",
                            e instanceof Error ? e.message : String(e),
                            eqToken.offset,
                            endOffset,
                        );

                        // CRITICAL:
                        // prevent swallowing next statement
                        this.recoverToStatementBoundary([","]);

                        endOffset = this.lastConsumedEnd();
                    }
                }

                return {
                    name,
                    dataType,
                    ...(initialValue ? { initialValue } : {}),
                    start: declStart,
                    end: endOffset,
                };
            });

            if (variables.length === 0) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DECLARE_EMPTY",
                    "Expected variable declaration",
                    startToken.offset,
                    endOffset,
                );
            }
        } catch (e) {
            variables = [];

            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_DECLARE",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );

            this.recoverToStatementBoundary();
        }

        return {
            type: "DeclareStatement",
            variables,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parsePrint(): PrintNode {
        const printToken = this.matchKeyword("PRINT");

        let value: Expression | null = null;
        let endOffset = printToken.offset + printToken.value.length;

        let incomplete = false;
        const errors: string[] = [];

        try {
            const next = this.peek();

            if (
                !next ||
                next.type === TokenType.Semicolon ||
                this.isStructuralKeyword(next.value)
            ) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_PRINT_EXPRESSION",
                    "Expected PRINT expression",
                    printToken.offset,
                    endOffset,
                );
            } else {
                value = this.parseExpression();

                if (value) {
                    endOffset = value.end;
                }
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_PRINT_EXPRESSION",
                e instanceof Error ? e.message : String(e),
                printToken.offset,
                endOffset,
            );
        }

        return {
            type: "PrintStatement",
            value,
            start: printToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseSet(): SetNode {
        const startToken = this.matchKeyword("SET");

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        let variable = "";
        let variableStart = endOffset;
        let variableEnd = endOffset;

        let value: Expression | null = null;
        let cursorQuery: QueryStatement | undefined;

        const first = this.peek();

        // CASE 1: Variable assignment — SET @x = expr
        if (first?.type === TokenType.Variable) {
            const variableToken = this.consume();

            variable = variableToken.value;
            variableStart = variableToken.offset;
            variableEnd = variableToken.offset + variableToken.value.length;

            endOffset = variableEnd;

            const assignmentToken = this.peek();
            const isSimpleAssignment = assignmentToken?.value === "=";
            const isCompoundAssignment =
                !!assignmentToken?.value &&
                this.getCompoundAssignmentBinaryOperator(assignmentToken.value) !== null;

            if (isSimpleAssignment || isCompoundAssignment) {
                const eqToken = this.consume();
                endOffset = eqToken.offset + eqToken.value.length;

                // Cursor variable assignment: SET @c = CURSOR FOR <query>
                // (as opposed to a named cursor: DECLARE c CURSOR FOR ...)
                if (this.peekKeyword("CURSOR")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();

                    if (this.peekKeyword("FOR")) {
                        this.consume();
                        endOffset = this.lastConsumedEnd();

                        try {
                            cursorQuery = this.parseQueryExpression();
                            endOffset = cursorQuery.end;
                        } catch (e) {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                "PARSE_SET_CURSOR_QUERY",
                                e instanceof Error ? e.message : String(e),
                                endOffset,
                                endOffset,
                            );
                        }
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_SET_CURSOR_FOR",
                            "Expected FOR query in cursor assignment",
                            endOffset,
                            endOffset,
                        );
                    }
                } else {
                    try {
                        const next = this.peek();

                        if (
                            next &&
                            next.type !== TokenType.Semicolon &&
                            next.type !== TokenType.Comma &&
                            this.canStartExpressionToken(next)
                        ) {
                            const parsedValue = this.parseExpression();
                            value = isCompoundAssignment
                                ? this.buildCompoundAssignmentExpression(
                                      {
                                          type: "Variable",
                                          name: variable,
                                          start: variableStart,
                                          end: variableEnd,
                                      },
                                      eqToken,
                                      parsedValue,
                                  )
                                : parsedValue;

                            if (value) {
                                endOffset = value.end;
                            }
                        } else {
                            incomplete = true;

                            this.addRecoverableError(
                                errors,
                                "PARSE_SET_EXPRESSION",
                                "Expected expression",
                                eqToken.offset,
                                endOffset,
                            );
                        }
                    } catch (e) {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_SET_EXPRESSION",
                            e instanceof Error ? e.message : String(e),
                            eqToken.offset,
                            endOffset,
                        );
                    }
                }
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SET_EQUALS",
                    "Expected = or compound assignment operator",
                    variableEnd,
                    variableEnd,
                );
            }
        }

        // CASE 2: Session option — SET NOCOUNT ON, SET ANSI_NULLS ON,
        //         SET TRANSACTION ISOLATION LEVEL READ COMMITTED, etc.
        //
        // These statements end with ON or OFF, both of which are keywords.
        // ON is in STRUCTURAL_KEYWORDS (needed for JOIN alias detection) so
        // the normal structural-keyword break would fire prematurely on
        // SET NOCOUNT ON, cutting off the ON before it is consumed.
        //
        // Fix: exempt ON and OFF from the structural-keyword break so they
        // are treated as terminal session option values rather than
        // statement boundaries.
        else {
            const SESSION_OPTION_TERMINALS = new Set(["ON", "OFF"]);
            const SESSION_OPTION_STATEMENT_STARTERS = new Set([
                "SELECT",
                "UPDATE",
                "DELETE",
                "INSERT",
                "MERGE",
                "CREATE",
                "ALTER",
                "DROP",
                "TRUNCATE",
                "BEGIN",
                "IF",
                "WHILE",
                "SET",
                "DECLARE",
                "EXEC",
                "EXECUTE",
                "RETURN",
                "PRINT",
                "RAISERROR",
                "THROW",
                "WITH",
                "GO",
            ]);

            const parts: string[] = [];
            let firstToken: Token | null = null;
            let lastToken: Token | null = null;

            while (this.peek()) {
                const token = this.peek()!;

                // Hard stops — always terminate the session option
                if (token.type === TokenType.Semicolon || token.type === TokenType.Comma) {
                    break;
                }

                // Parenthesized queries can follow session-option SET forms
                // like `SET ROWCOUNT @n (SELECT ...)`. Do not absorb the
                // opening wrapper into the SET statement.
                if (parts.length > 0 && token.type === TokenType.OpenParen) {
                    break;
                }

                // Structural keywords terminate the option, EXCEPT for ON
                // and OFF which are valid terminal values in session options.
                // Only apply this stop after at least one token has been
                // consumed — prevents an empty variable if the first token
                // happens to be structural.
                if (
                    parts.length > 0 &&
                    token.type === TokenType.Keyword &&
                    ((this.isStructuralKeyword(token.value) &&
                        !SESSION_OPTION_TERMINALS.has(token.value)) ||
                        SESSION_OPTION_STATEMENT_STARTERS.has(token.value))
                ) {
                    break;
                }

                const consumed = this.consume();

                if (!firstToken) {
                    firstToken = consumed;
                }

                lastToken = consumed;
                parts.push(consumed.value);
                endOffset = this.lastConsumedEnd();

                // ON and OFF always end a session option — stop after
                // consuming them so we don't accidentally absorb the next
                // statement's first keyword.
                if (SESSION_OPTION_TERMINALS.has(consumed.value)) {
                    break;
                }
            }

            variable = parts.join(" ").trim();

            if (firstToken && lastToken) {
                variableStart = firstToken.offset;
                variableEnd = lastToken.offset + lastToken.value.length;
            }

            if (!variable) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_SET_TARGET",
                    "Expected SET target",
                    startToken.offset,
                    endOffset,
                );
            }
        }

        return {
            type: "SetStatement",
            variable,
            variableStart,
            variableEnd,
            value,
            ...(cursorQuery ? { cursorQuery } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    /**
     * Parses a comma-separated list of column definitions enclosed in parentheses.
     * Shared by CREATE TABLE and CREATE TYPE ... AS TABLE.
     */

    protected parseReturn(): ReturnNode {
        const start = this.matchKeyword("RETURN");

        let value: Expression | null = null;
        let query: Statement | null = null;
        let end = start.offset + start.value.length;

        // RETURN (SELECT ...) / RETURN (WITH ... SELECT ...)
        if (
            this.peek()?.type === TokenType.OpenParen &&
            (this.peek(1)?.value?.toUpperCase() === "SELECT" ||
                this.peek(1)?.value?.toUpperCase() === "WITH")
        ) {
            this.consume(); // (

            query = this.peekKeyword("WITH") ? this.parseWith() : this.parseQueryExpression();

            end = query.end;

            if (this.peek()?.type === TokenType.CloseParen) {
                const close = this.consume();
                end = close.offset + close.value.length;
            }

            return {
                type: "ReturnStatement",
                ...(query ? { query } : {}),
                start: start.offset,
                end,
            };
        }

        if (
            this.peek() &&
            this.peek()!.type !== TokenType.Semicolon &&
            !this.isStructuralKeyword(this.peek()!.value) &&
            !RESYNC_KEYWORDS.has(this.peek()!.value)
        ) {
            value = this.parseExpression();
            end = value.end;
        }

        return {
            type: "ReturnStatement",
            value,
            start: start.offset,
            end,
        };
    }

    protected parseRaiseError(): RaiseErrorNode {
        const startToken = this.matchKeyword("RAISERROR");

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        const args: Expression[] = [];
        let options: string[] | undefined;

        let sawCloseParen = false;

        // --------------------------------------------------
        // 1) Opening (
        // --------------------------------------------------
        if (this.peek()?.type !== TokenType.OpenParen) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_RAISERROR_OPEN",
                "Expected ( after RAISERROR",
                endOffset,
                endOffset,
            );

            return {
                type: "RaiseErrorStatement",
                args,
                start: startToken.offset,
                end: endOffset,
                ...(incomplete ? { incomplete: true } : {}),
                ...(errors.length ? { errors } : {}),
            };
        }

        this.consume(); // (
        endOffset = this.lastConsumedEnd();

        // --------------------------------------------------
        // 2) Argument list
        // --------------------------------------------------
        try {
            while (this.peek()) {
                const token = this.peek()!;

                // end of arg list
                if (token.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                    sawCloseParen = true;
                    break;
                }

                // separator
                if (token.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                // parse arg
                const expr = this.parseExpression();
                args.push(expr);
                endOffset = expr.end;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_RAISERROR_ARGS",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );

            this.recoverTo(["WITH", ";"]);
        }

        // IMPORTANT:
        // Missing ) must also be detected at EOF.
        if (!sawCloseParen) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_RAISERROR_CLOSE",
                "Expected ) after RAISERROR arguments",
                endOffset,
                endOffset,
            );
        }

        // --------------------------------------------------
        // 3) WITH options
        // --------------------------------------------------
        if (this.peekKeyword("WITH")) {
            this.consume();
            endOffset = this.lastConsumedEnd();

            options = [];

            while (this.peek()) {
                const token = this.peek()!;

                if (token.type === TokenType.Semicolon) {
                    break;
                }

                if (token.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                if (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value)) {
                    break;
                }

                options.push(token.value);
                this.consume();
                endOffset = this.lastConsumedEnd();
            }

            if (options.length === 0) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_RAISERROR_WITH",
                    "Expected RAISERROR WITH option",
                    endOffset,
                    endOffset,
                );
            }
        }

        return {
            type: "RaiseErrorStatement",
            args,
            ...(options?.length ? { options } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseExecute(): ExecuteNode {
        const startToken = this.peekKeyword("EXECUTE")
            ? this.matchKeyword("EXECUTE")
            : this.matchKeyword("EXEC");

        let incomplete = false;
        const errors: string[] = [];

        let endOffset = startToken.offset + startToken.value.length;

        let target: Expression | null = null;
        const args: ExecArgument[] = [];

        try {
            // --------------------------------------------------
            // 1) target
            // --------------------------------------------------
            if (!this.peek()) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_EXEC_TARGET",
                    "Expected EXEC target",
                    endOffset,
                    endOffset,
                );
            } else if (this.peek()!.type === TokenType.OpenParen) {
                // EXEC(@sql)
                this.consume(); // (
                endOffset = this.lastConsumedEnd();

                if (!this.peek()) {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_EXEC_EXPR",
                        "Expected expression inside EXEC(...)",
                        endOffset,
                        endOffset,
                    );
                } else {
                    target = this.parseExpression();
                    endOffset = target.end;
                }

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;

                    this.addRecoverableError(
                        errors,
                        "PARSE_EXEC_CLOSE",
                        "Expected ) after EXEC expression",
                        endOffset,
                        endOffset,
                    );
                }
            } else {
                // EXEC dbo.proc
                // EXEC @proc
                // EXEC sp_executesql
                target = this.parseExpression();
                endOffset = target.end;
            }

            // --------------------------------------------------
            // 2) args
            // --------------------------------------------------
            while (this.peek()) {
                const token = this.peek()!;

                // separators / boundaries
                if (token.type === TokenType.Semicolon) {
                    break;
                }

                if (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value)) {
                    break;
                }

                if (token.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                // named argument:
                // EXEC proc @Id = 1
                if (this.isExecNamedArg()) {
                    const name = this.consume().value; // variable
                    this.consume(); // =

                    let value: Expression | null = null;
                    let isOutput = false;

                    if (this.peek()) {
                        value = this.parseExpression();
                        endOffset = value.end;

                        while (this.peekKeyword("OUTPUT") || this.peekKeyword("OUT")) {
                            isOutput = true;
                            this.consume();
                            endOffset = this.lastConsumedEnd();
                        }
                    } else {
                        incomplete = true;

                        this.addRecoverableError(
                            errors,
                            "PARSE_EXEC_ARG",
                            `Expected value for ${name}`,
                            endOffset,
                            endOffset,
                        );
                    }

                    args.push({
                        name,
                        value,
                        ...(isOutput ? { isOutput: true } : {}),
                    });

                    continue;
                }

                // positional:
                // EXEC proc 1, 'abc'
                const value = this.parseExpression();
                let isOutput = false;

                while (this.peekKeyword("OUTPUT") || this.peekKeyword("OUT")) {
                    isOutput = true;
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                }

                args.push({
                    value,
                    ...(isOutput ? { isOutput: true } : {}),
                });
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_EXEC",
                e instanceof Error ? e.message : String(e),
                endOffset,
                endOffset,
            );

            this.recoverTo([";"]);
        }

        return {
            type: "ExecuteStatement",
            target,
            args,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected isExecNamedArg(): boolean {
        const current = this.peek();
        const next = this.peek(1);

        if (!current || !next) {
            return false;
        }

        return (
            current.type === TokenType.Variable &&
            next.type === TokenType.Operator &&
            next.value === "="
        );
    }

    protected parseWaitFor(): WaitForNode {
        const startToken = this.matchKeyword("WAITFOR");
        let incomplete = false;
        const errors: string[] = [];
        let kind: "TIME" | "DELAY" | null = null;
        let value: Expression | null = null;
        let endOffset = startToken.offset + startToken.value.length;

        if (this.peekKeyword("TIME")) {
            this.consume();
            kind = "TIME";
            endOffset = this.lastConsumedEnd();
        } else if (this.peekKeyword("DELAY")) {
            this.consume();
            kind = "DELAY";
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_WAITFOR_KIND",
                "Expected TIME or DELAY after WAITFOR",
                endOffset,
                endOffset,
            );
        }

        if (kind) {
            try {
                if (
                    this.peek() &&
                    this.peek()?.type !== TokenType.Semicolon &&
                    !(
                        this.peek()?.type === TokenType.Keyword &&
                        RESYNC_KEYWORDS.has(this.peek()!.value)
                    )
                ) {
                    value = this.parseExpression();
                    endOffset = value.end;
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_WAITFOR_VALUE",
                        `Expected ${kind} value after WAITFOR ${kind}`,
                        endOffset,
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_WAITFOR_VALUE",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                    endOffset,
                );
            }
        }

        return {
            type: "WaitForStatement",
            kind,
            value,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseTruncate(): TruncateNode {
        const startToken = this.matchKeyword("TRUNCATE");
        this.matchKeyword("TABLE");
        const table = this.parseMultipartIdentifier() as IdentifierNode;

        return {
            type: "TruncateStatement",
            table,
            start: startToken.offset,
            end: table.end,
        };
    }
}
