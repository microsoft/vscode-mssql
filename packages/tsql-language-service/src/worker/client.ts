/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    isSqlWorkerResponse,
    type SqlWorkerCatalog,
    type SqlWorkerDocumentMode,
    type SqlWorkerDocumentSummary,
    type SqlWorkerFeatureMethod,
    type SqlWorkerFeatureResults,
    type SqlWorkerRequest,
    type SqlWorkerSnapshotData,
    type SqlWorkerTextChange,
} from "./protocol.js";

export interface SqlWorkerTransport {
    postMessage(message: SqlWorkerRequest): void;
    subscribe(onMessage: (message: unknown) => void, onError: (error: unknown) => void): () => void;
    terminate(): void | Promise<void>;
}

export interface SqlWorkerOpenOptions {
    readonly mode?: SqlWorkerDocumentMode;
    readonly catalog?: SqlWorkerCatalog;
    readonly signal?: AbortSignal;
}

export interface SqlWorkerChangeOptions {
    readonly catalog?: SqlWorkerCatalog | null;
    readonly signal?: AbortSignal;
}

interface PendingRequest<T = unknown> {
    readonly resolve: (value: T) => void;
    readonly reject: (reason: unknown) => void;
    readonly uri?: string;
    readonly version?: number;
    readonly removeAbortListener?: () => void;
}

/** Async facade shared by Node worker_threads and browser Web Worker transports. */
export class SqlWorkerClient implements AsyncDisposable {
    private readonly pending = new Map<number, PendingRequest>();
    private readonly versions = new Map<string, number>();
    private readonly acknowledgedVersions = new Map<string, number>();
    private readonly unsubscribe: () => void;
    private nextRequestId = 1;
    private disposed = false;

    public constructor(private readonly transport: SqlWorkerTransport) {
        this.unsubscribe = transport.subscribe(
            (message) => this.receive(message),
            (error) => this.failAll(error),
        );
    }

    public async openDocument(
        uri: string,
        version: number,
        text: string,
        options: SqlWorkerOpenOptions = {},
    ): Promise<SqlWorkerDocumentSummary> {
        this.assertActive();
        const previous = this.versions.get(uri);
        this.versions.set(uri, version);
        try {
            return await this.send<SqlWorkerDocumentSummary>(
                {
                    type: "open",
                    id: this.nextId(),
                    uri,
                    version,
                    text,
                    mode: options.mode,
                    catalog: options.catalog,
                },
                { uri, version, signal: options.signal },
            );
        } catch (error) {
            if (!isAbortError(error) && this.versions.get(uri) === version) {
                if (previous === undefined) this.versions.delete(uri);
                else this.versions.set(uri, previous);
            }
            throw error;
        }
    }

    public async changeDocument(
        uri: string,
        version: number,
        changes: readonly SqlWorkerTextChange[],
        options: SqlWorkerChangeOptions = {},
    ): Promise<SqlWorkerDocumentSummary> {
        this.assertActive();
        const previous = this.requireVersion(uri);
        if (version <= previous) {
            throw new Error(`Worker document version must increase (${version} <= ${previous})`);
        }
        this.versions.set(uri, version);
        const request: SqlWorkerRequest = {
            type: "change",
            id: this.nextId(),
            uri,
            expectedVersion: previous,
            version,
            changes,
            ...(Object.prototype.hasOwnProperty.call(options, "catalog")
                ? { catalog: options.catalog }
                : {}),
        };
        try {
            return await this.send<SqlWorkerDocumentSummary>(request, {
                uri,
                version,
                signal: options.signal,
            });
        } catch (error) {
            if (!isAbortError(error) && this.versions.get(uri) === version) {
                this.versions.set(uri, this.acknowledgedVersions.get(uri) ?? previous);
            }
            throw error;
        }
    }

    public async closeDocument(uri: string): Promise<boolean> {
        this.assertActive();
        const version = this.versions.get(uri);
        this.versions.delete(uri);
        try {
            const closed = await this.send<boolean>({ type: "close", id: this.nextId(), uri });
            this.acknowledgedVersions.delete(uri);
            return closed;
        } catch (error) {
            if (version !== undefined) this.versions.set(uri, version);
            throw error;
        }
    }

    public snapshot(uri: string, signal?: AbortSignal): Promise<SqlWorkerSnapshotData> {
        const version = this.requireVersion(uri);
        return this.send<SqlWorkerSnapshotData>(
            { type: "snapshot", id: this.nextId(), uri, expectedVersion: version },
            { uri, version, signal },
        );
    }

    public feature<M extends SqlWorkerFeatureMethod>(
        uri: string,
        method: M,
        options: {
            readonly offset?: number;
            readonly value?: string;
            readonly identifierKind?: "table" | "other";
            readonly signal?: AbortSignal;
        } = {},
    ): Promise<SqlWorkerFeatureResults[M]> {
        const version = this.requireVersion(uri);
        return this.send<SqlWorkerFeatureResults[M]>(
            {
                type: "feature",
                id: this.nextId(),
                uri,
                expectedVersion: version,
                method,
                offset: options.offset,
                value: options.value,
                identifierKind: options.identifierKind,
            },
            { uri, version, signal: options.signal },
        );
    }

    public completionAt(uri: string, offset: number, signal?: AbortSignal) {
        return this.feature(uri, "completion", { offset, signal });
    }

    public referencesAt(uri: string, offset: number, signal?: AbortSignal) {
        return this.feature(uri, "references", { offset, signal });
    }

    public typeAt(uri: string, offset: number, signal?: AbortSignal) {
        return this.feature(uri, "type", { offset, signal });
    }

    public signatureAt(uri: string, offset: number, signal?: AbortSignal) {
        return this.feature(uri, "signature", { offset, signal });
    }

    public expandStarAt(uri: string, offset: number, signal?: AbortSignal) {
        return this.feature(uri, "starExpansion", { offset, signal });
    }

    public symbolAt(uri: string, offset: number, signal?: AbortSignal) {
        return this.feature(uri, "symbol", { offset, signal });
    }

    public async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
        this.failAll(new Error("SQL worker client disposed"));
        this.versions.clear();
        this.acknowledgedVersions.clear();
        await this.transport.terminate();
    }

    public [Symbol.asyncDispose](): Promise<void> {
        return this.dispose();
    }

    private send<T>(
        request: SqlWorkerRequest & { readonly id: number },
        context: {
            readonly uri?: string;
            readonly version?: number;
            readonly signal?: AbortSignal;
        } = {},
    ): Promise<T> {
        this.assertActive();
        if (context.signal?.aborted) {
            return Promise.reject(abortReason(context.signal));
        }
        return new Promise<T>((resolve, reject) => {
            const abort = context.signal
                ? () => {
                      const pending = this.pending.get(request.id);
                      if (!pending) return;
                      this.pending.delete(request.id);
                      pending.removeAbortListener?.();
                      reject(abortReason(context.signal!));
                      this.transport.postMessage({ type: "cancel", id: request.id });
                  }
                : undefined;
            if (abort) context.signal!.addEventListener("abort", abort, { once: true });
            this.pending.set(request.id, {
                resolve: resolve as (value: unknown) => void,
                reject,
                uri: context.uri,
                version: context.version,
                removeAbortListener: abort
                    ? () => context.signal!.removeEventListener("abort", abort)
                    : undefined,
            });
            this.transport.postMessage(request);
        });
    }

    private receive(message: unknown): void {
        if (!isSqlWorkerResponse(message)) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        pending.removeAbortListener?.();
        if (message.ok === false) {
            const error = new Error(message.error.message);
            error.name = message.error.name;
            error.stack = message.error.stack;
            pending.reject(error);
            return;
        }
        if (
            pending.uri &&
            pending.version !== undefined &&
            message.documentVersion === pending.version
        ) {
            this.acknowledgedVersions.set(pending.uri, pending.version);
        }
        if (
            pending.uri &&
            pending.version !== undefined &&
            this.versions.get(pending.uri) !== pending.version
        ) {
            pending.reject(
                new Error(
                    `Discarded stale SQL worker result for ${pending.uri} version ${pending.version}`,
                ),
            );
            return;
        }
        pending.resolve(message.result);
    }

    private failAll(error: unknown): void {
        const normalized = error instanceof Error ? error : new Error(String(error));
        for (const pending of this.pending.values()) {
            pending.removeAbortListener?.();
            pending.reject(normalized);
        }
        this.pending.clear();
    }

    private requireVersion(uri: string): number {
        this.assertActive();
        const version = this.versions.get(uri);
        if (version === undefined) throw new Error(`Worker document is not open: ${uri}`);
        return version;
    }

    private nextId(): number {
        return this.nextRequestId++;
    }

    private assertActive(): void {
        if (this.disposed) throw new Error("SQL worker client disposed");
    }
}

function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}
