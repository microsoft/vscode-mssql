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
import {
    activeArgument,
    multipartIdentifierParts,
    tsqlIdentifierPattern,
    type SignatureModel,
} from "../semantics/index.js";
import type { SyntaxKind, SyntaxNode } from "../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    descendantsOfKind as descendants,
    directChildOfKind,
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
    /**
     * Signatures the semantic model already resolved for this call.
     *
     * Present for constructs the model describes directly - keyword operators such as `TOP`, the
     * conversion expressions, and built-in routines - so signature help renders the same call the
     * diagnostics and coloring layers see instead of re-deriving one.
     */
    readonly signatures?: readonly SignatureModel[];
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

export function signatureContext(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): SignatureContext | undefined {
    // Every parenthesized, conversion, and keyword-operator call comes from the one bound call
    // model, so what signature help answers for is what diagnostics and coloring saw.
    const bound = boundCallAt(snapshot, offset);
    if (bound && !bound.rowsetOnlyName) {
        return {
            kind: "function",
            target: bound.target,
            activeParameter: bound.activeArgument,
            ...(bound.signatures.length > 0 ? { signatures: bound.signatures } : {}),
        };
    }

    // The target column list of an INSERT sits inside the target itself, which the grammar also
    // uses for the parenthesised form of a rowset target, so the parentheses are found there.
    const dmlTarget = cursorAncestor(snapshot, offset, ["DmlTarget"]);
    if (dmlTarget && ancestor(dmlTarget, ["InsertStatement"])) {
        const open = directChildOfKind(dmlTarget, "OpenParen");
        const close = directChildOfKind(dmlTarget, "CloseParen");
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
    kinds: readonly SyntaxKind[],
): SyntaxNode | undefined {
    const exact = ancestor(snapshot.syntax.nodeAt(offset), kinds);
    return exact ?? (offset > 0 ? ancestor(snapshot.syntax.nodeAt(offset - 1), kinds) : undefined);
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
    return new RegExp(`(${tsqlIdentifierPattern.namedVariable})\\s*=`, "iu").exec(
        text.slice(start, offset),
    )?.[1];
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
              (parameter) => parameter.name.toLowerCase() === context.namedParameter!.toLowerCase(),
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
    if (entry && !isBuiltInAvailable(entry, builtInProfile(profile))) return undefined;
    const signatures = entry?.signatures;
    if (!name || !signatures || signatures.length === 0) return modelSignatureHelp(context);
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

/**
 * Renders the signatures the semantic model resolved.
 *
 * This is the path a keyword operator such as `TOP` takes: it is not a routine, so no registry
 * lookup describes it, but it has one argument shape the call model already knows.
 */
function modelSignatureHelp(context: RoutineSignatureContext): SignatureHelp | undefined {
    const signatures = context.signatures;
    if (!signatures || signatures.length === 0) return undefined;
    return {
        signatures: signatures.map((signature) => ({
            label: signature.label,
            ...(signature.documentation ? { documentation: signature.documentation } : {}),
            parameters: signature.parameters.map((parameter) => ({
                label: parameter.label,
                ...(parameter.documentation ? { documentation: parameter.documentation } : {}),
            })),
        })),
        activeSignature: 0,
        activeParameter: Math.min(
            context.activeParameter,
            Math.max(0, signatures[0]!.parameters.length - 1),
        ),
    };
}

/**
 * The bound call under the cursor, expressed the way signature help needs it.
 *
 * A table-valued source is also a rowset name; with the cursor on the name rather than inside the
 * argument list the caller wants the rowset paths below, so that case is reported separately
 * rather than answered here.
 */
function boundCallAt(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
):
    | {
          readonly target: readonly string[];
          readonly activeArgument: number;
          readonly signatures: readonly SignatureModel[];
          readonly rowsetOnlyName: boolean;
      }
    | undefined {
    const model = snapshot.semantics.model;
    const call = model.callAt(offset) ?? (offset > 0 ? model.callAt(offset - 1) : undefined);
    if (!call) return undefined;
    if (call.target.kind === "operator") {
        return {
            target: [call.target.name],
            activeArgument: activeArgument(call, offset),
            signatures: call.signatures,
            rowsetOnlyName: false,
        };
    }
    // EXEC keeps its own context below: it resolves named arguments and procedure metadata.
    if (call.shape === "bare") return undefined;
    const written = call.name
        ? call.name.parts.map((part) => part.normalized)
        : call.target.kind === "builtin"
          ? [call.target.name]
          : [];
    if (written.length === 0) return undefined;
    return {
        target: written,
        activeArgument: activeArgument(call, offset),
        signatures: call.signatures,
        rowsetOnlyName:
            call.rowset && call.argumentRange !== undefined && offset < call.argumentRange.start,
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
        : left.toLowerCase() === right.toLowerCase();
}

function builtInProfile(profile: TsqlFeatureProfile): BuiltInProfile {
    return {
        engineProfile: profile.engineProfile,
        ...(profile.compatibilityLevel === undefined
            ? {}
            : { compatibilityLevel: profile.compatibilityLevel }),
    };
}
