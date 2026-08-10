/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { TokenType } from "./lexer.js";

import {
    type DropNode,
    type AlterDatabaseNode,
    type AlterRoleNode,
    type IndexOptionNode,
    type AlterTableNode,
    type AlterIndexNode,
    type Expression,
    type IdentifierNode,
    type AlterTableAction,
    type AlterIndexAction,
} from "../ast/types.js";

import { DROP_OBJECT_TYPES } from "./grammar.js";

import { CreateParser } from "./createParser.js";

export abstract class AlterDropParser extends CreateParser {
    protected parseAlterDatabase(): AlterDatabaseNode {
        const startToken = this.matchKeyword("ALTER");
        this.matchKeyword("DATABASE");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = this.lastConsumedEnd();

        let database: IdentifierNode | null = null;
        const actionTokens: string[] = [];

        try {
            const databaseExpr = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });

            if (databaseExpr.type !== "Identifier") {
                throw new Error("Expected database name");
            }

            database = databaseExpr;
            endOffset = databaseExpr.end;

            while (this.peek()) {
                const token = this.peek()!;
                if (token.type === TokenType.Semicolon || token.value === "GO") {
                    break;
                }

                actionTokens.push(this.consume().value);
                endOffset = token.offset + token.value.length;
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_ALTER_DATABASE",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        return {
            type: "AlterDatabaseStatement",
            database,
            actionTokens,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseDrop(): DropNode {
        const startToken = this.matchKeyword("DROP");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = startToken.offset + startToken.value.length;

        // 1. Object type
        let objectType: DropNode["objectType"] = "TABLE";

        try {
            const typeToken = this.consume();
            const rawType = typeToken.value.toUpperCase();

            const mapped = DROP_OBJECT_TYPES[rawType as keyof typeof DROP_OBJECT_TYPES];

            if (mapped) {
                objectType = mapped;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DROP_TYPE",
                    `Unsupported DROP object type: ${rawType}`,
                    typeToken.offset,
                    typeToken.offset + typeToken.value.length,
                );
            }

            endOffset = typeToken.offset + typeToken.value.length;
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_DROP_TYPE",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                endOffset,
            );
        }

        let ifExists = false;
        if (this.peekKeyword("IF")) {
            this.consume(); // Consume 'IF'
            try {
                this.matchKeyword("EXISTS");
                ifExists = true;
                endOffset = this.lastConsumedEnd();
            } catch (e) {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_DROP_IF_EXISTS",
                    "Expected 'EXISTS' after 'IF'",
                    endOffset,
                );
            }
        }

        // 2. Target names. SQL Server accepts a comma-separated list for the
        // common DROP object types. Preserve `target` as the first item so
        // existing consumers remain source compatible, while retaining the
        // complete declaration for editor features.
        let target: IdentifierNode | null = null;
        const targets: IdentifierNode[] = [];
        let onTable: IdentifierNode | null | undefined;

        try {
            const targetExpr = this.parseMultipartIdentifier();

            if (targetExpr.type === "Identifier" && targetExpr.name) {
                target = targetExpr;
                targets.push(targetExpr);
                endOffset = targetExpr.end;
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_DROP_TARGET",
                    `Invalid target for DROP ${objectType}`,
                    targetExpr.start,
                    targetExpr.end,
                );
            }

            while (this.peek()?.type === TokenType.Comma) {
                const comma = this.consume();
                endOffset = comma.offset + comma.value.length;

                const next = this.peek();
                if (!next || next.type === TokenType.Semicolon || next.value === "ON") {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_DROP_TARGET",
                        "Expected object name after comma in DROP statement",
                        comma.offset,
                        endOffset,
                    );
                    break;
                }

                const extraTarget = this.parseMultipartIdentifier();
                if (extraTarget.type !== "Identifier" || !extraTarget.name) {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_DROP_TARGET",
                        `Invalid target for DROP ${objectType}`,
                        extraTarget.start,
                        extraTarget.end,
                    );
                    break;
                }

                targets.push(extraTarget);
                endOffset = extraTarget.end;
            }

            // DROP INDEX has a distinct qualification form:
            // DROP INDEX ix_one, ix_two ON dbo.TableName.
            if (objectType === "INDEX" && this.peekKeyword("ON")) {
                const onToken = this.consume();
                endOffset = onToken.offset + onToken.value.length;

                const tableExpr = this.parseMultipartIdentifier();
                if (tableExpr.type === "Identifier" && tableExpr.name) {
                    onTable = tableExpr;
                    endOffset = tableExpr.end;
                } else {
                    incomplete = true;
                    this.addRecoverableError(
                        errors,
                        "PARSE_DROP_INDEX_ON",
                        "Expected table name after ON in DROP INDEX",
                        onToken.offset,
                        endOffset,
                    );
                }
            }
        } catch (e) {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_DROP_TARGET",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        return {
            type: "DropStatement",
            ifExists,
            objectType,
            target,
            ...(targets.length ? { targets } : {}),
            ...(onTable !== undefined ? { onTable } : {}),
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseAlterTable(): AlterTableNode {
        const startToken = this.matchKeyword("ALTER");
        this.matchKeyword("TABLE");
        const table = this.parseMultipartIdentifier() as IdentifierNode;
        let incomplete = false;
        const errors: string[] = [];

        let enforcement: "CHECK" | "NOCHECK" | undefined;
        if (this.peekKeyword("WITH")) {
            this.consume();

            if (this.peekKeyword("CHECK")) {
                this.consume();
                enforcement = "CHECK";
            } else if (this.peekKeyword("NOCHECK")) {
                this.consume();
                enforcement = "NOCHECK";
            } else {
                incomplete = true;

                this.addRecoverableError(
                    errors,
                    "PARSE_ALTER_TABLE_WITH",
                    "Expected CHECK or NOCHECK after WITH in ALTER TABLE",
                    this.lastConsumedEnd(),
                    this.lastConsumedEnd(),
                );
            }
        }

        const actionToken = this.consume(); // ADD or DROP
        const actionVal = actionToken.value.toUpperCase();
        let action: AlterTableAction;

        if (actionVal === "ADD") {
            if (this.peekKeyword("CONSTRAINT") || this.peekKeyword("DEFAULT")) {
                action = {
                    kind: "ADD_CONSTRAINT",
                    constraint: this.parseConstraint(),
                    ...(enforcement ? { enforcement } : {}),
                };
            } else {
                if (this.peekKeyword("COLUMN")) this.consume();
                action = {
                    kind: "ADD_COLUMN",
                    column: this.parseColumnDefinition(),
                };
            }
        } else if (actionVal === "DROP") {
            const isConstraint = this.peekKeyword("CONSTRAINT");
            const isColumn = this.peekKeyword("COLUMN");
            if (isConstraint || isColumn) this.consume();

            let ifExists = false;
            if (this.peekKeyword("IF")) {
                this.consume(); // IF
                this.matchKeyword("EXISTS");
                ifExists = true;
            }

            const name = this.consume().value;
            action = isConstraint
                ? { kind: "DROP_CONSTRAINT", name, ifExists }
                : { kind: "DROP_COLUMN", name, ifExists };
        } else if (actionVal === "ALTER") {
            if (this.peekKeyword("COLUMN")) this.consume(); // optional COLUMN keyword
            action = {
                kind: "ALTER_COLUMN",
                column: this.parseColumnDefinition(),
            };
        } else {
            incomplete = true;

            this.addRecoverableError(
                errors,
                "PARSE_ALTER_TABLE_ACTION",
                `Unsupported ALTER TABLE action: ${actionVal}`,
                actionToken.offset,
                actionToken.offset + actionToken.value.length,
            );

            action = {
                kind: "DROP_COLUMN",
                name: actionToken.value,
                ifExists: false,
            };

            while (this.peek() && this.peek()?.type !== TokenType.Semicolon) {
                this.consume();
            }
        }

        return {
            type: "AlterTableStatement",
            table,
            action,
            start: startToken.offset,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseAlterRole(): AlterRoleNode {
        const startToken = this.matchKeyword("ALTER");
        this.matchKeyword("ROLE");

        let incomplete = false;
        const errors: string[] = [];
        let endOffset = this.lastConsumedEnd();

        let role: IdentifierNode | null = null;
        let action: AlterRoleNode["action"] = null;

        try {
            const roleExpr = this.parseMultipartIdentifier(undefined, {
                allowStructuralFirstSegment: true,
            });

            if (roleExpr.type === "Identifier") {
                role = roleExpr;
                endOffset = roleExpr.end;
            } else {
                throw new Error("Expected role name");
            }

            if (this.peekKeyword("ADD")) {
                this.consume();
                this.matchKeyword("MEMBER");

                const memberExpr = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });

                action = {
                    kind: "ADD_MEMBER",
                    member: memberExpr.type === "Identifier" ? memberExpr : null,
                };
                endOffset = this.lastConsumedEnd();
            } else if (this.peekKeyword("DROP")) {
                this.consume();
                this.matchKeyword("MEMBER");

                const memberExpr = this.parseMultipartIdentifier(undefined, {
                    allowStructuralFirstSegment: true,
                });

                action = {
                    kind: "DROP_MEMBER",
                    member: memberExpr.type === "Identifier" ? memberExpr : null,
                };
                endOffset = this.lastConsumedEnd();
            } else {
                throw new Error("Expected ADD MEMBER or DROP MEMBER in ALTER ROLE");
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_ALTER_ROLE",
                e instanceof Error ? e.message : String(e),
                endOffset,
            );
        }

        return {
            type: "AlterRoleStatement",
            role,
            action,
            start: startToken.offset,
            end: endOffset,
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }

    protected parseAlterIndex(): AlterIndexNode {
        const startToken = this.matchKeyword("ALTER");
        this.matchKeyword("INDEX");

        let incomplete = false;
        const errors: string[] = [];

        let indexName = "";
        let indexNameNode: IdentifierNode | null = null;
        let table: IdentifierNode | null = null;
        let action: AlterIndexAction | null = null;

        try {
            if (this.peekKeyword("ALL")) {
                const allToken = this.consume();
                indexName = allToken.value;
            } else {
                const nameExpr = this.parseMultipartIdentifier();
                if (nameExpr.type === "Identifier") {
                    indexName = nameExpr.name;
                    indexNameNode = nameExpr;
                } else {
                    throw new Error("Expected index name");
                }
            }

            this.matchKeyword("ON");
            const tableExpr = this.parseMultipartIdentifier();
            if (tableExpr.type === "Identifier") {
                table = tableExpr;
            } else {
                throw new Error("Expected table name after ON");
            }

            const actionToken = this.consume();
            const actionVal = actionToken.value.toUpperCase();

            if (actionVal === "REBUILD") {
                let partition: Expression | null = null;
                let options: IndexOptionNode[] | undefined;

                if (this.peekKeyword("PARTITION")) {
                    this.consume();
                    if (this.peek()?.value === "=") {
                        this.consume();
                    }
                    if (this.peekKeyword("ALL")) {
                        const partitionExpr = this.parseMultipartIdentifier(undefined, {
                            allowStructuralFirstSegment: true,
                        });

                        if (partitionExpr.type === "Identifier") {
                            partition = partitionExpr;
                        } else {
                            throw new Error("Expected partition value after PARTITION =");
                        }
                    } else {
                        partition = this.parseExpression();
                    }
                }

                if (this.peekKeyword("WITH")) {
                    options = this.parseIndexOptionsWithClause();
                }

                action = {
                    kind: "REBUILD",
                    ...(partition ? { partition } : {}),
                    ...(options?.length ? { options } : {}),
                };
            } else if (actionVal === "REORGANIZE") {
                let partition: Expression | null = null;

                if (this.peekKeyword("PARTITION")) {
                    this.consume();
                    if (this.peek()?.value === "=") {
                        this.consume();
                    }
                    if (this.peekKeyword("ALL")) {
                        const partitionExpr = this.parseMultipartIdentifier(undefined, {
                            allowStructuralFirstSegment: true,
                        });

                        if (partitionExpr.type === "Identifier") {
                            partition = partitionExpr;
                        } else {
                            throw new Error("Expected partition value after PARTITION =");
                        }
                    } else {
                        partition = this.parseExpression();
                    }
                }

                action = {
                    kind: "REORGANIZE",
                    ...(partition ? { partition } : {}),
                };
            } else if (actionVal === "DISABLE") {
                action = { kind: "DISABLE" };
            } else if (actionVal === "SET") {
                action = {
                    kind: "SET",
                    options: this.parseIndexOptionsBareClause(),
                };
            } else {
                incomplete = true;
                this.addRecoverableError(
                    errors,
                    "PARSE_ALTER_INDEX_ACTION",
                    `Unsupported ALTER INDEX action: ${actionVal}`,
                    actionToken.offset,
                    actionToken.offset + actionToken.value.length,
                );

                action = {
                    kind: "UNKNOWN",
                    raw: actionToken.value,
                };

                while (this.peek() && this.peek()?.type !== TokenType.Semicolon) {
                    this.consume();
                }
            }
        } catch (e) {
            incomplete = true;
            this.addRecoverableError(
                errors,
                "PARSE_ALTER_INDEX",
                e instanceof Error ? e.message : String(e),
                startToken.offset,
                this.lastConsumedEnd(),
            );
        }

        return {
            type: "AlterIndexStatement",
            indexName,
            indexNameNode,
            table,
            action,
            start: startToken.offset,
            end: this.lastConsumedEnd(),
            ...(incomplete ? { incomplete: true } : {}),
            ...(errors.length ? { errors } : {}),
        };
    }
}
