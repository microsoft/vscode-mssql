/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AnalysisProfile } from "../common/analysisProfile.js";
import { resolveAnalysisProfile } from "../common/analysisProfile.js";
import type { EngineCapabilities } from "../common/engineCapabilities.js";
import {
    capabilitiesFromProfile,
    createEngineCapabilities,
    unknownEngineCapabilities,
} from "../common/engineCapabilities.js";
import type { EngineFacts } from "../common/engineProfile.js";
import {
    featureAvailabilityDiagnosticCode,
    platformFeatures,
} from "../common/platformFeatureRegistry.js";
import type { Disposable } from "../common/disposable.js";
import type { MetadataProvider, MetadataView } from "../metadata/index.js";
import { NullMetadataProvider } from "../metadata/index.js";
import type { LanguageServiceStats } from "../observability/index.js";
import { LanguageServiceStatsStore, RequestLatencyRecorder } from "../observability/index.js";
import { CatalogSemanticBinder, type SemanticBinder } from "../semantics/index.js";
import {
    LezerSyntaxService,
    type ProfileAwareSyntaxService,
    type SyntaxService,
} from "../syntax/index.js";
import { SqlCmdDocumentService, type SqlCmdDocumentSnapshot } from "../sqlcmd/index.js";
import {
    applyTextChanges,
    ImmutableTextSnapshot,
    type TextChange,
    type TextRange,
    type TextSnapshot,
} from "../text/index.js";
import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "./contracts.js";

/** Placeholder the stats store replaces with the document's rolling window. */
const emptyHistory = Object.freeze({
    samples: Object.freeze([]),
    unit: "ms" as const,
    capacity: 0,
    observed: 0,
});
// Budgets are stated once here so "slow" is a threshold a view can draw, not a feeling.
const parseBudget = Object.freeze({
    targetMs: 20,
    rationale: "A keystroke reparses before the next one arrives.",
});
const bindBudget = Object.freeze({
    targetMs: 80,
    rationale: "Binding finishes inside one completion round trip.",
});

export class InProcessLanguageServiceRuntime implements LanguageServiceRuntime {
    public readonly mode = "in-process" as const;
    private readonly _documents = new Map<string, DocumentAnalysisSnapshot>();
    private readonly _sqlCmd = new SqlCmdDocumentService();
    private readonly _stats = new LanguageServiceStatsStore();
    /**
     * Latency for the feature calls this runtime's snapshots answer.
     *
     * Held here rather than in the feature service because the statistics store is here, and a
     * recorder the publisher cannot reach would collect numbers nothing reports.
     */
    public readonly requests = new RequestLatencyRecorder();
    private _capabilities: EngineCapabilities;

    /** Frozen for the runtime's lifetime so every snapshot it publishes carries one profile. */
    public readonly profile: AnalysisProfile;

    public constructor(
        // A runtime with no reported facts is unidentified, not SQL Server: a connected document
        // must never receive platform diagnostics the host never asked for.
        private readonly _syntax: SyntaxService = new LezerSyntaxService(
            undefined,
            unknownEngineCapabilities,
        ),
        private readonly _binder: SemanticBinder = new CatalogSemanticBinder(),
        private readonly _metadata: MetadataProvider = new NullMetadataProvider(),
        profile?: Partial<AnalysisProfile>,
        engineFacts?: EngineFacts,
    ) {
        this.profile = resolveAnalysisProfile(profile);
        if (engineFacts !== undefined) {
            this._capabilities = createEngineCapabilities(engineFacts);
            if (supportsProfileChange(this._syntax)) this._syntax.setProfile(this._capabilities);
        } else {
            // A syntax service supplied with its own profile stays in control, so an offline
            // harness analysing a named engine keeps analysing it.
            const supplied = supportsProfileChange(this._syntax) ? this._syntax.profile : undefined;
            this._capabilities = supplied
                ? capabilitiesFromProfile(supplied)
                : unknownEngineCapabilities;
        }
    }

    public get capabilities(): EngineCapabilities {
        return this._capabilities;
    }

    public async setEngineFacts(facts: EngineFacts | undefined): Promise<EngineCapabilities> {
        const capabilities = createEngineCapabilities(facts);
        if (capabilities.generation === this._capabilities.generation) return this._capabilities;
        if (!supportsProfileChange(this._syntax)) {
            throw new Error(
                "The configured syntax service cannot adopt a different engine profile",
            );
        }

        const previousCapabilities = this._capabilities;
        const replacements = new Map<
            string,
            { snapshot: DocumentAnalysisSnapshot; bindMs: number }
        >();
        this._syntax.setProfile(capabilities);
        try {
            for (const [uri, previous] of this._documents) {
                const syntax = this._syntax.reprofile(previous.syntax);
                const bindStarted = performance.now();
                const view = this._metadata.pin();
                const semantics = this._binder.update(previous.semantics, {
                    syntax,
                    metadata: view,
                    previous: previous.semantics,
                    changedRanges: [],
                    profile: this.profile,
                });
                replacements.set(uri, {
                    snapshot: analysisSnapshot(
                        previous.text,
                        previous.projection,
                        previous.projectedText,
                        syntax,
                        semantics,
                        view,
                    ),
                    bindMs: performance.now() - bindStarted,
                });
            }
        } catch (error) {
            // Publishing a profile is transactional: callers never observe new capabilities with
            // a mixture of old and new document snapshots.
            this._syntax.setProfile(previousCapabilities);
            throw error;
        }

        this._capabilities = capabilities;
        for (const [uri, replacement] of replacements) {
            this._documents.set(uri, replacement.snapshot);
            this.publishStats(replacement.snapshot, 0, replacement.bindMs);
        }
        return capabilities;
    }

    public async open(
        uri: string,
        version: number,
        text: string,
    ): Promise<DocumentAnalysisSnapshot> {
        const document = new ImmutableTextSnapshot(uri, version, text);
        const projection = this._sqlCmd.parse(uri, version, text);
        const projected = projectedSnapshot(document, projection);
        const parseStarted = performance.now();
        const syntax = this._syntax.parse(projected);
        const parseElapsed = performance.now() - parseStarted;
        const bindStarted = performance.now();
        const view = this._metadata.pin();
        const semantics = this._binder.bind({ syntax, metadata: view, profile: this.profile });
        const bindElapsed = performance.now() - bindStarted;
        const snapshot = analysisSnapshot(document, projection, projected, syntax, semantics, view);
        this._documents.set(uri, snapshot);
        this.publishStats(snapshot, parseElapsed, bindElapsed);
        return snapshot;
    }

    public async change(
        uri: string,
        expectedVersion: number,
        version: number,
        changes: readonly TextChange[],
    ): Promise<DocumentAnalysisSnapshot> {
        const previous = this.snapshot(uri, expectedVersion);
        const document = applyTextChanges(previous.text, version, changes);
        const projection = this._sqlCmd.update(
            previous.projection,
            version,
            document.text,
            changes,
        );
        const projected = projectedSnapshot(document, projection);
        const parseStarted = performance.now();
        // Incremental reuse needs the edit offsets to mean the same thing in both snapshots. That
        // holds while the projection stays the identity one; once a substitution rewrites the text,
        // the edit no longer describes the projected document and the parse starts again.
        const reusable = projected === document && previous.projectedText === previous.text;
        const syntax = reusable
            ? this._syntax.update(previous.syntax, projected, changes)
            : this._syntax.parse(projected);
        const parseElapsed = performance.now() - parseStarted;
        const bindStarted = performance.now();
        const view = this._metadata.pin();
        const semantics = this._binder.update(previous.semantics, {
            syntax,
            metadata: view,
            previous: previous.semantics,
            changedRanges: syntax.changedRanges,
            profile: this.profile,
        });
        const bindElapsed = performance.now() - bindStarted;
        const snapshot = analysisSnapshot(document, projection, projected, syntax, semantics, view);
        this._documents.set(uri, snapshot);
        this.publishStats(snapshot, parseElapsed, bindElapsed);
        return snapshot;
    }

    public async close(uri: string): Promise<void> {
        this._documents.delete(uri);
        this._stats.remove(uri);
    }

    public async rebind(uri: string, expectedVersion: number): Promise<DocumentAnalysisSnapshot> {
        const previous = this.snapshot(uri, expectedVersion);
        const bindStarted = performance.now();
        const view = this._metadata.pin();
        const semantics = this._binder.update(previous.semantics, {
            syntax: previous.syntax,
            metadata: view,
            previous: previous.semantics,
            changedRanges: [],
            profile: this.profile,
        });
        const bindElapsed = performance.now() - bindStarted;
        const snapshot = analysisSnapshot(
            previous.text,
            previous.projection,
            previous.projectedText,
            previous.syntax,
            semantics,
            view,
        );
        this._documents.set(uri, snapshot);
        this.publishStats(snapshot, 0, bindElapsed);
        return snapshot;
    }

    public snapshot(uri: string, expectedVersion: number): DocumentAnalysisSnapshot {
        const snapshot = this._documents.get(uri);
        if (!snapshot) throw new Error(`Document is not open: ${uri}`);
        if (snapshot.text.version !== expectedVersion) {
            throw new Error(
                `Stale document request for ${uri}: expected ${expectedVersion}, current ${snapshot.text.version}`,
            );
        }
        return snapshot;
    }

    public getStats(uri: string): LanguageServiceStats | undefined {
        return this._stats.getStats(uri);
    }

    public onDidChangeStats(listener: (uri: string) => void): Disposable {
        return this._stats.onDidChangeStats(listener);
    }

    private publishStats(
        snapshot: DocumentAnalysisSnapshot,
        parseElapsedMs: number,
        bindElapsedMs: number,
    ): void {
        const catalog = this._metadata.catalogStats?.();
        const availability = snapshot.syntax.diagnostics.filter(
            (diagnostic) => diagnostic.code === featureAvailabilityDiagnosticCode,
        ).length;
        const bySeverity = { error: 0, warning: 0, information: 0, hint: 0 };
        for (const diagnostic of snapshot.semantics.diagnostics) bySeverity[diagnostic.severity]++;
        this._stats.publish({
            document: {
                uri: snapshot.text.uri,
                version: snapshot.text.version,
                utf16Length: snapshot.text.length,
            },
            syntax: {
                state: "ready",
                mode: snapshot.syntax.statistics.mode,
                elapsedMs: parseElapsedMs,
                changedRangeCount: snapshot.syntax.statistics.changedRangeCount,
                reusableFragmentCount: snapshot.syntax.statistics.reusableFragmentCount,
                errorCount: snapshot.syntax.diagnostics.length,
                reusedChunkCount: snapshot.syntax.statistics.reusedChunkCount,
                reparsedChunkCount: snapshot.syntax.statistics.reparsedChunkCount,
                parsedCharacterCount: snapshot.syntax.statistics.parsedCharacterCount,
                documentCharacterCount: snapshot.text.length,
                availabilityDiagnosticCount: availability,
                // Replaced by the store, which owns the rolling window.
                history: emptyHistory,
                budget: parseBudget,
            },
            semantics: {
                state: "ready",
                documentVersion: snapshot.semantics.documentVersion,
                metadataGeneration: snapshot.semantics.metadataGeneration,
                profileGeneration: snapshot.semantics.profileGeneration,
                elapsedMs: bindElapsedMs,
                unitsExamined: snapshot.semantics.statistics.unitsExamined,
                unitsReused: snapshot.semantics.statistics.unitsReused,
                unitsRebound: snapshot.semantics.statistics.unitsRebound,
                diagnosticCount: snapshot.semantics.diagnostics.length,
                diagnostics: {
                    ...bySeverity,
                    // The binder only reports a name as missing once the namespace is complete, so
                    // a pending-metadata diagnostic cannot occur by construction. Reported as a
                    // measured zero rather than left out, because a view showing "0 waiting on the
                    // catalog" is the reassurance this field exists to give.
                    unresolvedPendingMetadata: 0,
                },
                history: emptyHistory,
                budget: bindBudget,
            },
            metadata: {
                providerId: snapshot.metadata.providerId,
                generation: snapshot.metadata.generation,
                completeness: snapshot.metadata.completeness,
                ageMs: Math.max(0, Date.now() - snapshot.metadata.publishedAt),
                observationState: catalog
                    ? "collected"
                    : snapshot.metadata.providerId === "null"
                      ? "unavailable"
                      : "notCollected",
                refreshInProgress: (catalog?.inFlight ?? 0) > 0,
                inFlight: catalog?.inFlight ?? 0,
                // Reported from the provider's own observations when it keeps them, and left empty
                // when it does not. An empty log means "this provider records nothing", never "this
                // session fetched nothing" -- the two are different and a view must not merge them.
                scopes: catalog?.scopes ?? [],
                fetches: catalog?.fetches ?? [],
                observedFetches: catalog?.observedFetches ?? 0,
                invalidations: catalog?.invalidations ?? [],
                dataQuality: catalog?.dataQuality ?? [],
                history: emptyHistory,
            },
            runtime: { mode: this.mode, state: "ready", queueDepth: 0 },
            requests: {
                latency: this.requests.summary(),
                // Cancellation is the editor abandoning a request, which only the host can see.
                cancelled: 0,
                staleResultsDiscarded: this.requests.staleDiscarded,
            },
            engine: {
                profile: this._capabilities.engineProfile,
                generation: this._capabilities.generation,
                displayName: this._capabilities.displayName,
                source: this._capabilities.resolution.source,
                reason: this._capabilities.resolution.reason,
                ...(this._capabilities.serverMajorVersion === undefined
                    ? {}
                    : { serverMajorVersion: this._capabilities.serverMajorVersion }),
                ...(this._capabilities.compatibilityLevel === undefined
                    ? {}
                    : { compatibilityLevel: this._capabilities.compatibilityLevel }),
                previewFeatures: this._capabilities.previewFeatures,
                capabilities: this._capabilities.capabilities,
                // While the engine is unidentified every platform decision is deferred, so the
                // absence of availability diagnostics proves nothing about this document.
                deferredDecisions:
                    this._capabilities.engineProfile === "unknown" ? platformFeatures.length : 0,
            },
        });
    }
}

/**
 * The text the parser sees.
 *
 * When SQLCMD projects the document unchanged the source snapshot is returned as-is, so the
 * identity case allocates nothing and a caller can compare by reference to learn that projected
 * and source coordinates are the same.
 */
function projectedSnapshot(
    document: TextSnapshot,
    projection: SqlCmdDocumentSnapshot,
): TextSnapshot {
    return projection.projectedSql === document.text
        ? document
        : new ImmutableTextSnapshot(document.uri, document.version, projection.projectedSql);
}

function analysisSnapshot(
    text: TextSnapshot,
    projection: SqlCmdDocumentSnapshot,
    projectedText: TextSnapshot,
    syntax: DocumentAnalysisSnapshot["syntax"],
    semantics: DocumentAnalysisSnapshot["semantics"],
    metadata: MetadataView,
): DocumentAnalysisSnapshot {
    if (semantics.metadataGeneration !== metadata.generation) {
        throw new Error(
            `Analysis metadata mismatch: semantics ${semantics.metadataGeneration}, catalog ${metadata.generation}`,
        );
    }
    return Object.freeze({
        text,
        projection,
        projectedText,
        syntax,
        semantics,
        metadata,
        sourceRangeOf: (range: TextRange) => projection.toSourceRanges(range),
    });
}

/** Only a syntax service that can adopt a profile participates in reprofiling. */
function supportsProfileChange(syntax: SyntaxService): syntax is ProfileAwareSyntaxService {
    const candidate = syntax as Partial<ProfileAwareSyntaxService>;
    return (
        candidate.profile !== undefined &&
        typeof candidate.setProfile === "function" &&
        typeof candidate.reprofile === "function"
    );
}
