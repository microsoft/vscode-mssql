/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type { EngineCapabilitySet } from "../common/engineCapabilities.js";
import type { EngineProfileSource, SqlEngineProfile } from "../common/engineProfile.js";
import type { MetadataCompleteness, MetadataSection } from "../metadata/index.js";

/**
 * The statistics surface a support view reads.
 *
 * Three rules shape it, because a dashboard that guesses is worse than no dashboard:
 *
 * 1. **A measured value is never invented.** Every field here is populated from something the
 *    runtime actually observes. A value the current wiring cannot source is `undefined` rather
 *    than zero, so a view can render "not measured" instead of a confident lie. `undefined` and
 *    `0` mean different things throughout this file.
 * 2. **History is part of the shape.** A single number cannot answer "is this getting worse",
 *    which is the question a latency panel exists to answer, so the timed stages carry a bounded
 *    sample window rather than leaving a view to accumulate one.
 * 3. **Nothing here identifies a server, a database, or a user.** Names of connections, objects,
 *    and SQL text stay out, because this payload is built to be copied into a bug report. The
 *    engine section describes *what kind* of engine answered, never which one.
 */

export interface LatencySummary {
    readonly count: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maximumMs: number;
    /** Requests abandoned because the caller moved on. Never an error. */
    readonly cancelled: number;
    /**
     * Results computed and then dropped because the document, metadata generation, or engine
     * profile moved on before publication. The package's stated invariant is that this never
     * reaches the editor; a non-zero value here is the count that proves it was caught.
     */
    readonly staleDiscarded: number;
    /**
     * How many of these requests were answered entirely from resident metadata, and how many had
     * to hydrate first. `undefined` when the provider does not report attribution, which is the
     * difference between "all cached" and "we do not know".
     */
    readonly servedFromResident?: number;
    readonly requiredHydration?: number;
}

/**
 * A bounded rolling window of a repeated measurement.
 *
 * The window is what makes a trend readable; `unit` travels with it so a renderer never has to
 * infer whether it is drawing milliseconds or bytes.
 */
export interface StatsHistory {
    readonly samples: readonly number[];
    readonly unit: "ms" | "count" | "bytes";
    /** How many samples the window retains once full. */
    readonly capacity: number;
    /** Total observations made, which exceeds `samples.length` once the window has wrapped. */
    readonly observed: number;
}

/** A budget a view can draw against a trend, so "slow" is a stated threshold rather than a feel. */
export interface StatsBudget {
    readonly targetMs: number;
    /** What the budget protects, phrased for a human: "completions feel instant". */
    readonly rationale: string;
}

export interface SyntaxStats {
    readonly state: "idle" | "parsing" | "ready" | "failed";
    readonly mode: "none" | "full" | "incremental";
    readonly elapsedMs: number;
    readonly changedRangeCount: number;
    readonly reusableFragmentCount: number;
    readonly errorCount: number;
    /**
     * Incremental reuse, which is the whole point of the parser and cannot be read from elapsed
     * time alone: reparsing 8 KB of a 2 MB document is the result worth showing.
     */
    readonly reusedChunkCount: number;
    readonly reparsedChunkCount: number;
    readonly parsedCharacterCount: number;
    readonly documentCharacterCount: number;
    /**
     * Availability diagnostics inside `errorCount`. These are not syntax errors: the construct
     * parsed, and this engine cannot run it. A view that shows them as errors misreports the
     * language service's central behaviour.
     */
    readonly availabilityDiagnosticCount: number;
    readonly history: StatsHistory;
    readonly budget: StatsBudget;
}

export interface SemanticStats {
    readonly state: "pending" | "binding" | "ready" | "failed";
    readonly documentVersion?: number;
    readonly metadataGeneration?: number;
    /** The engine profile identity this binding was produced under. */
    readonly profileGeneration?: string;
    readonly elapsedMs: number;
    readonly unitsExamined: number;
    readonly unitsReused: number;
    readonly unitsRebound: number;
    readonly diagnosticCount: number;
    /**
     * Diagnostics split by what a reader can act on. `unresolvedPendingMetadata` is the one that
     * matters most: those names are not wrong, the catalog simply has not hydrated them yet, and
     * presenting them as errors is the single most misleading thing this view could do.
     */
    readonly diagnostics: {
        readonly error: number;
        readonly warning: number;
        readonly information: number;
        readonly hint: number;
        readonly unresolvedPendingMetadata: number;
    };
    readonly history: StatsHistory;
    readonly budget: StatsBudget;
}

/**
 * What one database scope cost, folded from the fetch stream.
 *
 * This is derived, never tracked alongside the log, so it cannot drift from it. The fold runs over
 * **every** fetch as it is observed, not over the retained window: a rolling log is the right
 * durable record for display, but folding only the retained entries would silently report "6
 * fetches" when the session made sixty. `observedFetches` is the fold's denominator, so a view can
 * say what it is summarising.
 *
 * Residency comes from the same fold. Because every fetch carries whether it was answered by the
 * resident model or the server, a hit rate needs no separate counter — which is what stops it from
 * being a headline computed from an unwired zero.
 */
export interface CatalogScope {
    /**
     * A stable identifier for the database within this session. Deliberately not its name: this
     * payload is built to be copied into a bug report, and a database name is customer data. A host
     * rendering the view in place can map the handle back through its own connection state.
     */
    readonly handle: string;
    /** The database's name, redacted alongside the other identifying fields on export. */
    readonly databaseName?: string;
    readonly isCurrent: boolean;
    /** Why this scope exists: an active connection, a three-part name, a USE. */
    readonly reason: string;
    readonly observedFetches: number;
    readonly elapsedMs: number;
    readonly residentHits: number;
    readonly serverFetches: number;
    /**
     * Objects for which each per-object section has been fetched at least once, counted from the
     * stream. Only schemas and objects load eagerly; these arrive per object on demand, so this is
     * a hydration count rather than a completeness flag.
     */
    readonly hydrated: {
        readonly withColumns: number;
        readonly withParameters: number;
        readonly withDefinitions: number;
    };
    /** Sections nothing has requested, so their emptiness proves nothing about the catalog. */
    readonly neverRequested: readonly MetadataSection[];
    /** Unix epoch milliseconds of the most recent fetch, absent when the scope has had none. */
    readonly lastFetchAt?: number;
}

/**
 * One catalog fetch.
 *
 * Lazy loading is a sequence of events, not an inventory, so the honest shape of the metadata
 * layer is a log. `trigger` is the field that makes it diagnostic rather than decorative: it says
 * which editor interaction caused the query.
 */
export interface CatalogFetch {
    /** Unix epoch milliseconds, so a view can render it as a clock time or as an age. */
    readonly at: number;
    readonly section: MetadataSection;
    readonly databaseHandle: string;
    /** The interaction that caused it — "completion", "hover", "bind", "connection opened". */
    readonly trigger: string;
    readonly elapsedMs: number;
    readonly rowCount?: number;
    readonly source: "server" | "resident";
    readonly outcome: "loaded" | "empty" | "denied" | "failed" | "cancelled";
    /**
     * The identifying detail, which is the point of the log and also the customer's data.
     *
     * These three are the fields a developer opens this view to read: which database, which object,
     * and what SQL ran. They are kept apart from the rest so one call to {@link redactCatalogFetch}
     * removes exactly them, which is what lets the same record serve an in-place view and a copied
     * bug report without maintaining two logs that can disagree.
     */
    readonly databaseName?: string;
    readonly objectName?: string;
    readonly query?: string;
    /**
     * Why the fetch failed, when it did.
     *
     * Recorded because a preview feature that silently returns nothing is the hardest kind of bug
     * to report: the catalog layer marks the section failed and the message is otherwise discarded,
     * so without this a user can see that something did not load but never why.
     */
    readonly error?: {
        readonly message: string;
        readonly code?: string | number;
    };
}

/** Why a metadata generation was dropped, and what rebuilding it cost. */
export interface CatalogInvalidation {
    /** Unix epoch milliseconds. */
    readonly at: number;
    readonly cause:
        | "connectionChanged"
        | "databaseChanged"
        | "ddlExecuted"
        | "manualRefresh"
        | "settingsChanged"
        | "profileChanged";
    readonly rebuildMs: number;
    readonly note: string;
}

/**
 * What a metadata provider has observed, for a runtime to publish.
 *
 * Declared here rather than beside the observer so a provider can report statistics without
 * depending on the implementation that happens to collect them.
 */
export interface CatalogStatsSnapshot {
    readonly fetches: readonly CatalogFetch[];
    readonly scopes: readonly CatalogScope[];
    readonly observedFetches: number;
    readonly invalidations: readonly CatalogInvalidation[];
    readonly inFlight: number;
}

export interface MetadataStats {
    readonly providerId: string;
    readonly generation: number;
    readonly completeness: MetadataCompleteness;
    readonly ageMs: number;
    readonly refreshInProgress: boolean;
    readonly lastRefreshMs?: number;
    /**
     * Fetches a request is currently blocked on. Residency is not a separate counter here: every
     * fetch carries whether the resident model or the server answered it, so a hit rate is a fold
     * of the stream and cannot sit unwired at zero while a view reports a confident percentage.
     */
    readonly inFlight: number;
    /** Per-database totals, folded over every observed fetch. */
    readonly scopes: readonly CatalogScope[];
    /**
     * The most recent fetches, newest first. Bounded for display; the scopes above are folded over
     * the whole stream, so totals stay correct as this window rolls.
     */
    readonly fetches: readonly CatalogFetch[];
    /** How many fetches the stream has observed in total, against which `fetches` is a window. */
    readonly observedFetches: number;
    readonly invalidations: readonly CatalogInvalidation[];
    readonly history: StatsHistory;
}

/**
 * The SQLCMD layer, present only for a document that uses it.
 *
 * A SQLCMD document can hold several connections at once through `:connect`, which is why a
 * single connection identity cannot describe one.
 */
export interface SqlCmdStats {
    readonly directiveCount: number;
    readonly variableReferenceCount: number;
    readonly unresolvedVariableCount: number;
    readonly includeCount: number;
    readonly unresolvedIncludeCount: number;
    readonly connectionRegionCount: number;
    readonly projectedCharacters: number;
    readonly sourceCharacters: number;
    readonly mode: "full" | "incremental";
    readonly rescannedLines: number;
}

export interface RuntimeStats {
    readonly mode: "in-process" | "node-worker" | "web-worker";
    readonly state: "ready" | "busy" | "failed";
    readonly queueDepth: number;
    /** Present only for a worker runtime; the gap between the two is transport overhead. */
    readonly roundTripMs?: number;
    readonly workerElapsedMs?: number;
}

export interface EngineStats {
    readonly profile: SqlEngineProfile;
    /** The comparable identity every snapshot in this result carries. */
    readonly generation: string;
    readonly displayName: string;
    readonly source: EngineProfileSource;
    readonly reason: string;
    readonly serverMajorVersion?: number;
    readonly compatibilityLevel?: number;
    readonly previewFeatures: boolean;
    readonly capabilities: EngineCapabilitySet;
    /**
     * Platform decisions deferred because the engine is unidentified. While this is non-zero the
     * absence of availability diagnostics proves nothing, and a view should say so rather than
     * present a clean document as verified.
     */
    readonly deferredDecisions: number;
}

export interface LanguageServiceStats {
    readonly document: {
        readonly uri: string;
        readonly version: number;
        readonly utf16Length: number;
    };
    readonly syntax: SyntaxStats;
    readonly semantics: SemanticStats;
    readonly metadata: MetadataStats;
    readonly runtime: RuntimeStats;
    readonly requests: {
        readonly latency: Readonly<Record<string, LatencySummary>>;
        readonly cancelled: number;
        readonly staleResultsDiscarded: number;
    };
    readonly engine: EngineStats;
    /** Absent for a document that contains no SQLCMD directive or variable. */
    readonly sqlcmd?: SqlCmdStats;
}

export interface LanguageServiceStatsProvider {
    getStats(uri: string): LanguageServiceStats | undefined;
    onDidChangeStats(listener: (uri: string) => void): Disposable;
}

/**
 * One document's statistics, prepared for copying into a bug report.
 *
 * Redaction is a transform over the published record rather than a second collection path, so the
 * view and the report cannot describe different sessions. `includeIdentifiers` exists because the
 * person exporting is often the person who owns the data, and forcing them to reproduce a problem
 * twice to get a readable log helps nobody -- but it is opt-in, so the default copy is safe.
 */
export interface StatsExportOptions {
    /** Keeps database names, object names, and SQL text. Off by default. */
    readonly includeIdentifiers?: boolean;
}
