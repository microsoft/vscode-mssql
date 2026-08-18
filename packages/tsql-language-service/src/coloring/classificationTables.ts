/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtInRoutineNames } from "../common/builtInRegistry.js";
import type { SqlColorTokenType } from "./contracts.js";

/** Lexical terminals that carry a fixed classification regardless of their syntactic position. */
export const literalTokenTypes: ReadonlyMap<string, SqlColorTokenType> = new Map([
    ["LineComment", "comment"],
    ["BlockComment", "comment"],
    ["StringLiteral", "string"],
    ["BinaryLiteral", "number"],
    ["MoneyLiteral", "number"],
    ["FloatLiteral", "number"],
    ["DecimalLiteral", "number"],
    ["IntegerLiteral", "number"],
]);

/**
 * Arithmetic, bitwise, comparison, and assignment terminals. Pure punctuation is excluded so
 * commas, semicolons, parentheses, and name dots keep the editor's syntactic coloring.
 */
export const operatorTokenKinds: ReadonlySet<string> = new Set([
    "Plus",
    "Minus",
    "Star",
    "Slash",
    "PercentSign",
    "Ampersand",
    "Pipe",
    "Caret",
    "Tilde",
    "Equal",
    "PlusEqual",
    "MinusEqual",
    "StarEqual",
    "EqualStar",
    "SlashEqual",
    "PercentEqual",
    "AmpersandEqual",
    "PipeEqual",
    "CaretEqual",
    "ShiftLeft",
    "ShiftRight",
    "DoublePipe",
    "ConcatEqual",
    "NotEqual",
    "LessThanOrEqual",
    "GreaterThanOrEqual",
    "LessThan",
    "GreaterThan",
]);

/** Pre-ANSI outer-join comparisons, which SQL Server removed after compatibility level 90. */
export const deprecatedOperatorTokenKinds: ReadonlySet<string> = new Set([
    "StarEqual",
    "EqualStar",
]);

export const identifierTokenKinds: ReadonlySet<string> = new Set([
    "Identifier",
    "BracketedIdentifier",
    "DoubleQuotedIdentifier",
    "TempIdentifier",
    "PseudoColumn",
]);

export const quotedIdentifierTokenKinds: ReadonlySet<string> = new Set([
    "BracketedIdentifier",
    "DoubleQuotedIdentifier",
]);

export interface ObjectNameStatementRole {
    readonly type: SqlColorTokenType;
    readonly definition: boolean;
    readonly declaration: boolean;
}

/**
 * Statements whose direct name children denote the object the statement acts on. Statements naming
 * two different objects — index, statistics, and trigger targets — are handled explicitly instead,
 * because position rather than statement kind selects their roles.
 */
export const objectNameStatements: ReadonlyMap<string, ObjectNameStatementRole> = new Map([
    ["CreateTableStatement", { type: "table", definition: true, declaration: true }],
    ["AlterTableStatement", { type: "table", definition: true, declaration: false }],
    ["DropTableStatement", { type: "table", definition: false, declaration: false }],
    ["TruncateTableStatement", { type: "table", definition: false, declaration: false }],
    ["CreateViewStatement", { type: "view", definition: true, declaration: true }],
    ["AlterViewStatement", { type: "view", definition: true, declaration: false }],
    ["CreateMaterializedViewStatement", { type: "view", definition: true, declaration: true }],
    ["AlterMaterializedViewStatement", { type: "view", definition: true, declaration: false }],
    ["DropViewStatement", { type: "view", definition: false, declaration: false }],
    ["CreateProcedureStatement", { type: "procedure", definition: true, declaration: true }],
    ["AlterProcedureStatement", { type: "procedure", definition: true, declaration: false }],
    ["DropProcedureStatement", { type: "procedure", definition: false, declaration: false }],
    ["CreateFunctionStatement", { type: "function", definition: true, declaration: true }],
    ["AlterFunctionStatement", { type: "function", definition: true, declaration: false }],
    ["DropFunctionStatement", { type: "function", definition: false, declaration: false }],
    ["CreateTriggerStatement", { type: "procedure", definition: true, declaration: true }],
    ["AlterTriggerStatement", { type: "procedure", definition: true, declaration: false }],
    ["CreateTypeStatement", { type: "type", definition: true, declaration: true }],
    ["DropTypeStatement", { type: "type", definition: false, declaration: false }],
    ["CreateSchemaStatement", { type: "schema", definition: true, declaration: true }],
    ["AlterSchemaStatement", { type: "schema", definition: true, declaration: false }],
    ["DropSchemaStatement", { type: "schema", definition: false, declaration: false }],
    ["CreateDatabaseStatement", { type: "database", definition: true, declaration: true }],
    ["AlterDatabaseStatement", { type: "database", definition: true, declaration: false }],
    ["DropDatabaseStatement", { type: "database", definition: false, declaration: false }],
]);

/** Statements that name an index or statistics object first and the table it belongs to second. */
export const indexOwnerStatements: ReadonlySet<string> = new Set([
    "CreateIndexStatement",
    "CreateJsonIndexStatement",
    "CreateVectorIndexStatement",
    "CreateSemanticIndexStatement",
    "AlterIndexStatement",
    "CreateStatisticsStatement",
]);

export { builtInRoutineNames };
