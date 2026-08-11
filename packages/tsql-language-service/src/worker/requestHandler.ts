/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SaralSqlAnalysisEngine } from "../adapters/saral.js";
import type { SqlAnalysisSnapshot, SqlAnalysisUpdate } from "../analysis/contracts.js";
import { MappingCatalogProvider } from "../metadata/mappingCatalog.js";
import {
    IncrementalBatchParser,
    type IncrementalParseSnapshot,
    type IncrementalParseStatistics,
} from "../parser/incremental/incrementalBatchParser.js";
import type {
    SqlWorkerCatalog,
    SqlWorkerChangeRequest,
    SqlWorkerDocumentSummary,
    SqlWorkerFeatureRequest,
    SqlWorkerFeatureResults,
    SqlWorkerOpenRequest,
    SqlWorkerRequest,
    SqlWorkerResponse,
    SqlWorkerSnapshotData,
    SqlWorkerTextChange,
} from "./protocol.js";

interface ParseDocumentState {
    readonly mode: "parse";
    readonly uri: string;
    readonly version: number;
    readonly snapshot: IncrementalParseSnapshot;
}

interface AnalysisDocumentState {
    readonly mode: "analysis";
    readonly uri: string;
    readonly version: number;
    readonly snapshot: SqlAnalysisSnapshot;
    readonly catalog: SqlWorkerCatalog | undefined;
}

type WorkerDocumentState = ParseDocumentState | AnalysisDocumentState;

interface IncrementalSnapshotWithStatistics extends SqlAnalysisSnapshot {
    readonly incrementalStatistics?: IncrementalParseStatistics;
}

/** Worker-side document repository. Parser products and ASTs never cross the transport boundary. */
export class SqlWorkerRequestHandler {
    private readonly documents = new Map<string, WorkerDocumentState>();
    private readonly active = new Set<number>();
    private readonly cancelled = new Set<number>();
    private readonly parser = new IncrementalBatchParser();
    private readonly engine = new SaralSqlAnalysisEngine();

    public async handle(request: SqlWorkerRequest): Promise<SqlWorkerResponse> {
        if (request.type === "cancel") {
            if (this.active.has(request.id)) {
                this.cancelled.add(request.id);
            }
            return success(request.id, undefined);
        }
        this.active.add(request.id);
        try {
            this.throwIfCancelled(request.id);
            const started = performance.now();
            switch (request.type) {
                case "open": {
                    const state = this.open(request);
                    this.throwIfCancelled(request.id);
                    return success(
                        request.id,
                        summarize(state, performance.now() - started),
                        state.version,
                    );
                }
                case "change": {
                    const state = this.change(request);
                    this.throwIfCancelled(request.id);
                    return success(
                        request.id,
                        summarize(state, performance.now() - started),
                        state.version,
                    );
                }
                case "close":
                    return success(request.id, this.documents.delete(request.uri));
                case "snapshot": {
                    const state = this.requireAnalysis(request.uri, request.expectedVersion);
                    return success(request.id, snapshotData(state), state.version);
                }
                case "feature": {
                    const state = this.requireAnalysis(request.uri, request.expectedVersion);
                    const result = feature(state.snapshot, request);
                    this.throwIfCancelled(request.id);
                    return success(request.id, result, state.version);
                }
            }
        } catch (error) {
            return failure(request.id, error);
        } finally {
            this.active.delete(request.id);
            this.cancelled.delete(request.id);
        }
    }

    private open(request: SqlWorkerOpenRequest): WorkerDocumentState {
        const mode = request.mode ?? "analysis";
        const state: WorkerDocumentState =
            mode === "parse"
                ? {
                      mode,
                      uri: request.uri,
                      version: request.version,
                      snapshot: this.parser.create(request.text, request.version),
                  }
                : {
                      mode,
                      uri: request.uri,
                      version: request.version,
                      catalog: request.catalog,
                      snapshot: this.engine.createSnapshot({
                          uri: request.uri,
                          text: request.text,
                          catalog: catalogProvider(request.catalog),
                      }),
                  };
        this.documents.set(request.uri, state);
        return state;
    }

    private change(request: SqlWorkerChangeRequest): WorkerDocumentState {
        const previous = this.documents.get(request.uri);
        if (!previous) {
            throw new Error(`Worker document is not open: ${request.uri}`);
        }
        if (request.version <= previous.version) {
            throw new Error(
                `Worker document version must increase (${request.version} <= ${previous.version})`,
            );
        }
        if (request.expectedVersion !== previous.version) {
            throw new Error(
                `Worker edit base version is stale (${request.expectedVersion} != ${previous.version})`,
            );
        }
        const text = applyTextChanges(previous.snapshot.text, request.changes);
        let state: WorkerDocumentState;
        if (previous.mode === "parse") {
            state = {
                mode: "parse",
                uri: previous.uri,
                version: request.version,
                snapshot: this.parser.update(previous.snapshot, text, request.version),
            };
        } else {
            const catalog = Object.prototype.hasOwnProperty.call(request, "catalog")
                ? (request.catalog ?? undefined)
                : previous.catalog;
            const update: SqlAnalysisUpdate = Object.prototype.hasOwnProperty.call(
                request,
                "catalog",
            )
                ? {
                      text,
                      uri: previous.uri,
                      catalog: request.catalog === null ? null : catalogProvider(request.catalog),
                  }
                : { text, uri: previous.uri };
            state = {
                mode: "analysis",
                uri: previous.uri,
                version: request.version,
                catalog,
                snapshot: this.engine.updateSnapshot(previous.snapshot, update),
            };
        }
        this.documents.set(request.uri, state);
        return state;
    }

    private requireAnalysis(uri: string, expectedVersion: number): AnalysisDocumentState {
        const state = this.documents.get(uri);
        if (!state) {
            throw new Error(`Worker document is not open: ${uri}`);
        }
        if (state.version !== expectedVersion) {
            throw new Error(
                `Stale worker request for ${uri}: expected ${expectedVersion}, current ${state.version}`,
            );
        }
        if (state.mode !== "analysis") {
            throw new Error(`Worker document ${uri} was opened in parse-only mode`);
        }
        return state;
    }

    private throwIfCancelled(id: number): void {
        if (this.cancelled.has(id)) {
            throw new Error(`Worker request ${id} was cancelled`);
        }
    }
}

function summarize(state: WorkerDocumentState, workerElapsedMs: number): SqlWorkerDocumentSummary {
    if (state.mode === "parse") {
        return {
            uri: state.uri,
            version: state.version,
            mode: state.mode,
            length: state.snapshot.text.length,
            batchCount: state.snapshot.batches.length,
            statementCount: state.snapshot.batches.reduce(
                (total, batch) => total + batch.artifact.ast.body.length,
                0,
            ),
            issueCount: state.snapshot.batches.reduce(
                (total, batch) => total + batch.artifact.issues.length,
                0,
            ),
            statistics: state.snapshot.statistics,
            workerElapsedMs,
        };
    }
    const snapshot = state.snapshot as IncrementalSnapshotWithStatistics;
    return {
        uri: state.uri,
        version: state.version,
        mode: state.mode,
        length: snapshot.text.length,
        batchCount: snapshot.incrementalStatistics?.totalBatchCount ?? 1,
        statementCount: snapshot.statements.length,
        issueCount: snapshot.syntaxDiagnostics.length + snapshot.semanticDiagnostics.length,
        statistics: snapshot.incrementalStatistics ?? {
            parsedBatchCount: 1,
            reusedBatchCount: 0,
            totalBatchCount: 1,
            reusedCharacterCount: 0,
            totalCharacterCount: snapshot.text.length,
        },
        workerElapsedMs,
    };
}

function snapshotData(state: AnalysisDocumentState): SqlWorkerSnapshotData {
    const snapshot = state.snapshot;
    return {
        uri: state.uri,
        version: state.version,
        syntaxDiagnostics: snapshot.syntaxDiagnostics,
        semanticDiagnostics: snapshot.semanticDiagnostics,
        tokens: snapshot.tokens,
        statements: snapshot.statements,
        scopes: snapshot.scopes,
        symbols: snapshot.symbols(),
        externalReferences: snapshot.externalReferences(),
        mutationTargets: snapshot.mutationTargets(),
        lineage: snapshot.lineage(),
    };
}

function feature<M extends keyof SqlWorkerFeatureResults>(
    snapshot: SqlAnalysisSnapshot,
    request: SqlWorkerFeatureRequest & { readonly method: M },
): SqlWorkerFeatureResults[M] {
    const offset = request.offset ?? 0;
    switch (request.method) {
        case "completion":
            return snapshot.completeAt(offset) as SqlWorkerFeatureResults[M];
        case "references":
            return snapshot.referencesAt(offset) as SqlWorkerFeatureResults[M];
        case "type":
            return snapshot.typeAt(offset) as SqlWorkerFeatureResults[M];
        case "signature":
            return snapshot.signatureAt(offset) as SqlWorkerFeatureResults[M];
        case "starExpansion":
            return snapshot.expandStarAt(offset) as SqlWorkerFeatureResults[M];
        case "symbol":
            return snapshot.symbolAt(offset) as SqlWorkerFeatureResults[M];
        case "reservedKeyword":
            return snapshot.isReservedKeyword(request.value ?? "") as SqlWorkerFeatureResults[M];
        case "normalizedIdentifier":
            return snapshot.normalizeIdentifier(
                request.value ?? "",
                request.identifierKind,
            ) as SqlWorkerFeatureResults[M];
        case "displayedIdentifier":
            return snapshot.displayIdentifier(request.value ?? "") as SqlWorkerFeatureResults[M];
    }
}

function applyTextChanges(text: string, changes: readonly SqlWorkerTextChange[]): string {
    let result = text;
    for (const change of changes) {
        if (
            !Number.isInteger(change.start) ||
            !Number.isInteger(change.end) ||
            change.start < 0 ||
            change.end < change.start ||
            change.end > result.length
        ) {
            throw new RangeError(
                `Invalid worker edit [${change.start}, ${change.end}) for length ${result.length}`,
            );
        }
        result = `${result.slice(0, change.start)}${change.text}${result.slice(change.end)}`;
    }
    return result;
}

function catalogProvider(
    catalog: SqlWorkerCatalog | undefined,
): MappingCatalogProvider | undefined {
    return catalog
        ? new MappingCatalogProvider(catalog.mapping, catalog.version, catalog.world)
        : undefined;
}

function success<T>(id: number, result: T, documentVersion?: number): SqlWorkerResponse<T> {
    return { type: "response", id, ok: true, documentVersion, result };
}

function failure(id: number, error: unknown): SqlWorkerResponse {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
        type: "response",
        id,
        ok: false,
        error: {
            name: normalized.name,
            message: normalized.message,
            stack: normalized.stack,
        },
    };
}
