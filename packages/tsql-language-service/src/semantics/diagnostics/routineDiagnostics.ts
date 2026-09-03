/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lookupBuiltIn } from "../../common/builtInRegistry.js";
import type { MetadataView, ParameterMetadata } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxToken } from "../../syntax/index.js";
import { compactMultipartName, multipartIdentifierParts } from "../identifiers.js";
import {
    ancestorOfKind,
    containsSyntaxError,
    directChildrenOfKind,
    descendantsOwnedByKind,
    firstDescendantOfKind,
} from "../../syntax/treeUtilities.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

/** Routine diagnostics use the same pinned catalog and type table as the document binder. */
export interface RoutineDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    fold(value: string): string;
    localProcedureParameters(
        parts: readonly string[],
        offset: number,
    ): readonly ParameterMetadata[] | undefined;
    significantTokens(
        range: { readonly start: number; readonly end: number },
        limit: number,
    ): readonly SyntaxToken[];
    validateNonScalarArgumentType(
        argument: SyntaxNode,
        parameter: ParameterMetadata,
        named: boolean,
    ): void;
}

/** Validates bare routine names without re-parsing their source text. */
export function validateBuiltInRoutineNames(context: DiagnosticFamilyContext): void {
    for (const call of context.nodes("FunctionCall")) {
        if (containsSyntaxError(call)) continue;
        const containingColumn = ancestorOfKind(call, ["ColumnDefinition"]);
        if (containingColumn && containsSyntaxError(containingColumn)) continue;
        const nameNode = firstDescendantOfKind(call, "MultipartIdentifier");
        if (!nameNode) continue;
        const displayName = compactMultipartName(context.source(nameNode));
        const parts = multipartIdentifierParts(displayName);
        if (parts.length !== 1) continue;
        const name = parts[0]!;
        if (lookupBuiltIn(name, "routine")) continue;
        // OVER/WITHIN GROUP calls are parsed as analytic forms; their specialized validation owns
        // them even if a newer engine introduces a name this registry does not know yet.
        if (
            directChildrenOfKind(call, "OverClause").length > 0 ||
            directChildrenOfKind(call, "WithinGroupClause").length > 0
        ) {
            continue;
        }
        if (directChildrenOfKind(call, "FunctionMemberCall").length > 0) continue;
        if (ancestorOfKind(call, ["VariableMemberExpression"])) continue;
        context.add(
            "NotRecognizedFunctionName",
            `'${displayName}' is not a recognized built-in function name.`,
            nameNode,
        );
    }
}

/** Validates EXECUTE targets, positional/named arguments, output parameters, and required values. */
export function validateExecutions(context: RoutineDiagnosticContext): void {
    for (const execute of context.nodes("ExecuteStatement")) {
        validateExecuteArgumentFormat(context, execute);
        for (const argument of descendantsOwnedByKind(execute, "ExecuteArgument", execute)) {
            const option = firstDescendantOfKind(argument, "ExecuteArgumentOption");
            if (option && directChildrenOfKind(option, "ReadOnly").length > 0) {
                context.add(
                    "ReadonlyCannotBeUsed",
                    "The READONLY option cannot be used in an EXECUTE or CREATE AGGREGATE statement.",
                    option,
                );
                continue;
            }
            if (!option || !isOutputOption(option)) continue;
            const expression = firstDescendantOfKind(argument, "Expression");
            if (expression && expressionIsOneVariable(context, expression)) continue;
            context.add(
                "InvalidConstantOutput",
                "Cannot use the OUTPUT option when passing a constant to a stored procedure.",
                argument,
            );
        }
        const entity = firstDescendantOfKind(execute, "ExecutableEntity");
        const nameNode = entity && firstDescendantOfKind(entity, "MultipartIdentifier");
        if (!nameNode) continue;
        const name = compactMultipartName(context.source(nameNode));
        const parts = multipartIdentifierParts(name);
        const local = context.localProcedureParameters(parts, nameNode.start);
        if (local) {
            validateExecuteArguments(context, execute, name, local);
            continue;
        }
        const resolution = context.metadata.resolveObject(parts);
        if (resolution.kind === "notFound") {
            context.add(
                "CannotFindStoredProcedure",
                `Could not find stored procedure '${name}'.`,
                nameNode,
            );
            continue;
        }
        if (resolution.kind !== "resolved") continue;
        if (resolution.object.kind !== "procedure") {
            context.add(
                "ObjectNotExistOrIsInvalid",
                `The object '${name}' does not exist or is invalid for this operation.`,
                nameNode,
            );
            continue;
        }
        const state = context.metadata.parameterState(resolution.object.ref);
        if (state.kind === "loaded") validateExecuteArguments(context, execute, name, state.value);
    }
}

function validateExecuteArguments(
    context: RoutineDiagnosticContext,
    execute: SyntaxNode,
    procedureName: string,
    parameters: readonly ParameterMetadata[],
): void {
    const arguments_ = descendantsOwnedByKind(execute, "ExecuteArgument", execute);
    if (parameters.length === 0 && arguments_.length > 0) {
        context.add(
            "MissingParameters",
            `Procedure ${procedureName} has no parameters and arguments were supplied.`,
            arguments_[0]!,
        );
        return;
    }
    if (arguments_.length > parameters.length) {
        context.add(
            "TooManyArguments",
            `Procedure or function '${procedureName}' has too many arguments specified.`,
            arguments_.at(-1)!,
        );
    }
    const parameterByName = new Map(
        parameters.map((parameter) => [context.fold(parameter.name), parameter]),
    );
    const supplied = new Set<string>();
    for (const [index, argument] of arguments_.entries()) {
        const namedArgument = firstDescendantOfKind(argument, "NamedExecuteArgument");
        const variable = namedArgument && firstDescendantOfKind(namedArgument, "Variable");
        const named = variable && context.source(variable);
        if (!named) {
            const positional = parameters[index];
            if (positional) {
                supplied.add(context.fold(positional.name));
                context.validateNonScalarArgumentType(argument, positional, false);
            }
            continue;
        }
        const key = context.fold(named);
        if (supplied.has(key)) {
            context.add(
                "ParameterSuppliedMultipleTimes",
                `Parameter '${named}' was supplied multiple times.`,
                variable,
            );
            continue;
        }
        supplied.add(key);
        const parameter = parameterByName.get(key);
        if (parameter) context.validateNonScalarArgumentType(argument, parameter, true);
        if (!parameter) {
            context.add(
                "InvalidParameter",
                `${named} is not a parameter for procedure ${procedureName}.`,
                variable,
            );
        } else {
            const option = firstDescendantOfKind(argument, "ExecuteArgumentOption");
            if (option && isOutputOption(option) && !parameter.output) {
                context.add(
                    "OutputParameterMismatch",
                    `The formal parameter "${named}" was not declared as an OUTPUT parameter, but the actual parameter passed in requested output.`,
                    variable,
                );
            }
        }
    }
    for (const parameter of parameters) {
        if (
            parameter.ordinal <= 0 ||
            parameter.hasDefault !== false ||
            supplied.has(context.fold(parameter.name))
        ) {
            continue;
        }
        context.add(
            "MissingParameter",
            `Procedure or function '${procedureName}' expects parameter '${parameter.name}', which was not supplied.`,
            execute,
        );
    }
}

function validateExecuteArgumentFormat(
    context: RoutineDiagnosticContext,
    execute: SyntaxNode,
): void {
    const arguments_ = descendantsOwnedByKind(execute, "ExecuteArgument", execute);
    let namedSeen = false;
    for (const [index, argument] of arguments_.entries()) {
        if (firstDescendantOfKind(argument, "NamedExecuteArgument")) {
            namedSeen = true;
            continue;
        }
        if (!namedSeen) continue;
        context.add(
            "InconsistentParameterFormat",
            `Must pass parameter number ${index + 1} and subsequent parameters as '@name = value'. After the form '@name = value' has been used, all subsequent parameters must be passed in the form '@name = value'.`,
            argument,
        );
        break;
    }
}

function isOutputOption(option: SyntaxNode): boolean {
    return (
        directChildrenOfKind(option, "Output").length > 0 ||
        directChildrenOfKind(option, "Out").length > 0
    );
}

function expressionIsOneVariable(
    context: RoutineDiagnosticContext,
    expression: SyntaxNode,
): boolean {
    const tokens = context.significantTokens(expression, 2);
    return tokens.length === 1 && tokens[0]?.kind === "Variable";
}
