/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    sqlColorizationLegend,
    type ColorizationEdit,
    type ColorizedToken,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";

/** The host-neutral legend, published to VS Code exactly as the language service defines it. */
export const previewSemanticTokensLegend = new vscode.SemanticTokensLegend(
    [...sqlColorizationLegend.tokenTypes],
    [...sqlColorizationLegend.tokenModifiers],
);

const tokenTypeIndexes = new Map(
    sqlColorizationLegend.tokenTypes.map((type, index) => [type, index]),
);
const tokenModifierBits = new Map(
    sqlColorizationLegend.tokenModifiers.map((modifier, index) => [modifier, 1 << index]),
);

/** Minimal line view of a document, so encoding can be tested without a real editor. */
export interface SemanticTokenLineSource {
    lineAt(offset: number): { readonly line: number; readonly character: number };
    lineLength(line: number): number;
}

export function documentLineSource(document: vscode.TextDocument): SemanticTokenLineSource {
    return {
        lineAt(offset) {
            const position = document.positionAt(offset);
            return { line: position.line, character: position.character };
        },
        lineLength(line) {
            return document.lineAt(line).text.length;
        },
    };
}

/**
 * Encodes classified tokens into the VS Code semantic-token wire format. A token that spans lines,
 * such as a block comment, is split at line boundaries because the protocol forbids one that does.
 */
export function encodeSemanticTokens(
    tokens: readonly ColorizedToken[],
    source: SemanticTokenLineSource,
): Uint32Array {
    const data: number[] = [];
    let previousLine = 0;
    let previousCharacter = 0;
    for (const token of tokens) {
        const type = tokenTypeIndexes.get(token.tokenType);
        if (type === undefined) continue;
        let modifiers = 0;
        for (const modifier of token.modifiers) modifiers |= tokenModifierBits.get(modifier) ?? 0;
        for (const piece of splitTokenLines(token, source)) {
            const deltaLine = piece.line - previousLine;
            const deltaCharacter =
                deltaLine === 0 ? piece.character - previousCharacter : piece.character;
            data.push(deltaLine, deltaCharacter, piece.length, type, modifiers);
            previousLine = piece.line;
            previousCharacter = piece.character;
        }
    }
    return Uint32Array.from(data);
}

function* splitTokenLines(
    token: ColorizedToken,
    source: SemanticTokenLineSource,
): Iterable<{ readonly line: number; readonly character: number; readonly length: number }> {
    const start = source.lineAt(token.start);
    const end = source.lineAt(token.end);
    if (start.line === end.line) {
        if (token.end > token.start) {
            yield { line: start.line, character: start.character, length: token.end - token.start };
        }
        return;
    }
    for (let line = start.line; line <= end.line; line++) {
        const from = line === start.line ? start.character : 0;
        const to = line === end.line ? end.character : source.lineLength(line);
        if (to > from) yield { line, character: from, length: to - from };
    }
}

/**
 * Diffs two encoded token arrays. The delta is computed after encoding because the wire format is
 * relative: replacing one token can change how its successor is encoded.
 */
export function encodeSemanticTokensEdits(
    previous: Uint32Array,
    next: Uint32Array,
): vscode.SemanticTokensEdit[] {
    const shortest = Math.min(previous.length, next.length);
    let prefix = 0;
    while (prefix < shortest && previous[prefix] === next[prefix]) prefix++;
    prefix -= prefix % 5;
    let suffix = 0;
    while (
        suffix < shortest - prefix &&
        previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
        suffix++;
    }
    suffix -= suffix % 5;
    const deleteCount = previous.length - prefix - suffix;
    const inserted = next.slice(prefix, next.length - suffix);
    if (deleteCount === 0 && inserted.length === 0) return [];
    return [new vscode.SemanticTokensEdit(prefix, deleteCount, inserted)];
}

/** Applies the language service token delta so the adapter can keep a full token list cached. */
export function applyColorizationEdits(
    previous: readonly ColorizedToken[],
    edits: readonly ColorizationEdit[],
): readonly ColorizedToken[] {
    if (edits.length === 0) return previous;
    const tokens = [...previous];
    for (const edit of edits) {
        tokens.splice(edit.start, edit.deleteCount, ...(edit.tokens ?? []));
    }
    return tokens;
}
