/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EngineFacts } from "../common/engineProfile.js";
import type { LanguageServiceStats } from "../observability/index.js";
import type { FullColorizationResult } from "../coloring/index.js";
import type {
    CompletionResult,
    DefinitionTarget,
    DocumentSymbol,
    FoldingRange,
    HoverResult,
    Location,
    SignatureHelp,
} from "../features/index.js";
import type { TextRange } from "../text/index.js";
import type { TextChange } from "../text/index.js";
import {
    isWorkerResponse,
    workerProtocolVersion,
    type WorkerDocumentSummary,
    type WorkerEngineCapabilities,
    type WorkerDiagnostics,
    type WorkerRequest,
} from "./protocol.js";

export interface WorkerTransport {
    postMessage(message: WorkerRequest): void;
    subscribe(onMessage: (message: unknown) => void, onError: (error: unknown) => void): () => void;
    terminate(): void | Promise<void>;
}

export class LanguageServiceWorkerClient {
    private readonly _pending = new Map<
        number,
        { readonly resolve: (value: unknown) => void; readonly reject: (reason: unknown) => void }
    >();
    private readonly _versions = new Map<string, number>();
    private readonly _unsubscribe: () => void;
    private _nextId = 1;

    public constructor(private readonly _transport: WorkerTransport) {
        this._unsubscribe = _transport.subscribe(
            (message) => this.receive(message),
            (error) => this.failAll(error),
        );
    }

    public async open(uri: string, version: number, text: string): Promise<WorkerDocumentSummary> {
        const result = await this.send<WorkerDocumentSummary>({
            protocolVersion: workerProtocolVersion,
            type: "open",
            id: this.nextId(),
            uri,
            version,
            text,
        });
        this._versions.set(uri, version);
        return result;
    }

    public async change(
        uri: string,
        version: number,
        changes: readonly TextChange[],
    ): Promise<WorkerDocumentSummary> {
        const expectedVersion = this.requireVersion(uri);
        const result = await this.send<WorkerDocumentSummary>({
            protocolVersion: workerProtocolVersion,
            type: "change",
            id: this.nextId(),
            uri,
            expectedVersion,
            version,
            changes,
        });
        this._versions.set(uri, version);
        return result;
    }

    /**
     * Reports server facts to the worker and returns the capabilities in force afterwards.
     *
     * Only plain facts cross the boundary. The worker resolves the profile itself, so the host and
     * worker cannot disagree about which engine a document belongs to.
     */
    public setEngineFacts(facts?: EngineFacts): Promise<WorkerEngineCapabilities> {
        return this.sendEngineFacts(facts);
    }

    /** Changes one document's engine without affecting documents attached to other connections. */
    public setDocumentEngineFacts(
        uri: string,
        facts?: EngineFacts,
    ): Promise<WorkerEngineCapabilities> {
        this.requireVersion(uri);
        return this.sendEngineFacts(facts, uri);
    }

    private sendEngineFacts(facts?: EngineFacts, uri?: string): Promise<WorkerEngineCapabilities> {
        return this.send<WorkerEngineCapabilities>({
            protocolVersion: workerProtocolVersion,
            type: "engineFacts",
            id: this.nextId(),
            ...(uri === undefined ? {} : { uri }),
            ...(facts === undefined ? {} : { facts }),
        });
    }

    public stats(uri: string): Promise<LanguageServiceStats> {
        return this.send<LanguageServiceStats>({
            protocolVersion: workerProtocolVersion,
            type: "stats",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
        });
    }

    public rebind(uri: string): Promise<WorkerDocumentSummary> {
        return this.send<WorkerDocumentSummary>({
            protocolVersion: workerProtocolVersion,
            type: "rebind",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
        });
    }

    public diagnostics(uri: string): Promise<WorkerDiagnostics> {
        return this.send<WorkerDiagnostics>({
            protocolVersion: workerProtocolVersion,
            type: "diagnostics",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
        });
    }

    public completion(uri: string, offset: number): Promise<CompletionResult> {
        return this.send<CompletionResult>({
            protocolVersion: workerProtocolVersion,
            type: "completion",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            offset,
        });
    }

    public hover(uri: string, offset: number): Promise<HoverResult | undefined> {
        return this.send<HoverResult | undefined>({
            protocolVersion: workerProtocolVersion,
            type: "hover",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            offset,
        });
    }

    public definition(uri: string, offset: number): Promise<DefinitionTarget> {
        return this.send<DefinitionTarget>({
            protocolVersion: workerProtocolVersion,
            type: "definition",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            offset,
        });
    }

    public references(uri: string, offset: number): Promise<readonly Location[]> {
        return this.send<readonly Location[]>({
            protocolVersion: workerProtocolVersion,
            type: "references",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            offset,
        });
    }

    public documentSymbols(uri: string): Promise<readonly DocumentSymbol[]> {
        return this.send<readonly DocumentSymbol[]>({
            protocolVersion: workerProtocolVersion,
            type: "documentSymbols",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
        });
    }

    public foldingRanges(uri: string): Promise<readonly FoldingRange[]> {
        return this.send<readonly FoldingRange[]>({
            protocolVersion: workerProtocolVersion,
            type: "foldingRanges",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
        });
    }

    public selectionRanges(uri: string, offsets: readonly number[]): Promise<readonly TextRange[]> {
        return this.send<readonly TextRange[]>({
            protocolVersion: workerProtocolVersion,
            type: "selectionRanges",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            offsets,
        });
    }

    public signatureHelp(uri: string, offset: number): Promise<SignatureHelp | undefined> {
        return this.send<SignatureHelp | undefined>({
            protocolVersion: workerProtocolVersion,
            type: "signatureHelp",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            offset,
        });
    }

    public coloring(uri: string, range?: TextRange): Promise<FullColorizationResult> {
        return this.send<FullColorizationResult>({
            protocolVersion: workerProtocolVersion,
            type: "coloring",
            id: this.nextId(),
            uri,
            expectedVersion: this.requireVersion(uri),
            ...(range ? { range } : {}),
        });
    }

    public async close(uri: string): Promise<void> {
        await this.send<boolean>({
            protocolVersion: workerProtocolVersion,
            type: "close",
            id: this.nextId(),
            uri,
        });
        this._versions.delete(uri);
    }

    public async dispose(): Promise<void> {
        this._unsubscribe();
        this.failAll(new Error("Language-service worker disposed"));
        this._versions.clear();
        await this._transport.terminate();
    }

    private send<T>(request: WorkerRequest): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._pending.set(request.id, {
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            this._transport.postMessage(request);
        });
    }

    private receive(message: unknown): void {
        if (!isWorkerResponse(message)) return;
        const pending = this._pending.get(message.id);
        if (!pending) return;
        this._pending.delete(message.id);
        if (!message.ok) {
            const error = new Error(message.error.message);
            error.name = message.error.name;
            pending.reject(error);
            return;
        }
        pending.resolve(message.result);
    }

    private failAll(reason: unknown): void {
        for (const pending of this._pending.values()) pending.reject(reason);
        this._pending.clear();
    }

    private requireVersion(uri: string): number {
        const version = this._versions.get(uri);
        if (version === undefined) throw new Error(`Document is not open in worker: ${uri}`);
        return version;
    }

    private nextId(): number {
        return this._nextId++;
    }
}
