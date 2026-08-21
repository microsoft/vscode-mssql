/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot, SyntaxToken } from "../../syntax/index.js";
import {
    directChildrenOfKind,
    descendantsOwnedByKind,
    firstDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import {
    compactMultipartName,
    multipartIdentifierParts,
    normalizeIdentifier,
} from "../identifiers.js";
import type { UserTypeState } from "./objectDiagnostics.js";
import type { DiagnosticFamilyContext } from "./contracts.js";
import {
    columnDefinitionTextFacts,
    isNumericIdentityValue,
    normalizedSystemDataTypeText,
    parseDataTypeText,
    routineParameterTextFacts,
} from "./diagnosticTextFacts.js";

export interface DataTypeDiagnosticContext extends DiagnosticFamilyContext {
    readonly syntax: SyntaxSnapshot;
    significantTokens(range: TextRange, limit: number): readonly SyntaxToken[];
    reportOverPrefixedTypeNames(
        dataType: SyntaxNode,
        parts: readonly string[],
        parsedName: string,
    ): boolean;
    userTypeAt(parts: readonly string[], offset: number): UserTypeState;
    isKnownSystemDataType(parts: readonly string[], name: string, source: string): boolean;
    tableDefinitionOwner(definition: SyntaxNode): string;
}

/** Validates data-type resolution, arguments, column options, and identity contracts. */
export function validateDataTypesAndColumns(context: DataTypeDiagnosticContext): void {
    for (const dataType of context.nodes("DataType")) {
        const source = context.source(dataType);
        const parsed = parseDataTypeText(source);
        if (!parsed) continue;
        const parts = dataTypeParts(context.syntax, dataType);
        if (context.reportOverPrefixedTypeNames(dataType, parts, parsed.name)) continue;
        const systemType = context.isKnownSystemDataType(parts, parsed.name, source);
        const typeResolution = systemType ? undefined : context.userTypeAt(parts, dataType.start);
        if (
            (["CastExpression", "TryCastExpression", "ConvertExpression"] as const).some((kind) =>
                parentOfKind(dataType, kind),
            ) &&
            !systemType
        ) {
            context.add(
                "TypeIsNotSystemType",
                `Type '${compactMultipartName(source)}' is not a defined system type.`,
                dataType,
            );
        }
        const column = parentOfKind(dataType, "ColumnDefinition");
        const parameter = parentOfKind(dataType, "ProcedureParameter");
        const variable = parentOfKind(dataType, "VariableDeclaration");
        const collation = column
            ? descendantsOwnedByKind(column, "ColumnOption", column).find(
                  (option) =>
                      context.significantTokens(option, 1)[0]?.text.toUpperCase() === "COLLATE",
              )
            : undefined;
        if (typeResolution?.kind === "notFound" && !parentOfKind(dataType, "CreateTypeStatement")) {
            if (column) {
                const nameNode = firstDescendantOfKind(column, "IdentifierName");
                const name = nameNode
                    ? normalizeIdentifier(context.source(nameNode))
                    : compactMultipartName(source);
                context.add(
                    "ColumnHasInvalidDataType",
                    `Column '${name}' has an invalid data type.`,
                    dataType,
                );
            } else if (parameter || variable) {
                const owner = parameter ?? variable!;
                const variableNode = firstDescendantOfKind(owner, "Variable");
                const name = variableNode ? context.source(variableNode) : "";
                context.add(
                    "ParamVarHasInvalidDataType",
                    `Parameter or variable '${name}' has an invalid data type.`,
                    dataType,
                );
            }
        }
        if (typeResolution?.kind === "resolved") {
            if (column && typeResolution.typeCategory === "table") {
                const nameNode = firstDescendantOfKind(column, "IdentifierName");
                const name = nameNode ? normalizeIdentifier(context.source(nameNode)) : "";
                context.add(
                    "ColumnHasUserDefinedTableType",
                    `The column "${name}" does not have a valid data type. A column cannot be of a user-defined table type.`,
                    dataType,
                );
            }
            if (parameter) {
                const variableNode = firstDescendantOfKind(parameter, "Variable");
                const name = variableNode ? context.source(variableNode) : "";
                const readOnly = routineParameterTextFacts(context.source(parameter)).readOnly;
                if (typeResolution.typeCategory === "table" && !readOnly) {
                    context.add(
                        "TableValuedParameterMustBeReadOnly",
                        `The table-valued parameter "${name}" must be declared with the READONLY option.`,
                        dataType,
                    );
                } else if (typeResolution.typeCategory !== "table" && readOnly) {
                    context.add(
                        "ParameterCannotBeReadOnly",
                        `The parameter "${name}" can not be declared READONLY since it is not a table-valued parameter.`,
                        dataType,
                    );
                }
            }
        } else if (
            parameter &&
            systemType &&
            routineParameterTextFacts(context.source(parameter)).readOnly
        ) {
            const variableNode = firstDescendantOfKind(parameter, "Variable");
            const name = variableNode ? context.source(variableNode) : "";
            context.add(
                "ParameterCannotBeReadOnly",
                `The parameter "${name}" can not be declared READONLY since it is not a table-valued parameter.`,
                dataType,
            );
        }
        if (collation) {
            if (typeResolution?.kind === "resolved") {
                context.add(
                    "CollateCannotBeUsedOnUddt",
                    "COLLATE clause cannot be used on user-defined data types.",
                    collation,
                );
            } else if (systemType && !isCollatableSystemDataType(parsed.name, source)) {
                context.add(
                    "ExpressionTypeInvalidForCollate",
                    `Expression type ${parsed.name} is invalid for COLLATE clause.`,
                    collation,
                );
            }
        }
        validateDataTypeArguments(context, dataType, parsed.name, parsed.arguments);
    }

    for (const column of context.nodes("ColumnDefinition")) {
        const nameNode = firstDescendantOfKind(column, "IdentifierName");
        const typeNode = firstDescendantOfKind(column, "DataType");
        if (!nameNode) continue;
        const name = normalizeIdentifier(context.source(nameNode));
        const owner = context.tableDefinitionOwner(
            parentOfKind(column, "TableDefinition") ?? column,
        );
        const facts = columnDefinitionTextFacts(context.source(column));
        if (!typeNode) {
            context.add(
                "DataTypeMissing",
                `The definition for column '${name}' must include a data type.`,
                nameNode,
            );
            continue;
        }
        const type = parseDataTypeText(context.source(typeNode))?.name;
        if (facts.identity && facts.explicitlyNullable) {
            context.add(
                "CannotCreateIdentityOnNullable",
                `Could not create IDENTITY attribute on nullable column '${name}', table '${owner}'.`,
                nameNode,
            );
        }
        if (facts.identity && facts.hasDefault) {
            context.add(
                "CannotHaveDefaultsOnIdentity",
                `Defaults cannot be created on columns with an IDENTITY attribute. Table '${owner}', column '${name}'.`,
                nameNode,
            );
        }
        if (facts.identity && type && !identityTypes.has(type)) {
            context.add(
                "IdentityColumnInvalidType",
                `Identity column '${name}' must be of data type int, bigint, smallint, tinyint, or decimal or numeric with a scale of 0, and constrained to be nonnullable.`,
                nameNode,
            );
        }
        const identityArguments = firstDescendantOfKind(column, "IdentityArguments");
        if (identityArguments) {
            const values = directChildrenOfKind(identityArguments, "Expression");
            if (values[0] && !isNumericIdentityValue(context.source(values[0]))) {
                context.add(
                    "InvalidSeed",
                    `Identity column '${name}' contains invalid SEED.`,
                    values[0],
                );
            }
            if (values[1] && !isNumericIdentityValue(context.source(values[1]))) {
                context.add(
                    "InvalidIncrement",
                    `Identity column '${name}' contains invalid INCREMENT.`,
                    values[1],
                );
            }
        }
        if (facts.rowGuidColumn && type !== "uniqueidentifier") {
            context.add(
                "RowguidcolDatatypeMismatch",
                "The ROWGUIDCOL property can only be specified on the uniqueidentifier data type.",
                nameNode,
            );
        }
        if (facts.primaryKeyCount > 0 && facts.explicitlyNullable) {
            context.add(
                "CannotDefinePrimaryKeyOnNullable",
                `Cannot define PRIMARY KEY constraint on nullable column in table '${owner}'.`,
                nameNode,
            );
        }
    }
}

function validateDataTypeArguments(
    context: DataTypeDiagnosticContext,
    dataType: SyntaxNode,
    name: string,
    arguments_: readonly number[],
): void {
    const [first, second] = arguments_;
    if (["decimal", "numeric"].includes(name)) {
        if (first !== undefined && (first < 1 || first > 38)) {
            context.add(
                "InvalidLengthOrPrecision",
                `Length or precision specification ${first} is invalid.`,
                dataType,
            );
        }
        if (second !== undefined && (second < 0 || second > 38)) {
            context.add("InvalidScale", `Specified scale ${second} is invalid.`, dataType);
        }
        if (first !== undefined && second !== undefined && second > first) {
            context.add(
                "ScalePrecisionMismatch",
                "The scale must be less than or equal to the precision.",
                dataType,
            );
        }
    }
    const lengthArgument = firstArgumentNode(dataType) ?? dataType;
    const maximum = typeLengthMaximum[name];
    if (
        arguments_.length === 1 &&
        first !== undefined &&
        first > maximumSizeForAnyType &&
        !scaleArgumentTypes.has(name)
    ) {
        context.add(
            "MaximumSizeErrorForAnyType",
            `The size (${first}) given to the type '${name}' exceeds the maximum allowed for any data type (${maximumSizeForAnyType}).`,
            lengthArgument,
        );
    } else if (maximum && first !== undefined && first > maximum) {
        context.add(
            "MaximumSizeError",
            `The size (${first}) given to the type '${name}' exceeds the maximum allowed (${maximum}).`,
            dataType,
        );
    }
    if (
        ["time", "datetime2", "datetimeoffset"].includes(name) &&
        first !== undefined &&
        (first < 0 || first > 7)
    ) {
        context.add("InvalidScale", `Specified scale ${first} is invalid.`, dataType);
    }
    if (name === "float" && first !== undefined && (first < 1 || first > 53)) {
        context.add(
            "InvalidLengthOrPrecision",
            `Length or precision specification ${first} is invalid.`,
            dataType,
        );
    }
}

function firstArgumentNode(dataType: SyntaxNode): SyntaxNode | undefined {
    const argumentList = firstDescendantOfKind(dataType, "ArgumentList");
    return argumentList ? directChildrenOfKind(argumentList, "Expression")[0] : undefined;
}

function dataTypeParts(syntax: SyntaxSnapshot, dataType: SyntaxNode): readonly string[] {
    const name = firstDescendantOfKind(dataType, "MultipartIdentifier");
    return name ? multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)) : [];
}

function isCollatableSystemDataType(name: string, source: string): boolean {
    return (
        collatableSystemDataTypes.has(name) ||
        collatableSystemTypeSynonyms.has(normalizedSystemDataTypeText(source))
    );
}

const maximumSizeForAnyType = 8000;
const scaleArgumentTypes = new Set(["datetime2", "datetimeoffset", "time"]);
const identityTypes = new Set(["bigint", "decimal", "int", "numeric", "smallint", "tinyint"]);
const typeLengthMaximum: Readonly<Record<string, number>> = Object.freeze({
    binary: 8000,
    char: 8000,
    nchar: 4000,
    nvarchar: 4000,
    varbinary: 8000,
    varchar: 8000,
});
const collatableSystemDataTypes = new Set([
    "char",
    "nchar",
    "ntext",
    "nvarchar",
    "sysname",
    "text",
    "varchar",
]);
const collatableSystemTypeSynonyms = new Set([
    "char varying",
    "character",
    "character varying",
    "national char",
    "national char varying",
    "national character",
    "national character varying",
]);
