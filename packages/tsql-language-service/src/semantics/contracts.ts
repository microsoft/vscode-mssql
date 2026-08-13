/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView, ObjectRef } from "../metadata/index.js";
import type { SyntaxSnapshot } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";

export type SymbolId = string;

export interface SemanticDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: "error" | "warning" | "information" | "hint";
    readonly range: TextRange;
}

export interface SqlType {
    readonly displayName: string;
    readonly nullable: boolean;
}

export interface SemanticSymbol {
    readonly id: SymbolId;
    readonly name: string;
    readonly kind: string;
    readonly declaration?: TextRange;
    readonly object?: ObjectRef;
    readonly type?: SqlType;
}

export interface BoundReference extends TextRange {
    readonly symbol?: SymbolId;
    readonly unresolvedName?: readonly string[];
    readonly write: boolean;
}

export interface BoundUnit {
    readonly kind: "script" | "batch" | "statement" | "query";
    readonly range: TextRange;
    readonly syntaxFingerprint: string;
    readonly incomingEnvironmentVersion: string;
    readonly exportedEnvironmentVersion: string;
    readonly metadataDependencies: readonly string[];
    readonly symbols: readonly SemanticSymbol[];
    readonly references: readonly BoundReference[];
    readonly diagnostics: readonly SemanticDiagnostic[];
}

export interface SemanticSnapshot {
    readonly documentVersion: number;
    readonly metadataGeneration: number;
    readonly units: readonly BoundUnit[];
    readonly diagnostics: readonly SemanticDiagnostic[];
    readonly statistics: {
        readonly unitsExamined: number;
        readonly unitsReused: number;
        readonly unitsRebound: number;
        readonly elapsedMs: number;
    };

    symbolAt(offset: number): SemanticSymbol | undefined;
    references(symbol: SymbolId): readonly BoundReference[];
    visibleSymbols(offset: number): readonly SemanticSymbol[];
}

export interface BindInput {
    readonly syntax: SyntaxSnapshot;
    readonly metadata: MetadataView;
    readonly previous?: SemanticSnapshot;
    readonly changedRanges?: readonly TextRange[];
    readonly settings?: Readonly<Record<string, string | number | boolean>>;
}

export interface SemanticBinder {
    bind(input: BindInput): SemanticSnapshot;
    update(previous: SemanticSnapshot, input: BindInput): SemanticSnapshot;
}
