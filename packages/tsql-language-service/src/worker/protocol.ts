/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlColumnLineage,
    SqlCompletionResult,
    SqlDiagnostic,
    SqlExpandedColumn,
    SqlExternalReference,
    SqlMutationTarget,
    SqlReferences,
    SqlScope,
    SqlSignatureHelp,
    SqlStatement,
    SqlSymbol,
    SqlToken,
    SqlType,
} from "../analysis/contracts.js";
import type { SqlCatalogMapping } from "../metadata/mappingCatalog.js";
import type { IncrementalParseStatistics } from "../parser/incremental/incrementalBatchParser.js";

export type SqlWorkerDocumentMode = "parse" | "analysis";

/** Serializable metadata supplied by the host. Connections and credentials never enter a worker. */
export interface SqlWorkerCatalog {
    readonly mapping: SqlCatalogMapping;
    readonly version?: string | number;
    readonly world?: "open" | "closed";
}

/** UTF-16 edit offsets are applied sequentially, matching LSP incremental-change semantics. */
export interface SqlWorkerTextChange {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

export interface SqlWorkerDocumentSummary {
    readonly uri: string;
    readonly version: number;
    readonly mode: SqlWorkerDocumentMode;
    readonly length: number;
    readonly batchCount: number;
    readonly statementCount: number;
    readonly issueCount: number;
    readonly statistics: IncrementalParseStatistics;
    /** Work inside the worker, excluding message scheduling and structured-clone overhead. */
    readonly workerElapsedMs: number;
}

/** Optional document-wide data. Feature requests avoid transferring parser ASTs to the host. */
export interface SqlWorkerSnapshotData {
    readonly uri: string;
    readonly version: number;
    readonly syntaxDiagnostics: readonly SqlDiagnostic[];
    readonly semanticDiagnostics: readonly SqlDiagnostic[];
    readonly tokens: readonly SqlToken[];
    readonly statements: readonly SqlStatement[];
    readonly scopes: readonly SqlScope[];
    readonly symbols: readonly SqlSymbol[];
    readonly externalReferences: readonly SqlExternalReference[];
    readonly mutationTargets: readonly SqlMutationTarget[];
    readonly lineage: readonly SqlColumnLineage[];
}

export interface SqlWorkerFeatureResults {
    readonly completion: SqlCompletionResult;
    readonly references: SqlReferences | undefined;
    readonly type: SqlType;
    readonly signature: SqlSignatureHelp | undefined;
    readonly starExpansion: readonly SqlExpandedColumn[] | undefined;
    readonly symbol: SqlSymbol | undefined;
    readonly reservedKeyword: boolean;
    readonly normalizedIdentifier: string;
    readonly displayedIdentifier: string;
}

export type SqlWorkerFeatureMethod = keyof SqlWorkerFeatureResults;

interface SqlWorkerRequestBase {
    readonly id: number;
}

export interface SqlWorkerOpenRequest extends SqlWorkerRequestBase {
    readonly type: "open";
    readonly uri: string;
    readonly version: number;
    readonly text: string;
    readonly mode?: SqlWorkerDocumentMode;
    readonly catalog?: SqlWorkerCatalog;
}

export interface SqlWorkerChangeRequest extends SqlWorkerRequestBase {
    readonly type: "change";
    readonly uri: string;
    /** Version on which these sequential UTF-16 edits were computed. */
    readonly expectedVersion: number;
    readonly version: number;
    readonly changes: readonly SqlWorkerTextChange[];
    /** Omitted retains the catalog, null removes it, and a value replaces it. */
    readonly catalog?: SqlWorkerCatalog | null;
}

export interface SqlWorkerCloseRequest extends SqlWorkerRequestBase {
    readonly type: "close";
    readonly uri: string;
}

export interface SqlWorkerSnapshotRequest extends SqlWorkerRequestBase {
    readonly type: "snapshot";
    readonly uri: string;
    readonly expectedVersion: number;
}

export interface SqlWorkerFeatureRequest extends SqlWorkerRequestBase {
    readonly type: "feature";
    readonly uri: string;
    readonly expectedVersion: number;
    readonly method: SqlWorkerFeatureMethod;
    readonly offset?: number;
    readonly value?: string;
    readonly identifierKind?: "table" | "other";
}

export interface SqlWorkerCancelRequest {
    readonly type: "cancel";
    readonly id: number;
}

export type SqlWorkerRequest =
    | SqlWorkerOpenRequest
    | SqlWorkerChangeRequest
    | SqlWorkerCloseRequest
    | SqlWorkerSnapshotRequest
    | SqlWorkerFeatureRequest
    | SqlWorkerCancelRequest;

export interface SqlWorkerSuccessResponse<T = unknown> {
    readonly type: "response";
    readonly id: number;
    readonly ok: true;
    readonly documentVersion?: number;
    readonly result: T;
}

export interface SqlWorkerFailureResponse {
    readonly type: "response";
    readonly id: number;
    readonly ok: false;
    readonly error: {
        readonly name: string;
        readonly message: string;
        readonly stack?: string;
    };
}

export type SqlWorkerResponse<T = unknown> = SqlWorkerSuccessResponse<T> | SqlWorkerFailureResponse;

export function isSqlWorkerResponse(value: unknown): value is SqlWorkerResponse {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { readonly type?: unknown }).type === "response" &&
        typeof (value as { readonly id?: unknown }).id === "number"
    );
}
