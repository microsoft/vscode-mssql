/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";

import {
    type Statement,
    type CreateNode,
    type ConstraintNode,
    type CreateIndexNode,
    type TableIndexNode,
    type IndexColumnNode,
    type IndexOptionNode,
    type StorageTargetNode,
    type Expression,
    type IdentifierNode,
    type ColumnDefinition,
    type ParameterDefinition,
} from "../ast/types.js";

import { CREATE_OBJECT_TYPES, Precedence, RESYNC_KEYWORDS } from "./grammar.js";

import { ControlFlowParser } from "./controlFlowParser.js";

export abstract class CreateParser extends ControlFlowParser {
    protected skipCreatePreambleUntil(stopKeywords: string[]): number {
        let endOffset = this.lastConsumedEnd();

        const stopSet = new Set(stopKeywords.map((x) => x.toUpperCase()));

        let previousKeyword: string | null = null;

        while (this.peek()) {
            const token = this.peek()!;

            if (token.type === TokenType.Keyword) {
                const upper = token.value.toUpperCase();

                if (stopSet.has(upper) && !(upper === "AS" && previousKeyword === "EXECUTE")) {
                    break;
                }

                previousKeyword = upper;
            } else {
                previousKeyword = null;
            }

            const consumed = this.consume();

            endOffset = consumed.offset + consumed.value.length;
        }

        return endOffset;
    }

    protected parseTableColumns(): {
        columns: ColumnDefinition[];
        constraints: ConstraintNode[];
        indexes: TableIndexNode[];
        incomplete?: boolean;
    } {
        this.match(TokenType.OpenParen);

        const columns: ColumnDefinition[] = [];
        const constraints: ConstraintNode[] = [];
        const indexes: TableIndexNode[] = [];

        let incomplete = false;
        let nextTableConstraintMissingComma = false;

        while (this.peek()) {
            const token = this.peek()!;

            // recovery boundary
            if (token.type === TokenType.Semicolon) {
                incomplete = true;
                break;
            }

            // proper close
            if (token.type === TokenType.CloseParen) {
                break;
            }

            const value = token.value;

            try {
                // table-level constraint
                if (
                    value === "CONSTRAINT" ||
                    value === "PRIMARY" ||
                    value === "FOREIGN" ||
                    value === "UNIQUE" ||
                    value === "CHECK"
                ) {
                    const constraint = this.parseConstraint();

                    if (nextTableConstraintMissingComma) {
                        constraint.missingLeadingComma = true;
                        nextTableConstraintMissingComma = false;
                    }

                    constraints.push(constraint);

                    if (this.peek()?.type === TokenType.Comma) {
                        this.consume();
                    }

                    continue;
                }

                if (
                    value === "INDEX" ||
                    (value === "UNIQUE" && this.peek(1)?.value?.toUpperCase() === "INDEX")
                ) {
                    indexes.push(this.parseInlineTableIndex());

                    if (this.peek()?.type === TokenType.Comma) {
                        this.consume();
                    }

                    continue;
                }

                // column name
                const startToken = this.peek()!;

                const nameExpr = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });

                if (nameExpr.type !== "Identifier") {
                    incomplete = true;

                    throw new Error(
                        "Wildcards are not allowed as column names in table definitions",
                    );
                }

                const name = nameExpr.name;

                if (this.peekKeyword("AS")) {
                    const computed = this.parseComputedColumnTail();

                    columns.push({
                        name,
                        ...computed,
                        start: startToken.offset,
                        end: this.lastConsumedEnd(),
                    });

                    if (this.peek()?.type === TokenType.Comma) {
                        this.consume();
                    }

                    continue;
                }

                // datatype
                let dataType = "";
                let parenDepth = 0;

                while (this.peek()) {
                    const next = this.peek()!;
                    const nextVal = next.value;

                    if (parenDepth === 0) {
                        if (
                            next.type === TokenType.Semicolon ||
                            (next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value))
                        ) {
                            incomplete = true;
                            break;
                        }

                        if (next.type === TokenType.Comma || next.type === TokenType.CloseParen) {
                            break;
                        }

                        if (
                            nextVal === "CONSTRAINT" ||
                            nextVal === "PRIMARY" ||
                            nextVal === "FOREIGN" ||
                            nextVal === "UNIQUE" ||
                            nextVal === "CHECK" ||
                            nextVal === "DEFAULT" ||
                            nextVal === "NOT" ||
                            nextVal === "NULL" ||
                            nextVal === "REFERENCES" ||
                            nextVal === "IDENTITY"
                        ) {
                            break;
                        }
                    }

                    if (next.type === TokenType.OpenParen) {
                        parenDepth++;
                    }

                    dataType += this.consume().value;

                    if (next.type === TokenType.CloseParen) {
                        parenDepth--;
                    }
                }

                // missing datatype
                if (!dataType.trim()) {
                    incomplete = true;
                }

                // inline constraints
                const columnConstraints: ConstraintNode[] = [];

                while (this.peek()) {
                    const next = this.peek()!;
                    const nextVal = next.value;

                    if (
                        next.type === TokenType.Comma ||
                        next.type === TokenType.CloseParen ||
                        next.type === TokenType.Semicolon ||
                        nextVal === "INDEX" ||
                        (nextVal === "UNIQUE" && this.peek(1)?.value?.toUpperCase() === "INDEX") ||
                        (next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value))
                    ) {
                        break;
                    }

                    if (
                        nextVal === "CONSTRAINT" ||
                        nextVal === "PRIMARY" ||
                        nextVal === "FOREIGN" ||
                        nextVal === "UNIQUE" ||
                        nextVal === "CHECK" ||
                        nextVal === "DEFAULT" ||
                        nextVal === "NOT" ||
                        nextVal === "NULL" ||
                        nextVal === "REFERENCES" ||
                        nextVal === "IDENTITY"
                    ) {
                        if (this.looksLikeTableConstraintAfterColumn()) {
                            nextTableConstraintMissingComma = true;
                            break;
                        }

                        const constraint = this.parseConstraint(name);

                        columnConstraints.push(constraint);

                        if (constraint.incomplete) {
                            incomplete = true;
                        }

                        if (
                            this.peek()?.type === TokenType.Comma ||
                            this.peek()?.type === TokenType.CloseParen
                        ) {
                            break;
                        }

                        continue;
                    }

                    incomplete = true;
                    this.consume();
                }

                columns.push({
                    name,
                    dataType,
                    ...(columnConstraints.length
                        ? {
                              constraints: columnConstraints,
                          }
                        : {}),
                    start: startToken.offset,
                    end: this.lastConsumedEnd(),
                });

                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();
                }
            } catch {
                incomplete = true;

                this.resyncToBoundary(this.isTableDefinitionRecoveryBoundary.bind(this));

                if (this.peek()?.type === TokenType.Comma) {
                    this.consume();
                    continue;
                }

                if (this.peek() && !this.isTableDefinitionRecoveryBoundary(this.peek())) {
                    continue;
                }

                break;
            }
        }

        // missing closing paren
        if (this.peek()?.type === TokenType.CloseParen) {
            this.consume();
        } else {
            incomplete = true;
        }

        return {
            columns,
            constraints,
            indexes,
            ...(incomplete ? { incomplete: true } : {}),
        };
    }

    protected parseInlineTableIndex(): TableIndexNode {
        const startToken = this.peek()!;
        let unique = false;
        let clustered: TableIndexNode["clustered"] = null;

        if (this.peek()?.value?.toUpperCase() === "UNIQUE") {
            this.consume();
            unique = true;
        }

        this.matchKeyword("INDEX");

        let nameNode: IdentifierNode | null = null;
        const nameExpr = this.parseMultipartIdentifier(undefined, {
            allowStructuralFirstSegment: true,
        });

        if (nameExpr.type === "Identifier") {
            nameNode = nameExpr;
        } else {
            throw new Error("Expected inline table index name");
        }

        if (this.peek()?.value?.toUpperCase() === "CLUSTERED") {
            this.consume();
            clustered = "CLUSTERED";
        } else if (this.peek()?.value?.toUpperCase() === "NONCLUSTERED") {
            this.consume();
            clustered = "NONCLUSTERED";
        }

        this.match(TokenType.OpenParen);

        const columns = this.parseList<IndexColumnNode>(() => {
            const start = this.peek()!;
            const columnExpr = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });

            if (columnExpr.type !== "Identifier") {
                throw new Error("Expected index column name");
            }

            let direction: "ASC" | "DESC" = "ASC";
            const dir = this.peek()?.value?.toUpperCase();
            if (dir === "ASC" || dir === "DESC") {
                this.consume();
                direction = dir;
            }

            return {
                type: "IndexColumn",
                name: columnExpr.name,
                nameNode: columnExpr,
                direction,
                start: start.offset,
                end: this.lastConsumedEnd(),
            };
        });

        this.match(TokenType.CloseParen);

        return {
            type: "TableIndexDefinition",
            unique,
            clustered,
            name: nameNode.name,
            nameNode,
            columns,
            start: startToken.offset,
            end: this.lastConsumedEnd(),
        };
    }

    protected parseStorageTarget(): StorageTargetNode {
        const start = this.peek()?.offset ?? this.lastConsumedEnd();
        const first = this.peek();

        if (!first) {
            throw new Error("Expected storage target");
        }

        if (first.value.toUpperCase() === "DEFAULT") {
            const token = this.consume();
            return {
                type: "StorageTarget",
                kind: "DEFAULT",
                start: token.offset,
                end: token.offset + token.value.length,
            };
        }

        const nameExpr = this.parseMultipartIdentifier(undefined, {
            allowStructuralFirstSegment: true,
        });

        if (nameExpr.type !== "Identifier") {
            throw new Error("Expected filegroup or partition scheme name");
        }

        if (this.peek()?.type === TokenType.OpenParen) {
            this.consume();

            const columnExpr = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });

            if (columnExpr.type !== "Identifier") {
                throw new Error("Expected partition column name");
            }

            if (this.peek()?.type !== TokenType.CloseParen) {
                throw new Error("Expected ) after partition scheme column");
            }

            this.consume();

            return {
                type: "StorageTarget",
                kind: "PARTITION_SCHEME",
                name: nameExpr.name,
                nameNode: nameExpr,
                partitionColumn: columnExpr,
                start,
                end: this.lastConsumedEnd(),
            };
        }

        return {
            type: "StorageTarget",
            kind: "FILEGROUP",
            name: nameExpr.name,
            nameNode: nameExpr,
            start,
            end: nameExpr.end,
        };
    }

    protected parsePartitionSchemeFilegroups(): {
        allTo?: boolean;
        filegroups: IdentifierNode[];
    } {
        let allTo = false;

        if (this.peek()?.value?.toUpperCase() === "ALL") {
            this.consume();
            allTo = true;
        }

        const toToken = this.peek();
        if (!toToken || toToken.value.toUpperCase() !== "TO") {
            throw new Error("Expected TO in PARTITION SCHEME");
        }
        this.consume();

        if (this.peek()?.type !== TokenType.OpenParen) {
            throw new Error("Expected ( after TO in PARTITION SCHEME");
        }
        this.consume();

        const filegroups = this.parseList<IdentifierNode>(() => {
            const filegroup = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });

            if (filegroup.type !== "Identifier") {
                throw new Error("Expected filegroup name");
            }

            return filegroup;
        });

        if (this.peek()?.type !== TokenType.CloseParen) {
            throw new Error("Expected ) after PARTITION SCHEME filegroups");
        }
        this.consume();

        return {
            ...(allTo ? { allTo: true } : {}),
            filegroups,
        };
    }

    protected parseCreate(orAlter: boolean = false): CreateNode {
        // For standalone ALTER: consume ALTER keyword as the start token.
        // For CREATE and CREATE OR ALTER: consume CREATE keyword.
        const startToken = orAlter ? this.matchKeyword("ALTER") : this.matchKeyword("CREATE");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        // Detect CREATE OR ALTER
        if (!orAlter && this.peekKeyword("OR")) {
            const orToken = this.consume();

            if (this.peekKeyword("ALTER")) {
                this.consume();
                orAlter = true;

                endOffset =
                    this.tokens[this.pos - 1].offset + this.tokens[this.pos - 1].value.length;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_OR_ALTER",
                    "Expected ALTER after OR in CREATE OR ALTER",
                    orToken.offset,
                    orToken.offset + orToken.value.length,
                );
            }
        }

        // Divert to index parser before consuming object type token
        // Handles: CREATE [UNIQUE] [CLUSTERED|NONCLUSTERED] INDEX
        if (!orAlter) {
            const t0 = this.peek()?.value?.toUpperCase();
            const t1 = this.peek(1)?.value?.toUpperCase();
            const t2 = this.peek(2)?.value?.toUpperCase();

            const isIndex =
                t0 === "INDEX" ||
                (t0 === "UNIQUE" &&
                    (t1 === "INDEX" || t1 === "CLUSTERED" || t1 === "NONCLUSTERED")) ||
                ((t0 === "CLUSTERED" || t0 === "NONCLUSTERED") && t1 === "INDEX") ||
                (t0 === "UNIQUE" &&
                    (t1 === "CLUSTERED" || t1 === "NONCLUSTERED") &&
                    t2 === "INDEX");

            if (isIndex) {
                return this.parseCreateIndex(startToken) as unknown as CreateNode;
            }
        }

        // 1. Object type
        let objectType: CreateNode["objectType"] = "TABLE";
        let unsupportedObjectType: string | undefined;

        try {
            const typeToken = this.consume();
            const rawType = typeToken.value.toUpperCase();

            if (rawType === "PARTITION") {
                const subtypeToken = this.consume();
                const subtype = subtypeToken.value.toUpperCase();

                if (subtype === "FUNCTION") {
                    objectType = "PARTITION_FUNCTION";
                } else if (subtype === "SCHEME") {
                    objectType = "PARTITION_SCHEME";
                } else {
                    incomplete = true;
                    unsupportedObjectType = `PARTITION ${subtype}`;

                    this.addRecoverableError(
                        errors,
                        "PARSE_CREATE_TYPE",
                        `Unsupported CREATE PARTITION subtype: ${subtype}`,
                        subtypeToken.offset,
                        subtypeToken.offset + subtypeToken.value.length,
                    );
                }

                endOffset = subtypeToken.offset + subtypeToken.value.length;
            } else {
                const mapped = CREATE_OBJECT_TYPES[rawType as keyof typeof CREATE_OBJECT_TYPES];

                // DATABASE SCOPED CREDENTIAL is a different object from DATABASE; without this
                // it parsed as a database named SCOPED and left CREDENTIAL dangling.
                const scoped =
                    rawType === "DATABASE" && this.peek()?.value?.toUpperCase() === "SCOPED";

                if (mapped && !scoped) {
                    objectType = mapped;
                } else {
                    incomplete = true;
                    unsupportedObjectType = scoped ? "DATABASE SCOPED" : rawType;

                    this.addRecoverableError(
                        errors,
                        "PARSE_CREATE_TYPE",
                        `Unsupported CREATE object type: ${unsupportedObjectType}`,
                        typeToken.offset,
                        typeToken.offset + typeToken.value.length,
                    );
                }

                endOffset = typeToken.offset + typeToken.value.length;
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_CREATE_TYPE",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );
        }

        if (unsupportedObjectType) {
            // Continuing would read the next token as the object's name and emit it as a real
            // CREATE TABLE, so `CREATE DATABASE SCOPED CREDENTIAL [sa]` declared a table named
            // SCOPED and then failed again on the missing column list.
            this.skipToStatementTerminator();
            return {
                type: "CreateStatement",
                objectType,
                unsupportedObjectType,
                orAlter,
                name: "",
                nameNode: {
                    type: "Identifier",
                    name: "",
                    parts: [],
                    start: endOffset,
                    end: endOffset,
                },
                start: startToken.offset,
                end: this.lastConsumedEnd(),
                incomplete: true,
                errors,
            };
        }

        // 2. Name
        let name = "";

        let nameNode: IdentifierNode = {
            type: "Identifier",
            name: "",
            parts: [],
            start: endOffset,
            end: endOffset,
        };

        try {
            const nameExpr = this.parseMultipartIdentifier();

            if (nameExpr.type === "Identifier") {
                name = nameExpr.name;
                nameNode = nameExpr;
                endOffset = nameExpr.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_NAME",
                    `Wildcards are not allowed as names for ${objectType} definitions`,
                    nameExpr.start,
                    nameExpr.end,
                );
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_CREATE_NAME",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // body pieces
        let columns: ColumnDefinition[] | undefined;
        let constraints: ConstraintNode[] | undefined;
        let indexes: TableIndexNode[] | undefined;
        let parameters: ParameterDefinition[] | undefined;
        let returnVariable: string | undefined;
        let returnColumns: ColumnDefinition[] | undefined;
        let body: Statement | Statement[] | undefined;
        let isTableType: boolean | undefined;
        let storage: StorageTargetNode | undefined;
        let textImageOn: StorageTargetNode | undefined;
        let partitionRange: "LEFT" | "RIGHT" | undefined;
        let partitionInputType: string | undefined;
        let boundaryValues: Expression[] | undefined;
        let partitionFunction: IdentifierNode | undefined;
        let filegroups: IdentifierNode[] | undefined;
        let allTo: boolean | undefined;

        // 3. TYPE
        if (objectType === "TYPE") {
            try {
                if (this.peekKeyword("AS")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();

                    if (this.peekKeyword("TABLE")) {
                        this.consume();
                        endOffset = this.lastConsumedEnd();

                        const tableDef = this.parseTableColumns();

                        if (tableDef.incomplete || tableDef.columns.length === 0) {
                            incomplete = true;
                        }

                        columns = tableDef.columns;
                        constraints = tableDef.constraints;
                        indexes = tableDef.indexes;

                        isTableType = true;
                        endOffset = this.lastConsumedEnd();
                    }
                }
            } catch (e) {
                incomplete = true;
                columns = [];
                constraints = [];

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_TYPE_BODY",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 4. TABLE
        else if (objectType === "TABLE") {
            try {
                const tableDef = this.parseTableColumns();

                columns = tableDef.columns;
                constraints = tableDef.constraints;
                indexes = tableDef.indexes;

                endOffset = this.lastConsumedEnd();

                if (this.peek()?.value?.toUpperCase() === "ON") {
                    this.consume();
                    storage = this.parseStorageTarget();
                    endOffset = this.lastConsumedEnd();
                }

                if (this.peek()?.value?.toUpperCase() === "TEXTIMAGE_ON") {
                    this.consume();
                    textImageOn = this.parseStorageTarget();
                    endOffset = this.lastConsumedEnd();
                }
            } catch (e) {
                incomplete = true;
                columns = [];
                constraints = [];
                indexes = [];
                indexes = [];

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_TABLE_COLUMNS",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 5. PROCEDURE / FUNCTION
        else if (
            objectType === "PROCEDURE" ||
            objectType === "FUNCTION" ||
            objectType === "TRIGGER"
        ) {
            // Parameters
            try {
                const hasParens = this.peek()?.type === TokenType.OpenParen;

                if (hasParens) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                }

                if (this.peek()?.type === TokenType.Variable) {
                    parameters = this.parseList<ParameterDefinition>(
                        () => {
                            const paramToken = this.peek()!;

                            const pName = this.consume().value;

                            if (this.peekKeyword("AS")) {
                                this.consume();
                            }

                            const pType = this.parseDataType();

                            let defaultValue: Expression | null = null;

                            let isOutput = false;
                            let isReadOnly = false;

                            // optional default
                            if (
                                this.peek()?.type === TokenType.Operator &&
                                this.peek()?.value === "="
                            ) {
                                this.consume();

                                if (this.peek()) {
                                    defaultValue = this.parseExpression();
                                }
                            }

                            // modifiers
                            while (this.peek()) {
                                const kw = this.peek()!.value.toUpperCase();

                                if (kw === "OUTPUT" || kw === "OUT") {
                                    isOutput = true;
                                    this.consume();
                                    continue;
                                }

                                if (kw === "READONLY") {
                                    isReadOnly = true;
                                    this.consume();
                                    continue;
                                }

                                break;
                            }

                            return {
                                name: pName,
                                dataType: pType,
                                ...(defaultValue !== null ? { defaultValue } : {}),
                                ...(isOutput ? { isOutput: true } : {}),
                                ...(isReadOnly ? { isReadOnly: true } : {}),
                                start: paramToken.offset,
                                end: this.lastConsumedEnd(),
                            };
                        },
                        {
                            isBoundary: this.isParameterListBoundary.bind(this),
                        },
                    );

                    endOffset = this.lastConsumedEnd();
                }

                if (hasParens) {
                    this.match(TokenType.CloseParen);

                    endOffset = this.lastConsumedEnd();
                }
            } catch (e) {
                incomplete = true;
                parameters = [];

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_PARAMETERS",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }

            if (this.peekKeyword("WITH")) {
                endOffset = this.skipCreatePreambleUntil(["AS", "RETURNS", "GO"]);
            }

            if (objectType === "FUNCTION" && this.peekKeyword("RETURNS")) {
                this.consume();
                endOffset = this.lastConsumedEnd();

                // RETURNS @varName TABLE (col_defs...) — multi-statement TVF
                const nextTok = this.peek();
                if (nextTok && nextTok.type === TokenType.Variable) {
                    returnVariable = nextTok.value;
                    this.consume();
                    endOffset = this.lastConsumedEnd();

                    if (this.peekKeyword("TABLE")) {
                        this.consume();
                        endOffset = this.lastConsumedEnd();
                        try {
                            const tableDef = this.parseTableColumns();
                            returnColumns = tableDef.columns;
                            endOffset = this.lastConsumedEnd();
                        } catch {
                            // swallow — return variable is still captured
                        }
                    }
                } else {
                    // RETURNS scalar_type or RETURNS TABLE (inline TVF) — skip
                    endOffset = this.skipCreatePreambleUntil(["AS", "BEGIN", "GO"]);
                }
            }

            if (objectType === "TRIGGER") {
                endOffset = this.skipCreatePreambleUntil(["AS", "GO"]);
            }

            // AS
            if (this.peekKeyword("AS")) {
                this.consume();
                endOffset = this.lastConsumedEnd();
            }

            // Body
            try {
                const statements: Statement[] = [];
                const stopKeywords = ["GO"];

                while (this.pos < this.tokens.length) {
                    const beforePos = this.pos;
                    const nextToken = this.peek();

                    if (!nextToken || stopKeywords.includes(nextToken.value)) {
                        break;
                    }

                    const stmt = this.parseStatement();

                    if (stmt) {
                        statements.push(stmt);
                        endOffset = stmt.end;

                        // A BEGIN...END block is the complete, unambiguous
                        // routine body — nothing can legitimately follow it
                        // without a batch separator (GO), so stop here
                        // rather than swallowing subsequent statements into
                        // this routine's body.
                        if (stmt.type === "BlockStatement") {
                            break;
                        }
                    } else {
                        if (this.pos > beforePos) {
                            continue;
                        }

                        if (this.peek() && !stopKeywords.includes(this.peek()!.value)) {
                            this.consume();
                            continue;
                        }

                        break;
                    }
                }

                body = statements;
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_BODY",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 6. VIEW
        else if (objectType === "VIEW") {
            try {
                if (this.peekKeyword("WITH")) {
                    endOffset = this.skipCreatePreambleUntil(["AS", "GO"]);
                }

                if (this.peekKeyword("AS")) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                }

                const hasParens = this.peek()?.type === TokenType.OpenParen;

                if (hasParens) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                }

                body = this.peekKeyword("WITH") ? this.parseWith() : this.parseQueryExpression();

                endOffset = body.end;

                if (hasParens) {
                    this.match(TokenType.CloseParen);
                    endOffset = this.lastConsumedEnd();
                }
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_VIEW",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        } else if (objectType === "PARTITION_FUNCTION") {
            try {
                if (this.peek()?.type !== TokenType.OpenParen) {
                    throw new Error("Expected ( after partition function name");
                }

                this.consume();
                partitionInputType = this.parseDataTypeName();

                if (this.peek()?.type !== TokenType.CloseParen) {
                    throw new Error("Expected ) after partition function input type");
                }
                this.consume();

                if (!this.peekKeyword("AS")) {
                    throw new Error("Expected AS in PARTITION FUNCTION");
                }
                this.consume();

                const rangeToken = this.peek();
                if (!rangeToken || rangeToken.value.toUpperCase() !== "RANGE") {
                    throw new Error("Expected RANGE in PARTITION FUNCTION");
                }
                this.consume();

                const sideToken = this.peek();
                if (!sideToken) {
                    throw new Error("Expected LEFT or RIGHT in PARTITION FUNCTION");
                }

                const side = sideToken.value.toUpperCase();
                if (side !== "LEFT" && side !== "RIGHT") {
                    throw new Error("Expected LEFT or RIGHT in PARTITION FUNCTION");
                }
                this.consume();
                partitionRange = side;

                if (this.peek()?.value?.toUpperCase() !== "FOR") {
                    throw new Error("Expected FOR in PARTITION FUNCTION");
                }
                this.consume();

                if (this.peek()?.value?.toUpperCase() !== "VALUES") {
                    throw new Error("Expected VALUES in PARTITION FUNCTION");
                }
                this.consume();

                if (this.peek()?.type !== TokenType.OpenParen) {
                    throw new Error("Expected ( after FOR VALUES");
                }
                this.consume();

                boundaryValues = this.parseList<Expression>(() => this.parseExpression());

                if (this.peek()?.type !== TokenType.CloseParen) {
                    throw new Error("Expected ) after partition boundary values");
                }
                this.consume();
                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_PARTITION_FUNCTION",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        } else if (objectType === "PARTITION_SCHEME") {
            try {
                if (!this.peekKeyword("AS")) {
                    throw new Error("Expected AS in PARTITION SCHEME");
                }
                this.consume();

                if (this.peekKeyword("PARTITION")) {
                    this.consume();
                }

                const functionExpr = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });

                if (functionExpr.type !== "Identifier") {
                    throw new Error("Expected partition function name");
                }
                partitionFunction = functionExpr;

                const scheme = this.parsePartitionSchemeFilegroups();
                filegroups = scheme.filegroups;
                allTo = scheme.allTo;
                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_PARTITION_SCHEME",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        } else if (
            objectType === "SCHEMA" ||
            objectType === "SEQUENCE" ||
            objectType === "SYNONYM" ||
            objectType === "LOGIN" ||
            objectType === "USER"
        ) {
            endOffset = this.skipCreatePreambleUntil(["GO"]);
        }

        return {
            type: "CreateStatement",
            objectType,
            orAlter,
            name,
            nameNode,
            columns,
            constraints,
            ...(indexes?.length ? { indexes } : {}),
            parameters,
            ...(returnVariable ? { returnVariable, returnColumns } : {}),
            body,
            isTableType,
            ...(storage ? { storage } : {}),
            ...(textImageOn ? { textImageOn } : {}),
            ...(partitionRange ? { partitionRange } : {}),
            ...(partitionInputType ? { partitionInputType } : {}),
            ...(boundaryValues ? { boundaryValues } : {}),
            ...(partitionFunction ? { partitionFunction } : {}),
            ...(filegroups ? { filegroups } : {}),
            ...(allTo ? { allTo: true } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected isParameterListBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (token.type === TokenType.Semicolon || token.type === TokenType.CloseParen) {
            return true;
        }

        return (
            token.type === TokenType.Keyword && (token.value === "AS" || token.value === "RETURNS")
        );
    }

    protected isCreateIndexIncludeBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        if (token.type === TokenType.Semicolon || token.type === TokenType.CloseParen) {
            return true;
        }

        return (
            token.type === TokenType.Keyword &&
            (token.value === "WHERE" || token.value === "WITH" || token.value === "OPTION")
        );
    }

    protected isIndexOptionBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        return token.type === TokenType.Semicolon || token.type === TokenType.CloseParen;
    }

    protected isTableDefinitionRecoveryBoundary(token?: Token): boolean {
        if (!token) {
            return true;
        }

        return (
            token.type === TokenType.Comma ||
            token.type === TokenType.CloseParen ||
            token.type === TokenType.Semicolon ||
            (token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value))
        );
    }

    protected parseIdentifierListSafe(): string[] {
        const result: string[] = [];

        while (this.peek()) {
            const token = this.peek()!;

            const isResync = token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value);

            if (
                token.type === TokenType.CloseParen ||
                token.type === TokenType.Semicolon ||
                isResync
            ) {
                break;
            }

            if (token.type === TokenType.Comma) {
                this.consume();
                continue;
            }

            const id = this.parseMultipartIdentifier();

            if (id.type !== "Identifier") {
                break;
            }

            result.push(id.name);
        }

        return result;
    }

    protected parseConstraintColumnListSafe(): string[] {
        const result: string[] = [];

        while (this.peek()) {
            const token = this.peek()!;

            const isResync = token.type === TokenType.Keyword && RESYNC_KEYWORDS.has(token.value);

            if (
                token.type === TokenType.CloseParen ||
                token.type === TokenType.Semicolon ||
                isResync
            ) {
                break;
            }

            if (token.type === TokenType.Comma) {
                this.consume();
                continue;
            }

            const id = this.parseMultipartIdentifier();

            if (id.type !== "Identifier") {
                break;
            }

            result.push(id.name);

            if (this.peekKeyword("ASC") || this.peekKeyword("DESC")) {
                this.consume();
            }
        }

        return result;
    }

    protected looksLikeTableConstraintAfterColumn(): boolean {
        const t0 = this.peek()?.value;
        const t1 = this.peek(1)?.value;
        const t2 = this.peek(2)?.value;
        const t3 = this.peek(3)?.value;

        if (
            t0 === "PRIMARY" &&
            t1 === "KEY" &&
            (t2 === "CLUSTERED" || t2 === "NONCLUSTERED" || t2 === "(")
        ) {
            return true;
        }

        if (t0 === "UNIQUE" && (t1 === "CLUSTERED" || t1 === "NONCLUSTERED" || t1 === "(")) {
            return true;
        }

        if (t0 === "FOREIGN" && t1 === "KEY" && t2 === "(") {
            return true;
        }

        if (
            t0 === "CONSTRAINT" &&
            ((t2 === "PRIMARY" && t3 === "KEY") ||
                (t2 === "UNIQUE" &&
                    (this.peek(3)?.value === "CLUSTERED" ||
                        this.peek(3)?.value === "NONCLUSTERED" ||
                        this.peek(3)?.type === TokenType.OpenParen)) ||
                (t2 === "FOREIGN" && t3 === "KEY"))
        ) {
            return true;
        }

        return false;
    }

    protected parseComputedColumnTail(): {
        dataType: string;
        computedExpression?: Expression | null;
        persisted?: boolean;
    } {
        this.matchKeyword("AS");

        let computedExpression: Expression | null = null;

        if (this.peek()?.type === TokenType.OpenParen) {
            this.consume();
            computedExpression = this.parseExpression(Precedence.LOWEST);

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
            } else {
                throw new Error("Expected ) after computed column expression");
            }
        } else {
            computedExpression = this.parseExpression(Precedence.LOWEST, new Set(["PERSISTED"]));
        }

        const persisted = this.peekKeyword("PERSISTED");
        if (persisted) {
            this.consume();
        }

        return {
            dataType: "",
            computedExpression,
            ...(persisted ? { persisted: true } : {}),
        };
    }

    protected parseConstraint(implicitColumn?: string): ConstraintNode {
        const start = this.peek()?.offset ?? this.lastConsumedEnd();

        let incomplete = false;
        const errors: string[] = [];

        let name: string | undefined;

        let kind:
            | "PRIMARY KEY"
            | "FOREIGN KEY"
            | "UNIQUE"
            | "CHECK"
            | "DEFAULT"
            | "NOT NULL"
            | "NOT FOR REPLICATION"
            | "NULL"
            | "IDENTITY" = "NULL";

        let columns: string[] | undefined;
        let expression: Expression | null | undefined;
        let referencesTable: string | undefined;
        let referencesColumns: string[] | undefined;
        let onDelete: ConstraintNode["onDelete"];
        let onUpdate: ConstraintNode["onUpdate"];
        let storage: StorageTargetNode | undefined;

        const fail = (code: string, message: string) => {
            incomplete = true;

            this.addRecoverableError(errors, code, message, this.lastConsumedEnd());
        };

        // Shared by `FOREIGN KEY [(cols)] REFERENCES ...` and the
        // column-level shorthand `CONSTRAINT name REFERENCES ...` (no
        // FOREIGN KEY keywords — only valid when attached to a single
        // column). Parses the REFERENCES target plus any trailing
        // ON DELETE/ON UPDATE actions.
        const parseReferencesAndActions = (): void => {
            if (this.peek()?.value === "REFERENCES") {
                this.consume();

                const next = this.peek();

                const validTarget =
                    next &&
                    next.type !== TokenType.CloseParen &&
                    next.type !== TokenType.Comma &&
                    next.type !== TokenType.Semicolon &&
                    !(next.type === TokenType.Keyword && RESYNC_KEYWORDS.has(next.value));

                if (validTarget) {
                    const ref = this.parseMultipartIdentifier();

                    if (ref.type === "Identifier") {
                        referencesTable = ref.name;
                    } else {
                        fail("PARSE_CONSTRAINT_REFERENCES_TABLE", "Expected referenced table name");
                    }
                } else {
                    fail("PARSE_CONSTRAINT_REFERENCES_TABLE", "Expected referenced table name");
                }

                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume();

                    referencesColumns = this.parseIdentifierListSafe();

                    if (this.peek()?.type === TokenType.CloseParen) {
                        this.consume();
                    } else {
                        fail(
                            "PARSE_CONSTRAINT_REFERENCES_CLOSE",
                            "Expected ) after REFERENCES columns",
                        );
                    }
                }
            } else {
                fail("PARSE_CONSTRAINT_REFERENCES", "Expected REFERENCES clause");
            }

            // Optional FK referential actions:
            // ON DELETE { CASCADE | SET NULL | SET DEFAULT | NO ACTION }
            // ON UPDATE { CASCADE | SET NULL | SET DEFAULT | NO ACTION }
            while (
                this.peek()?.value?.toUpperCase() === "ON" &&
                (this.peek(1)?.value?.toUpperCase() === "DELETE" ||
                    this.peek(1)?.value?.toUpperCase() === "UPDATE")
            ) {
                this.consume(); // ON
                const target = this.consume().value.toUpperCase(); // DELETE|UPDATE

                let action: ConstraintNode["onDelete"] | undefined;
                const first = this.peek()?.value?.toUpperCase();
                const second = this.peek(1)?.value?.toUpperCase();

                if (first === "CASCADE") {
                    this.consume();
                    action = "CASCADE";
                } else if (first === "NO" && second === "ACTION") {
                    this.consume();
                    this.consume();
                    action = "NO ACTION";
                } else if (first === "SET" && second === "NULL") {
                    this.consume();
                    this.consume();
                    action = "SET NULL";
                } else if (first === "SET" && second === "DEFAULT") {
                    this.consume();
                    this.consume();
                    action = "SET DEFAULT";
                } else {
                    fail(
                        "PARSE_CONSTRAINT_FK_ACTION",
                        `Expected referential action after ON ${target}`,
                    );
                }

                if (target === "DELETE" && action) {
                    onDelete = action;
                }

                if (target === "UPDATE" && action) {
                    onUpdate = action;
                }
            }
        };

        try {
            // optional CONSTRAINT name
            if (this.peek()?.value === "CONSTRAINT") {
                this.consume();

                if (this.peek()) {
                    name = this.consume().value;
                } else {
                    fail("PARSE_CONSTRAINT_NAME", "Expected constraint name");
                }
            }

            const token = this.peek();
            const value = token?.value;

            if (!token) {
                fail("PARSE_CONSTRAINT_KIND", "Expected constraint type");
            }

            // PRIMARY KEY
            else if (value === "PRIMARY" && this.peek(1)?.value === "KEY") {
                this.consume();
                this.consume();

                kind = "PRIMARY KEY";

                if (this.peek()?.value === "CLUSTERED" || this.peek()?.value === "NONCLUSTERED") {
                    this.consume();
                }

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume();

                    columns = this.parseConstraintColumnListSafe();

                    if (this.peek()?.type === TokenType.CloseParen) {
                        this.consume();
                    } else {
                        fail("PARSE_CONSTRAINT_PK_CLOSE", "Expected ) after PRIMARY KEY columns");
                    }
                }
            }

            // FOREIGN KEY
            else if (value === "FOREIGN" && this.peek(1)?.value === "KEY") {
                this.consume();
                this.consume();

                kind = "FOREIGN KEY";

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume();

                    columns = this.parseIdentifierListSafe();

                    if (this.peek()?.type === TokenType.CloseParen) {
                        this.consume();
                    } else {
                        fail("PARSE_CONSTRAINT_FK_CLOSE", "Expected ) after FOREIGN KEY columns");
                    }
                }

                parseReferencesAndActions();
            }

            // Column-level shorthand: CONSTRAINT name REFERENCES table(col)
            // — same as FOREIGN KEY REFERENCES, but only valid attached to
            // a single column (no explicit FOREIGN KEY keywords or column
            // list of its own).
            else if (value === "REFERENCES") {
                kind = "FOREIGN KEY";

                if (implicitColumn) {
                    columns = [implicitColumn];
                }

                parseReferencesAndActions();
            }

            // UNIQUE
            else if (value === "UNIQUE") {
                this.consume();

                kind = "UNIQUE";

                if (this.peek()?.value === "CLUSTERED" || this.peek()?.value === "NONCLUSTERED") {
                    this.consume();
                }

                if (implicitColumn) {
                    columns = [implicitColumn];
                } else if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume();

                    columns = this.parseConstraintColumnListSafe();

                    if (this.peek()?.type === TokenType.CloseParen) {
                        this.consume();
                    } else {
                        fail("PARSE_CONSTRAINT_UNIQUE_CLOSE", "Expected ) after UNIQUE columns");
                    }
                }
            }

            // CHECK
            else if (value === "CHECK") {
                this.consume();

                kind = "CHECK";

                if (this.peek()?.type !== TokenType.OpenParen) {
                    fail("PARSE_CONSTRAINT_CHECK", "Expected ( after CHECK");
                } else {
                    this.consume();

                    const next = this.peek();

                    if (
                        next &&
                        next.type !== TokenType.CloseParen &&
                        next.type !== TokenType.Semicolon
                    ) {
                        try {
                            expression = this.parseExpression();
                        } catch {
                            fail("PARSE_CONSTRAINT_CHECK_EXPR", "Invalid CHECK expression");
                        }
                    } else {
                        fail("PARSE_CONSTRAINT_CHECK_EXPR", "Expected CHECK expression");
                    }

                    if (this.peek()?.type === TokenType.CloseParen) {
                        this.consume();
                    } else {
                        fail("PARSE_CONSTRAINT_CHECK_CLOSE", "Expected ) after CHECK expression");
                    }
                }
            }

            // DEFAULT
            else if (value === "DEFAULT") {
                this.consume();

                kind = "DEFAULT";

                const next = this.peek();

                if (
                    next &&
                    next.type !== TokenType.Comma &&
                    next.type !== TokenType.CloseParen &&
                    next.type !== TokenType.Semicolon
                ) {
                    try {
                        expression = this.parseExpression(
                            Precedence.LOWEST,
                            new Set([
                                "FOR",
                                "CONSTRAINT",
                                "PRIMARY",
                                "FOREIGN",
                                "UNIQUE",
                                "CHECK",
                                "DEFAULT",
                                "NOT",
                                "NULL",
                                "REFERENCES",
                                "IDENTITY",
                            ]),
                        );
                    } catch {
                        fail("PARSE_CONSTRAINT_DEFAULT_EXPR", "Invalid DEFAULT expression");
                    }
                } else {
                    fail("PARSE_CONSTRAINT_DEFAULT", "Expected DEFAULT expression");
                }

                if (this.peek()?.value?.toUpperCase() === "FOR") {
                    this.consume();

                    const targetColumn = this.parseMultipartIdentifier();

                    if (targetColumn.type === "Identifier") {
                        columns = [targetColumn.name];
                    } else {
                        fail(
                            "PARSE_CONSTRAINT_DEFAULT_FOR",
                            "Expected column name after DEFAULT ... FOR",
                        );
                    }
                }
            }

            // NOT FOR REPLICATION
            else if (
                value === "NOT" &&
                this.peek(1)?.value === "FOR" &&
                this.peek(2)?.value === "REPLICATION"
            ) {
                this.consume();
                this.consume();
                this.consume();

                kind = "NOT FOR REPLICATION";

                if (implicitColumn) {
                    columns = [implicitColumn];
                }
            }

            // NOT NULL
            else if (value === "NOT" && this.peek(1)?.value === "NULL") {
                this.consume();
                this.consume();

                kind = "NOT NULL";

                if (implicitColumn) {
                    columns = [implicitColumn];
                }
            }

            // NULL
            else if (value === "NULL") {
                this.consume();

                kind = "NULL";

                if (implicitColumn) {
                    columns = [implicitColumn];
                }
            } else if (value === "IDENTITY") {
                this.consume();

                kind = "IDENTITY";

                if (implicitColumn) {
                    columns = [implicitColumn];
                }

                let seed: number | undefined;
                let increment: number | undefined;

                if (this.peek()?.type === TokenType.OpenParen) {
                    this.consume();

                    if (this.peek()?.type === TokenType.Number) {
                        seed = Number(this.consume().value);
                    }

                    if (this.peek()?.type === TokenType.Comma) {
                        this.consume();

                        if (this.peek()?.type === TokenType.Number) {
                            increment = Number(this.consume().value);
                        }
                    }

                    if (this.peek()?.type === TokenType.CloseParen) {
                        this.consume();
                    } else {
                        fail("PARSE_CONSTRAINT_IDENTITY_CLOSE", "Expected ) after IDENTITY");
                    }
                }

                return {
                    name,
                    kind,
                    ...(columns?.length ? { columns } : {}),
                    ...(seed !== undefined ? { seed } : {}),
                    ...(increment !== undefined ? { increment } : {}),
                    start,
                    end: this.lastConsumedEnd(),
                    ...(incomplete ? { incomplete: true } : {}),
                    ...(errors.length ? { errors } : {}),
                };
            }

            // unknown
            else {
                fail("PARSE_CONSTRAINT_UNKNOWN", `Unknown constraint: ${value}`);

                this.consume();
            }

            if (
                (kind === "PRIMARY KEY" || kind === "UNIQUE") &&
                this.peek()?.value?.toUpperCase() === "WITH" &&
                this.peek(1)?.type === TokenType.OpenParen
            ) {
                this.parseIndexOptionsWithClause();
            }

            if (
                (kind === "PRIMARY KEY" || kind === "UNIQUE") &&
                this.peek()?.value?.toUpperCase() === "ON"
            ) {
                this.consume();
                storage = this.parseStorageTarget();
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_CONSTRAINT",
                e instanceof Error ? e.message : String(e),
                this.lastConsumedEnd(),
            );
        }

        return {
            name,
            kind,
            ...(columns?.length ? { columns } : {}),
            ...(expression !== undefined ? { expression } : {}),
            ...(referencesTable ? { referencesTable } : {}),
            ...(referencesColumns?.length ? { referencesColumns } : {}),
            ...(onDelete ? { onDelete } : {}),
            ...(onUpdate ? { onUpdate } : {}),
            ...(storage ? { storage } : {}),
            start,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseCreateIndex(startToken: Token): CreateIndexNode {
        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        // 1. UNIQUE (optional)
        // UNIQUE is a Keyword token — use value comparison for consistency
        let unique = false;
        if (this.peek()?.value?.toUpperCase() === "UNIQUE") {
            this.consume();
            unique = true;
            endOffset = this.lastConsumedEnd();
        }

        // 2. CLUSTERED / NONCLUSTERED (optional)
        // Not in the lexer keyword set — tokenize as Identifier, must use value check
        let clustered: CreateIndexNode["clustered"] = null;
        if (this.peek()?.value?.toUpperCase() === "CLUSTERED") {
            this.consume();
            clustered = "CLUSTERED";
            endOffset = this.lastConsumedEnd();
        } else if (this.peek()?.value?.toUpperCase() === "NONCLUSTERED") {
            this.consume();
            clustered = "NONCLUSTERED";
            endOffset = this.lastConsumedEnd();
        }

        // 3. INDEX keyword
        // INDEX is a Keyword token — value check consistent with above
        if (this.peek()?.value?.toUpperCase() === "INDEX") {
            this.consume();
            endOffset = this.lastConsumedEnd();
        } else {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CREATE_INDEX_KEYWORD",
                "Expected INDEX keyword",
                endOffset,
            );
        }

        // 4. Index name
        let name = "";
        let nameNode: IdentifierNode = {
            type: "Identifier",
            name: "",
            parts: [],
            start: endOffset,
            end: endOffset,
        };

        try {
            const nameExpr = this.parseMultipartIdentifier();
            if (nameExpr.type === "Identifier") {
                name = nameExpr.name;
                nameNode = nameExpr;
                endOffset = nameExpr.end;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_NAME",
                    "Wildcards are not allowed as index names",
                    nameExpr.start,
                    nameExpr.end,
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CREATE_INDEX_NAME",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // 5. ON table
        let table: IdentifierNode = {
            type: "Identifier",
            name: "",
            parts: [],
            start: endOffset,
            end: endOffset,
        };

        try {
            this.matchKeyword("ON");
            endOffset = this.lastConsumedEnd();

            const tableExpr = this.parseMultipartIdentifier();
            if (tableExpr.type === "Identifier") {
                table = tableExpr;
                endOffset = tableExpr.end;
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_TABLE",
                    "Expected table name after ON",
                    tableExpr.start,
                    tableExpr.end,
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CREATE_INDEX_ON",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // 6. Key columns: (col1 ASC, col2 DESC)
        // ASC/DESC are Keyword tokens but must NOT be treated as structural
        // boundaries — use value comparison so parseList() doesn't stop on them
        let columns: IndexColumnNode[] = [];

        try {
            this.match(TokenType.OpenParen);
            endOffset = this.lastConsumedEnd();

            columns = this.parseList<IndexColumnNode>(
                () => {
                    const colStart = this.peek()?.offset ?? endOffset;

                    const colExpr = this.parseMultipartIdentifier();
                    if (colExpr.type !== "Identifier") {
                        throw new Error("Expected column name in index key");
                    }

                    // Value comparison — avoids structural keyword stop
                    let direction: "ASC" | "DESC" = "ASC";
                    if (this.peek()?.value === "DESC") {
                        this.consume();
                        direction = "DESC";
                    } else if (this.peek()?.value === "ASC") {
                        this.consume();
                    }

                    return {
                        type: "IndexColumn",
                        name: colExpr.name,
                        nameNode: colExpr,
                        direction,
                        start: colStart,
                        end: this.lastConsumedEnd(),
                    };
                },
                {
                    isBoundary: this.isCreateIndexIncludeBoundary.bind(this),
                },
            );

            if (this.peek()?.type === TokenType.CloseParen) {
                this.consume();
                endOffset = this.lastConsumedEnd();
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_COLUMNS_CLOSE",
                    "Expected ) after index columns",
                    endOffset,
                );
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_CREATE_INDEX_COLUMNS",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        // 7. INCLUDE (col1, col2) — optional
        // INCLUDE is not a keyword — comes through as Identifier token
        let include: IdentifierNode[] | undefined;

        if (this.peek()?.value?.toUpperCase() === "INCLUDE") {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                this.match(TokenType.OpenParen);
                endOffset = this.lastConsumedEnd();

                include = this.parseList<IdentifierNode>(
                    () => {
                        const colExpr = this.parseMultipartIdentifier();
                        if (colExpr.type !== "Identifier") {
                            throw new Error("Expected column name in INCLUDE list");
                        }
                        return colExpr;
                    },
                    {
                        isBoundary: this.isCreateIndexIncludeBoundary.bind(this),
                    },
                );

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_CREATE_INDEX_INCLUDE_CLOSE",
                        "Expected ) after INCLUDE columns",
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_INCLUDE",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 8. WHERE — filtered index (optional)
        // WHERE is a Keyword token and IS in STRUCTURAL_KEYWORDS, but
        // peekKeyword() here is a direct next-token check so it still works.
        // Using value comparison anyway for consistency with this method.
        let where: Expression | undefined;

        if (this.peek()?.value === "WHERE") {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                where = this.parseExpression();
                endOffset = where.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_WHERE",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        // 9. WITH (option = value, ...) — optional
        // WITH is a Keyword token. Check next token is '(' to distinguish
        // from WITH used as a CTE introducer (not valid here, but defensive).
        let options: IndexOptionNode[] | undefined;
        let storage: StorageTargetNode | undefined;

        if (this.peek()?.value === "WITH" && this.peek(1)?.type === TokenType.OpenParen) {
            this.consume(); // WITH
            this.consume(); // (
            endOffset = this.lastConsumedEnd();

            try {
                options = this.parseList<IndexOptionNode>(
                    () => {
                        const optStart = this.peek()?.offset ?? endOffset;

                        // option name — ONLINE, FILLFACTOR, PAD_INDEX, etc.
                        const nameToken = this.consume();
                        const optName = nameToken.value.toUpperCase();

                        // =
                        if (this.peek()?.value !== "=") {
                            throw new Error(`Expected = after index option ${optName}`);
                        }
                        this.consume();

                        // value — ON / OFF / number / identifier
                        const valToken = this.consume();
                        const optValue = valToken.value.toUpperCase();

                        return {
                            type: "IndexOption",
                            name: optName,
                            value: optValue,
                            start: optStart,
                            end: this.lastConsumedEnd(),
                        };
                    },
                    {
                        isBoundary: this.isIndexOptionBoundary.bind(this),
                    },
                );

                if (this.peek()?.type === TokenType.CloseParen) {
                    this.consume();
                    endOffset = this.lastConsumedEnd();
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_CREATE_INDEX_OPTIONS_CLOSE",
                        "Expected ) after index options",
                        endOffset,
                    );
                }
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_OPTIONS",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        if (this.peek()?.value?.toUpperCase() === "ON") {
            this.consume();
            endOffset = this.lastConsumedEnd();

            try {
                storage = this.parseStorageTarget();
                endOffset = storage.end;
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_CREATE_INDEX_STORAGE",
                    e instanceof Error ? e.message : String(e),
                    endOffset,
                );
            }
        }

        return {
            type: "CreateIndexStatement",
            unique,
            clustered,
            name,
            nameNode,
            table,
            columns,
            ...(include !== undefined ? { include } : {}),
            ...(where !== undefined ? { where } : {}),
            ...(options !== undefined ? { options } : {}),
            ...(storage ? { storage } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseIndexOptionsWithClause(): IndexOptionNode[] {
        this.matchKeyword("WITH");
        return this.parseIndexOptionsBareClause();
    }

    protected parseIndexOptionsBareClause(): IndexOptionNode[] {
        this.match(TokenType.OpenParen);

        const options = this.parseList<IndexOptionNode>(
            () => {
                const optionToken = this.consume();
                const start = optionToken.offset;

                let value = "";

                if (this.peek()?.value === "=") {
                    this.consume();
                    value = this.consume().value;
                }

                return {
                    type: "IndexOption",
                    name: optionToken.value,
                    value,
                    start,
                    end: this.lastConsumedEnd(),
                };
            },
            {
                isBoundary: (token?: Token) => !token || token.type === TokenType.CloseParen,
            },
        );

        this.match(TokenType.CloseParen);

        return options;
    }

    protected parseColumnDefinition(): ColumnDefinition {
        const startToken = this.peek()!;
        const nameExpr = this.parseMultipartIdentifier(undefined, {
            allowStructuralFirstSegment: true,
        });

        if (nameExpr.type !== "Identifier") {
            throw new Error("Wildcards are not allowed as column names in table definitions");
        }

        const name = nameExpr.name;

        if (this.peekKeyword("AS")) {
            return {
                name,
                ...this.parseComputedColumnTail(),
                start: startToken.offset,
                end: this.lastConsumedEnd(),
            };
        }

        // 1. Data Type
        let dataType = "";
        let parenDepth = 0;
        while (this.peek()) {
            const next = this.peek()!;
            const val = next.value.toUpperCase();

            if (parenDepth === 0) {
                // Stop if we hit a separator or a column constraint keyword
                if (
                    next.type === TokenType.Comma ||
                    next.type === TokenType.CloseParen ||
                    next.type === TokenType.Semicolon
                )
                    break;
                if (
                    [
                        "CONSTRAINT",
                        "PRIMARY",
                        "FOREIGN",
                        "UNIQUE",
                        "CHECK",
                        "DEFAULT",
                        "NOT",
                        "NULL",
                        "REFERENCES",
                        "IDENTITY",
                    ].includes(val)
                )
                    break;
            }

            if (next.type === TokenType.OpenParen) parenDepth++;

            const tokenValue = this.consume().value;

            // Smarter spacing logic:
            // Only add space if both the last char and current token are "word" characters.
            // This keeps "VARCHAR(255)" tight but "DOUBLE PRECISION" spaced.
            if (dataType.length > 0) {
                const lastChar = dataType[dataType.length - 1];
                const isCurrentWord = /^[A-Za-z0-9_]+$/.test(tokenValue);
                const isLastWord = /^[A-Za-z0-9_]+$/.test(lastChar);

                if (isCurrentWord && isLastWord) {
                    dataType += " ";
                }
            }

            dataType += tokenValue;

            if (next.type === TokenType.CloseParen) parenDepth--;
        }

        // 2. Inline Constraints
        const constraints: ConstraintNode[] = [];
        while (this.peek()) {
            const next = this.peek()!;
            const val = next.value.toUpperCase();

            // Standard boundary check
            if (
                next.type === TokenType.Comma ||
                next.type === TokenType.CloseParen ||
                next.type === TokenType.Semicolon
            )
                break;

            if (
                [
                    "CONSTRAINT",
                    "PRIMARY",
                    "FOREIGN",
                    "UNIQUE",
                    "CHECK",
                    "DEFAULT",
                    "NOT",
                    "NULL",
                    "REFERENCES",
                    "IDENTITY",
                ].includes(val)
            ) {
                // parseConstraint handles its own name-check and keyword consumption
                constraints.push(this.parseConstraint(name));

                // Check if the constraint was followed by a separator
                if (
                    this.peek()?.type === TokenType.Comma ||
                    this.peek()?.type === TokenType.CloseParen
                )
                    break;
                continue;
            }

            // Skip unexpected tokens to reach next boundary
            this.consume();
        }

        return {
            name,
            dataType,
            ...(constraints.length ? { constraints } : {}),
            start: startToken.offset,
            end: this.lastConsumedEnd(),
        };
    }
}
