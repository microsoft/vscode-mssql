/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SemanticDiagnostic } from "../semantics/index.js";
import type { SyntaxDiagnostic } from "../syntax/index.js";
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

export interface DocumentSymbol {
    readonly name: string;
    readonly kind: string;
    readonly range: TextRange;
    readonly selectionRange: TextRange;
    readonly children?: readonly DocumentSymbol[];
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
    foldingRanges(uri: string, version: number): readonly TextRange[];
    selectionRanges(uri: string, version: number, offsets: readonly number[]): readonly TextRange[];
    signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined;
}
