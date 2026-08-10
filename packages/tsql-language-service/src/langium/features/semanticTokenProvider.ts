/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    Range,
    SemanticTokens,
    SemanticTokensDelta,
    SemanticTokensLegend,
} from "vscode-languageserver-types";
import type { SqlSymbol, SqlToken } from "../../analysis/contracts.js";
import type { SqlFeatureDocumentAccessor } from "./featureDocument.js";

export const sqlSemanticTokenTypes = [
    "namespace",
    "type",
    "class",
    "struct",
    "parameter",
    "variable",
    "property",
    "function",
    "keyword",
    "comment",
    "string",
    "number",
    "operator",
] as const;

export const sqlSemanticTokenModifiers = [
    "declaration",
    "definition",
    "readonly",
    "modification",
    "defaultLibrary",
] as const;

export const sqlSemanticTokensLegend: SemanticTokensLegend = {
    tokenTypes: [...sqlSemanticTokenTypes],
    tokenModifiers: [...sqlSemanticTokenModifiers],
};

type SqlTokenType = (typeof sqlSemanticTokenTypes)[number];
type SqlTokenModifier = (typeof sqlSemanticTokenModifiers)[number];

interface ClassifiedToken {
    readonly line: number;
    readonly character: number;
    readonly length: number;
    readonly type: SqlTokenType;
    readonly modifiers: readonly SqlTokenModifier[];
}

export class SqlSemanticTokenProvider {
    public readonly legend = sqlSemanticTokensLegend;
    private readonly cache = new Map<
        string,
        { readonly resultId: string; readonly data: number[] }
    >();

    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async getSemanticTokens(uri: string, range?: Range): Promise<SemanticTokens> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return { data: [] };
        }
        const symbols = document.analysis.symbols();
        const writes = document.analysis
            .externalReferences()
            .filter((reference) => reference.role === "write")
            .map((reference) => reference.span)
            .sort((left, right) => left.start - right.start || left.end - right.end);
        const tokens = document.analysis.tokens
            .filter((token) => token.channel === "code" || token.role === "comment")
            .filter((token) => token.span.start < document.text.length)
            .sort((left, right) => left.span.start - right.span.start);
        const symbolsByToken = matchSymbols(tokens, symbols);
        const classified = tokens
            .flatMap((token) =>
                classifyToken(
                    token,
                    symbolsByToken.get(token),
                    document.text.length,
                    sortedSpanContains(writes, token.span.start, token.span.end),
                ),
            )
            .filter((token) => !range || tokenIntersectsRange(token, range))
            .sort((left, right) => left.line - right.line || left.character - right.character);
        const data = encodeTokens(classified);
        if (range) {
            return { data };
        }
        const resultId = semanticResultId(document.version ?? document.analysis.version, data);
        this.cache.set(uri, { resultId, data });
        return { resultId, data };
    }

    public async getSemanticTokenEdits(
        uri: string,
        previousResultId: string,
    ): Promise<SemanticTokens | SemanticTokensDelta> {
        const previous = this.cache.get(uri);
        const current = await this.getSemanticTokens(uri);
        if (!previous || previous.resultId !== previousResultId || !current.resultId) {
            return current;
        }
        return {
            resultId: current.resultId,
            edits: [singleTokenEdit(previous.data, current.data)],
        };
    }
}

function sortedSpanContains(
    spans: readonly { readonly start: number; readonly end: number }[],
    start: number,
    end: number,
): boolean {
    let low = 0;
    let high = spans.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((spans[middle]?.start ?? Number.POSITIVE_INFINITY) <= start) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    for (let index = low - 1; index >= 0; index--) {
        const span = spans[index]!;
        if (span.end < end) return false;
        if (span.start <= start && end <= span.end) return true;
    }
    return false;
}

function singleTokenEdit(previous: readonly number[], current: readonly number[]) {
    let prefix = 0;
    while (
        prefix < previous.length &&
        prefix < current.length &&
        previous[prefix] === current[prefix]
    ) {
        prefix++;
    }
    let suffix = 0;
    while (
        suffix < previous.length - prefix &&
        suffix < current.length - prefix &&
        previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
    ) {
        suffix++;
    }
    return {
        start: prefix,
        deleteCount: previous.length - prefix - suffix,
        data: current.slice(prefix, current.length - suffix),
    };
}

function semanticResultId(version: number, data: readonly number[]): string {
    let hash = 2_166_136_261;
    for (const value of data) {
        hash = Math.imul(hash ^ value, 16_777_619) >>> 0;
    }
    return `${version}:${hash.toString(16)}`;
}

function classifyToken(
    token: SqlToken,
    symbol: SqlSymbol | undefined,
    sourceLength: number,
    modification: boolean,
): ClassifiedToken[] {
    const type = lexicalType(token) ?? symbolType(symbol);
    if (!type || token.end.line !== token.start.line) {
        return type
            ? splitMultilineToken(token, type, symbolModifiers(symbol, modification), sourceLength)
            : [];
    }
    const length = Math.min(token.span.end, sourceLength) - token.span.start;
    return length > 0
        ? [
              {
                  line: token.start.line,
                  character: token.start.character,
                  length,
                  type,
                  modifiers: symbolModifiers(symbol, modification),
              },
          ]
        : [];
}

function lexicalType(token: SqlToken): SqlTokenType | undefined {
    switch (token.role) {
        case "keyword":
            return token.consumedAs === "identifier"
                ? undefined
                : token.consumedAs === "type"
                  ? "type"
                  : "keyword";
        case "comment":
        case "string":
        case "number":
        case "operator":
            return token.role;
        default:
            return undefined;
    }
}

function symbolType(symbol: SqlSymbol | undefined): SqlTokenType | undefined {
    switch (symbol?.kind) {
        case "table":
        case "tempTable":
            return "class";
        case "cte":
        case "subquery":
        case "lateral":
            return "struct";
        case "column":
            return "property";
        case "alias":
        case "variable":
            return "variable";
        case "parameter":
            return "parameter";
        case "function":
        case "procedure":
            return "function";
        case "type":
            return "type";
        default:
            return undefined;
    }
}

function matchSymbols(
    tokens: readonly SqlToken[],
    symbols: readonly SqlSymbol[],
): Map<SqlToken, SqlSymbol> {
    const ordered = [...symbols].sort(
        (left, right) => left.span.start - right.span.start || left.span.end - right.span.end,
    );
    const result = new Map<SqlToken, SqlSymbol>();
    let nextSymbol = 0;
    let active: SqlSymbol[] = [];
    for (const token of tokens) {
        while (nextSymbol < ordered.length && ordered[nextSymbol].span.start <= token.span.start) {
            active.push(ordered[nextSymbol++]);
        }
        active = active.filter((symbol) => symbol.span.end >= token.span.end);
        let best: SqlSymbol | undefined;
        for (const symbol of active) {
            if (!best || symbol.span.end - symbol.span.start < best.span.end - best.span.start) {
                best = symbol;
            }
        }
        if (best) {
            result.set(token, best);
        }
    }
    return result;
}

function symbolModifiers(symbol: SqlSymbol | undefined, modification: boolean): SqlTokenModifier[] {
    const result: SqlTokenModifier[] = [];
    if (symbol?.modifiers.includes("declaration")) {
        result.push("declaration", "definition");
    }
    if (symbol?.kind === "cte") {
        result.push("readonly");
    }
    if (modification) {
        result.push("modification");
    }
    if (symbol?.kind === "function" && !symbol.name.includes(".")) {
        result.push("defaultLibrary");
    }
    return result;
}

function splitMultilineToken(
    token: SqlToken,
    type: SqlTokenType,
    modifiers: readonly SqlTokenModifier[],
    sourceLength: number,
): ClassifiedToken[] {
    return token.text
        .slice(0, Math.max(0, sourceLength - token.span.start))
        .split(/\r?\n/)
        .map((text, index) => ({
            line: token.start.line + index,
            character: index === 0 ? token.start.character : 0,
            length: text.length,
            type,
            modifiers,
        }))
        .filter((part) => part.length > 0);
}

function tokenIntersectsRange(token: ClassifiedToken, range: Range): boolean {
    if (token.line < range.start.line || token.line > range.end.line) {
        return false;
    }
    if (
        token.line === range.start.line &&
        token.character + token.length <= range.start.character
    ) {
        return false;
    }
    return token.line !== range.end.line || token.character < range.end.character;
}

function encodeTokens(tokens: readonly ClassifiedToken[]): number[] {
    const data: number[] = [];
    let previousLine = 0;
    let previousCharacter = 0;
    for (const token of tokens) {
        const deltaLine = token.line - previousLine;
        const deltaCharacter =
            deltaLine === 0 ? token.character - previousCharacter : token.character;
        data.push(
            deltaLine,
            deltaCharacter,
            token.length,
            sqlSemanticTokenTypes.indexOf(token.type),
            modifierBits(token.modifiers),
        );
        previousLine = token.line;
        previousCharacter = token.character;
    }
    return data;
}

function modifierBits(modifiers: readonly SqlTokenModifier[]): number {
    return modifiers.reduce(
        (bits, modifier) => bits | (1 << sqlSemanticTokenModifiers.indexOf(modifier)),
        0,
    );
}
