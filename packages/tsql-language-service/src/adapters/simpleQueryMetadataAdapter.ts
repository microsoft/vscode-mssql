/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type {
    CatalogFetchContext,
    CatalogObserver,
    CatalogStatsSnapshot,
} from "../observability/catalogObserver.js";
import {
    InMemoryMetadataProvider,
    type ClrTypeMetadata,
    type ColumnMetadata,
    type ForeignKeyMetadata,
    type IndexMetadata,
    type InMemoryMetadataInput,
    type MetadataHydrationRequest,
    type MetadataLoadState,
    type MetadataProvider,
    type MetadataRefreshResult,
    type MetadataSection,
    type MetadataView,
    type ParameterMetadata,
    type TriggerMetadata,
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
                indexes: "unknown",
                triggers: "unknown",
                constraints: "unknown",
                clrTypes: "unknown",
                securables: "unknown",
                collations: "unknown",
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

    private readonly _databaseHandles = new Map<string, string>();

    public constructor(
        private readonly _executor: SimpleQueryExecutor,
        private readonly _loader: SimpleQueryMetadataLoader,
        /**
         * Records what the catalog layer did. Absent by default: a provider must work without an
         * observer, and a caller that does not want a log should not pay for one.
         */
        private readonly _observer?: CatalogObserver,
    ) {}

    public catalogStats(): CatalogStatsSnapshot | undefined {
        return this._observer?.snapshot();
    }

    public noteResidentUse(request: MetadataHydrationRequest): void {
        this._observer?.recordResident(this.contextFor(request, "resident section"));
    }

    /**
     * The executor the loader is handed for one operation.
     *
     * Bound per operation rather than shared, because hydrations run concurrently and a single
     * mutable "current fetch" would attribute one request's query to another's context. The loader
     * may issue several queries for one request; each becomes its own record under the same context,
     * which is what the log should show.
     */
    private recordingExecutor(context: CatalogFetchContext): SimpleQueryExecutor {
        const observer = this._observer;
        if (!observer) return this._executor;
        const inner = this._executor;
        return {
            execute: async (query, signal) => {
                const span = observer.beginFetch(context);
                try {
                    const result = await inner.execute(query, signal);
                    const failure = result.messages?.find((message) => message.error);
                    span.settle(
                        failure ? "failed" : result.rows.length === 0 ? "empty" : "loaded",
                        {
                            rowCount: result.rows.length,
                            query,
                            ...(failure ? { error: { message: failure.message } } : {}),
                        },
                    );
                    return result;
                } catch (error) {
                    span.settle(isAbort(error, signal) ? "cancelled" : "failed", {
                        query,
                        error: describeError(error),
                    });
                    throw error;
                }
            },
        };
    }

    /** A stable per-session identifier for a database, so the handle never carries its name. */
    private handleFor(database: string | undefined): string {
        const key = (database ?? "").toLocaleLowerCase();
        const existing = this._databaseHandles.get(key);
        if (existing) return existing;
        const created =
            database === undefined ? "db:unknown" : `db:${this._databaseHandles.size + 1}`;
        this._databaseHandles.set(key, created);
        return created;
    }

    /** What a request identifies, resolved against the current view for display. */
    private contextFor(request: MetadataHydrationRequest, reason: string): CatalogFetchContext {
        const view = this.pin();
        const database = request.database ?? view.environment.currentDatabase;
        const object = request.object ? view.object(request.object) : undefined;
        return {
            section: request.section,
            databaseHandle: this.handleFor(database),
            ...(database === undefined ? {} : { databaseName: database }),
            ...(object === undefined ? {} : { objectName: `${object.schema}.${object.name}` }),
            trigger: request.reason ?? request.priority,
            reason,
            isCurrent: equalName(
                database,
                view.environment.currentDatabase,
                view.environment.caseSensitive,
            ),
        };
    }

    public pin(): MetadataView {
        return this._store.pin();
    }

    public requestHydration(request: MetadataHydrationRequest): void {
        if (request.database && ["schemas", "objects"].includes(request.section)) {
            this.requestDatabaseHydration(request);
            return;
        }
        if (
            !request.object ||
            !["columns", "parameters", "indexes", "triggers", "constraints", "clrTypes"].includes(
                request.section,
            )
        ) {
            void this.refresh().catch(() => undefined);
            return;
        }
        const key = `${request.section}:${request.object.id}`;
        if (this._hydrations.has(key)) return;
        const previous = loadState(this.pin(), request);
        if (previous.kind === "loaded") {
            // Answered without a query. Logged because a view that only saw server traffic would
            // report the cache as absent and every request as a round trip.
            this._observer?.recordResident(this.contextFor(request, "resident section"));
            return;
        }
        const previousValue = previous.kind === "failed" ? previous.previous : undefined;
        this._store.merge(loadStatePatch(request, { kind: "loading" }));
        const hydration = this._loader
            .hydrate(
                this.recordingExecutor(this.contextFor(request, "object detail")),
                request,
                this._publisher,
            )
            .catch((error: unknown) => {
                this._store.merge(
                    loadStatePatch(request, {
                        kind: "failed",
                        ...(previousValue === undefined
                            ? {}
                            : { previous: previousValue as never }),
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
        const state =
            view.databaseCatalogCompleteness(database)[request.section as "schemas" | "objects"];
        if (state === "ready") {
            this._observer?.recordResident(
                this.contextFor({ ...request, database }, "database in scope"),
            );
            return;
        }
        const normalizedRequest = { ...request, database };
        const key = `${request.section}:database:${database.toLocaleLowerCase()}`;
        if (this._hydrations.has(key)) return;
        this._store.merge(databaseLoadStatePatch(database, request.section, "loading"));
        const hydration = this._loader
            .hydrate(
                this.recordingExecutor(this.contextFor(normalizedRequest, "database in scope")),
                normalizedRequest,
                this._publisher,
            )
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
        if (normalized.some((section) => section !== "principals" && section !== "securables")) {
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
        // A first load is the connection opening; a later one is that connection's catalog being
        // dropped and rebuilt, which is the case worth reporting as a reload.
        const cause = hadPublishedIdentity ? "connectionChanged" : undefined;
        try {
            await this._loader.refresh(
                this.recordingExecutor(
                    this.contextFor(
                        { section: "objects", priority: "background", reason: "connection opened" },
                        "active connection",
                    ),
                ),
                this._publisher,
            );
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
        const elapsedMs = performance.now() - started;
        if (cause) {
            this._observer?.recordInvalidation({
                at: Date.now(),
                cause,
                rebuildMs: elapsedMs,
                note: "The connection's catalog was reloaded from the server.",
            });
        }
        return {
            generation: this._store.pin().generation,
            published: true,
            elapsedMs,
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
                const request: MetadataHydrationRequest = {
                    section,
                    priority: "background",
                    reason: "DDL executed in editor",
                };
                await this._loader.hydrate(
                    this.recordingExecutor(this.contextFor(request, "section reload")),
                    request,
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
        const elapsedMs = performance.now() - started;
        this._observer?.recordInvalidation({
            at: Date.now(),
            cause: "ddlExecuted",
            rebuildMs: elapsedMs,
            note: `Reloaded after DDL: ${sections.join(", ")}.`,
        });
        return {
            generation: this.pin().generation,
            published: true,
            elapsedMs,
        };
    }
}

/** An abort is the caller moving on, which is not a failure and must not be logged as one. */
function isAbort(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    return error instanceof Error && error.name === "AbortError";
}

function describeError(error: unknown): {
    readonly message: string;
    readonly code?: string | number;
} {
    if (!(error instanceof Error)) return { message: String(error) };
    const code = (error as { code?: string | number }).code;
    return { message: error.message, ...(code === undefined ? {} : { code }) };
}

function usableSectionState(state: MetadataView["completeness"][MetadataSection]): boolean {
    return state === "ready" || state === "partial" || state === "stale";
}

function loadState(view: MetadataView, request: MetadataHydrationRequest) {
    if (request.section === "columns") return view.columnState(request.object!);
    if (request.section === "indexes") return view.indexState(request.object!);
    if (request.section === "triggers") return view.triggerState(request.object!);
    if (request.section === "constraints") return view.foreignKeyState(request.object!);
    if (request.section === "clrTypes") return view.clrTypeState(request.object!);
    return view.parameterState(request.object!);
}

function loadStatePatch(
    request: MetadataHydrationRequest,
    state: MetadataLoadState<never>,
): InMemoryMetadataInput {
    if (request.section === "columns") {
        return {
            columnStates: new Map([
                [request.object!.id, state as MetadataLoadState<readonly ColumnMetadata[]>],
            ]),
        };
    }
    if (request.section === "indexes") {
        return {
            indexStates: new Map([
                [request.object!.id, state as MetadataLoadState<readonly IndexMetadata[]>],
            ]),
        };
    }
    if (request.section === "triggers") {
        return {
            triggerStates: new Map([
                [request.object!.id, state as MetadataLoadState<readonly TriggerMetadata[]>],
            ]),
        };
    }
    if (request.section === "constraints") {
        return {
            foreignKeyStates: new Map([
                [request.object!.id, state as MetadataLoadState<readonly ForeignKeyMetadata[]>],
            ]),
        };
    }
    if (request.section === "clrTypes") {
        return {
            clrTypeStates: new Map([
                [request.object!.id, state as MetadataLoadState<ClrTypeMetadata>],
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
