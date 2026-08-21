/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AnalysisProfile } from "../../common/analysisProfile.js";
import type { SyntaxKind, SyntaxNode } from "../../syntax/index.js";
import {
    containsSyntaxError,
    descendantsOfKind,
    directChildrenOfKind,
    firstDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import { multipartIdentifierParts, normalizeIdentifier } from "../identifiers.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

/** Build-mode policy needs statement naming in addition to the common diagnostic surface. */
export interface BuildModeDiagnosticContext extends DiagnosticFamilyContext {
    readonly profile: AnalysisProfile;
    statementPhrase(statement: SyntaxNode): string | undefined;
}

const createDdlKinds = new Set<SyntaxKind>([
    "CreateFunctionStatement",
    "CreateIndexStatement",
    "CreatePrincipalStatement",
    "CreateProcedureStatement",
    "CreateSchemaStatement",
    "CreateSynonymStatement",
    "CreateTableStatement",
    "CreateTriggerStatement",
    "CreateTypeStatement",
    "CreateViewStatement",
]);

const unsupportedDataTypes = new Set(["geography", "geometry", "hierarchyid"]);

// These patterns classify one parser-owned option node. They deliberately do not discover
// statements or clauses, and each is covered by build-mode diagnostic tests.
const executeAsSelf = /^\s*EXEC(?:UTE)?\s+AS\s+SELF\s*$/iu;
const defaultDatabaseOption = /^\s*DEFAULT_DATABASE\b/iu;
const mustChangeOption = /^\s*MUST_CHANGE\s*$/iu;
const windowsLoginCreation = /^\s*FROM\s+WINDOWS\b/iu;

/** Reports statements and code-object options a data-tier application build cannot replay. */
export function validateBuildMode(context: BuildModeDiagnosticContext): void {
    if (context.profile.deploymentMode !== "build") return;
    for (const batch of context.nodes("Batch")) {
        // Module bodies mount their own Script/Batch. Only the script's own statements are built.
        if (parentOfKind(batch, "Statement")) continue;
        for (const statement of directChildrenOfKind(batch, "Statement")) {
            // Damaged input has no reliable statement identity, so it produces no build error.
            if (containsSyntaxError(statement)) continue;
            const node = buildModeStatementNode(statement);
            if (!node) continue;
            if (!createDdlKinds.has(node.kind)) {
                const phrase = context.statementPhrase(node);
                if (!phrase) continue;
                context.add(
                    "InvalidBuildModeSqlNullStatement",
                    `The '${phrase}' statement is not supported in a data-tier application. Remove the statement before rebuilding.`,
                    statement,
                );
                continue;
            }
            validateBuildModeCodeObjects(context, node);
            const message = buildModeStatementMessage(context, node);
            if (message) context.add(message[0], message[1], statement);
        }
    }
}

function validateBuildModeCodeObjects(
    context: BuildModeDiagnosticContext,
    statement: SyntaxNode,
): void {
    for (const dataType of descendantsOfKind(statement, "DataType")) {
        const name = unsupportedDataType(context.source(dataType));
        if (!name) continue;
        context.add(
            "InvalidBuildModeDataTypeUse",
            `Using the '${name}' data type is not supported in a data-tier application. Remove the statement or change the data type before rebuilding.`,
            dataType,
        );
    }
    for (const kind of ["ProcedureOption", "TriggerOption", "FunctionOption"] as const) {
        for (const option of descendantsOfKind(statement, kind)) {
            if (!executeAsSelf.test(context.source(option))) continue;
            context.add(
                "InvalidBuildModeExecutionContextTypeSelf",
                "EXECUTE AS SELF option is not supported in a data-tier application. Specify the principal name explicitly before rebuilding.",
                option,
            );
        }
    }
}

function buildModeStatementMessage(
    context: BuildModeDiagnosticContext,
    statement: SyntaxNode,
): readonly [code: string, message: string] | undefined {
    switch (statement.kind) {
        case "CreateSchemaStatement":
            return directChildrenOfKind(statement, "SchemaElement").length > 0
                ? [
                      "InvalidBuildModeStatementCreateSchema",
                      "CREATE SCHEMA statements that contain schema elements are not supported in a data-tier application. Remove the elements from the statement or write the elements as separate DDL statements before rebuilding.",
                  ]
                : undefined;
        case "CreateIndexStatement":
            return hasDropExistingIndexOption(context, statement)
                ? [
                      "InvalidBuildModeStatementCreateIndex",
                      "CREATE INDEX statements with a DROP_EXISTING option are not supported in a data-tier application. Remove the statement or the DROP EXISTING option before rebuilding.",
                  ]
                : undefined;
        case "CreateProcedureStatement":
            if (hasCursorParameter(statement)) {
                return [
                    "InvalidBuildModeStatementCreateProcCursorParams",
                    "CREATE PROCEDURE statements with cursor parameters are not supported in a data-tier application. Remove the statement or the cursor parameter before rebuilding.",
                ];
            }
            return hasModuleEncryptionOption(context, statement, "ProcedureOption")
                ? [
                      "InvalidBuildModeStatementCreateProcedureWithEncryption",
                      "CREATE PROCEDURE statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                  ]
                : undefined;
        case "CreateFunctionStatement":
            if (firstDescendantOfKind(statement, "ExternalModuleBody")) {
                return [
                    "InvalidBuildModeSqlNullStatement",
                    "The 'CREATE FUNCTION' statement is not supported in a data-tier application. Remove the statement before rebuilding.",
                ];
            }
            if (hasCursorParameter(statement)) {
                return [
                    "InvalidBuildModeStatementCreateFunction",
                    "CREATE FUNCTION statements with cursor parameters are not supported in a data-tier application. Remove the statement or the cursor parameter before rebuilding.",
                ];
            }
            return hasModuleEncryptionOption(context, statement, "FunctionOption")
                ? [
                      "InvalidBuildModeStatementCreateFunctionWithEncryption",
                      "CREATE FUNCTION statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                  ]
                : undefined;
        case "CreateTriggerStatement":
            if (isDdlTriggerDefinition(statement)) {
                return [
                    "InvalidBuildModeStatementCreateTriggerDdl",
                    "CREATE TRIGGER statements for DDL triggers are not supported in a data-tier application. Remove the statement before rebuilding.",
                ];
            }
            return hasModuleEncryptionOption(context, statement, "TriggerOption")
                ? [
                      "InvalidBuildModeStatementCreateTriggerWithEncryption",
                      "CREATE TRIGGER statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                  ]
                : undefined;
        case "CreateViewStatement": {
            const options = firstDescendantOfKind(statement, "ViewOptionClause");
            const encrypted =
                options !== undefined &&
                descendantsOfKind(options, "IdentifierName").some(
                    (name) => context.source(name).toUpperCase() === "ENCRYPTION",
                );
            return encrypted
                ? [
                      "InvalidBuildModeStatementCreateViewWithEncryption",
                      "CREATE VIEW statements with ENCRYPTION option are not supported in a data-tier application. Remove the statement or ENCRYPTION option before rebuilding.",
                  ]
                : undefined;
        }
        case "CreatePrincipalStatement":
            return createLoginBuildModeMessage(context, statement);
        default:
            return undefined;
    }
}

function createLoginBuildModeMessage(
    context: BuildModeDiagnosticContext,
    statement: SyntaxNode,
): readonly [code: string, message: string] | undefined {
    const creation = firstDescendantOfKind(statement, "LoginCreationClause");
    if (!creation) return undefined;
    const defaultDatabase = descendantsOfKind(creation, "PrincipalNonPasswordOption").some(
        (option) => defaultDatabaseOption.test(context.source(option)),
    );
    if (firstDescendantOfKind(creation, "LoginPasswordOption")) {
        const mustChange = directChildrenOfKind(creation, "LoginPasswordModifier").some(
            (modifier) => mustChangeOption.test(context.source(modifier)),
        );
        if (!mustChange) {
            return [
                "InvalidBuildModeStatementCreateLogin",
                "CREATE LOGIN statements with PASSWORD or SID options that do not specify a MUST_CHANGE option are not supported in a data-tier application. Remove the statement or add the MUST_CHANGE option before rebuilding.",
            ];
        }
    } else if (!windowsLoginCreation.test(context.source(creation))) {
        return undefined;
    }
    return defaultDatabase
        ? [
              "InvalidBuildModeStatementCreateLoginWithDefaultDatabase",
              "CREATE LOGIN statements with DEFAULT_DATABASE option are not supported in a data-tier application. Remove the statement or DEFAULT_DATABASE option before rebuilding.",
          ]
        : undefined;
}

export function hasDropExistingIndexOption(
    context: Pick<DiagnosticFamilyContext, "source">,
    statement: SyntaxNode,
): boolean {
    return descendantsOfKind(statement, "GenericOption").some((option) => {
        const name = firstDescendantOfKind(option, "GenericOptionName");
        if (
            !name ||
            normalizeIdentifier(context.source(name).trim()).toUpperCase() !== "DROP_EXISTING"
        ) {
            return false;
        }
        const value = firstDescendantOfKind(option, "OptionValue");
        return !value || context.source(value).toUpperCase() !== "OFF";
    });
}

function hasCursorParameter(statement: SyntaxNode): boolean {
    return descendantsOfKind(statement, "ProcedureParameter").some(
        (parameter) => directChildrenOfKind(parameter, "Cursor").length > 0,
    );
}

function hasModuleEncryptionOption(
    context: BuildModeDiagnosticContext,
    statement: SyntaxNode,
    optionKind: SyntaxKind,
): boolean {
    return descendantsOfKind(statement, optionKind).some(
        (option) => moduleOptionKey(context.source(option)) === "ENCRYPTION",
    );
}

function isDdlTriggerDefinition(statement: SyntaxNode): boolean {
    const target = firstDescendantOfKind(statement, "TriggerTarget");
    return (
        target !== undefined && firstDescendantOfKind(target, "MultipartIdentifier") === undefined
    );
}

function unsupportedDataType(source: string): string | undefined {
    const parts = multipartIdentifierParts(source.replace(/\(.*$/su, ""));
    const name = parts.at(-1)?.toLowerCase();
    return name !== undefined && unsupportedDataTypes.has(name) ? name : undefined;
}

function buildModeStatementNode(statement: SyntaxNode): SyntaxNode | undefined {
    const child = [...statement.children()][0];
    if (!child) return undefined;
    if (child.kind !== "ProceduralStatement") return child;
    return [...child.children()][0] ?? child;
}

// Module options are already parser-owned nodes; whitespace folding is lexical normalization, not
// a second parser. The option family and build family share this exact key policy.
function moduleOptionKey(value: string): string {
    const normalized = value.trim().replace(/\s+/gu, " ").toUpperCase();
    if (normalized.startsWith("EXECUTE AS ")) return "EXECUTE AS";
    if (normalized.startsWith("RETURNS NULL ON NULL INPUT")) return "RETURNS NULL ON NULL INPUT";
    if (normalized.startsWith("CALLED ON NULL INPUT")) return "CALLED ON NULL INPUT";
    if (normalized.startsWith("INLINE")) return "INLINE";
    return normalized;
}
