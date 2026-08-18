/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AnalysisProfile } from "../common/analysisProfile.js";
import { resolveAnalysisProfile } from "../common/analysisProfile.js";
import type { EngineCapabilities, TsqlFeatureProfile } from "../common/engineCapabilities.js";
import {
    capabilitiesFromProfile,
    createEngineCapabilities,
    unknownEngineCapabilities,
} from "../common/engineCapabilities.js";
import type { EngineFacts } from "../common/engineProfile.js";
import type { Disposable } from "../common/disposable.js";
import type { MetadataProvider } from "../metadata/index.js";
import { NullMetadataProvider } from "../metadata/index.js";
import type { LanguageServiceStats } from "../observability/index.js";
import { LanguageServiceStatsStore } from "../observability/index.js";
import { CatalogSemanticBinder, type SemanticBinder } from "../semantics/index.js";
import { LezerSyntaxService, type SyntaxService } from "../syntax/index.js";
import { applyTextChanges, ImmutableTextSnapshot, type TextChange } from "../text/index.js";
import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "./contracts.js";

export class InProcessLanguageServiceRuntime implements LanguageServiceRuntime {
    public readonly mode = "in-process" as const;
    private readonly _documents = new Map<string, DocumentAnalysisSnapshot>();
    private readonly _stats = new LanguageServiceStatsStore();
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
            const supplied = (this._syntax as Partial<LezerSyntaxService>).profile;
            this._capabilities = supplied
                ? capabilitiesFromProfile(supplied as TsqlFeatureProfile)
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
            this._capabilities = capabilities;
            return capabilities;
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
                const semantics = this._binder.update(previous.semantics, {
                    syntax,
                    metadata: this._metadata.pin(),
                    previous: previous.semantics,
                    changedRanges: [],
                    profile: this.profile,
                });
                replacements.set(uri, {
                    snapshot: Object.freeze({ text: previous.text, syntax, semantics }),
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
        const parseStarted = performance.now();
        const syntax = this._syntax.parse(document);
        const parseElapsed = performance.now() - parseStarted;
        const bindStarted = performance.now();
        const view = this._metadata.pin();
        const semantics = this._binder.bind({ syntax, metadata: view, profile: this.profile });
        const bindElapsed = performance.now() - bindStarted;
        const snapshot = Object.freeze({ text: document, syntax, semantics });
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
        const parseStarted = performance.now();
        const syntax = this._syntax.update(previous.syntax, document, changes);
        const parseElapsed = performance.now() - parseStarted;
        const bindStarted = performance.now();
        const semantics = this._binder.update(previous.semantics, {
            syntax,
            metadata: this._metadata.pin(),
            previous: previous.semantics,
            changedRanges: syntax.changedRanges,
            profile: this.profile,
        });
        const bindElapsed = performance.now() - bindStarted;
        const snapshot = Object.freeze({ text: document, syntax, semantics });
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
        const semantics = this._binder.update(previous.semantics, {
            syntax: previous.syntax,
            metadata: this._metadata.pin(),
            previous: previous.semantics,
            changedRanges: [],
            profile: this.profile,
        });
        const bindElapsed = performance.now() - bindStarted;
        const snapshot = Object.freeze({
            text: previous.text,
            syntax: previous.syntax,
            semantics,
        });
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
        const view = this._metadata.pin();
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
            },
            semantics: {
                state: "ready",
                documentVersion: snapshot.semantics.documentVersion,
                metadataGeneration: snapshot.semantics.metadataGeneration,
                elapsedMs: bindElapsedMs,
                unitsExamined: snapshot.semantics.statistics.unitsExamined,
                unitsReused: snapshot.semantics.statistics.unitsReused,
                unitsRebound: snapshot.semantics.statistics.unitsRebound,
                diagnosticCount: snapshot.semantics.diagnostics.length,
            },
            metadata: {
                providerId: view.providerId,
                generation: view.generation,
                completeness: view.completeness,
                ageMs: Math.max(0, Date.now() - view.publishedAt),
                refreshInProgress: false,
                cacheHits: 0,
                cacheMisses: 0,
            },
            runtime: { mode: this.mode, state: "ready", queueDepth: 0 },
            requests: { latency: {}, cancelled: 0, staleResultsDiscarded: 0 },
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
            },
        });
    }
}

/** Only a syntax service that can adopt a profile participates in reprofiling. */
function supportsProfileChange(syntax: SyntaxService): syntax is SyntaxService & {
    setProfile(profile: EngineCapabilities): void;
    reprofile(previous: DocumentAnalysisSnapshot["syntax"]): DocumentAnalysisSnapshot["syntax"];
} {
    const candidate = syntax as Partial<LezerSyntaxService>;
    return typeof candidate.setProfile === "function" && typeof candidate.reprofile === "function";
}
