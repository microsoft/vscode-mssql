/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    formatParameter,
    formatSignature,
    isBuiltInAvailable,
    lookupBuiltIn,
    type BuiltInProfile,
    type BuiltInSignature,
} from "../../common/builtInRegistry.js";
import type { MetadataView, ParameterMetadata } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot, TsqlFeatureProfile } from "../../syntax/index.js";
import {
    directChildOfKind as directChild,
    firstDescendantOfKind as firstDescendant,
    syntaxSource,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { multipartIdentifierParts } from "../identifiers.js";
import { isNamedRoutineArgumentLabel, routineCallArguments } from "../routineCall.js";
import type {
    ArgumentShape,
    BoundArgument,
    CallTarget,
    CatalogTimeline,
    ExpressionType,
    ResolvedCall,
    SignatureModel,
} from "./contracts.js";
import { boundNameFrom } from "./boundName.js";

/**
 * One call model for every callable shape the grammar writes.
 *
 * SQL Server writes invocations in several unrelated syntaxes: an ordinary call, a table-valued
 * rowset source, `CAST(x AS t)`, `EXEC p @a = 1`, and keyword operators such as `TOP (n)`. Before
 * this module each feature recognised its own subset, which is how a table-valued call could be
 * counted as zero arguments by diagnostics while signature help read the same call correctly.
 */

/** Expressions the grammar models in their own right but that read, and behave, as calls. */
const specialCallRoutines: ReadonlyMap<string, string> = new Map([
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
    ["RaiserrorStatement", "RAISERROR"],
    ["ThrowStatement", "THROW"],
    ["WaitForStatement", "WAITFOR"],
]);

/** Conversion routines separate their arguments with a keyword rather than a comma. */
const keywordSeparatedRoutines: ReadonlySet<string> = new Set([
    "CAST",
    "TRY_CAST",
    "CONVERT",
    "PARSE",
    "TRY_PARSE",
    "TRIM",
]);

/** The generic call nodes, in the order a cursor lookup should prefer them. */
const genericCallKinds: readonly string[] = Object.freeze([
    "FunctionCall",
    "FunctionTableSource",
    "GlobalFunctionTableSource",
    "KeywordFunctionCall",
]);

/**
 * `TOP` is an operator with an argument, not a function.
 *
 * It shares cursor tracking and argument shape with calls so signature help can answer for it,
 * while its target stays an operator so nothing looks it up as a routine or validates its arity
 * against parameter metadata.
 */
const topSignature: SignatureModel = Object.freeze({
    label: "TOP (expression) [PERCENT] [WITH TIES]",
    parameters: Object.freeze([
        { label: "expression", optional: false, documentation: "Row count or percentage." },
        {
            label: "PERCENT",
            optional: true,
            documentation: "Treat the expression as a percentage.",
        },
        {
            label: "WITH TIES",
            optional: true,
            documentation: "Include rows tied with the last one.",
        },
    ]),
    documentation: "Limits the rows returned or affected by the statement.",
    separator: " ",
});

export interface CallModelInput {
    readonly syntax: SyntaxSnapshot;
    readonly metadata: MetadataView;
    readonly index: ReadonlyMap<string, readonly SyntaxNode[]>;
    readonly timeline: CatalogTimeline;
    readonly profile: TsqlFeatureProfile;
}

/** Every call in the document, in document order. */
export function buildCalls(input: CallModelInput): readonly ResolvedCall[] {
    const calls: ResolvedCall[] = [];
    for (const kind of genericCallKinds) {
        for (const node of input.index.get(kind) ?? []) calls.push(genericCall(input, node));
    }
    for (const [kind, routine] of specialCallRoutines) {
        for (const node of input.index.get(kind) ?? []) {
            calls.push(specialCall(input, node, routine));
        }
    }
    for (const node of input.index.get("ExecuteStatement") ?? []) {
        const call = executeCall(input, node);
        if (call) calls.push(call);
    }
    for (const node of input.index.get("TopClause") ?? []) calls.push(topCall(input, node));
    return Object.freeze(calls.sort((left, right) => left.range.start - right.range.start));
}

function genericCall(input: CallModelInput, node: SyntaxNode): ResolvedCall {
    const nameNode = callNameNode(node);
    const supplied = routineCallArguments(node);
    // A keyword-spelled call such as LEFT(x, 2) has no name node at all: its routine is the
    // keyword itself. Reading a descendant name here would bind the call to its first argument.
    const keyword = nameNode ? undefined : keywordCallName(node);
    const written = nameNode ? source(input, nameNode) : keyword ? source(input, keyword) : "";
    const parts = multipartIdentifierParts(written);
    const target = resolveTarget(input, parts, nameNode?.start ?? node.start);
    const parameters = parametersFor(input, target);
    return freezeCall({
        range: { start: node.start, end: node.end },
        ...(nameNode
            ? { name: boundNameFrom(input.metadata, nameNode, written, "routine", target) }
            : {}),
        ...(keyword ? { keywordRange: { start: keyword.start, end: keyword.end } } : {}),
        target,
        shape: "parenthesized",
        ...(supplied.node
            ? { argumentRange: { start: supplied.node.start, end: supplied.node.end } }
            : {}),
        arguments: boundArguments(input, supplied.items, supplied.wildcard, parameters),
        separators: separatorOffsets(supplied.node ?? node, ["Comma"]),
        parameters,
        signatures: signaturesFor(input, target, parameters, parts.at(-1) ?? ""),
        rowset: node.kind === "FunctionTableSource" || node.kind === "GlobalFunctionTableSource",
    });
}

/**
 * The node naming the routine a call invokes.
 *
 * The name is taken from the call's own children rather than from a descendant search: the first
 * `MultipartIdentifier` under `LEFT(Name, 2)` is the argument, not the routine.
 */
function callNameNode(node: SyntaxNode): SyntaxNode | undefined {
    const direct = directChild(node, "MultipartIdentifier") ?? directChild(node, "IdentifierName");
    if (direct) return direct;
    const wrapper = directChild(node, "TableSourceName");
    if (!wrapper) return undefined;
    return directChild(wrapper, "MultipartIdentifier") ?? directChild(wrapper, "IdentifierName");
}

/** The keyword a keyword-spelled call is written as, when the call has no name node. */
function keywordCallName(node: SyntaxNode): SyntaxNode | undefined {
    const first = [...node.children()][0];
    return first && first.kind !== "OpenParen" ? first : undefined;
}

function specialCall(input: CallModelInput, node: SyntaxNode, routine: string): ResolvedCall {
    // CONVERT and PARSE share a node with their TRY_ form, so the written spelling decides.
    const written = /^[A-Za-z_]+/u.exec(source(input, node))?.[0];
    const name = written ? written.toUpperCase() : routine;
    const target: CallTarget = { kind: "builtin", name };
    const items = [...node.children()].filter((child) => child.kind === "Expression");
    return freezeCall({
        range: { start: node.start, end: node.end },
        keywordRange: { start: node.start, end: node.start + (written ?? name).length },
        target,
        shape: keywordSeparatedRoutines.has(name) ? "keywordSeparated" : "parenthesized",
        arguments: boundArguments(input, items, false, "unknown"),
        // A conversion writes `AS` or `USING` where an ordinary call writes a comma.
        separators: separatorOffsets(node, ["Comma", "As", "Using"]),
        parameters: "unknown",
        signatures: builtInSignatures(input, name),
        rowset: false,
    });
}

function executeCall(input: CallModelInput, node: SyntaxNode): ResolvedCall | undefined {
    const entity = firstDescendant(node, "ExecutableEntity");
    const nameNode = entity && firstDescendant(entity, "MultipartIdentifier");
    if (!nameNode) return undefined;
    const written = source(input, nameNode);
    const parts = multipartIdentifierParts(written);
    const target = resolveTarget(input, parts, nameNode.start, "procedure");
    const parameters = parametersFor(input, target);
    const list = firstDescendant(node, "ExecuteArgumentList");
    const items = list
        ? [...list.children()].filter((child) => child.kind === "ExecuteArgument")
        : [];
    return freezeCall({
        range: { start: node.start, end: node.end },
        name: boundNameFrom(input.metadata, nameNode, written, "procedure", target),
        target,
        shape: "bare",
        ...(list ? { argumentRange: { start: list.start, end: list.end } } : {}),
        arguments: boundArguments(input, items, false, parameters),
        separators: separatorOffsets(list ?? node, ["Comma"]),
        parameters,
        signatures: signaturesFor(input, target, parameters, parts.at(-1) ?? ""),
        rowset: false,
    });
}

function topCall(input: CallModelInput, node: SyntaxNode): ResolvedCall {
    const expression = firstDescendant(node, "Expression");
    const keyword = [...node.children()][0];
    return freezeCall({
        range: { start: node.start, end: node.end },
        ...(keyword ? { keywordRange: { start: keyword.start, end: keyword.end } } : {}),
        target: { kind: "operator", name: "TOP" },
        shape: "keywordSeparated",
        arguments: expression
            ? boundArguments(input, [expression], false, "unknown")
            : Object.freeze([]),
        // `PERCENT` and `WITH TIES` follow the row count without a comma between them.
        separators: separatorOffsets(node, ["Percent", "With"]),
        parameters: "unknown",
        signatures: Object.freeze([topSignature]),
        rowset: false,
    });
}

function boundArguments(
    input: CallModelInput,
    items: readonly SyntaxNode[],
    wildcard: boolean,
    parameters: readonly ParameterMetadata[] | "unknown",
): readonly BoundArgument[] {
    const known = parameters === "unknown" ? undefined : parameters;
    const result = items.map((item, index) => {
        const label = namedArgumentLabel(input, item);
        const parameter = label
            ? known?.find((candidate) => candidate.name.toUpperCase() === label.name.toUpperCase())
            : known?.[index];
        return Object.freeze({
            range: { start: item.start, end: item.end },
            ...(label ? { name: label.name, nameRange: label.range } : {}),
            ...(parameter ? { parameter } : {}),
            wildcard: false,
        }) as BoundArgument;
    });
    if (wildcard && result.length === 0) {
        return Object.freeze([]);
    }
    return Object.freeze(result);
}

/** The `@name` label of an `@name = value` argument, which is not a variable reference. */
function namedArgumentLabel(
    input: CallModelInput,
    item: SyntaxNode,
): { readonly name: string; readonly range: TextRange } | undefined {
    for (const candidate of [item, ...item.children()]) {
        const variable =
            candidate.kind === "Variable" ? candidate : firstDescendant(candidate, "Variable");
        if (!variable) continue;
        if (!isNamedRoutineArgumentLabel(variable) && !isNamedExecuteArgumentLabel(variable)) {
            return undefined;
        }
        return {
            name: source(input, variable),
            range: { start: variable.start, end: variable.end },
        };
    }
    return undefined;
}

/** `EXEC p @a = 1` names its parameter through the grammar's own named-argument node. */
function isNamedExecuteArgumentLabel(variable: SyntaxNode): boolean {
    const parent = variable.parent();
    if (!parent || parent.kind !== "NamedExecuteArgument") return false;
    return [...parent.children()][0]?.start === variable.start;
}

function resolveTarget(
    input: CallModelInput,
    parts: readonly string[],
    offset: number,
    expected?: "procedure",
): CallTarget {
    const written = parts.at(-1) ?? "";
    if (parts.length === 1) {
        // Recognised regardless of availability. A built-in the profile cannot run is still that
        // built-in: resolving it as something else is what let a gated construct escape its own
        // availability decision. Availability is applied where signatures are offered, below.
        const builtIn = lookupBuiltIn(written, "routine");
        if (builtIn) return { kind: "builtin", name: builtIn.name.toUpperCase() };
    }
    const local = input.timeline.resolve(parts, offset);
    if (local?.exists && local.kind) {
        return { kind: "local", symbol: `local:${parts.join(".")}`, objectKind: local.kind };
    }
    if (local && !local.exists) return { kind: "unresolved", name: written };
    const resolution = input.metadata.resolveObject(parts);
    if (resolution.kind === "resolved") {
        const kind = resolution.object.kind;
        if (
            expected === "procedure" ||
            kind === "scalarFunction" ||
            kind === "tableFunction" ||
            kind === "procedure"
        ) {
            return { kind: "catalog", object: resolution.object.ref, objectKind: kind };
        }
    }
    return { kind: "unresolved", name: written };
}

/**
 * The declared parameters of a call's target.
 *
 * `"unknown"` is deliberate and load-bearing: metadata that is still loading must never be read as
 * "this routine takes no parameters", because that turns a pending catalog into a false arity
 * diagnostic.
 */
function parametersFor(
    input: CallModelInput,
    target: CallTarget,
): readonly ParameterMetadata[] | "unknown" {
    if (target.kind === "catalog") {
        const state = input.metadata.parameterState(target.object);
        return state.kind === "loaded" ? state.value : "unknown";
    }
    if (target.kind === "local") {
        const parts = target.symbol.slice("local:".length).split(".");
        const local = input.timeline.resolve(parts, Number.MAX_SAFE_INTEGER);
        return local?.parameters ?? "unknown";
    }
    return "unknown";
}

function signaturesFor(
    input: CallModelInput,
    target: CallTarget,
    parameters: readonly ParameterMetadata[] | "unknown",
    written: string,
): readonly SignatureModel[] {
    if (target.kind === "builtin") return builtInSignatures(input, target.name);
    if (parameters === "unknown") return Object.freeze([]);
    const labels = parameters.map(parameterLabel);
    return Object.freeze([
        Object.freeze({
            label: `${written}(${labels.join(", ")})`,
            parameters: Object.freeze(
                parameters.map((parameter, index) => ({
                    label: labels[index]!,
                    optional: parameter.hasDefault === true,
                })),
            ),
            separator: ", ",
        }) as SignatureModel,
    ]);
}

function builtInSignatures(input: CallModelInput, name: string): readonly SignatureModel[] {
    const entry = lookupBuiltIn(name, "routine");
    if (!entry?.signatures) return Object.freeze([]);
    if (!isBuiltInAvailable(entry, builtInProfile(input.profile))) return Object.freeze([]);
    return Object.freeze(entry.signatures.map((signature) => builtInSignature(name, signature)));
}

function builtInSignature(name: string, signature: BuiltInSignature): SignatureModel {
    return Object.freeze({
        label: formatSignature(name, signature),
        parameters: Object.freeze(
            signature.parameters.map((parameter) => ({
                label: formatParameter(parameter),
                optional: parameter.optional === true,
                ...(parameter.variadic ? { documentation: "May be repeated." } : {}),
            })),
        ),
        documentation: signature.documentation,
        separator: signature.separator ?? ", ",
        ...(signature.returnType
            ? {
                  returnType: {
                      displayName: signature.returnType,
                      nullable: true,
                      category: "scalar",
                      confidence: "known",
                  } as ExpressionType,
              }
            : {}),
    }) as SignatureModel;
}

function parameterLabel(parameter: ParameterMetadata): string {
    const name = parameter.name || `#${parameter.ordinal}`;
    return `${name} ${parameter.typeDisplay ?? "unknown"}${parameter.hasDefault ? " = DEFAULT" : ""}${
        parameter.output ? " OUTPUT" : ""
    }`;
}

function builtInProfile(profile: TsqlFeatureProfile): BuiltInProfile {
    return {
        engineProfile: profile.engineProfile,
        ...(profile.compatibilityLevel === undefined
            ? {}
            : { compatibilityLevel: profile.compatibilityLevel }),
    };
}

/** The offsets of the tokens that separate one written argument from the next. */
function separatorOffsets(node: SyntaxNode, kinds: readonly string[]): readonly number[] {
    const offsets: number[] = [];
    for (const child of node.children()) {
        if (kinds.includes(child.kind)) offsets.push(child.start);
    }
    return Object.freeze(offsets);
}

function source(input: CallModelInput, node: SyntaxNode): string {
    return syntaxSource(input.syntax, node);
}

function freezeCall(call: ResolvedCall): ResolvedCall {
    return Object.freeze(call);
}

/** The shape a call's arguments were written in, for callers holding only a node kind. */
export function callShapeFor(kind: string): ArgumentShape {
    if (kind === "ExecuteStatement") return "bare";
    const routine = specialCallRoutines.get(kind);
    if (routine && keywordSeparatedRoutines.has(routine)) return "keywordSeparated";
    if (kind === "TopClause") return "keywordSeparated";
    return "parenthesized";
}

/** Node kinds the call model recognises, so a cursor lookup does not repeat the list. */
export const callNodeKinds: readonly string[] = Object.freeze([
    ...genericCallKinds,
    ...specialCallRoutines.keys(),
    "ExecuteStatement",
    "TopClause",
]);
