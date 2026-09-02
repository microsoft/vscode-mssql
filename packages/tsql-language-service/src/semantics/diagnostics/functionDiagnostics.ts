/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtInArity } from "../../common/builtInRegistry.js";
import type { MetadataView, ParameterMetadata } from "../../metadata/index.js";
import type { SyntaxNode } from "../../syntax/index.js";
import {
    directChildrenOfKind,
    firstDescendantOfKind,
    parentOfKind,
} from "../../syntax/treeUtilities.js";
import {
    compactMultipartName,
    multipartIdentifierParts,
    normalizeIdentifier,
} from "../identifiers.js";
import { routineCallArguments } from "../routineCall.js";
import type { DiagnosticFamilyContext } from "./contracts.js";

/** Function validation reads routine metadata from the same pinned semantic snapshot. */
export interface FunctionDiagnosticContext extends DiagnosticFamilyContext {
    readonly metadata: MetadataView;
    localFunctionParameters(
        parts: readonly string[],
        offset: number,
    ): readonly ParameterMetadata[] | undefined;
}

/** Validates built-in argument counts and keyword-like arguments from the shared registry. */
export function validateBuiltInFunctions(context: FunctionDiagnosticContext): void {
    for (const call of context.nodes("FunctionCall")) {
        const nameNode = firstDescendantOfKind(call, "MultipartIdentifier");
        if (!nameNode) continue;
        const parts = multipartIdentifierParts(context.source(nameNode));
        if (parts.length !== 1) continue;
        const name = parts[0]!.toUpperCase();
        const aggregate =
            aggregateFunctionNames.has(name) ||
            directChildrenOfKind(call, "Star").length > 0 ||
            directChildrenOfKind(call, "Distinct").length > 0;
        const arity =
            parentOfKind(call, "PivotJoin") || aggregate
                ? fallbackArities.get(name)
                : (builtInArity(name) ?? fallbackArities.get(name));
        const argumentList = firstDescendantOfKind(call, "ArgumentList");
        const arguments_ = argumentList ? directChildrenOfKind(argumentList, "Expression") : [];
        if (arity && (arguments_.length < arity.minimum || arguments_.length > arity.maximum)) {
            context.add(arityCode(arity), arityMessage(name, arity), nameNode);
        }
        if (datePartFunctions.has(name) && arguments_.length > 0) {
            const argument = arguments_[0]!;
            const option = context.source(argument).trim();
            const reference = firstDescendantOfKind(argument, "ColumnReference");
            if (!reference) {
                context.add(
                    "InvalidParameterOne",
                    `Invalid parameter 1 specified for ${name}.`,
                    argument,
                );
            } else if (!dateParts.has(option.toUpperCase())) {
                context.add(
                    "NotRecognizedDatePartOption",
                    `'${normalizeIdentifier(option)}' is not a recognized ${name} option.`,
                    argument,
                );
            }
        }
        if (name === "ISJSON" && arguments_.length > 1) {
            const argument = arguments_[1]!;
            const option = normalizeIdentifier(context.source(argument).trim());
            if (!isJsonValueTypes.has(option.toUpperCase())) {
                context.add(
                    "NotRecognizedIsJsonType",
                    `'${option}' is not a recognized ISJSON option.`,
                    argument,
                );
            }
        }
    }
}

/** Validates document-local and catalog scalar/table-function argument counts. */
export function validateCatalogFunctionArguments(context: FunctionDiagnosticContext): void {
    for (const call of [
        ...context.nodes("FunctionCall"),
        ...context.nodes("FunctionTableSource"),
    ]) {
        const nameNode = firstDescendantOfKind(call, "MultipartIdentifier");
        if (!nameNode) continue;
        const parts = multipartIdentifierParts(context.source(nameNode));
        const local = context.localFunctionParameters(parts, nameNode.start);
        if (local) {
            validateRoutineArity(context, call, nameNode, local);
            continue;
        }
        const resolution = context.metadata.resolveObject(parts);
        if (
            resolution.kind !== "resolved" ||
            (resolution.object.kind !== "scalarFunction" &&
                resolution.object.kind !== "tableFunction")
        ) {
            continue;
        }
        const state = context.metadata.parameterState(resolution.object.ref);
        if (state.kind === "loaded") validateRoutineArity(context, call, nameNode, state.value);
    }
}

function validateRoutineArity(
    context: FunctionDiagnosticContext,
    call: SyntaxNode,
    nameNode: SyntaxNode,
    parameters: readonly ParameterMetadata[],
): void {
    const actual = routineCallArguments(call).items.length;
    const declared = parameters.filter((parameter) => parameter.ordinal !== 0);
    const required = declared.filter((parameter) => parameter.hasDefault !== true).length;
    const displayName = compactMultipartName(context.source(nameNode));
    if (actual < required) {
        context.add(
            "InsufficientArguments",
            `An insufficient number of arguments were supplied for the procedure or function ${displayName}.`,
            nameNode,
        );
    } else if (actual > declared.length) {
        context.add(
            "TooManyArguments",
            `Procedure or function '${displayName}' has too many arguments specified.`,
            nameNode,
        );
    }
}

interface FunctionArity {
    readonly minimum: number;
    readonly maximum: number;
}

function arityCode(arity: FunctionArity): string {
    if (arity.minimum === arity.maximum) {
        if (arity.minimum === 0) return "FunctionRequiresZeroArguments";
        if (arity.minimum === 1) return "FunctionRequiresOneArgument";
        return "FunctionRequiresNumberOfArguments";
    }
    if (arity.maximum === Number.POSITIVE_INFINITY) {
        return arity.minimum === 1
            ? "FunctionRequiresAtLeastOneArgument"
            : "FunctionRequiresAtLeastNumberOfArguments";
    }
    return "FunctionRequiresRangeOfAruments";
}

function arityMessage(name: string, arity: FunctionArity): string {
    if (arity.minimum === arity.maximum) {
        if (arity.minimum === 0) return `The function '${name}' takes exactly 0 arguments.`;
        if (arity.minimum === 1) return ` The ${name} function takes exactly 1 argument.`;
        return ` The ${name} function requires ${arity.minimum} arguments.`;
    }
    if (arity.maximum === Number.POSITIVE_INFINITY) {
        return arity.minimum === 1
            ? `Function '${name}' requires at least 1 argument.`
            : `Function '${name}' requires at least ${arity.minimum} arguments.`;
    }
    return `The ${name} function requires ${arity.minimum} to ${arity.maximum} arguments.`;
}

const aggregateFunctionNames = new Set([
    "APPROX_COUNT_DISTINCT",
    "AVG",
    "CHECKSUM_AGG",
    "COUNT",
    "COUNT_BIG",
    "GROUPING",
    "GROUPING_ID",
    "MAX",
    "MIN",
    "STDEV",
    "STDEVP",
    "STRING_AGG",
    "SUM",
    "VAR",
    "VARP",
]);

const datePartFunctions = new Set([
    "DATEADD",
    "DATEDIFF",
    "DATEDIFF_BIG",
    "DATENAME",
    "DATEPART",
    "DATE_BUCKET",
]);

const isJsonValueTypes = new Set(["ARRAY", "OBJECT", "SCALAR", "VALUE"]);

const dateParts = new Set([
    "DAY",
    "DAYOFYEAR",
    "DD",
    "DW",
    "DY",
    "HOUR",
    "HH",
    "ISO_WEEK",
    "ISOWK",
    "ISOWW",
    "MICROSECOND",
    "MCS",
    "MILLISECOND",
    "MINUTE",
    "MM",
    "MONTH",
    "MS",
    "NANOSECOND",
    "NS",
    "N",
    "QUARTER",
    "QQ",
    "Q",
    "SECOND",
    "SS",
    "S",
    "TZOFFSET",
    "TZ",
    "WEEK",
    "WEEKDAY",
    "WK",
    "WW",
    "YEAR",
    "YY",
    "YYYY",
]);

/** Built-ins not yet represented by the shared signature registry. */
const fallbackArities = new Map<string, FunctionArity>([
    ...[
        "ABS",
        "ACOS",
        "ASIN",
        "ATAN",
        "CEILING",
        "COS",
        "COT",
        "DAY",
        "DEGREES",
        "EXP",
        "FLOOR",
        "ISNUMERIC",
        "LOG10",
        "MONTH",
        "RADIANS",
        "SIGN",
        "SIN",
        "SQRT",
        "SQUARE",
        "TAN",
        "YEAR",
    ].map((name) => [name, { minimum: 1, maximum: 1 }] as const),
    ...[
        "CURRENT_TIMESTAMP",
        "GETDATE",
        "GETUTCDATE",
        "NEWID",
        "PI",
        "SYSDATETIME",
        "SYSDATETIMEOFFSET",
        "SYSUTCDATETIME",
    ].map((name) => [name, { minimum: 0, maximum: 0 }] as const),
    ["ATN2", { minimum: 2, maximum: 2 }],
    ["COALESCE", { minimum: 2, maximum: Number.POSITIVE_INFINITY }],
    ["CONCAT", { minimum: 2, maximum: 254 }],
    ["DATEADD", { minimum: 3, maximum: 3 }],
    ["DATEDIFF", { minimum: 3, maximum: 3 }],
    ["DATEDIFF_BIG", { minimum: 3, maximum: 3 }],
    ["DATEFROMPARTS", { minimum: 3, maximum: 3 }],
    ["DATENAME", { minimum: 2, maximum: 2 }],
    ["DATEPART", { minimum: 2, maximum: 2 }],
    ["EOMONTH", { minimum: 1, maximum: 2 }],
    ["IIF", { minimum: 3, maximum: 3 }],
    ["ISJSON", { minimum: 1, maximum: 2 }],
    ["JSON_MODIFY", { minimum: 3, maximum: 3 }],
    ["JSON_QUERY", { minimum: 1, maximum: 2 }],
    ["JSON_VALUE", { minimum: 2, maximum: 2 }],
    ["LOG", { minimum: 1, maximum: 2 }],
    ["NULLIF", { minimum: 2, maximum: 2 }],
    ["POWER", { minimum: 2, maximum: 2 }],
    ["RAND", { minimum: 0, maximum: 1 }],
    ["ROUND", { minimum: 2, maximum: 3 }],
]);
