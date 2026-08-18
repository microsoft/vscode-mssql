/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FeatureAvailabilityDetail } from "../common/platformFeatureRegistry.js";
import type { TextChange, TextRange, TextSnapshot } from "../text/index.js";

export interface SyntaxDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: "error" | "warning" | "information";
    readonly range: TextRange;
    /**
     * Present only on deliberate platform/version availability diagnostics. Its absence is what
     * separates "this engine cannot run it" from "this is not T-SQL".
     */
    readonly availability?: FeatureAvailabilityDetail;
}

export interface SyntaxToken extends TextRange {
    readonly kind: string;
    readonly text: string;
    readonly trivia: boolean;
    readonly lineStart: boolean;
    readonly keyword?: "reserved" | "contextual";
}

// The engine profile model lives in `common` because metadata, semantics, and features consume it
// as well; syntax re-exports it so a grammar-facing caller keeps one import.
export type {
    EngineCapabilities,
    FeatureAvailability,
    SqlCompatibilityLevel,
    SqlServerMajorVersion,
    TsqlFeatureProfile,
} from "../common/engineCapabilities.js";
export type { SqlEngineProfile } from "../common/engineProfile.js";
export {
    capabilityGeneration,
    defaultTsqlFeatureProfile,
    unknownEngineCapabilities,
} from "../common/engineCapabilities.js";

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
    /** The engine profile this snapshot was produced for. Part of the snapshot's identity. */
    readonly profile: import("../common/engineCapabilities.js").TsqlFeatureProfile;
    /** {@link profile} reduced to one comparable string. Two snapshots agree only when it matches. */
    readonly profileGeneration: string;

    root(): SyntaxNode;
    /** Optional allocation-conscious structural index supplied by syntax implementations. */
    structuralIndex?(): ReadonlyMap<string, readonly SyntaxNode[]>;
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
