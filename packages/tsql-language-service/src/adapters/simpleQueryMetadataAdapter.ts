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
    type MetadataSection,
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
    /** Replaces one authoritative section while retaining every unrelated section. */
    replaceSection(section: MetadataSection, input: InMemoryMetadataInput): void;
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
                principals: "unknown",
                definitions: "unknown",
            },
        },
        this.id,
    );
    private _inFlight: Promise<MetadataRefreshResult> | undefined;
    private readonly _hydrations = new Map<string, Promise<void>>();
    private readonly _sectionRefreshes = new Map<string, Promise<MetadataRefreshResult>>();
    private _hasPublishedIdentity = false;
    private readonly _publisher: SimpleQueryMetadataPublisher = {
        replace: (input) => {
            this._store.replace(input);
            this._hasPublishedIdentity = true;
        },
        merge: (input) => this._store.merge(input),
        replaceSection: (section, input) => this._store.replaceSection(section, input),
    };

    public constructor(
        private readonly _executor: SimpleQueryExecutor,
        private readonly _loader: SimpleQueryMetadataLoader,
    ) {}

    public pin(): MetadataView {
        return this._store.pin();
    }

    public requestHydration(request: MetadataHydrationRequest): void {
        if (request.database && ["schemas", "objects"].includes(request.section)) {
            this.requestDatabaseHydration(request);
            return;
        }
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

    public waitForHydration(signal?: AbortSignal): Promise<void> {
        const operations: Promise<unknown>[] = [
            ...this._hydrations.values(),
            ...this._sectionRefreshes.values(),
        ];
        if (this._inFlight) operations.push(this._inFlight);
        const pending = Promise.all(operations).then(() => undefined);
        return signal ? detachOnAbort(pending, signal) : pending;
    }

    private requestDatabaseHydration(request: MetadataHydrationRequest): void {
        const view = this.pin();
        const database = canonicalDatabase(view, request.database!);
        if (!database) {
            void this.refresh().catch(() => undefined);
            return;
        }
        if (
            this._inFlight &&
            equalName(database, view.environment.currentDatabase, view.environment.caseSensitive)
        ) {
            return;
        }
        const state = view.databaseCatalogCompleteness(database)[request.section as "schemas" | "objects"];
        if (state === "ready") return;
        const normalizedRequest = { ...request, database };
        const key = `${request.section}:database:${database.toLocaleLowerCase()}`;
        if (this._hydrations.has(key)) return;
        this._store.merge(databaseLoadStatePatch(database, request.section, "loading"));
        const hydration = this._loader
            .hydrate(this._executor, normalizedRequest, this._publisher)
            .catch((error: unknown) => {
                this._store.merge(databaseLoadStatePatch(database, request.section, "failed"));
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

    public refreshSections(
        sections: readonly MetadataSection[],
        signal?: AbortSignal,
    ): Promise<MetadataRefreshResult> {
        const normalized = [...new Set(sections)].sort();
        if (normalized.length === 0) {
            return Promise.resolve({
                generation: this.pin().generation,
                published: false,
                elapsedMs: 0,
            });
        }
        // The simple-query loader currently has an isolated authoritative query for principals.
        // Other invalidations retain correctness by using the complete catalog refresh path.
        if (normalized.some((section) => section !== "principals")) {
            return this.refresh(signal);
        }
        const key = normalized.join(",");
        let operation = this._sectionRefreshes.get(key);
        if (!operation) {
            operation = this.loadAndPublishSections(normalized).finally(() => {
                this._sectionRefreshes.delete(key);
            });
            this._sectionRefreshes.set(key, operation);
        }
        return signal ? detachOnAbort(operation, signal) : operation;
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
                completeness: {
                    databases: state,
                    schemas: state,
                    objects: state,
                    principals: state,
                },
            });
            throw error;
        }
        return {
            generation: this._store.pin().generation,
            published: true,
            elapsedMs: performance.now() - started,
        };
    }

    private async loadAndPublishSections(
        sections: readonly MetadataSection[],
    ): Promise<MetadataRefreshResult> {
        const started = performance.now();
        // A refresh that began before the DDL completed cannot prove the post-DDL state. Let it
        // finish, then issue the small authoritative section query.
        if (this._inFlight) await this._inFlight;
        const prior = this.pin();
        this._store.merge({
            completeness: Object.fromEntries(
                sections.map((section) => [section, "loading"]),
            ) as Partial<MetadataView["completeness"]>,
        });
        try {
            for (const section of sections) {
                await this._loader.hydrate(
                    this._executor,
                    { section, priority: "background" },
                    this._publisher,
                );
            }
        } catch (error) {
            this._store.merge({
                completeness: Object.fromEntries(
                    sections.map((section) => [
                        section,
                        usableSectionState(prior.completeness[section]) ? "stale" : "failed",
                    ]),
                ) as Partial<MetadataView["completeness"]>,
            });
            throw error;
        }
        return {
            generation: this.pin().generation,
            published: true,
            elapsedMs: performance.now() - started,
        };
    }
}

function usableSectionState(state: MetadataView["completeness"][MetadataSection]): boolean {
    return state === "ready" || state === "partial" || state === "stale";
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

function databaseLoadStatePatch(
    database: string,
    section: MetadataHydrationRequest["section"],
    state: "loading" | "failed",
): InMemoryMetadataInput {
    return {
        databaseCatalogCompleteness: new Map([
            [database, section === "schemas" ? { schemas: state } : { objects: state }],
        ]),
    };
}

function canonicalDatabase(view: MetadataView, requested: string): string | undefined {
    return (view.databases() ?? []).find((database) =>
        equalName(database.name, requested, view.environment.caseSensitive),
    )?.name;
}

function equalName(
    left: string | undefined,
    right: string | undefined,
    caseSensitive: boolean,
): boolean {
    if (left === undefined || right === undefined) return left === right;
    return caseSensitive ? left === right : left.toLocaleLowerCase() === right.toLocaleLowerCase();
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
