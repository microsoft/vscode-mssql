/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextChange, TextRange, TextSnapshot } from "../text/index.js";

export interface SyntaxDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: "error" | "warning" | "information";
    readonly range: TextRange;
}

export interface SyntaxToken extends TextRange {
    readonly kind: string;
    readonly text: string;
    readonly trivia: boolean;
    readonly lineStart: boolean;
}

export interface SyntaxNode extends TextRange {
    readonly kind: string;
    readonly error: boolean;
    parent(): SyntaxNode | undefined;
    children(): Iterable<SyntaxNode>;
}

export interface SyntaxContext {
    readonly offset: number;
    readonly node: SyntaxNode;
    readonly ancestors: readonly string[];
    readonly batch?: TextRange;
    readonly statement?: TextRange;
}

export interface SyntaxReuseStatistics {
    readonly mode: "full" | "incremental";
    readonly changedRangeCount: number;
    readonly reusableFragmentCount: number;
}

export interface SyntaxSnapshot {
    readonly document: TextSnapshot;
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly changedRanges: readonly TextRange[];
    readonly statistics: SyntaxReuseStatistics;

    root(): SyntaxNode;
    nodeAt(offset: number): SyntaxNode;
    contextAt(offset: number): SyntaxContext;
    tokens(range?: TextRange): Iterable<SyntaxToken>;
}

export interface SyntaxService {
    parse(document: TextSnapshot): SyntaxSnapshot;
    update(
        previous: SyntaxSnapshot,
        document: TextSnapshot,
        changes: readonly TextChange[],
    ): SyntaxSnapshot;
}
