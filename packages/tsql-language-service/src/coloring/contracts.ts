/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SemanticSnapshot } from "../semantics/index.js";
import type { SyntaxSnapshot } from "../syntax/index.js";
import type { TextChange, TextRange } from "../text/index.js";

/** Host-neutral SQL classifications. Hosts map these names into their semantic-token legend. */
export const sqlColorTokenTypes = Object.freeze([
    "comment",
    "string",
    "number",
    "keyword",
    "operator",
    "identifier",
    "server",
    "database",
    "schema",
    "table",
    "view",
    "column",
    "function",
    "procedure",
    "parameter",
    "variable",
    "type",
    "alias",
    "commonTableExpression",
    "temporaryTable",
    "label",
] as const);

export type SqlColorTokenType = (typeof sqlColorTokenTypes)[number];

export const sqlColorTokenModifiers = Object.freeze([
    "declaration",
    "definition",
    "readonly",
    "write",
    "deprecated",
    "defaultLibrary",
    "system",
    "quoted",
    "temporary",
] as const);

export type SqlColorTokenModifier = (typeof sqlColorTokenModifiers)[number];

export interface ColorizationLegend {
    readonly tokenTypes: readonly SqlColorTokenType[];
    readonly tokenModifiers: readonly SqlColorTokenModifier[];
}

export const sqlColorizationLegend: ColorizationLegend = Object.freeze({
    tokenTypes: sqlColorTokenTypes,
    tokenModifiers: sqlColorTokenModifiers,
});

/** A resolved classification using UTF-16 document offsets. Tokens are sorted and non-overlapping. */
export interface ColorizedToken extends TextRange {
    readonly tokenType: SqlColorTokenType;
    readonly modifiers: readonly SqlColorTokenModifier[];
}

export interface ColorizationInput {
    readonly syntax: SyntaxSnapshot;
    readonly semantics: SemanticSnapshot;
    readonly range?: TextRange;
}

interface ColorizationResultBase {
    readonly resultId: string;
    readonly documentVersion: number;
    readonly metadataGeneration: number;
}

export interface FullColorizationResult extends ColorizationResultBase {
    readonly kind: "full";
    readonly tokens: readonly ColorizedToken[];
}

/** Token-array edit. `start` and `deleteCount` are token indexes, not LSP integer indexes. */
export interface ColorizationEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly tokens?: readonly ColorizedToken[];
}

export interface DeltaColorizationResult extends ColorizationResultBase {
    readonly kind: "delta";
    readonly previousResultId: string;
    readonly edits: readonly ColorizationEdit[];
}

export type ColorizationResult = FullColorizationResult | DeltaColorizationResult;

/**
 * Strategy implemented by the syntax/semantic coloring milestone. It performs no host encoding.
 * A VS Code or LSP adapter converts the returned offset ranges into its wire representation.
 */
export interface ColorizationService {
    readonly legend: ColorizationLegend;

    provideDocumentColors(input: ColorizationInput): FullColorizationResult;
    provideRangeColors(
        input: ColorizationInput & { readonly range: TextRange },
    ): FullColorizationResult;
    provideColorEdits(
        previous: FullColorizationResult,
        input: ColorizationInput,
        changes: readonly TextChange[],
    ): ColorizationResult;
}
