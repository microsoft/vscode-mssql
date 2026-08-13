/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import {
    InMemoryMetadataProvider,
    type ColumnMetadata,
    type InMemoryMetadataInput,
    type MetadataHydrationRequest,
    type MetadataLoadState,
    type MetadataProvider,
    type MetadataRefreshResult,
    type MetadataView,
    type ParameterMetadata,
} from "../metadata/index.js";

export type SimpleQueryCell = string | number | boolean | bigint | Uint8Array | Date | undefined;

export interface SimpleQueryColumn {
    readonly name: string;
    readonly type?: string;
}

export interface SimpleQueryResult {
    readonly columns: readonly SimpleQueryColumn[];
    readonly rows: readonly (readonly SimpleQueryCell[])[];
    readonly messages?: readonly { readonly error: boolean; readonly message: string }[];
}

/** Supplied by a host such as ConnectionSharingService.executeSimpleQuery. */
export interface SimpleQueryExecutor {
    execute(query: string, signal?: AbortSignal): Promise<SimpleQueryResult>;
}

/** Owns the SQL catalog query plan and row projection; implemented in the metadata milestone. */
export interface SimpleQueryMetadataLoader {
    refresh(
        executor: SimpleQueryExecutor,
        publisher: SimpleQueryMetadataPublisher,
        signal?: AbortSignal,
    ): Promise<void>;
    hydrate(
        executor: SimpleQueryExecutor,
        request: MetadataHydrationRequest,
        publisher: SimpleQueryMetadataPublisher,
        signal?: AbortSignal,
    ): Promise<void>;
}

/** Publication remains adapter-owned; loaders can emit immutable partial generations. */
export interface SimpleQueryMetadataPublisher {
    /** Commits a coherent identity snapshot and invalidates prior per-object detail states. */
    replace(input: InMemoryMetadataInput): void;
    /** Publishes a partial stage while retaining usable data from the prior generation. */
    merge(input: InMemoryMetadataInput): void;
}

export class SimpleQueryMetadataAdapter implements MetadataProvider {
    public readonly id = "simple-query";
    private readonly _store = new InMemoryMetadataProvider(
        {
            completeness: {
                databases: "unknown",
                schemas: "unknown",
                objects: "unknown",
                columns: "unknown",
                parameters: "unknown",
                definitions: "unknown",
            },
        },
        this.id,
    );
    private _inFlight: Promise<MetadataRefreshResult> | undefined;
    private readonly _hydrations = new Map<string, Promise<void>>();
    private _hasPublishedIdentity = false;
    private readonly _publisher: SimpleQueryMetadataPublisher = {
        replace: (input) => {
            this._store.replace(input);
            this._hasPublishedIdentity = true;
        },
        merge: (input) => this._store.merge(input),
    };

    public constructor(
        private readonly _executor: SimpleQueryExecutor,
        private readonly _loader: SimpleQueryMetadataLoader,
    ) {}

    public pin(): MetadataView {
        return this._store.pin();
    }

    public requestHydration(request: MetadataHydrationRequest): void {
        if (!request.object || !["columns", "parameters"].includes(request.section)) {
            void this.refresh().catch(() => undefined);
            return;
        }
        const key = `${request.section}:${request.object.id}`;
        if (this._hydrations.has(key)) return;
        const previous = loadState(this.pin(), request);
        if (previous.kind === "loaded") return;
        const previousValue = previous.kind === "failed" ? previous.previous : undefined;
        this._store.merge(loadStatePatch(request, { kind: "loading" }));
        const hydration = this._loader
            .hydrate(this._executor, request, this._publisher)
            .catch((error: unknown) => {
                this._store.merge(
                    loadStatePatch(request, {
                        kind: "failed",
                        previous: previousValue,
                    }),
                );
                throw error;
            })
            .finally(() => this._hydrations.delete(key));
        this._hydrations.set(key, hydration);
        void hydration.catch(() => undefined);
    }

    public refresh(signal?: AbortSignal): Promise<MetadataRefreshResult> {
        this._inFlight ??= this.loadAndPublish().finally(() => {
            this._inFlight = undefined;
        });
        return signal ? detachOnAbort(this._inFlight, signal) : this._inFlight;
    }

    public onDidChange(listener: () => void): Disposable {
        return this._store.onDidChange(listener);
    }

    private async loadAndPublish(): Promise<MetadataRefreshResult> {
        const started = performance.now();
        const hadPublishedIdentity = this._hasPublishedIdentity;
        try {
            await this._loader.refresh(this._executor, this._publisher);
        } catch (error) {
            const state = hadPublishedIdentity ? "stale" : "failed";
            this._store.merge({
                completeness: { databases: state, schemas: state, objects: state },
            });
            throw error;
        }
        return {
            generation: this._store.pin().generation,
            published: true,
            elapsedMs: performance.now() - started,
        };
    }
}

function loadState(view: MetadataView, request: MetadataHydrationRequest) {
    return request.section === "columns"
        ? view.columnState(request.object!)
        : view.parameterState(request.object!);
}

function loadStatePatch(
    request: MetadataHydrationRequest,
    state: MetadataLoadState<readonly unknown[]>,
): InMemoryMetadataInput {
    if (request.section === "columns") {
        return {
            columnStates: new Map([
                [request.object!.id, state as MetadataLoadState<readonly ColumnMetadata[]>],
            ]),
        };
    }
    return {
        parameterStates: new Map([
            [request.object!.id, state as MetadataLoadState<readonly ParameterMetadata[]>],
        ]),
    };
}

function detachOnAbort<T>(shared: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(abortReason(signal));
        signal.addEventListener("abort", abort, { once: true });
        void shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
