/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { featureAvailabilityDiagnosticCode } from "../common/platformFeatureRegistry.js";
import { createEngineCapabilities, type EngineCapabilities } from "../common/engineCapabilities.js";
import type { EngineFacts } from "../common/engineProfile.js";
import { TsqlColorizationService } from "../coloring/index.js";
import { TsqlLanguageFeatureService } from "../features/index.js";
import { NullMetadataProvider } from "../metadata/index.js";
import { InProcessLanguageServiceRuntime } from "../runtime/index.js";
import {
    workerProtocolVersion,
    type WorkerDocumentSummary,
    type WorkerEngineCapabilities,
    type WorkerRequest,
    type WorkerResponse,
} from "./protocol.js";

export class WorkerRequestHandler {
    private readonly _sessions = new Map<string, WorkerDocumentSession>();
    private readonly _cancelled = new Set<number>();
    private _defaultFacts: EngineFacts | undefined;

    public async handle(request: WorkerRequest): Promise<WorkerResponse> {
        if (request.type === "cancel") {
            this._cancelled.add(request.id);
            return success(request.id, true);
        }
        const started = performance.now();
        try {
            this.throwIfCancelled(request.id);
            switch (request.type) {
                case "open": {
                    let session = this._sessions.get(request.uri);
                    if (!session) {
                        session = createSession();
                        await session.runtime.setEngineFacts(this._defaultFacts);
                        this._sessions.set(request.uri, session);
                    }
                    const snapshot = await session.runtime.open(
                        request.uri,
                        request.version,
                        request.text,
                    );
                    this.throwIfCancelled(request.id);
                    return success(
                        request.id,
                        summarize(snapshot, performance.now() - started),
                        request.version,
                    );
                }
                case "change": {
                    const snapshot = await this.runtime(request.uri).change(
                        request.uri,
                        request.expectedVersion,
                        request.version,
                        request.changes,
                    );
                    this.throwIfCancelled(request.id);
                    return success(
                        request.id,
                        summarize(snapshot, performance.now() - started),
                        request.version,
                    );
                }
                case "close":
                    await this.session(request.uri).runtime.close(request.uri);
                    this._sessions.delete(request.uri);
                    return success(request.id, true);
                case "rebind": {
                    const snapshot = await this.runtime(request.uri).rebind(
                        request.uri,
                        request.expectedVersion,
                    );
                    this.throwIfCancelled(request.id);
                    return success(
                        request.id,
                        summarize(snapshot, performance.now() - started),
                        request.expectedVersion,
                    );
                }
                case "engineFacts": {
                    let capabilities: EngineCapabilities;
                    if (request.uri) {
                        capabilities = await this.session(request.uri).runtime.setEngineFacts(
                            request.facts,
                        );
                    } else {
                        this._defaultFacts = request.facts;
                        capabilities = createEngineCapabilities(request.facts);
                        for (const session of this._sessions.values()) {
                            capabilities = await session.runtime.setEngineFacts(request.facts);
                        }
                    }
                    this.throwIfCancelled(request.id);
                    const projection: WorkerEngineCapabilities = {
                        profile: capabilities.engineProfile,
                        generation: capabilities.generation,
                        displayName: capabilities.displayName,
                        ...(capabilities.serverMajorVersion === undefined
                            ? {}
                            : { serverMajorVersion: capabilities.serverMajorVersion }),
                        ...(capabilities.compatibilityLevel === undefined
                            ? {}
                            : { compatibilityLevel: capabilities.compatibilityLevel }),
                        previewFeatures: capabilities.previewFeatures,
                    };
                    return success(request.id, projection);
                }
                case "stats": {
                    const runtime = this.runtime(request.uri);
                    runtime.snapshot(request.uri, request.expectedVersion);
                    const stats = runtime.getStats(request.uri);
                    if (!stats) throw new Error(`Statistics are unavailable for ${request.uri}`);
                    return success(request.id, stats, request.expectedVersion);
                }
                case "diagnostics": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.diagnostics(request.uri, request.expectedVersion),
                        request.expectedVersion,
                    );
                }
                case "completion": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.completion(
                            request.uri,
                            request.expectedVersion,
                            request.offset,
                        ),
                        request.expectedVersion,
                    );
                }
                case "hover": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.hover(
                            request.uri,
                            request.expectedVersion,
                            request.offset,
                        ),
                        request.expectedVersion,
                    );
                }
                case "definition": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.definitionTarget(
                            request.uri,
                            request.expectedVersion,
                            request.offset,
                        ),
                        request.expectedVersion,
                    );
                }
                case "references": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.references(
                            request.uri,
                            request.expectedVersion,
                            request.offset,
                        ),
                        request.expectedVersion,
                    );
                }
                case "documentSymbols": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.documentSymbols(request.uri, request.expectedVersion),
                        request.expectedVersion,
                    );
                }
                case "foldingRanges": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.foldingRanges(request.uri, request.expectedVersion),
                        request.expectedVersion,
                    );
                }
                case "selectionRanges": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.selectionRanges(
                            request.uri,
                            request.expectedVersion,
                            request.offsets,
                        ),
                        request.expectedVersion,
                    );
                }
                case "signatureHelp": {
                    const session = this.versionedSession(request);
                    return success(
                        request.id,
                        session.features.signatureHelp(
                            request.uri,
                            request.expectedVersion,
                            request.offset,
                        ),
                        request.expectedVersion,
                    );
                }
                case "coloring": {
                    const session = this.versionedSession(request);
                    const snapshot = session.runtime.snapshot(request.uri, request.expectedVersion);
                    const result = request.range
                        ? session.coloring.provideRangeColors({ ...snapshot, range: request.range })
                        : session.coloring.provideDocumentColors(snapshot);
                    return success(request.id, result, request.expectedVersion);
                }
            }
        } catch (error) {
            return failure(request.id, error);
        } finally {
            this._cancelled.delete(request.id);
        }
    }

    private throwIfCancelled(id: number): void {
        if (!this._cancelled.has(id)) return;
        throw new DOMException(`Worker request ${id} was cancelled`, "AbortError");
    }

    private runtime(uri: string): InProcessLanguageServiceRuntime {
        return this.session(uri).runtime;
    }

    private session(uri: string): WorkerDocumentSession {
        const session = this._sessions.get(uri);
        if (!session) throw new Error(`Document is not open in worker: ${uri}`);
        return session;
    }

    private versionedSession(request: { readonly uri: string; readonly expectedVersion: number }) {
        const session = this.session(request.uri);
        session.runtime.snapshot(request.uri, request.expectedVersion);
        return session;
    }
}

interface WorkerDocumentSession {
    readonly runtime: InProcessLanguageServiceRuntime;
    readonly features: TsqlLanguageFeatureService;
    readonly coloring: TsqlColorizationService;
}

function createSession(): WorkerDocumentSession {
    const metadata = new NullMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(undefined, undefined, metadata);
    return {
        runtime,
        features: new TsqlLanguageFeatureService(runtime, metadata),
        coloring: new TsqlColorizationService(),
    };
}

function summarize(
    snapshot: Awaited<ReturnType<InProcessLanguageServiceRuntime["open"]>>,
    workerElapsedMs: number,
): WorkerDocumentSummary {
    return {
        uri: snapshot.text.uri,
        version: snapshot.text.version,
        utf16Length: snapshot.text.length,
        syntaxErrorCount: snapshot.syntax.diagnostics.length,
        semanticDiagnosticCount: snapshot.semantics.diagnostics.length,
        workerElapsedMs,
        profileGeneration: snapshot.syntax.profileGeneration,
        availabilityDiagnosticCount: snapshot.syntax.diagnostics.filter(
            (diagnostic) => diagnostic.code === featureAvailabilityDiagnosticCode,
        ).length,
    };
}

function success(
    id: number,
    result: Extract<WorkerResponse, { ok: true }>["result"],
    documentVersion?: number,
): WorkerResponse {
    return {
        protocolVersion: workerProtocolVersion,
        type: "response",
        id,
        ok: true,
        result,
        documentVersion,
    };
}

function failure(id: number, error: unknown): WorkerResponse {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
        protocolVersion: workerProtocolVersion,
        type: "response",
        id,
        ok: false,
        error: { name: normalized.name, message: normalized.message, stack: normalized.stack },
    };
}
