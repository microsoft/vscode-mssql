/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

    public constructor(
        private readonly _syntax: SyntaxService = new LezerSyntaxService(),
        private readonly _binder: SemanticBinder = new CatalogSemanticBinder(),
        private readonly _metadata: MetadataProvider = new NullMetadataProvider(),
    ) {}

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
        const semantics = this._binder.bind({ syntax, metadata: view });
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
        });
    }
}
