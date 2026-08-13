/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceStats } from "../observability/index.js";
import type { TextChange } from "../text/index.js";
import {
    isWorkerResponse,
    workerProtocolVersion,
    type WorkerDocumentSummary,
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
