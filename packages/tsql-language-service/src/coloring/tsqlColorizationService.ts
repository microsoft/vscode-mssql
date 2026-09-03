/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxToken } from "../syntax/index.js";
import type { TextChange, TextRange } from "../text/index.js";
import {
    deprecatedOperatorTokenKinds,
    identifierTokenKinds,
    literalTokenTypes,
    operatorTokenKinds,
    quotedIdentifierTokenKinds,
} from "./classificationTables.js";
import { classification, rangeKey, type Classification } from "./classificationModel.js";
import {
    sqlColorizationLegend,
    type ColorizationEdit,
    type ColorizationInput,
    type ColorizationLegend,
    type ColorizationResult,
    type ColorizationService,
    type ColorizedToken,
    type FullColorizationResult,
    type SqlColorTokenModifier,
} from "./contracts.js";
import { collectSemanticClassification } from "./semanticClassification.js";
import {
    collectSyntacticClassification,
    type SyntacticClassification,
} from "./syntacticClassification.js";

/**
 * Classifies a document from the syntax and semantic snapshots the runtime already published.
 *
 * Three layers combine per token: the lexical kind, the syntactic role the tree gives a name, and
 * the bound symbol when one exists. The service parses nothing and queries no metadata, so a
 * document with unresolved names still colors completely from its tree.
 */
export class TsqlColorizationService implements ColorizationService {
    public readonly legend: ColorizationLegend = sqlColorizationLegend;

    public provideDocumentColors(input: ColorizationInput): FullColorizationResult {
        validateInput(input);
        return fullResult(input, colorize(input, input.range ?? documentRange(input)));
    }

    public provideRangeColors(
        input: ColorizationInput & { readonly range: TextRange },
    ): FullColorizationResult {
        validateInput(input);
        if (
            input.range.start < 0 ||
            input.range.end > input.syntax.document.length ||
            input.range.start > input.range.end
        ) {
            throw new RangeError("Colorization range is outside the document");
        }
        return fullResult(input, colorize(input, input.range));
    }

    public provideColorEdits(
        previous: FullColorizationResult,
        input: ColorizationInput,
        changes: readonly TextChange[],
    ): ColorizationResult {
        validateInput(input);
        const unchanged =
            changes.length === 0 &&
            previous.documentVersion === input.syntax.document.version &&
            previous.metadataGeneration === input.semantics.metadataGeneration;
        const tokens = unchanged
            ? previous.tokens
            : colorize(input, input.range ?? documentRange(input));
        return Object.freeze({
            kind: "delta",
            previousResultId: previous.resultId,
            resultId: resultId(input),
            documentVersion: input.syntax.document.version,
            metadataGeneration: input.semantics.metadataGeneration,
            edits: diffTokens(previous.tokens, tokens),
        });
    }
}

function colorize(input: ColorizationInput, range: TextRange): readonly ColorizedToken[] {
    const syntactic = collectSyntacticClassification(input.syntax, range);
    const semantic = collectSemanticClassification(input.semantics, syntactic, range);
    const unterminated = unterminatedStringRanges(input, range);
    const tokens: ColorizedToken[] = [];
    let consumed = range.start;
    let pending = 0;
    for (const token of input.syntax.tokens(range)) {
        if (token.end <= token.start || token.start < consumed) continue;
        while (pending < unterminated.length && unterminated[pending]!.end <= token.start)
            pending++;
        const openString = unterminated[pending];
        if (openString && openString.start <= token.start) {
            // Recovery hands back the characters after an opening quote as ordinary tokens. They
            // are string content, so the whole unterminated run is published as one string.
            tokens.push(colorizedToken(openString, classification("string")));
            consumed = openString.end;
            pending++;
            continue;
        }
        consumed = token.end;
        const resolved = classifyToken(token, syntactic, semantic);
        if (resolved) tokens.push(colorizedToken(token, resolved));
    }
    return Object.freeze(tokens);
}

function colorizedToken(range: TextRange, resolved: Classification): ColorizedToken {
    return Object.freeze({
        start: range.start,
        end: range.end,
        tokenType: resolved.type,
        modifiers: resolved.modifiers,
    });
}

/**
 * Runs the syntax snapshot already reported as an unclosed string, clipped to the requested range.
 * Nothing inside one may be classified as a symbol.
 *
 * An unclosed delimited identifier carries the same diagnostic but not the same coloring: a hostile
 * name must not repaint the statements after it, so only a run opened by a quote is taken here.
 */
function unterminatedStringRanges(
    input: ColorizationInput,
    range: TextRange,
): readonly TextRange[] {
    const ranges: TextRange[] = [];
    for (const diagnostic of input.syntax.diagnostics) {
        if (diagnostic.code !== unclosedStringDiagnosticCode) continue;
        if (input.syntax.document.text[diagnostic.range.start] !== "'") continue;
        const start = Math.max(diagnostic.range.start, range.start);
        const end = Math.min(diagnostic.range.end, range.end);
        if (start < end) ranges.push({ start, end });
    }
    return ranges.sort((left, right) => left.start - right.start);
}

const unclosedStringDiagnosticCode = "UnclosedQuotationMark";

function classifyToken(
    token: SyntaxToken,
    syntactic: SyntacticClassification,
    semantic: ReadonlyMap<string, Classification>,
): Classification | undefined {
    const literal = literalTokenTypes.get(token.kind);
    // Comments and literals are lexical facts. No bound symbol may recolor them, which keeps a
    // name inside a string or a damaged token from being presented as a resolved object.
    if (literal) return classification(literal);
    if (token.trivia) return undefined;

    const key = rangeKey(token);
    const syntacticRole = syntactic.roles.get(key);
    const boundRole = semantic.get(key);
    if (syntacticRole && (!boundRole || prefersSyntacticType(syntacticRole, boundRole))) {
        // The binding described the same name less precisely, so its modifiers are dropped with
        // its type: a call site is not the declaration the binder recorded there.
        return classification(syntacticRole.type, [
            ...syntacticRole.modifiers,
            ...tokenModifiers(token),
        ]);
    }
    if (boundRole) {
        return classification(boundRole.type, [
            ...(syntacticRole?.modifiers ?? []),
            ...boundRole.modifiers,
            ...tokenModifiers(token),
        ]);
    }
    return lexicalClassification(token);
}

/**
 * Cases where the tree knows more than the binding does.
 *
 * A routine parameter is recorded as an ordinary local variable, and only its declaration site
 * tells the two apart. A rowset function such as `OPENJSON` is recorded as the rowset it exposes,
 * which would otherwise present the call as the declaration of a correlation name.
 */
function prefersSyntacticType(syntacticRole: Classification, boundRole: Classification): boolean {
    if (syntacticRole.type === "parameter") return boundRole.type === "variable";
    return (
        (syntacticRole.type === "function" || syntacticRole.type === "procedure") &&
        boundRole.type === "alias"
    );
}

function lexicalClassification(token: SyntaxToken): Classification | undefined {
    if (operatorTokenKinds.has(token.kind)) {
        return classification(
            "operator",
            deprecatedOperatorTokenKinds.has(token.kind) ? ["deprecated"] : [],
        );
    }
    if (token.kind === "Keyword" || token.kind === "Go") return classification("keyword");
    if (token.kind === "GlobalVariable") return classification("variable", ["system", "readonly"]);
    if (token.kind === "Variable") return classification("variable");
    if (token.kind === "Label") return classification("label", ["declaration"]);
    if (identifierTokenKinds.has(token.kind)) {
        return classification("identifier", tokenModifiers(token));
    }
    return undefined;
}

function tokenModifiers(token: SyntaxToken): readonly SqlColorTokenModifier[] {
    if (quotedIdentifierTokenKinds.has(token.kind)) return ["quoted"];
    return token.kind === "TempIdentifier" ? ["temporary"] : [];
}

/** Token-array diff. Indexes address tokens, which a host converts to its own wire encoding. */
function diffTokens(
    previous: readonly ColorizedToken[],
    next: readonly ColorizedToken[],
): readonly ColorizationEdit[] {
    const shortest = Math.min(previous.length, next.length);
    let prefix = 0;
    while (prefix < shortest && sameToken(previous[prefix]!, next[prefix]!)) prefix++;
    let suffix = 0;
    while (
        suffix < shortest - prefix &&
        sameToken(previous[previous.length - 1 - suffix]!, next[next.length - 1 - suffix]!)
    ) {
        suffix++;
    }
    const deleteCount = previous.length - prefix - suffix;
    const inserted = next.slice(prefix, next.length - suffix);
    if (deleteCount === 0 && inserted.length === 0) return Object.freeze([]);
    return Object.freeze([
        Object.freeze({
            start: prefix,
            deleteCount,
            ...(inserted.length > 0 ? { tokens: Object.freeze(inserted) } : {}),
        }),
    ]);
}

function sameToken(left: ColorizedToken, right: ColorizedToken): boolean {
    return (
        left.start === right.start &&
        left.end === right.end &&
        left.tokenType === right.tokenType &&
        left.modifiers.length === right.modifiers.length &&
        left.modifiers.every((modifier, index) => modifier === right.modifiers[index])
    );
}

function validateInput(input: ColorizationInput): void {
    if (input.syntax.document.version !== input.semantics.documentVersion) {
        throw new Error(
            `Colorization snapshot mismatch: syntax ${input.syntax.document.version}, semantics ${input.semantics.documentVersion}`,
        );
    }
}

function documentRange(input: ColorizationInput): TextRange {
    return { start: 0, end: input.syntax.document.length };
}

function fullResult(
    input: ColorizationInput,
    tokens: readonly ColorizedToken[],
): FullColorizationResult {
    return Object.freeze({
        kind: "full",
        resultId: resultId(input),
        documentVersion: input.syntax.document.version,
        metadataGeneration: input.semantics.metadataGeneration,
        tokens,
    });
}

function resultId(input: ColorizationInput): string {
    const range = input.range
        ? `${input.range.start}-${input.range.end}`
        : `0-${input.syntax.document.length}`;
    return `${input.syntax.document.version}:${input.semantics.metadataGeneration}:${range}`;
}
