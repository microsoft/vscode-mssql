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
    readonly keyword?: "reserved" | "contextual";
}

export type SqlServerMajorVersion = 15 | 16 | 17;
export type SqlCompatibilityLevel = 150 | 160 | 170;
export type SqlEngineFlavor = "sql-server" | "azure-sql" | "azure-synapse" | "fabric";

export interface TsqlFeatureProfile {
    readonly serverMajorVersion: SqlServerMajorVersion;
    readonly compatibilityLevel: SqlCompatibilityLevel;
    readonly engineFlavor: SqlEngineFlavor;
    readonly previewFeatures: boolean;
}

export const defaultTsqlFeatureProfile: TsqlFeatureProfile = Object.freeze({
    serverMajorVersion: 17,
    compatibilityLevel: 170,
    engineFlavor: "sql-server",
    previewFeatures: false,
});

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
    /** Fragments offered to Lezer for native subtree reuse, not a claim that every fragment shifted. */
    readonly reusableFragmentCount: number;
    /** Complete safe batch groups reused without invoking the parser. */
    readonly reusedChunkCount: number;
    /** Safe batch groups reparsed for this snapshot. */
    readonly reparsedChunkCount: number;
    /** Source characters presented to Lezer for this snapshot. */
    readonly parsedCharacterCount: number;
    /** Number of independently cached safe batch groups. */
    readonly chunkCount: number;
    /** Raw Lezer recovery nodes before diagnostic conversion or compatibility filtering. */
    readonly rawErrorNodeCount: number;
    /** Top-level grammar-defined SQL batches in the canonical Script tree. */
    readonly batchCount: number;
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
