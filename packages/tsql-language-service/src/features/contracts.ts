/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SemanticDiagnostic } from "../semantics/index.js";
import type { SyntaxDiagnostic } from "../syntax/index.js";
import type { ObjectDefinitionDescriptor } from "./objectDefinitions.js";
import type { TextRange } from "../text/index.js";

export interface TextEdit extends TextRange {
    readonly newText: string;
}

export interface CompletionItem {
    readonly label: string;
    readonly kind: string;
    readonly detail?: string;
    readonly documentation?: string;
    readonly sortText?: string;
    readonly filterText?: string;
    readonly insertTextFormat?: "plain" | "snippet";
    readonly preselect?: boolean;
    readonly command?: {
        readonly command: string;
        readonly title: string;
    };
    readonly edit?: TextEdit;
    readonly data?: unknown;
}

export interface CompletionResult {
    readonly items: readonly CompletionItem[];
    readonly incomplete: boolean;
}

export interface HoverResult {
    readonly range?: TextRange;
    readonly markdown: string;
}

export interface Location {
    readonly uri: string;
    readonly range: TextRange;
}

/**
 * Where a name is defined. A local declaration resolves inside the document and needs nothing
 * further. A catalog object resolves to an identity the host fetches asynchronously, because
 * reading an object definition is I/O and this service performs none.
 */
export interface DefinitionTarget {
    readonly locations: readonly Location[];
    readonly object?: ObjectDefinitionDescriptor;
    /**
     * The identifier occurrence navigation started from. A host renders it as the clickable
     * origin of a definition link instead of highlighting unrelated surrounding syntax.
     */
    readonly originRange?: TextRange;
}

export interface DocumentSymbol {
    readonly name: string;
    readonly kind: string;
    readonly range: TextRange;
    readonly selectionRange: TextRange;
    readonly children?: readonly DocumentSymbol[];
}

/**
 * Folding kinds a host can style separately. Structural folds carry no kind, matching LSP, where an
 * absent kind means an ordinary code region.
 */
export type FoldingRangeKind = "comment" | "region";

/** Host limits applied while selecting document folding ranges. */
export interface FoldingRangeOptions {
    /** Largest number of ranges to publish; widest regions receive priority. */
    readonly limit?: number;
}

/**
 * A collapsible region in UTF-16 offsets. The service guarantees that each range covers more than
 * one line, that no two ranges begin on the same line, and that ranges nest without partial
 * overlap, so a host only has to convert offsets to its own line encoding.
 */
export interface FoldingRange extends TextRange {
    readonly kind?: FoldingRangeKind;
}

export interface SignatureHelp {
    readonly signatures: readonly {
        readonly label: string;
        readonly documentation?: string;
        readonly parameters: readonly { readonly label: string; readonly documentation?: string }[];
    }[];
    readonly activeSignature?: number;
    readonly activeParameter?: number;
}

export interface LanguageFeatureService {
    completion(uri: string, version: number, offset: number): CompletionResult;
    resolveCompletion(item: CompletionItem): Promise<CompletionItem>;
    hover(uri: string, version: number, offset: number): HoverResult | undefined;
    definition(uri: string, version: number, offset: number): readonly Location[];
    /**
     * The same resolution as `definition`, plus the catalog object to fetch when the name is one.
     * Declarations inside the document still resolve synchronously and completely.
     */
    definitionTarget(uri: string, version: number, offset: number): DefinitionTarget;
    references(uri: string, version: number, offset: number): readonly Location[];
    prepareRename(uri: string, version: number, offset: number): TextRange | undefined;
    rename(uri: string, version: number, offset: number, newName: string): readonly TextEdit[];
    diagnostics(
        uri: string,
        version: number,
    ): {
        readonly syntax: readonly SyntaxDiagnostic[];
        readonly semantic: readonly SemanticDiagnostic[];
    };
    documentSymbols(uri: string, version: number): readonly DocumentSymbol[];
    foldingRanges(
        uri: string,
        version: number,
        options?: FoldingRangeOptions,
    ): readonly FoldingRange[];
    selectionRanges(uri: string, version: number, offsets: readonly number[]): readonly TextRange[];
    signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined;
}
