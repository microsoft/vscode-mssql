/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InProcessLanguageServiceRuntime } from "../runtime/index.js";
import {
    workerProtocolVersion,
    type WorkerDocumentSummary,
    type WorkerRequest,
    type WorkerResponse,
} from "./protocol.js";

export class WorkerRequestHandler {
    private readonly _runtime = new InProcessLanguageServiceRuntime();
    private readonly _cancelled = new Set<number>();

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
                    const snapshot = await this._runtime.open(
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
                    const snapshot = await this._runtime.change(
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
                    await this._runtime.close(request.uri);
                    return success(request.id, true);
                case "rebind": {
                    const snapshot = await this._runtime.rebind(
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
                case "stats": {
                    this._runtime.snapshot(request.uri, request.expectedVersion);
                    const stats = this._runtime.getStats(request.uri);
                    if (!stats) throw new Error(`Statistics are unavailable for ${request.uri}`);
                    return success(request.id, stats, request.expectedVersion);
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
