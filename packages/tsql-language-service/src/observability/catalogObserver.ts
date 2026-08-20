/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataSection } from "../metadata/index.js";
import type {
    CatalogFetch,
    CatalogDataQualityEvent,
    CatalogDataQualityObservation,
    CatalogInvalidation,
    CatalogScope,
    CatalogStatsSnapshot,
} from "./contracts.js";

export type { CatalogStatsSnapshot };

/**
 * The record of what the catalog layer actually did.
 *
 * Lazy loading is a sequence of events rather than an inventory, so the honest account of it is a
 * log. Until this existed the metadata section of the statistics payload was structurally complete
 * and entirely empty: the types described a fetch stream that nothing produced, and a view reading
 * it would have reported a confident zero for work the session had certainly done.
 *
 * Two things are recorded that a naive instrumentation would miss, and both change what the log
 * means:
 *
 * 1. **Requests answered without a query.** A resident section short-circuits before the executor
 *    is reached, so instrumenting only the query path would show every request going to the server
 *    and make the cache look absent. Those are recorded here as `source: "resident"`.
 * 2. **Failures, with their message.** The catalog marks a section failed and discards the reason,
 *    which is the hardest kind of bug to report -- a feature that quietly returns nothing. The
 *    message is kept here because this log is where someone will look for it.
 *
 * Totals are folded over **every** observation, not over the retained window, so a rolling log
 * stays displayable without the summary drifting from it.
 */

/** A fetch that has started and not yet finished. */
export interface CatalogFetchSpan {
    settle(
        outcome: CatalogFetch["outcome"],
        detail?: {
            readonly rowCount?: number;
            readonly query?: string;
            readonly error?: CatalogFetch["error"];
        },
    ): void;
}

/** What identifies a fetch before it has run. */
export interface CatalogFetchContext {
    readonly section: MetadataSection;
    readonly databaseHandle: string;
    readonly databaseName?: string;
    readonly objectName?: string;
    /** The interaction that caused it, as reported by the caller that asked for hydration. */
    readonly trigger: string;
    /** Why this database is in scope: an active connection, a three-part name, a USE. */
    readonly reason?: string;
    readonly isCurrent?: boolean;
}

/** Per-database totals, accumulated as the stream is observed. */
interface ScopeAccumulator {
    handle: string;
    databaseName?: string;
    isCurrent: boolean;
    reason: string;
    observedFetches: number;
    elapsedMs: number;
    residentHits: number;
    serverFetches: number;
    withColumns: Set<string>;
    withParameters: Set<string>;
    withDefinitions: Set<string>;
    requested: Set<MetadataSection>;
    lastFetchAt?: number;
}

/** Sections a scope is expected to be able to answer, for reporting the ones nothing has asked for. */
const trackedSections: readonly MetadataSection[] = Object.freeze([
    "databases",
    "schemas",
    "objects",
    "columns",
    "parameters",
    "indexes",
    "triggers",
    "constraints",
    "clrTypes",
    "securables",
    "collations",
    "principals",
    "definitions",
] as MetadataSection[]);

const defaultCapacity = 200;
const defaultInvalidationCapacity = 50;

export class CatalogObserver {
    private readonly _fetches: CatalogFetch[] = [];
    private readonly _invalidations: CatalogInvalidation[] = [];
    private readonly _scopes = new Map<string, ScopeAccumulator>();
    private readonly _dataQuality = new Map<string, CatalogDataQualityObservation>();
    private _observed = 0;
    private _inFlight = 0;

    public constructor(
        private readonly _capacity: number = defaultCapacity,
        private readonly _invalidationCapacity: number = defaultInvalidationCapacity,
        /** Injected so tests can produce a fixed clock; production passes nothing. */
        private readonly _now: () => number = () => Date.now(),
        private readonly _elapsed: () => number = () => performance.now(),
    ) {}

    public get inFlight(): number {
        return this._inFlight;
    }

    /**
     * Opens a span for a query about to be issued.
     *
     * In-flight is incremented here and decremented on settle rather than being counted separately,
     * so the number a view shows as "loading now" cannot disagree with the log beneath it.
     */
    public beginFetch(context: CatalogFetchContext): CatalogFetchSpan {
        const startedAt = this._now();
        const startedElapsed = this._elapsed();
        this._inFlight += 1;
        let settled = false;
        return {
            settle: (outcome, detail) => {
                // A loader that settles twice would double-count in-flight and corrupt the totals,
                // which is worse than losing the second observation.
                if (settled) return;
                settled = true;
                this._inFlight = Math.max(0, this._inFlight - 1);
                this.record({
                    at: startedAt,
                    section: context.section,
                    databaseHandle: context.databaseHandle,
                    trigger: context.trigger,
                    elapsedMs: this._elapsed() - startedElapsed,
                    source: "server",
                    outcome,
                    ...(context.databaseName === undefined
                        ? {}
                        : { databaseName: context.databaseName }),
                    ...(context.objectName === undefined ? {} : { objectName: context.objectName }),
                    ...(detail?.rowCount === undefined ? {} : { rowCount: detail.rowCount }),
                    ...(detail?.query === undefined ? {} : { query: detail.query }),
                    ...(detail?.error === undefined ? {} : { error: detail.error }),
                });
                this.touchScope(context);
            },
        };
    }

    /**
     * A request the resident model answered, so no query was issued.
     *
     * Recorded with `elapsedMs: 0` because that is what it cost, not because it was not measured.
     */
    public recordResident(context: CatalogFetchContext): void {
        this.record({
            at: this._now(),
            section: context.section,
            databaseHandle: context.databaseHandle,
            trigger: context.trigger,
            elapsedMs: 0,
            source: "resident",
            outcome: "loaded",
            ...(context.databaseName === undefined ? {} : { databaseName: context.databaseName }),
            ...(context.objectName === undefined ? {} : { objectName: context.objectName }),
        });
        this.touchScope(context);
    }

    public recordInvalidation(invalidation: CatalogInvalidation): void {
        this._invalidations.unshift(invalidation);
        if (this._invalidations.length > this._invalidationCapacity) this._invalidations.pop();
    }

    public recordDataQuality(event: CatalogDataQualityEvent): void {
        const key =
            event.kind === "unknownValue"
                ? `${event.kind}:${event.field}`
                : `${event.kind}:${event.section}:${event.limit}`;
        const prior = this._dataQuality.get(key);
        this._dataQuality.set(key, { ...event, count: (prior?.count ?? 0) + 1 });
    }

    public snapshot(): CatalogStatsSnapshot {
        return {
            fetches: Object.freeze([...this._fetches]),
            scopes: Object.freeze([...this._scopes.values()].map(toScope)),
            observedFetches: this._observed,
            invalidations: Object.freeze([...this._invalidations]),
            inFlight: this._inFlight,
            dataQuality: Object.freeze([...this._dataQuality.values()]),
        };
    }

    /** Appends to the display window and folds the totals, which are kept over the whole stream. */
    private record(fetch: CatalogFetch): void {
        this._observed += 1;
        this._fetches.unshift(Object.freeze(fetch));
        if (this._fetches.length > this._capacity) this._fetches.pop();
        const scope = this.scopeFor(fetch.databaseHandle);
        scope.observedFetches += 1;
        scope.elapsedMs += fetch.elapsedMs;
        if (fetch.source === "resident") scope.residentHits += 1;
        else scope.serverFetches += 1;
        scope.requested.add(fetch.section);
        scope.lastFetchAt = fetch.at;
        if (fetch.objectName) {
            if (fetch.section === "columns") scope.withColumns.add(fetch.objectName);
            if (fetch.section === "parameters") scope.withParameters.add(fetch.objectName);
            if (fetch.section === "definitions") scope.withDefinitions.add(fetch.objectName);
        }
    }

    private touchScope(context: CatalogFetchContext): void {
        const scope = this.scopeFor(context.databaseHandle);
        if (context.databaseName !== undefined) scope.databaseName = context.databaseName;
        if (context.reason !== undefined) scope.reason = context.reason;
        if (context.isCurrent !== undefined) scope.isCurrent = context.isCurrent;
    }

    private scopeFor(handle: string): ScopeAccumulator {
        const existing = this._scopes.get(handle);
        if (existing) return existing;
        const created: ScopeAccumulator = {
            handle,
            isCurrent: false,
            reason: "unknown",
            observedFetches: 0,
            elapsedMs: 0,
            residentHits: 0,
            serverFetches: 0,
            withColumns: new Set(),
            withParameters: new Set(),
            withDefinitions: new Set(),
            requested: new Set(),
        };
        this._scopes.set(handle, created);
        return created;
    }
}

function toScope(accumulator: ScopeAccumulator): CatalogScope {
    return Object.freeze({
        handle: accumulator.handle,
        ...(accumulator.databaseName === undefined
            ? {}
            : { databaseName: accumulator.databaseName }),
        isCurrent: accumulator.isCurrent,
        reason: accumulator.reason,
        observedFetches: accumulator.observedFetches,
        elapsedMs: accumulator.elapsedMs,
        residentHits: accumulator.residentHits,
        serverFetches: accumulator.serverFetches,
        hydrated: Object.freeze({
            withColumns: accumulator.withColumns.size,
            withParameters: accumulator.withParameters.size,
            withDefinitions: accumulator.withDefinitions.size,
        }),
        neverRequested: Object.freeze(
            trackedSections.filter((section) => !accumulator.requested.has(section)),
        ),
        ...(accumulator.lastFetchAt === undefined ? {} : { lastFetchAt: accumulator.lastFetchAt }),
    }) as CatalogScope;
}
