/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lookupBuiltIn } from "../../common/builtInRegistry.js";
import type { MetadataView } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    directChildOfKind as directChild,
    firstDescendantOfKind as firstDescendant,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { multipartIdentifierParts, normalizeIdentifier } from "../identifiers.js";
import type { BoundExpression, BoundRelation, ExpressionType, ResolvedCall } from "./contracts.js";

/**
 * Bound expression types.
 *
 * Each feature used to answer "what type is this?" for itself, or not at all: hover read syntax,
 * member completion guessed, and argument validation had nothing to compare. The inference result
 * belongs in the snapshot, so this produces one table that every reader shares.
 *
 * `confidence` is the load-bearing field. `unknown` is a real answer — it means the service does
 * not know — and a caller must not turn it into a diagnostic. Only `known` is evidence.
 */
export interface ExpressionTypeInput {
    readonly syntax: SyntaxSnapshot;
    readonly metadata: MetadataView;
    readonly index: ReadonlyMap<string, readonly SyntaxNode[]>;
    readonly relations: readonly BoundRelation[];
    readonly calls: readonly ResolvedCall[];
}

/**
 * SQL Server's data type precedence, lowest first, for the types this module infers.
 *
 * An operator converts the lower-precedence operand to the higher one, so the result is the higher
 * type. Only the ladder's own entries participate: an operand whose type is not on it leaves the
 * result unknown rather than guessing a conversion the engine may refuse.
 */
const typePrecedence: readonly string[] = Object.freeze([
    "bit",
    "tinyint",
    "smallint",
    "int",
    "bigint",
    "smallmoney",
    "money",
    "numeric",
    "decimal",
    "real",
    "float",
]);

/** Operators whose result is the converted type of their operands. */
const arithmeticOperators: ReadonlySet<string> = new Set([
    "Plus",
    "Minus",
    "Star",
    "Slash",
    "PercentSign",
    "Ampersand",
    "Pipe",
    "Caret",
    "Tilde",
]);

/** Operators that compare or concatenate rather than compute. */
const concatenationOperators: ReadonlySet<string> = new Set(["Plus", "DoublePipe"]);

/**
 * The XML data type's methods and what each yields.
 *
 * `value` is the interesting one: it names its own result type in its second argument, so the
 * expression's type is written in the source rather than inferred. `nodes` is a rowset method and
 * is bound as a relation, not as a scalar, so it is absent here.
 */
const xmlMethodTypes: ReadonlyMap<string, string> = new Map([
    ["query", "xml"],
    ["exist", "bit"],
]);

/** Literal node kinds and the type SQL Server gives each one. */
const literalTypes: ReadonlyMap<
    string,
    { readonly displayName: string; readonly nullable: boolean }
> = new Map([
    ["IntegerLiteral", { displayName: "int", nullable: false }],
    ["DecimalLiteral", { displayName: "numeric", nullable: false }],
    ["FloatLiteral", { displayName: "float", nullable: false }],
    ["MoneyLiteral", { displayName: "money", nullable: false }],
    ["BinaryLiteral", { displayName: "varbinary", nullable: false }],
    ["StringLiteral", { displayName: "varchar", nullable: false }],
]);

const unknownType: ExpressionType = Object.freeze({
    displayName: "unknown",
    nullable: true,
    category: "unknown",
    confidence: "unknown",
});

/** Types whose values are not scalars, so a member or operator rule has to treat them apart. */
const nonScalarCategories: readonly (readonly [RegExp, ExpressionType["category"]])[] =
    Object.freeze([
        [/^xml\b/iu, "xml"],
        [/^vector\b/iu, "vector"],
        [/^cursor\b/iu, "cursor"],
        [/^table\b/iu, "table"],
    ]);

export function buildExpressionTypes(input: ExpressionTypeInput): readonly BoundExpression[] {
    const variables = collectVariableTypes(input);
    const callsByStart = new Map(input.calls.map((call) => [call.range.start, call]));
    const bound: BoundExpression[] = [];

    const record = (node: SyntaxNode, type: ExpressionType | undefined): void => {
        if (!type) return;
        bound.push(Object.freeze({ range: { start: node.start, end: node.end }, type }));
    };

    for (const node of input.index.get("Literal") ?? []) {
        record(node, literalType(input, node));
    }
    for (const node of input.index.get("Variable") ?? []) {
        record(node, variables.get(normalizeIdentifier(source(input, node)).toLocaleLowerCase()));
    }
    for (const node of input.index.get("ColumnReference") ?? []) {
        record(node, columnType(input, node));
    }
    for (const kind of [
        "CastExpression",
        "TryCastExpression",
        "ConvertExpression",
        "ParseExpression",
    ]) {
        for (const node of input.index.get(kind) ?? []) {
            // A conversion's type is the type it names, and a TRY_ form can always return NULL.
            const target = directChild(node, "DataType");
            const declared = target && declaredType(source(input, target), kind.startsWith("Try"));
            record(node, declared);
        }
    }
    for (const kind of ["FunctionCall", "KeywordFunctionCall"]) {
        for (const node of input.index.get(kind) ?? []) {
            record(node, callType(input, callsByStart.get(node.start)));
        }
    }
    // A qualified method on an XML column reads as an ordinary call, so it is recognised by its
    // receiver's type rather than by its shape.
    for (const node of input.index.get("FunctionCall") ?? []) {
        const nameNode = directChild(node, "MultipartIdentifier");
        if (!nameNode) continue;
        const parts = multipartIdentifierParts(source(input, nameNode));
        if (parts.length < 2) continue;
        const receiver = columnTypeNamed(input, parts.slice(0, -1), node);
        record(node, xmlMemberType(input, receiver, parts.at(-1)!, node));
    }

    // Composite forms are typed from their parts, so they are resolved innermost-first: an
    // expression's own type may depend on one recorded a moment ago.
    const byRange = new Map(bound.map((entry) => [rangeKey(entry.range), entry.type]));
    const typeOf = (node: SyntaxNode): ExpressionType | undefined =>
        byRange.get(rangeKey({ start: node.start, end: node.end }));
    const remember = (node: SyntaxNode, type: ExpressionType | undefined): void => {
        if (!type) return;
        record(node, type);
        byRange.set(rangeKey({ start: node.start, end: node.end }), type);
    };

    // A member expression is typed after its receiver, whose type may itself have just been bound.
    for (const node of innermostFirst(input.index.get("VariableMemberExpression") ?? [])) {
        const variable = directChild(node, "Variable");
        const receiver =
            variable &&
            variables.get(normalizeIdentifier(source(input, variable)).toLocaleLowerCase());
        remember(node, memberExpressionType(input, node, receiver));
    }
    for (const node of innermostFirst(input.index.get("CaseExpression") ?? [])) {
        remember(node, caseType(node, typeOf));
    }
    for (const node of innermostFirst(input.index.get("ParenthesizedQuery") ?? [])) {
        remember(node, subqueryType(input, node, typeOf));
    }
    // An `Expression` is either a wrapper around one typed child or an operator applied to several.
    for (const node of innermostFirst(input.index.get("Expression") ?? [])) {
        const children = [...node.children()];
        if (children.length === 1) {
            remember(node, typeOf(children[0]!));
            continue;
        }
        remember(node, operatorType(children, typeOf));
    }

    return Object.freeze(bound.sort((left, right) => left.range.start - right.range.start));
}

/** The innermost bound expression covering the offset. */
export function expressionTypeAt(
    expressions: readonly BoundExpression[],
    offset: number,
): ExpressionType | undefined {
    let best: BoundExpression | undefined;
    for (const entry of expressions) {
        if (entry.range.start > offset || offset > entry.range.end) continue;
        if (!best || entry.range.end - entry.range.start < best.range.end - best.range.start) {
            best = entry;
        }
    }
    return best?.type;
}

/** The type a `DECLARE` or routine parameter gives each variable name, folded for lookup. */
function collectVariableTypes(input: ExpressionTypeInput): ReadonlyMap<string, ExpressionType> {
    const result = new Map<string, ExpressionType>();
    for (const kind of ["VariableDeclaration", "ProcedureParameter"]) {
        for (const node of input.index.get(kind) ?? []) {
            const variable = directChild(node, "Variable") ?? firstDescendant(node, "Variable");
            const dataType = directChild(node, "DataType") ?? firstDescendant(node, "DataType");
            if (!variable || !dataType) continue;
            result.set(
                source(input, variable).toLocaleLowerCase(),
                declaredType(source(input, dataType), true),
            );
        }
    }
    return result;
}

function literalType(input: ExpressionTypeInput, node: SyntaxNode): ExpressionType {
    const child = [...node.children()][0];
    const known = child && literalTypes.get(child.kind);
    if (!known) return unknownType;
    // A national-character literal is written `N'...'`, which the token itself records.
    const written = source(input, node);
    const displayName =
        known.displayName === "varchar" && /^[Nn]'/u.test(written) ? "nvarchar" : known.displayName;
    return Object.freeze({
        displayName,
        nullable: known.nullable,
        category: "scalar",
        confidence: "known",
    });
}

/**
 * A column's type, read from the relation that exposes it.
 *
 * Both the qualified and unqualified forms resolve through the same visible-relation list, so a
 * column that hover can describe is a column completion can offer.
 */
function columnType(input: ExpressionTypeInput, node: SyntaxNode): ExpressionType | undefined {
    const parts = multipartIdentifierParts(source(input, node));
    const name = parts.at(-1);
    if (!name) return undefined;
    const qualifier = parts.at(-2)?.toLocaleLowerCase();
    const query = ancestor(node, ["QuerySpecification"]);
    const candidates = input.relations.filter(
        (relation) =>
            relation.columns !== "unknown" &&
            (!query || (relation.range.start >= query.start && relation.range.end <= query.end)) &&
            (qualifier === undefined || relation.exposedName.toLocaleLowerCase() === qualifier),
    );
    const folded = name.toLocaleLowerCase();
    for (const relation of candidates) {
        if (relation.columns === "unknown") continue;
        const column = relation.columns.find(
            (candidate) => candidate.name.toLocaleLowerCase() === folded,
        );
        if (column?.type) {
            return Object.freeze({ ...column.type, sourceRelation: relation.id });
        }
    }
    return undefined;
}

/**
 * The type a member expression yields.
 *
 * XML methods are defined by the language, so they are typed from the method and, for `value`, the
 * type its second argument names. A CLR member is typed from the type the backend reports for it;
 * a member with no reported type leaves the expression untyped rather than guessed.
 */
function memberExpressionType(
    input: ExpressionTypeInput,
    node: SyntaxNode,
    receiver: ExpressionType | undefined,
): ExpressionType | undefined {
    if (!receiver) return undefined;
    const call = directChild(node, "FunctionMemberCall");
    if (call) {
        const name = firstDescendant(call, "IdentifierName");
        return name
            ? xmlMemberType(input, receiver, normalizeIdentifier(source(input, name)), call)
            : undefined;
    }
    const data = directChild(node, "UdtDataMemberCall");
    const member = data && firstDescendant(data, "IdentifierName");
    if (!member) return undefined;
    return clrMemberType(input, receiver, normalizeIdentifier(source(input, member)));
}

/** The result of an XML method call, when the receiver really is XML. */
function xmlMemberType(
    input: ExpressionTypeInput,
    receiver: ExpressionType | undefined,
    member: string,
    call: SyntaxNode,
): ExpressionType | undefined {
    if (receiver?.category !== "xml") return undefined;
    const folded = member.toLocaleLowerCase();
    const fixed = xmlMethodTypes.get(folded);
    if (fixed) return declaredType(fixed, true);
    if (folded !== "value") return undefined;
    // `value('path', 'sql type')` names its own result type in its second argument.
    const list = firstDescendant(call, "ArgumentList");
    const written = list ? [...list.children()].filter((child) => child.kind === "Expression") : [];
    const literal = written[1] && firstDescendant(written[1]!, "StringLiteral");
    if (!literal) return undefined;
    const text = source(input, literal).trim();
    const inner = text.replace(/^[Nn]?'/u, "").replace(/'$/u, "");
    return inner.length > 0 ? declaredType(inner, true) : undefined;
}

/** The type a CLR user-defined type reports for one of its members. */
function clrMemberType(
    input: ExpressionTypeInput,
    receiver: ExpressionType,
    member: string,
): ExpressionType | undefined {
    if (receiver.category !== "clr") return undefined;
    const resolution = input.metadata.resolveObject(multipartIdentifierParts(receiver.displayName));
    if (resolution.kind !== "resolved") return undefined;
    const state = input.metadata.clrTypeState(resolution.object.ref);
    if (state.kind !== "loaded") return undefined;
    const folded = member.toLocaleLowerCase();
    const declared = state.value.members.find(
        (candidate) => candidate.name.toLocaleLowerCase() === folded,
    );
    return declared?.typeDisplay ? declaredType(declared.typeDisplay, true) : undefined;
}

/** The type of a column named by a qualifier, used to identify a method's receiver. */
function columnTypeNamed(
    input: ExpressionTypeInput,
    parts: readonly string[],
    node: SyntaxNode,
): ExpressionType | undefined {
    const name = parts.at(-1);
    if (!name) return undefined;
    const qualifier = parts.at(-2)?.toLocaleLowerCase();
    const query = ancestor(node, ["QuerySpecification"]);
    const folded = name.toLocaleLowerCase();
    for (const relation of input.relations) {
        if (relation.columns === "unknown") continue;
        if (query && (relation.range.start < query.start || relation.range.end > query.end)) {
            continue;
        }
        if (qualifier !== undefined && relation.exposedName.toLocaleLowerCase() !== qualifier) {
            continue;
        }
        const column = relation.columns.find(
            (candidate) => candidate.name.toLocaleLowerCase() === folded,
        );
        if (column?.type) return column.type;
    }
    return undefined;
}

function callType(
    input: ExpressionTypeInput,
    call: ResolvedCall | undefined,
): ExpressionType | undefined {
    if (!call) return undefined;
    if (call.returnType) return call.returnType;
    const declared = call.signatures.find((signature) => signature.returnType)?.returnType;
    if (declared) return declared;
    if (call.target.kind === "builtin") {
        const entry = lookupBuiltIn(call.target.name, "routine");
        return entry?.returnType ? declaredType(entry.returnType, true) : undefined;
    }
    // A catalog scalar function's result type is a metadata fact, reported either directly or as
    // the routine's ordinal-zero parameter, which is how `sys.parameters` describes a return
    // value. A provider that reports neither leaves the call untyped rather than guessed.
    if (call.target.kind === "catalog") {
        const object = input.metadata.object(call.target.object);
        if (object?.returnType) return declaredType(object.returnType, true);
        const state = input.metadata.parameterState(call.target.object);
        if (state.kind !== "loaded") return undefined;
        const result = state.value.find((parameter) => parameter.ordinal === 0);
        return result?.typeDisplay ? declaredType(result.typeDisplay, true) : undefined;
    }
    return undefined;
}

/**
 * The type a `CASE` produces.
 *
 * Every result branch has to agree, because the engine converts them to one type and this module
 * only claims a type it can name. A branch it cannot type makes the whole expression unknown, and
 * a missing `ELSE` makes the result nullable however certain the branches are.
 */
function caseType(
    node: SyntaxNode,
    typeOf: (node: SyntaxNode) => ExpressionType | undefined,
): ExpressionType | undefined {
    const children = [...node.children()];
    const results: SyntaxNode[] = [];
    for (const [index, child] of children.entries()) {
        if (child.kind === "WhenClause") {
            const parts = [...child.children()].filter((part) => part.kind === "Expression");
            const result = parts.at(-1);
            if (result) results.push(result);
        } else if (child.kind === "Else") {
            const next = children[index + 1];
            if (next?.kind === "Expression") results.push(next);
        }
    }
    if (results.length === 0) return undefined;
    const hasElse = children.some((child) => child.kind === "Else");
    const types = results.map(typeOf);
    if (types.some((type) => type === undefined || type.confidence === "unknown")) return undefined;
    const first = types[0]!;
    if (types.some((type) => type!.displayName !== first.displayName)) {
        const converted = convertedType(types as readonly ExpressionType[]);
        if (!converted) return undefined;
        return Object.freeze({ ...converted, nullable: true, confidence: "inferred" as const });
    }
    return Object.freeze({
        ...first,
        nullable: !hasElse || types.some((type) => type!.nullable),
        confidence: "inferred" as const,
    });
}

/**
 * The type of a scalar subquery: the type of the single column it projects.
 *
 * A subquery producing more than one column is not a scalar expression, and one whose column the
 * binder could not type stays unknown.
 */
function subqueryType(
    input: ExpressionTypeInput,
    node: SyntaxNode,
    typeOf: (node: SyntaxNode) => ExpressionType | undefined,
): ExpressionType | undefined {
    const list = firstDescendant(node, "SelectList");
    if (!list) return undefined;
    const elements = [...list.children()].filter((child) => child.kind === "SelectElement");
    if (elements.length !== 1) return undefined;
    const expression = firstDescendant(elements[0]!, "Expression");
    const inner = expression && typeOf(expression);
    if (!inner) return undefined;
    // A subquery that matches no row yields NULL, whatever the column's own nullability says.
    void input;
    return Object.freeze({ ...inner, nullable: true, confidence: "inferred" as const });
}

/**
 * The type an operator produces.
 *
 * Comparison and logical operators are deliberately left untyped: T-SQL has no Boolean value, so
 * naming one would invent a type the language does not have. Arithmetic and concatenation follow
 * the engine's precedence ladder, and anything off that ladder stays unknown.
 */
function operatorType(
    children: readonly SyntaxNode[],
    typeOf: (node: SyntaxNode) => ExpressionType | undefined,
): ExpressionType | undefined {
    const operators = children.filter(
        (child) => arithmeticOperators.has(child.kind) || child.kind === "DoublePipe",
    );
    if (operators.length === 0) return undefined;
    if (children.some((child) => isComparison(child.kind))) return undefined;

    const operands = children
        .filter((child) => !arithmeticOperators.has(child.kind) && child.kind !== "DoublePipe")
        .map(typeOf);
    if (operands.length === 0) return undefined;
    if (operands.some((type) => type === undefined || type.confidence === "unknown")) {
        return undefined;
    }
    const known = operands as readonly ExpressionType[];
    const nullable = known.some((type) => type.nullable);

    // Concatenation of character data produces character data; the ladder does not describe it.
    if (
        known.every((type) => /^n?(?:var)?char\b/iu.test(type.displayName)) &&
        operators.every((operator) => concatenationOperators.has(operator.kind))
    ) {
        const wide = known.some((type) => /^n/iu.test(type.displayName));
        return Object.freeze({
            displayName: wide ? "nvarchar" : "varchar",
            nullable,
            category: "scalar" as const,
            confidence: "inferred" as const,
        });
    }

    const converted = convertedType(known);
    return converted ? Object.freeze({ ...converted, nullable }) : undefined;
}

/** The higher-precedence type of a set of operands, or nothing when one is off the ladder. */
function convertedType(types: readonly ExpressionType[]): ExpressionType | undefined {
    let best: { readonly type: ExpressionType; readonly rank: number } | undefined;
    for (const type of types) {
        const bare = type.displayName.replace(/\(.*$/su, "").trim().toLocaleLowerCase();
        const rank = typePrecedence.indexOf(bare);
        if (rank < 0) return undefined;
        if (!best || rank > best.rank) best = { type, rank };
    }
    return best ? Object.freeze({ ...best.type, confidence: "inferred" as const }) : undefined;
}

function isComparison(kind: string): boolean {
    return [
        "Equal",
        "NotEqual",
        "LessThan",
        "GreaterThan",
        "LessThanOrEqual",
        "GreaterThanOrEqual",
    ].includes(kind);
}

/** Innermost ranges first, so a composite is typed after the parts it is built from. */
function innermostFirst(nodes: readonly SyntaxNode[]): readonly SyntaxNode[] {
    return [...nodes].sort((left, right) => left.end - left.start - (right.end - right.start));
}

/**
 * The type a written data-type name denotes, with its non-scalar category recognised.
 *
 * Exported because a column's declared type has to reach the same conclusion: an `xml` column and
 * an `xml` variable are the same kind of receiver, and a member rule that only recognised one of
 * them would answer differently for the same expression written two ways.
 */
export function declaredType(written: string, nullable: boolean): ExpressionType {
    const displayName = written.trim();
    const category =
        nonScalarCategories.find(([pattern]) => pattern.test(displayName))?.[1] ??
        (isSystemTypeName(displayName) ? "scalar" : "clr");
    return Object.freeze({
        displayName,
        nullable,
        category,
        confidence: "known",
    });
}

/**
 * Whether a written type name is a built-in one.
 *
 * A name the built-in registry does not know is a user-defined or CLR type rather than an unknown
 * one: the document declared it, so the type is known even when its members are not.
 */
function isSystemTypeName(written: string): boolean {
    const bare = written.replace(/\(.*$/su, "").trim();
    return lookupBuiltIn(bare, "dataType") !== undefined;
}

function source(input: ExpressionTypeInput, node: SyntaxNode): string {
    return input.syntax.document.text.slice(node.start, node.end);
}

function rangeKey(range: TextRange): string {
    return `${range.start}:${range.end}`;
}
