/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    FullColorizationResult,
    LanguageFeatureService,
    LanguageServiceRuntime,
    MetadataProvider,
} from "@vscode-mssql/tsql-language-service";
import type * as vscode from "vscode";

/** The last full colorization published for one document, kept so deltas have a baseline. */
export interface PreviewSemanticTokenCache {
    readonly result: FullColorizationResult;
    readonly data: Uint32Array;
}

export interface ResolvedDefinitionTarget {
    readonly uri: vscode.Uri;
    readonly targetRange: vscode.Range;
    readonly targetSelectionRange: vscode.Range;
}

export type PreviewOperationStage = "full-open" | "incremental-change" | "rebind" | "reprofile";

export interface PreviewOperationFailure {
    readonly stage: PreviewOperationStage;
    readonly message: string;
    readonly fallbackAttempted: boolean;
    readonly fallbackSucceeded?: boolean;
}

/** All mutable host coordination for one document; analysis products remain immutable snapshots. */
export interface PreviewDocumentState {
    readonly documentUri: vscode.Uri;
    readonly connectionUri: string;
    readonly metadata: MetadataProvider;
    readonly metadataSessionKey?: string;
    readonly metadataLease?: vscode.Disposable;
    readonly runtime: LanguageServiceRuntime;
    readonly features: LanguageFeatureService;
    readonly disposables: vscode.Disposable[];
    queue: Promise<void>;
    syncedVersion: number;
    syncedText: string;
    incrementalFallbackCount: number;
    lastOperationFailure?: PreviewOperationFailure;
    refreshing: boolean;
    lastRefreshMs?: number;
    lastRefreshError?: string;
    rebindQueued: boolean;
    lastDefinitionMs?: number;
    lastDefinitionError?: string;
    profileGeneration: string;
    semanticTokens?: PreviewSemanticTokenCache;
    disposed: boolean;
}
