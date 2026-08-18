/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView, ParameterMetadata } from "../metadata/index.js";
import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import {
    formatParameter,
    formatSignature,
    isBuiltInAvailable,
    lookupBuiltIn,
    type BuiltInProfile,
    type BuiltInSignature,
} from "../common/builtInRegistry.js";
import type { TsqlFeatureProfile } from "../common/engineCapabilities.js";
import { multipartIdentifierParts } from "../semantics/index.js";
import type { SyntaxNode } from "../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    descendantsOfKind as descendants,
    firstDescendantOfKind as firstDescendant,
    visitSyntaxTree as visit,
} from "../syntax/treeUtilities.js";
import type { SignatureHelp } from "./contracts.js";
import { quoteIdentifierIfNeeded } from "./identifierFormatting.js";

export interface RoutineSignatureContext {
    readonly kind: "function" | "execute";
    readonly target: readonly string[];
    readonly activeParameter: number;
    readonly namedParameter?: string;
}

export interface InsertSignatureContext {
    readonly kind: "insert";
    readonly target: readonly string[];
    readonly columns?: readonly string[];
    readonly activeParameter: number;
    /** True while the cursor is inside the target column list rather than a VALUES row. */
    readonly namingColumns?: boolean;
}

export type SignatureContext = RoutineSignatureContext | InsertSignatureContext;

/**
 * Expressions the grammar models in their own right rather than as calls. Each still reads as a
 * routine to anyone typing one, so signature help answers for them the same way.
 */
const specialExpressionRoutines: ReadonlyMap<string, string> = new Map([
    ["JsonValueExpression", "JSON_VALUE"],
    ["JsonQueryExpression", "JSON_QUERY"],
    ["JsonConstructorExpression", "JSON_OBJECT"],
    ["JsonAggregateExpression", "JSON_OBJECTAGG"],
    ["CastExpression", "CAST"],
    ["TryCastExpression", "TRY_CAST"],
    ["ConvertExpression", "CONVERT"],
    ["ParseExpression", "PARSE"],
    ["TrimExpression", "TRIM"],
    ["AiGenerateEmbeddingsExpression", "AI_GENERATE_EMBEDDINGS"],
    // Statements that read as calls. Their arguments have fixed meanings, which is why the grammar
    // gives them their own shape, but anyone typing one expects the same help a call gives.
    ["RaiserrorStatement", "RAISERROR"],
    ["ThrowStatement", "THROW"],
    ["WaitForStatement", "WAITFOR"],
]);

/** CONVERT and PARSE share a node with their TRY_ form, so the written spelling decides. */
function conversionSpelling(
    snapshot: DocumentAnalysisSnapshot,
    node: SyntaxNode,
    fallback: string,
): string {
    const written = /^[A-Za-z_]+/u.exec(snapshot.text.text.slice(node.start, node.end))?.[0];
    return written ? written.toLocaleUpperCase() : fallback;
}

/**
 * CAST separates its two arguments with AS rather than a comma, so the keyword advances the active
 * parameter the way a comma does elsewhere.
 */
function conversionActiveParameter(node: SyntaxNode, offset: number): number {
    let active = activeParameterIn(node, offset);
    for (const child of node.children()) {
        // AS and USING separate arguments here the way a comma does in an ordinary call.
        if ((child.kind === "As" || child.kind === "Using") && child.start < offset) active++;
    }
    return active;
}

export function signatureContext(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): SignatureContext | undefined {
    const specialized = cursorAncestor(snapshot, offset, [...specialExpressionRoutines.keys()]);
    if (specialized) {
        const routine = specialExpressionRoutines.get(specialized.kind)!;
        return {
            kind: "function",
            target: [conversionSpelling(snapshot, specialized, routine)],
            activeParameter: conversionActiveParameter(specialized, offset),
        };
    }

    const call = cursorAncestor(snapshot, offset, [
        "FunctionCall",
        "FunctionTableSource",
        "GlobalFunctionTableSource",
    ]);
    if (call) {
        const name =
            firstDescendant(call, "MultipartIdentifier") ?? firstDescendant(call, "IdentifierName");
        if (name) {
            const argumentsNode =
                firstDescendant(call, "ArgumentList") ??
                firstDescendant(call, "TableFunctionArgumentList");
            return {
                kind: "function",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                activeParameter: argumentsNode ? activeParameterIn(argumentsNode, offset) : 0,
            };
        }
    }

    // The target column list of an INSERT sits inside the target itself, which the grammar also
    // uses for the parenthesised form of a rowset target, so the parentheses are found there.
    const dmlTarget = cursorAncestor(snapshot, offset, ["DmlTarget"]);
    if (dmlTarget && ancestor(dmlTarget, ["InsertStatement"])) {
        const open = childOfKind(dmlTarget, "OpenParen");
        const close = childOfKind(dmlTarget, "CloseParen");
        const name = firstDescendant(dmlTarget, "MultipartIdentifier");
        if (name && open && offset > open.start && (!close || offset <= close.start)) {
            const list =
                firstDescendant(dmlTarget, "InsertColumnList") ??
                firstDescendant(dmlTarget, "ArgumentList");
            return {
                kind: "insert",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                activeParameter: list ? activeParameterIn(list, offset) : 0,
                namingColumns: true,
            };
        }
    }

    const row = cursorAncestor(snapshot, offset, ["RowValue"]);
    const insert = row && ancestor(row, ["InsertStatement"]);
    if (row && insert && ancestor(row, ["ValuesInsertSource"])) {
        const target = firstDescendant(insert, "DmlTarget");
        const name = target && firstDescendant(target, "MultipartIdentifier");
        if (target && name) {
            const explicit =
                firstDescendant(target, "InsertColumnList") ??
                firstDescendant(target, "ArgumentList");
            const columns = explicit
                ? descendants(explicit, "ColumnReference")
                      .map((column) =>
                          multipartIdentifierParts(
                              snapshot.text.text.slice(column.start, column.end),
                          ).at(-1),
                      )
                      .filter((column): column is string => column !== undefined)
                : undefined;
            return {
                kind: "insert",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                ...(columns && columns.length > 0 ? { columns } : {}),
                activeParameter: activeParameterIn(row, offset),
            };
        }
    }

    const execute = cursorAncestor(snapshot, offset, ["ExecuteStatement"]);
    if (execute) {
        const entity = firstDescendant(execute, "ExecutableEntity");
        const name = entity && firstDescendant(entity, "MultipartIdentifier");
        if (name) {
            const argumentsNode = firstDescendant(execute, "ExecuteArgumentList");
            return {
                kind: "execute",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                activeParameter: argumentsNode ? activeParameterIn(argumentsNode, offset) : 0,
                ...(argumentsNode
                    ? {
                          namedParameter: activeNamedParameter(
                              snapshot.text.text,
                              argumentsNode,
                              offset,
                          ),
                      }
                    : {}),
            };
        }
    }
    return undefined;
}

function cursorAncestor(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
    kinds: readonly string[],
): SyntaxNode | undefined {
    const exact = ancestor(snapshot.syntax.nodeAt(offset), kinds);
    return exact ?? (offset > 0 ? ancestor(snapshot.syntax.nodeAt(offset - 1), kinds) : undefined);
}

function childOfKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
    }
    return undefined;
}

function activeParameterIn(node: SyntaxNode, offset: number): number {
    let active = 0;
    for (const child of node.children()) {
        if (child.kind === "Comma" && child.start < offset) active++;
    }
    return active;
}

function activeNamedParameter(
    text: string,
    argumentsNode: SyntaxNode,
    offset: number,
): string | undefined {
    let start = argumentsNode.start;
    for (const child of argumentsNode.children()) {
        if (child.kind === "Comma" && child.start < offset) start = child.end;
    }
    return /(@[\p{L}_][\p{L}\p{N}_$#@]*)\s*=/iu.exec(text.slice(start, offset))?.[1];
}

export function routineSignatureHelp(
    context: RoutineSignatureContext,
    displayName: string,
    parameters: readonly ParameterMetadata[],
    extendedProcedure = false,
): SignatureHelp {
    const labels = parameters.map(parameterLabel);
    const namedIndex = context.namedParameter
        ? parameters.findIndex(
              (parameter) =>
                  parameter.name.toLocaleLowerCase() ===
                  context.namedParameter!.toLocaleLowerCase(),
          )
        : -1;
    const activeParameter =
        parameters.length === 0
            ? 0
            : Math.min(
                  namedIndex >= 0 ? namedIndex : context.activeParameter,
                  parameters.length - 1,
              );
    return {
        signatures: [
            {
                label:
                    context.kind === "execute"
                        ? `EXEC ${displayName}${labels.length > 0 ? ` ${labels.join(", ")}` : ""}`
                        : `${displayName}(${labels.join(", ")})`,
                documentation:
                    context.kind === "execute"
                        ? extendedProcedure
                            ? "Parameter help is not supported for extended stored procedures."
                            : "Stored procedures always return INT."
                        : "Function parameters in declaration order.",
                parameters: parameters.map((parameter) => ({
                    label: parameterLabel(parameter),
                    documentation: parameterDocumentation(parameter),
                })),
            },
        ],
        activeSignature: 0,
        activeParameter,
    };
}

function parameterLabel(parameter: ParameterMetadata): string {
    const name = parameter.name || `#${parameter.ordinal}`;
    return `${name} ${parameter.typeDisplay ?? "unknown"}${
        parameter.hasDefault ? " = DEFAULT" : ""
    }${parameter.output ? " OUTPUT" : ""}`;
}

function parameterDocumentation(parameter: ParameterMetadata): string {
    const direction = parameter.output ? "Input/output" : "Input";
    const requirement =
        parameter.hasDefault === undefined
            ? "optionality unavailable"
            : parameter.hasDefault
              ? "optional"
              : "required";
    return `${direction} parameter (${requirement}). Type: \`${parameter.typeDisplay ?? "unknown"}\`.`;
}

export function insertSignatureHelp(
    context: InsertSignatureContext,
    columns: readonly ColumnMetadata[],
): SignatureHelp {
    const labels = columns.map(
        (column) =>
            `${quoteIdentifierIfNeeded(column.name)} ${column.typeDisplay ?? "unknown"}${
                column.nullable === undefined ? "" : column.nullable ? " NULL" : " NOT NULL"
            }`,
    );
    return {
        signatures: [
            {
                label: `INSERT INTO ${context.target.map(quoteIdentifierIfNeeded).join(".")}${
                    context.namingColumns ? "" : " VALUES"
                } (${labels.join(", ")})`,
                documentation: context.namingColumns
                    ? "Name the target columns to populate; the highlighted one is next."
                    : "Each VALUES expression corresponds to the highlighted target column.",
                parameters: columns.map((column, index) => ({
                    label: labels[index]!,
                    documentation: `Target column \`${column.name}\`. Type: \`${
                        column.typeDisplay ?? "unknown"
                    }\`${
                        column.nullable === undefined
                            ? "."
                            : column.nullable
                              ? "; NULL is allowed."
                              : "; NULL is not allowed."
                    }`,
                })),
            },
        ],
        activeSignature: 0,
        activeParameter: Math.min(context.activeParameter, columns.length - 1),
    };
}

export function localRoutineAt(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    target: readonly string[],
    offset: number,
    callKind: RoutineSignatureContext["kind"],
): { readonly displayName: string; readonly parameters: readonly ParameterMetadata[] } | undefined {
    const declarationKinds =
        callKind === "execute"
            ? ["CreateProcedureStatement", "AlterProcedureStatement"]
            : ["CreateFunctionStatement", "AlterFunctionStatement"];
    const dropKind = callKind === "execute" ? "DropProcedureStatement" : "DropFunctionStatement";
    let result:
        | {
              readonly offset: number;
              readonly displayName: string;
              readonly parameters: readonly ParameterMetadata[];
          }
        | undefined;
    visit(snapshot.syntax.root(), (node) => {
        if (
            node.end > offset ||
            (!declarationKinds.includes(node.kind) && node.kind !== dropKind)
        ) {
            return;
        }
        const names =
            node.kind === dropKind
                ? descendants(node, "MultipartIdentifier")
                : [firstDescendant(node, "MultipartIdentifier")].filter(
                      (name): name is SyntaxNode => name !== undefined,
                  );
        for (const name of names) {
            const parts = multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end));
            if (!localNameMatches(parts, target, view)) continue;
            if (!result || node.end >= result.offset) {
                result =
                    node.kind === dropKind
                        ? undefined
                        : {
                              offset: node.end,
                              displayName: parts.join("."),
                              parameters: localRoutineParameters(snapshot, node),
                          };
            }
        }
    });
    return result;
}

function localNameMatches(
    declaration: readonly string[],
    target: readonly string[],
    view: MetadataView,
): boolean {
    const declarationName = declaration.at(-1);
    const targetName = target.at(-1);
    if (!declarationName || !targetName || !namesEqual(declarationName, targetName, view))
        return false;
    if (target.length === 1) {
        const schema = declaration.at(-2);
        return !schema || namesEqual(schema, view.environment.defaultSchema, view);
    }
    const count = Math.min(declaration.length, target.length);
    for (let index = 1; index <= count; index++) {
        if (!namesEqual(declaration.at(-index)!, target.at(-index)!, view)) return false;
    }
    return true;
}

function localRoutineParameters(
    snapshot: DocumentAnalysisSnapshot,
    routine: SyntaxNode,
): readonly ParameterMetadata[] {
    const list =
        firstDescendant(routine, "ProcedureParameterClause") ??
        firstDescendant(routine, "FunctionParameterList");
    if (!list) return [];
    return descendants(list, "ProcedureParameter").map((parameter, index) => {
        const variable = firstDescendant(parameter, "Variable");
        const dataType = firstDescendant(parameter, "DataType");
        const source = snapshot.text.text.slice(parameter.start, parameter.end);
        return {
            ordinal: index + 1,
            name: variable
                ? snapshot.text.text.slice(variable.start, variable.end)
                : `@parameter${index + 1}`,
            ...(dataType
                ? { typeDisplay: snapshot.text.text.slice(dataType.start, dataType.end) }
                : {}),
            output: /\b(?:OUT|OUTPUT)\s*$/iu.test(source),
            hasDefault: /=/u.test(source),
        };
    });
}

export function builtInSignatureHelp(
    context: RoutineSignatureContext,
    profile: TsqlFeatureProfile,
): SignatureHelp | undefined {
    const name = context.target.at(-1);
    const entry = name ? lookupBuiltIn(name, "routine") : undefined;
    if (!entry || !isBuiltInAvailable(entry, builtInProfile(profile))) return undefined;
    const signatures = entry?.signatures;
    if (!name || !signatures || signatures.length === 0) return undefined;
    return {
        signatures: signatures.map((signature) => ({
            label: formatSignature(name, signature),
            documentation: signatureDocumentation(signature),
            parameters: signature.parameters.map((parameter) => ({
                label: formatParameter(parameter),
                ...(parameter.optional ? { documentation: "Optional." } : {}),
                ...(parameter.variadic ? { documentation: "May be repeated." } : {}),
            })),
        })),
        activeSignature: 0,
        activeParameter: activeParameterWithin(signatures[0]!, context.activeParameter),
    };
}

/** A variadic argument absorbs every argument after it, so the last one stays highlighted. */
function activeParameterWithin(signature: BuiltInSignature, active: number): number {
    const count = signature.parameters.length;
    if (count === 0) return 0;
    return Math.min(active, count - 1);
}

function signatureDocumentation(signature: BuiltInSignature): string {
    return signature.returnType
        ? `${signature.documentation}\n\nReturns \`${signature.returnType}\`.`
        : signature.documentation;
}

function namesEqual(left: string, right: string, view: MetadataView): boolean {
    return view.environment.caseSensitive
        ? left === right
        : left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function builtInProfile(profile: TsqlFeatureProfile): BuiltInProfile {
    return {
        engineProfile: profile.engineProfile,
        ...(profile.compatibilityLevel === undefined
            ? {}
            : { compatibilityLevel: profile.compatibilityLevel }),
    };
}
