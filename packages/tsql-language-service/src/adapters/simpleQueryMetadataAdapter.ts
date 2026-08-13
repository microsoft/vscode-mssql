/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import {
    InMemoryMetadataProvider,
    type InMemoryMetadataInput,
    type MetadataHydrationRequest,
    type MetadataProvider,
    type MetadataRefreshResult,
    type MetadataView,
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
    load(executor: SimpleQueryExecutor, signal?: AbortSignal): Promise<InMemoryMetadataInput>;
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

    public constructor(
        private readonly _executor: SimpleQueryExecutor,
        private readonly _loader: SimpleQueryMetadataLoader,
    ) {}

    public pin(): MetadataView {
        return this._store.pin();
    }

    public requestHydration(_request: MetadataHydrationRequest): void {
        void this.refresh().catch(() => undefined);
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
        const input = await this._loader.load(this._executor);
        this._store.replace(input);
        return {
            generation: this._store.pin().generation,
            published: true,
            elapsedMs: performance.now() - started,
        };
    }
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
