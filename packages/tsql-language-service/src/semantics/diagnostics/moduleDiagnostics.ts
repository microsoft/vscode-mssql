/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot, SyntaxToken } from "../../syntax/index.js";
import {
    containsSyntaxError,
    descendantsOfKind,
    descendantsOwnedByKind,
    directChildrenOfKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { multipartIdentifierPartRange, multipartIdentifierParts } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";
import { selectElementAssignsVariable } from "./diagnosticTextFacts.js";

export interface ModuleDiagnosticContext extends DiagnosticFamilyContext {
    readonly syntax: SyntaxSnapshot;
    significantTokens(range: TextRange, limit: number): readonly SyntaxToken[];
}

/** Validates programmable-object names, options, and function-body restrictions. */
export function validateModuleDefinitions(context: ModuleDiagnosticContext): void {
    for (const kind of ["CreateProcedureStatement", "AlterProcedureStatement"] as const) {
        for (const module of context.nodes(kind)) {
            const nameNode = firstDescendantOfKind(module, "MultipartIdentifier");
            if (nameNode) {
                const parts = multipartIdentifierParts(context.source(nameNode));
                if (parts.length >= 3) {
                    context.add(
                        "DbNameIsNotAllowedForCreateAlterProc",
                        "CREATE/ALTER PROCEDURE' does not allow specifying the database name as a prefix to the object name.",
                        multipartIdentifierPartRange(
                            context.source(nameNode),
                            nameNode.start,
                            parts.length - 3,
                            nameNode,
                        ),
                    );
                }
            }
            const numberClause = firstDescendantOfKind(module, "ProcedureNumberClause");
            const numberNode =
                numberClause && firstDescendantOfKind(numberClause, "IntegerLiteral");
            if (numberNode) {
                const value = BigInt(context.source(numberNode));
                if (value <= 2_147_483_647n && (value === 0n || value > 32_767n)) {
                    context.add(
                        "InvalidProcedureNumberRange",
                        `Invalid procedure number ${value}.Must be between 1 and 32767.`,
                        numberNode,
                    );
                }
            }
        }
    }

    for (const kind of ["CreateFunctionStatement", "AlterFunctionStatement"] as const) {
        for (const module of context.nodes(kind)) {
            const nameNode = firstDescendantOfKind(module, "MultipartIdentifier");
            if (nameNode) {
                const parts = multipartIdentifierParts(context.source(nameNode));
                if (parts.length >= 3) {
                    context.add(
                        "DbNameIsNotAllowedForCreateAlterFunc",
                        "CREATE/ALTER FUNCTION' does not allow specifying the database name as a prefix to the object name.",
                        multipartIdentifierPartRange(
                            context.source(nameNode),
                            nameNode.start,
                            parts.length - 3,
                            nameNode,
                        ),
                    );
                }
                if (parts.at(-1)?.startsWith("#")) {
                    const range = multipartIdentifierPartRange(
                        context.source(nameNode),
                        nameNode.start,
                        parts.length - 1,
                        nameNode,
                    );
                    context.add(
                        "TempFunctionNameIsNotAllowed",
                        "Creation of temporary functions is not allowed.",
                        range,
                    );
                }
            }
            const options = descendantsOwnedByKind(module, "FunctionOption", module);
            for (const parameter of descendantsOwnedByKind(module, "ProcedureParameter", module)) {
                const output = [...parameter.children()].find(
                    (child) => child.kind === "Out" || child.kind === "Output",
                );
                if (output) {
                    context.add(
                        "OptionNotRecognized",
                        "'OUTPUT' is not a recognized option.",
                        output,
                    );
                }
            }
            const returnsNull = options.find(
                (option) =>
                    moduleOptionKey(context.source(option)) === "RETURNS NULL ON NULL INPUT",
            );
            const calledOnNull = options.find(
                (option) => moduleOptionKey(context.source(option)) === "CALLED ON NULL INPUT",
            );
            if (returnsNull && calledOnNull) {
                context.add(
                    "ConflictingReturnsNullAndCalledOnNullInputOptions",
                    'Conflicting CREATE/ALTER FUNCTION options "RETURNS NULL ON NULL INPUT" and "CALLED ON NULL INPUT".',
                    returnsNull.start > calledOnNull.start ? returnsNull : calledOnNull,
                );
            }
            const definition = firstDescendantOfKind(module, "FunctionDefinition");
            if (!definition) continue;
            const tableValued =
                firstDescendantOfKind(definition, "FunctionTableReturnType") !== undefined;
            const external = firstDescendantOfKind(definition, "ExternalModuleBody") !== undefined;
            const inlineTable =
                tableValued &&
                !external &&
                firstDescendantOfKind(definition, "ModuleBody") === undefined;
            const allowed = external
                ? tableValued
                    ? externalTableFunctionOptions
                    : externalScalarFunctionOptions
                : tableValued
                  ? inlineTable
                      ? inlineTableFunctionOptions
                      : tableFunctionOptions
                  : scalarFunctionOptions;
            for (const option of options) {
                const key = moduleOptionKey(context.source(option));
                if (key === "INLINE" && !firstDescendantOfKind(option, "Equal")) continue;
                if (allowed.has(key)) continue;
                if (
                    directChildrenOfKind(option, "IdentifierName").length > 0 &&
                    !knownFunctionOptions.has(key)
                ) {
                    continue;
                }
                context.add(
                    "InvalidOptionInCreateFunction",
                    'An invalid option was specified for the statement "CREATE/ALTER FUNCTION".',
                    option,
                );
            }
            if (!external && !inlineTable) {
                validateFunctionBody(context, module, tableValued, nameNode);
            }
        }
    }

    for (const kind of ["CreateViewStatement", "AlterViewStatement"] as const) {
        for (const module of context.nodes(kind)) {
            const nameNode = firstDescendantOfKind(module, "MultipartIdentifier");
            if (!nameNode) continue;
            const parts = multipartIdentifierParts(context.source(nameNode));
            if (parts.length >= 3) {
                context.add(
                    "DatabaseNameAsPrefixInCreateView",
                    "'CREATE/ALTER VIEW' does not allow specifying the database name as a prefix to the object name.",
                    multipartIdentifierPartRange(
                        context.source(nameNode),
                        nameNode.start,
                        parts.length - 3,
                        nameNode,
                    ),
                );
            }
        }
    }
}

/** Returns the canonical statement phrase used by build-mode and function-body diagnostics. */
export function statementPhrase(
    context: Pick<ModuleDiagnosticContext, "significantTokens">,
    statement: SyntaxNode,
): string | undefined {
    const fixed = typedStatementPhrases.get(statement.kind);
    if (fixed) return fixed;
    if (statement.kind === "DeclareStatement") {
        if (firstDescendantOfKind(statement, "CursorDeclaration")) return "DECLARE CURSOR";
        return descendantsOfKind(statement, "TableDefinition").length > 0
            ? "DECLARE TABLE"
            : "DECLARE";
    }
    if (statement.kind === "BeginControlStatement") {
        const second = context.significantTokens(statement, 2)[1]?.text.toUpperCase();
        if (second === "TRY") return "TRY CATCH";
        if (second === "ATOMIC") return "BEGIN ATOMIC";
        return "BEGIN END";
    }
    if (derivedStatementPhraseKinds.has(statement.kind)) {
        const phrase = leadingKnownStatementPhrase(context, statement);
        if (phrase) return phrase;
    }
    const tokens = context.significantTokens(statement, 2);
    const first = tokens[0];
    if (!first) return undefined;
    const second = tokens[1];
    if (
        !second ||
        unnamedPhraseTokenKinds.has(second.kind) ||
        (second.text.length === 1 && !isIdentifierPhraseCharacter(second.text))
    ) {
        return first.text.toUpperCase();
    }
    return `${first.text} ${second.text}`.toUpperCase();
}

function validateFunctionBody(
    context: ModuleDiagnosticContext,
    module: SyntaxNode,
    tableValued: boolean,
    nameNode: SyntaxNode | undefined,
): void {
    const statements = moduleBodyStatements(module);
    const last = statements.at(-1);
    if (nameNode && last && directChildrenOfKind(last, "ReturnStatement").length === 0) {
        context.add(
            "LastStatementWithinFunctionMustBeReturn",
            "The last statement included within a function must be a return statement.",
            nameNode,
        );
    }

    for (const statement of descendantsOfKind(module, "Statement")) {
        for (const child of statement.children()) {
            if (containsSyntaxError(child)) continue;
            const phrase = sideEffectingPhrase(context, child);
            if (!phrase) continue;
            context.add(
                "InvalidUseOfSideEffectingOperatorWithinFunction",
                `Invalid use of a side-effecting operator '${phrase}' within a function.`,
                child,
            );
        }
    }

    for (const statement of statementsInModule(module)) {
        const intoSelect = directChildrenOfKind(statement, "SelectStatement")[0];
        if (
            intoSelect &&
            !containsSyntaxError(intoSelect) &&
            firstDescendantOfKind(intoSelect, "IntoClause")
        ) {
            context.add(
                "InvalidUseOfSideEffectingOperatorWithinFunction",
                "Invalid use of a side-effecting operator 'SELECT' within a function.",
                intoSelect,
            );
            continue;
        }

        const returnStatement = directChildrenOfKind(statement, "ReturnStatement")[0];
        if (returnStatement) {
            const expression = directChildrenOfKind(returnStatement, "Expression")[0];
            if (!tableValued && !expression) {
                context.add(
                    "ReturnStatementInScalarValuedFunctionMustIncludeArg",
                    "RETURN statements in scalar valued functions must include an argument.",
                    returnStatement,
                );
            } else if (tableValued && expression) {
                context.add(
                    "UseReturnStatementWithValueCannotBeUsed",
                    " A RETURN statement with a return value cannot be used in this context.",
                    returnStatement,
                );
            }
            continue;
        }

        const select = directChildrenOfKind(statement, "SelectStatement")[0];
        if (!select || !selectReturnsClientData(context.syntax, select)) continue;
        context.add(
            "SelectStatementWithinFunctionCannotReturnData",
            "Select statements included within a function cannot return data to a client.",
            select,
        );
    }
}

function leadingKnownStatementPhrase(
    context: Pick<ModuleDiagnosticContext, "significantTokens">,
    statement: SyntaxNode,
): string | undefined {
    const words = context.significantTokens(statement, 4).map((token) => token.text.toUpperCase());
    for (let length = words.length; length > 0; length--) {
        const candidate = words.slice(0, length).join(" ");
        if (knownStatementPhrases.has(candidate)) return candidate;
    }
    return undefined;
}

function sideEffectingPhrase(
    context: ModuleDiagnosticContext,
    statement: SyntaxNode,
): string | undefined {
    let phrase = sideEffectingStatementPhrases.get(statement.kind);
    if (phrase === undefined) {
        if (!derivedStatementPhraseKinds.has(statement.kind)) return undefined;
        phrase = leadingKnownStatementPhrase(context, statement);
        if (phrase === undefined) return undefined;
    }
    if (phrase === "SET" && directChildrenOfKind(statement, "Variable").length > 0) {
        return undefined;
    }
    if (dmlStatementPhrases.has(phrase) && isFunctionSafeDml(statement)) return undefined;
    return phrase;
}

function isFunctionSafeDml(statement: SyntaxNode): boolean {
    const target = firstDescendantOfKind(statement, "DmlTarget");
    if (!target) return true;
    if (!firstDescendantOfKind(target, "Variable")) return false;
    const output = firstDescendantOfKind(statement, "OutputClause");
    if (!output) return true;
    const into = firstDescendantOfKind(output, "OutputIntoClause");
    const intoTarget = into && firstDescendantOfKind(into, "DmlTarget");
    return intoTarget !== undefined && firstDescendantOfKind(intoTarget, "Variable") !== undefined;
}

function moduleOptionKey(value: string): string {
    const normalized = value.trim().replace(/\s+/gu, " ").toUpperCase();
    if (normalized.startsWith("EXECUTE AS ")) return "EXECUTE AS";
    if (normalized.startsWith("RETURNS NULL ON NULL INPUT")) return "RETURNS NULL ON NULL INPUT";
    if (normalized.startsWith("CALLED ON NULL INPUT")) return "CALLED ON NULL INPUT";
    if (normalized.startsWith("INLINE")) return "INLINE";
    return normalized;
}

function moduleBodyStatements(module: SyntaxNode): readonly SyntaxNode[] {
    const body = firstDescendantOfKind(module, "ModuleBody");
    const script = body && directChildrenOfKind(body, "Script")[0];
    const batch = script && directChildrenOfKind(script, "Batch")[0];
    const outer = batch ? directChildrenOfKind(batch, "Statement") : [];
    if (outer.length !== 1) return outer;
    const block = firstDescendantOfKind(outer[0]!, "BeginControlStatement");
    const nestedScript = block && directChildrenOfKind(block, "Script")[0];
    const nestedBatch = nestedScript && directChildrenOfKind(nestedScript, "Batch")[0];
    return nestedBatch ? directChildrenOfKind(nestedBatch, "Statement") : outer;
}

function statementsInModule(module: SyntaxNode): readonly SyntaxNode[] {
    return descendantsOfKind(module, "Statement").filter(
        (statement) =>
            directChildrenOfKind(statement, "ReturnStatement").length > 0 ||
            directChildrenOfKind(statement, "SelectStatement").length > 0,
    );
}

function selectReturnsClientData(syntax: SyntaxSnapshot, select: SyntaxNode): boolean {
    const list = firstDescendantOfKind(select, "SelectList");
    if (!list) return true;
    const elements = directChildrenOfKind(list, "SelectElement");
    return (
        elements.length === 0 ||
        elements.some(
            (element) =>
                !selectElementAssignsVariable(
                    syntax.document.text.slice(element.start, element.end),
                ),
        )
    );
}

function isIdentifierPhraseCharacter(value: string): boolean {
    return /[\p{L}\p{N}_]/u.test(value);
}

const sideEffectingStatementPhrases = new Map<string, string>([
    ["AlterFunctionStatement", "ALTER FUNCTION"],
    ["AlterProcedureStatement", "ALTER PROCEDURE"],
    ["AlterTriggerStatement", "ALTER TRIGGER"],
    ["AlterViewStatement", "ALTER VIEW"],
    ["CreateFunctionStatement", "CREATE FUNCTION"],
    ["CreateIndexStatement", "CREATE INDEX"],
    ["CreateProcedureStatement", "CREATE PROCEDURE"],
    ["CreateSchemaStatement", "CREATE SCHEMA"],
    ["CreateSynonymStatement", "CREATE SYNONYM"],
    ["CreateTableStatement", "CREATE TABLE"],
    ["CreateTriggerStatement", "CREATE TRIGGER"],
    ["CreateTypeStatement", "CREATE TYPE"],
    ["CreateViewStatement", "CREATE VIEW"],
    ["DbccStatement", "DBCC"],
    ["DeleteStatement", "DELETE"],
    ["DropDatabaseStatement", "DROP DATABASE"],
    ["DropFunctionStatement", "DROP FUNCTION"],
    ["DropProcedureStatement", "DROP PROCEDURE"],
    ["DropSchemaStatement", "DROP SCHEMA"],
    ["DropSequenceStatement", "DROP SEQUENCE"],
    ["DropSynonymStatement", "DROP SYNONYM"],
    ["DropTableStatement", "DROP TABLE"],
    ["DropTriggerStatement", "DROP TRIGGER"],
    ["DropTypeStatement", "DROP TYPE"],
    ["DropViewStatement", "DROP VIEW"],
    ["InsertStatement", "INSERT"],
    ["MergeStatement", "MERGE"],
    ["SetStatement", "SET"],
]);

const derivedStatementPhraseKinds = new Set([
    "AggregateStatement",
    "AlterPrincipalStatement",
    "BackupStatement",
    "CreatePrincipalStatement",
    "DropPrincipalStatement",
    "PermissionStatement",
    "RestoreStatement",
    "RuleDefaultStatement",
    "SecurityPolicyStatement",
]);

const knownStatementPhrases = new Set([
    "ALTER LOGIN",
    "BACKUP CERTIFICATE",
    "BACKUP DATABASE",
    "BACKUP LOG",
    "BACKUP MASTER KEY",
    "BACKUP SERVICE MASTER KEY",
    "BACKUP TABLE",
    "CREATE LOGIN",
    "CREATE ROLE",
    "CREATE USER",
    "DENY",
    "DROP AGGREGATE",
    "DROP DEFAULT",
    "DROP LOGIN",
    "DROP ROLE",
    "DROP RULE",
    "DROP SECURITY POLICY",
    "DROP USER",
    "GRANT",
    "RESTORE DATABASE",
    "RESTORE INFORMATION",
    "RESTORE LOG",
    "RESTORE MASTER KEY",
    "RESTORE SERVICE MASTER KEY",
    "RESTORE TABLE",
    "REVOKE",
]);

const dmlStatementPhrases = new Set(["DELETE", "INSERT", "MERGE"]);

const typedStatementPhrases = new Map<string, string>([
    ["AlterFunctionStatement", "ALTER FUNCTION"],
    ["AlterProcedureStatement", "ALTER PROCEDURE"],
    ["AlterTriggerStatement", "ALTER TRIGGER"],
    ["AlterViewStatement", "ALTER VIEW"],
    ["BreakStatement", "BREAK"],
    ["ContinueStatement", "CONTINUE"],
    ["CreateFunctionStatement", "CREATE FUNCTION"],
    ["CreateIndexStatement", "CREATE INDEX"],
    ["CreateProcedureStatement", "CREATE PROCEDURE"],
    ["CreateSchemaStatement", "CREATE SCHEMA"],
    ["CreateSynonymStatement", "CREATE SYNONYM"],
    ["CreateTableStatement", "CREATE TABLE"],
    ["CreateTriggerStatement", "CREATE TRIGGER"],
    ["CreateTypeStatement", "CREATE TYPE"],
    ["CreateViewStatement", "CREATE VIEW"],
    ["DbccStatement", "DBCC"],
    ["DeleteStatement", "DELETE"],
    ["DropDatabaseStatement", "DROP DATABASE"],
    ["DropFunctionStatement", "DROP FUNCTION"],
    ["DropIndexStatement", "DROP INDEX"],
    ["DropProcedureStatement", "DROP PROCEDURE"],
    ["DropSchemaStatement", "DROP SCHEMA"],
    ["DropSequenceStatement", "DROP SEQUENCE"],
    ["DropSynonymStatement", "DROP SYNONYM"],
    ["DropTableStatement", "DROP TABLE"],
    ["DropTriggerStatement", "DROP TRIGGER"],
    ["DropTypeStatement", "DROP TYPE"],
    ["DropViewStatement", "DROP VIEW"],
    ["ExecuteStatement", "EXECUTE"],
    ["IfStatement", "IF"],
    ["InsertStatement", "INSERT"],
    ["MergeStatement", "MERGE"],
    ["ReturnStatement", "RETURN"],
    ["SelectStatement", "SELECT"],
    ["SetStatement", "SET"],
    ["UpdateStatement", "UPDATE"],
    ["UseStatement", "USE"],
    ["WhileStatement", "WHILE"],
]);

const unnamedPhraseTokenKinds = new Set([
    "BracketedIdentifier",
    "DoubleQuotedIdentifier",
    "GlobalVariable",
    "Identifier",
    "TempIdentifier",
    "Variable",
]);

const scalarFunctionOptions = new Set([
    "ENCRYPTION",
    "SCHEMABINDING",
    "EXECUTE AS",
    "RETURNS NULL ON NULL INPUT",
    "CALLED ON NULL INPUT",
    "INLINE",
]);
const tableFunctionOptions = new Set(["ENCRYPTION", "SCHEMABINDING", "EXECUTE AS"]);
const inlineTableFunctionOptions = new Set(["ENCRYPTION", "SCHEMABINDING", "NATIVE_COMPILATION"]);
const externalScalarFunctionOptions = new Set([
    "EXECUTE AS",
    "RETURNS NULL ON NULL INPUT",
    "CALLED ON NULL INPUT",
]);
const externalTableFunctionOptions = new Set(["EXECUTE AS"]);
const knownFunctionOptions = new Set([
    "CALLED ON NULL INPUT",
    "ENCRYPTION",
    "EXECUTE AS",
    "INLINE",
    "NATIVE_COMPILATION",
    "RECOMPILE",
    "RETURNS NULL ON NULL INPUT",
    "SCHEMABINDING",
]);
