/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native engine host wrapper (design 05 §6.1 host/nativeEngine). Owns the
 * per-document analysis cache (lex + segment + sketch + overlay, keyed by
 * version) and emits the sqlLanguage.* spans (sizes, counts and durations
 * only — never text). Served natively so far: folding + document symbols
 * (B8), completion (B9), diagnostics incl. the sliced pass for the scheduler
 * (B10), hover + signature help (B11), definition over the scripting engine
 * (B12 — sqlScripting.script spans are emitted host-side through
 * scriptingHost's withScriptingSpans, because the engine itself is pure).
 * Remaining features return undefined until their batch, which the router
 * reports honestly as unserved.
 */

import { RawField, diag } from "../../diagnostics/diagnosticsCore";
import {
    CompletionRequest,
    CompletionResult,
    DefinitionLocationResult,
    DiagnosticsRequest,
    DiagnosticsResult,
    DocumentSymbolResult,
    FoldingRangeResult,
    HighlightResult,
    HoverResult,
    SemanticTokensResult,
    SignatureHelpResult,
    SqlLanguageFeatureEngine,
    SqlLanguageRequest,
} from "../api";
import { LexResult, lex } from "../core/lexer";
import { SegmentResult, StatementSegment, segment } from "../core/segmenter";
import { TextSnapshot } from "../core/text/textSnapshot";
import { IPinnedMetadataView, ISqlLanguageMetadataProvider } from "../provider/types";
import { withSystemObjectCatalog } from "../provider/systemCatalogView";
import { computeDocumentSymbols } from "../features/documentSymbols";
import { computeFolding } from "../features/folding";
import { StatementSketch, sketchStatement } from "../core/sketch";
import { ScriptOverlay, SketchedStatement, buildOverlay } from "../core/overlay";
import { bindStatement } from "../core/binder";
import { classifyContext } from "../core/context";
import { buildDatabaseContext } from "../core/databaseContext";
import {
    MemberAccessInfo,
    MemberAccessResolution,
    computeCompletion,
} from "../features/completion";
import { computeDefinition } from "../features/definition";
import { DiagnosticsPassResult, createDiagnostics } from "../features/diagnostics";
import { computeHover } from "../features/hover";
import { computeSignatureHelp } from "../features/signatureHelp";
import { SqlScriptingEngine } from "../../sqlScripting/scriptingService";
import { SlicedDiagnosticsPass } from "./scheduler";
import { withScriptingSpans } from "./scriptingHost";

export interface NativeEngineOptions {
    readonly snippetsEnabled: boolean;
    readonly keywordCasing: "upper" | "lower";
}

interface AnalyzedStatement extends SketchedStatement {
    readonly segment: StatementSegment;
    readonly sketch: StatementSketch;
}

interface DocumentAnalysis {
    readonly version: number;
    readonly textLength: number;
    readonly snapshot: TextSnapshot;
    readonly lexed: LexResult;
    readonly segments: SegmentResult;
    readonly statements: readonly AnalyzedStatement[];
    readonly overlay: ScriptOverlay;
}

interface DiagnosticsMemo {
    readonly version: number;
    readonly textLength: number;
    readonly generation: number;
    /** Host freshness verdict the pass ran under (CACHE-5 §7.3). */
    readonly metadataFreshness: "validated" | "notValidated";
    readonly result: DiagnosticsResult;
}

export class NativeSqlLanguageEngine implements SqlLanguageFeatureEngine {
    readonly engineId = "nativeTypeScript" as const;

    private analysis: DocumentAnalysis | undefined;
    private diagnosticsMemo: DiagnosticsMemo | undefined;
    private provider: ISqlLanguageMetadataProvider;
    private readonly getOptions: () => NativeEngineOptions;

    constructor(provider: ISqlLanguageMetadataProvider, getOptions?: () => NativeEngineOptions) {
        this.provider = provider;
        this.getOptions =
            getOptions ??
            ((): NativeEngineOptions => ({ snippetsEnabled: true, keywordCasing: "upper" }));
    }

    /** Swap the metadata provider (connect/disconnect/database change). */
    setProvider(provider: ISqlLanguageMetadataProvider): void {
        this.provider = provider;
        this.diagnosticsMemo = undefined;
    }

    get metadataProvider(): ISqlLanguageMetadataProvider {
        return this.provider;
    }

    /**
     * Pin one metadata generation for a request, decorated with the static
     * system-object catalog fallback (provider/systemCatalogView): sys /
     * INFORMATION_SCHEMA names resolve for every feature through the one
     * resolution path, and live metadata always wins.
     */
    private pinView(): IPinnedMetadataView {
        return withSystemObjectCatalog(this.provider.pin());
    }

    private analyze(text: string, version: number): DocumentAnalysis {
        const cached = this.analysis;
        if (
            cached !== undefined &&
            cached.version === version &&
            cached.textLength === text.length
        ) {
            return cached;
        }
        const snapshot = new TextSnapshot(text, version);
        const lexSpan = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.lex",
            fields: {
                charCount: { raw: text.length, cls: "diagnostic.metadata" },
                lineCount: { raw: snapshot.lineCount, cls: "diagnostic.metadata" },
            },
        });
        let lexed: LexResult;
        try {
            lexed = lex(text);
            lexSpan.end("ok", {
                tokenCount: { raw: lexed.tokens.length, cls: "diagnostic.metadata" },
            });
        } catch (error) {
            lexSpan.fail(error);
            throw error;
        }
        const segmentSpan = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.segment",
            fields: {
                tokenCount: { raw: lexed.tokens.length, cls: "diagnostic.metadata" },
            },
        });
        let segments: SegmentResult;
        try {
            segments = segment(text, lexed.tokens);
            segmentSpan.end("ok", {
                batchCount: { raw: segments.batches.length, cls: "diagnostic.metadata" },
                statementCount: {
                    raw: segments.batches.reduce((n, b) => n + b.statements.length, 0),
                    cls: "diagnostic.metadata",
                },
            });
        } catch (error) {
            segmentSpan.fail(error);
            throw error;
        }
        // Sketch every statement (cheap, statement-scoped) + document overlay.
        const parseSpan = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.parse",
            fields: {
                batchCount: { raw: segments.batches.length, cls: "diagnostic.metadata" },
            },
        });
        let statements: AnalyzedStatement[];
        let overlay: ScriptOverlay;
        try {
            statements = [];
            let ordinal = 0;
            segments.batches.forEach((batch, batchIndex) => {
                for (const statement of batch.statements) {
                    statements.push({
                        batchIndex,
                        ordinal,
                        segment: statement,
                        sketch: sketchStatement(text, lexed.tokens, statement),
                    });
                    ordinal++;
                }
            });
            overlay = buildOverlay(statements);
            parseSpan.end("ok", {
                statementCount: { raw: statements.length, cls: "diagnostic.metadata" },
            });
        } catch (error) {
            parseSpan.fail(error);
            throw error;
        }
        const analysis: DocumentAnalysis = {
            version,
            textLength: text.length,
            snapshot,
            lexed,
            segments,
            statements,
            overlay,
        };
        this.analysis = analysis;
        return analysis;
    }

    /**
     * Statement containing the caret, else the nearest one before it
     * (trailing mid-edit positions belong to the prior statement). Undefined
     * when unattached non-whitespace separates the caret from that statement.
     */
    private locateStatement(
        analysis: DocumentAnalysis,
        text: string,
        offset: number,
    ): AnalyzedStatement | undefined {
        let target: AnalyzedStatement | undefined;
        for (const statement of analysis.statements) {
            if (statement.sketch.span.start > offset) {
                break;
            }
            target = statement;
        }
        if (
            target !== undefined &&
            offset > target.sketch.span.end + 1 &&
            !/^\s*$/.test(text.slice(target.sketch.span.end, offset))
        ) {
            return undefined;
        }
        return target;
    }

    completion(req: CompletionRequest): Promise<CompletionResult | undefined> {
        const analysis = this.analyze(req.text, req.version);
        const offset = analysis.snapshot.offsetAt(req.position);
        const span = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.completion",
            fields: {
                trigger: { raw: req.trigger, cls: "diagnostic.metadata" },
                generation: { raw: this.provider.generation, cls: "diagnostic.metadata" },
            },
        });
        try {
            const target = this.locateStatement(analysis, req.text, offset);
            const pinned = this.pinView();
            if (target === undefined) {
                // Empty document / between statements: statement start.
                const options = this.getOptions();
                const result = computeCompletion({
                    text: req.text,
                    offset,
                    context: { kind: "statementStart" },
                    sketch: emptySketch(offset),
                    binding: bindStatement({
                        text: req.text,
                        sketch: emptySketch(offset),
                        overlay: analysis.overlay,
                        batchIndex: 0,
                        ordinal: 0,
                        pinned,
                        caseSensitive: pinned.env.caseSensitive,
                    }),
                    overlay: analysis.overlay,
                    batchIndex: 0,
                    ordinal: 0,
                    pinned,
                    databases: this.provider.databases(),
                    snippetsEnabled: options.snippetsEnabled,
                    keywordCasing: options.keywordCasing,
                    positionAt: (o) => analysis.snapshot.positionAt(o),
                });
                span.end("ok", {
                    contextKind: { raw: "statementStart", cls: "diagnostic.metadata" },
                    itemCount: { raw: result.items.length, cls: "diagnostic.metadata" },
                });
                return Promise.resolve(result);
            }
            const binding = bindStatement({
                text: req.text,
                sketch: target.sketch,
                overlay: analysis.overlay,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                caseSensitive: pinned.env.caseSensitive,
            });
            const context = classifyContext(req.text, analysis.lexed.tokens, target.sketch, offset);
            const options = this.getOptions();
            const result = computeCompletion({
                text: req.text,
                offset,
                context,
                sketch: target.sketch,
                binding,
                overlay: analysis.overlay,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                databases: this.provider.databases(),
                snippetsEnabled: options.snippetsEnabled,
                keywordCasing: options.keywordCasing,
                positionAt: (o) => analysis.snapshot.positionAt(o),
            });
            // Member-access miss on a lazily-hydrated columns section: KICK
            // the load — nothing else does, and without it the isIncomplete
            // retrigger would find the same emptiness forever.
            const memberResolution = this.settleMemberAccess(result.memberAccess);
            // Visibility fields (classified): offsets/counts are protocol
            // metadata; prefix/parts/labels carry identifier classes — the
            // capture policy digests them by default and reveals them only
            // under the explicit, time-bounded elevated capture.
            const contextPrefix = "prefix" in context ? context.prefix : "";
            const contextParts = "parts" in context ? context.parts.join(".") : "";
            span.end("ok", {
                contextKind: { raw: context.kind, cls: "diagnostic.metadata" },
                itemCount: { raw: result.items.length, cls: "diagnostic.metadata" },
                isIncomplete: { raw: result.isIncomplete, cls: "diagnostic.metadata" },
                offset: { raw: offset, cls: "diagnostic.metadata" },
                docLength: { raw: req.text.length, cls: "diagnostic.metadata" },
                prefixLength: { raw: contextPrefix.length, cls: "diagnostic.metadata" },
                prefix: { raw: contextPrefix, cls: "user.text" },
                parts: { raw: contextParts, cls: "object.name" },
                topLabels: {
                    raw: result.items
                        .slice(0, 5)
                        .map((item) => item.label)
                        .join(", "),
                    cls: "object.name",
                },
                ...(memberResolution !== undefined
                    ? { memberResolution: { raw: memberResolution, cls: "diagnostic.metadata" } }
                    : {}),
            });
            // Strip the engine-internal memberAccess block before the RPC.
            return Promise.resolve({
                items: result.items,
                isIncomplete: result.isIncomplete,
                incompleteReason: result.incompleteReason,
            });
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    /**
     * Member-access columns outcome (journal field `memberResolution`).
     * "notLoaded" with a resolved ref means the columns section never
     * hydrated for that table/view: fire-and-forget the lazy load through
     * the provider seam — the request already returned isIncomplete:true,
     * so Monaco re-queries and the retrigger serves the loaded columns.
     * The provider de-dupes in-flight kicks; without the seam the honest
     * answer stays "notLoaded".
     */
    private settleMemberAccess(
        info: MemberAccessInfo | undefined,
    ): MemberAccessResolution | undefined {
        if (info === undefined) {
            return undefined;
        }
        if (
            info.resolution === "notLoaded" &&
            info.columnsRef !== undefined &&
            this.provider.requestHydration !== undefined
        ) {
            this.provider.requestHydration({
                kind: "columns",
                object: info.columnsRef,
                priority: "interactiveFollowup",
            });
            return "loading";
        }
        return info.resolution;
    }

    hover(req: SqlLanguageRequest): Promise<HoverResult | undefined> {
        const analysis = this.analyze(req.text, req.version);
        const offset = analysis.snapshot.offsetAt(req.position);
        const span = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.hover",
            fields: {
                generation: { raw: this.provider.generation, cls: "diagnostic.metadata" },
            },
        });
        try {
            const target = this.locateStatement(analysis, req.text, offset);
            if (target === undefined) {
                span.end("ok", {
                    symbolKind: { raw: "none", cls: "diagnostic.metadata" },
                    served: { raw: false, cls: "diagnostic.metadata" },
                });
                return Promise.resolve(undefined);
            }
            const pinned = this.pinView();
            const binding = bindStatement({
                text: req.text,
                sketch: target.sketch,
                overlay: analysis.overlay,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                caseSensitive: pinned.env.caseSensitive,
            });
            const databaseContext = buildDatabaseContext(analysis.statements);
            const computation = computeHover({
                text: req.text,
                offset,
                tokens: analysis.lexed.tokens,
                sketch: target.sketch,
                binding,
                overlay: analysis.overlay,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                databases: this.provider.databases(),
                effectiveDatabase: databaseContext.effectiveDatabaseAt(target.ordinal),
                positionAt: (o) => analysis.snapshot.positionAt(o),
            });
            span.end("ok", {
                symbolKind: { raw: computation.symbolKind, cls: "diagnostic.metadata" },
                served: { raw: computation.result !== undefined, cls: "diagnostic.metadata" },
            });
            return Promise.resolve(computation.result);
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    signatureHelp(req: SqlLanguageRequest): Promise<SignatureHelpResult | undefined> {
        const analysis = this.analyze(req.text, req.version);
        const offset = analysis.snapshot.offsetAt(req.position);
        const span = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.signature",
            fields: {
                generation: { raw: this.provider.generation, cls: "diagnostic.metadata" },
            },
        });
        try {
            const target = this.locateStatement(analysis, req.text, offset);
            if (target === undefined) {
                span.end("ok", {
                    calleeKind: { raw: "none", cls: "diagnostic.metadata" },
                    signatureCount: { raw: 0, cls: "diagnostic.metadata" },
                });
                return Promise.resolve(undefined);
            }
            const pinned = this.pinView();
            const databaseContext = buildDatabaseContext(analysis.statements);
            const computation = computeSignatureHelp({
                text: req.text,
                offset,
                tokens: analysis.lexed.tokens,
                sketch: target.sketch,
                overlay: analysis.overlay,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                effectiveDatabase: databaseContext.effectiveDatabaseAt(target.ordinal),
            });
            span.end("ok", {
                calleeKind: { raw: computation.calleeKind, cls: "diagnostic.metadata" },
                signatureCount: {
                    raw: computation.result?.signatures.length ?? 0,
                    cls: "diagnostic.metadata",
                },
                activeParameter: {
                    raw: computation.result?.activeParameter ?? -1,
                    cls: "diagnostic.metadata",
                },
            });
            return Promise.resolve(computation.result);
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    /** Whole-document diagnostics, run to completion (pull path / router). */
    diagnostics(req: DiagnosticsRequest): Promise<DiagnosticsResult | undefined> {
        const pass = this.diagnosticsPass(req);
        while (pass.step()) {
            // synchronous full pass
        }
        return Promise.resolve(pass.finish());
    }

    /**
     * Resumable whole-document diagnostics pass for the sliced scheduler.
     * Owns the sqlLanguage.diagnostics span: counts/durations/suppression
     * reasons only — never text. Results are memoized per (version, length,
     * metadata generation) so a pull right after a scheduled pass is free.
     */
    diagnosticsPass(req: DiagnosticsRequest): SlicedDiagnosticsPass {
        const generation = this.provider.generation;
        const metadataFreshness = req.metadataFreshness ?? "validated";
        const memo = this.diagnosticsMemo;
        if (
            memo !== undefined &&
            memo.version === req.version &&
            memo.textLength === req.text.length &&
            memo.generation === generation &&
            memo.metadataFreshness === metadataFreshness
        ) {
            let done = false;
            return {
                step: (): boolean => {
                    done = true;
                    return false;
                },
                finish: (): DiagnosticsResult => {
                    void done;
                    return memo.result;
                },
                abort: (): void => undefined,
            };
        }
        const analysis = this.analyze(req.text, req.version);
        const pinned = this.pinView();
        const span = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.diagnostics",
            fields: {
                charCount: { raw: req.text.length, cls: "diagnostic.metadata" },
                statementCount: { raw: analysis.statements.length, cls: "diagnostic.metadata" },
                generation: { raw: generation, cls: "diagnostic.metadata" },
                metadataFreshness: { raw: metadataFreshness, cls: "diagnostic.metadata" },
            },
        });
        // Diagnostics analogue of settleMemberAccess: a columnsNotReady
        // suppression on a never-loaded lazy columns section kicks the load
        // through the provider seam (fire-and-forget; provider de-dupes).
        // The provider's didChange then reschedules a pass that can claim
        // honestly (orchestrator-owned listener).
        const requestHydration = this.provider.requestHydration?.bind(this.provider);
        const computation = createDiagnostics({
            text: req.text,
            tokens: analysis.lexed.tokens,
            statements: analysis.statements,
            overlay: analysis.overlay,
            pinned,
            metadataFreshness,
            requestColumnsHydration:
                requestHydration === undefined
                    ? undefined
                    : (ref) =>
                          requestHydration({
                              kind: "columns",
                              object: ref,
                              priority: "background",
                          }),
            positionAt: (offset) => analysis.snapshot.positionAt(offset),
        });
        let settled = false;
        return {
            step: (): boolean => {
                try {
                    return computation.step();
                } catch (error) {
                    if (!settled) {
                        settled = true;
                        span.fail(error);
                    }
                    throw error;
                }
            },
            finish: (): DiagnosticsResult => {
                const result = computation.result();
                if (!settled) {
                    settled = true;
                    span.end("ok", diagnosticsSpanFields(result));
                }
                const diagnosticsResult: DiagnosticsResult = {
                    diagnostics: result.diagnostics,
                    suppressed: result.suppressed,
                };
                this.diagnosticsMemo = {
                    version: req.version,
                    textLength: req.text.length,
                    generation,
                    metadataFreshness,
                    result: diagnosticsResult,
                };
                return diagnosticsResult;
            },
            abort: (): void => {
                if (!settled) {
                    settled = true;
                    span.end("warning", {
                        outcome: { raw: "staleCancelled", cls: "diagnostic.metadata" },
                    });
                }
            },
        };
    }
    async definition(req: SqlLanguageRequest): Promise<DefinitionLocationResult | undefined> {
        const analysis = this.analyze(req.text, req.version);
        const offset = analysis.snapshot.offsetAt(req.position);
        const span = diag.startSpan({
            feature: "sqlLanguage",
            kind: "span",
            type: "sqlLanguage.definition",
            fields: {
                generation: { raw: this.provider.generation, cls: "diagnostic.metadata" },
            },
        });
        try {
            const target = this.locateStatement(analysis, req.text, offset);
            if (target === undefined) {
                span.end("ok", {
                    targetKind: { raw: "none", cls: "diagnostic.metadata" },
                    served: { raw: false, cls: "diagnostic.metadata" },
                });
                return undefined;
            }
            const pinned = this.pinView();
            const binding = bindStatement({
                text: req.text,
                sketch: target.sketch,
                overlay: analysis.overlay,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                caseSensitive: pinned.env.caseSensitive,
            });
            const databaseContext = buildDatabaseContext(analysis.statements);
            const computation = await computeDefinition({
                text: req.text,
                offset,
                tokens: analysis.lexed.tokens,
                sketch: target.sketch,
                binding,
                overlay: analysis.overlay,
                statements: analysis.statements,
                batchIndex: target.batchIndex,
                ordinal: target.ordinal,
                pinned,
                effectiveDatabase: databaseContext.effectiveDatabaseAt(target.ordinal),
                scripting: withScriptingSpans(new SqlScriptingEngine(pinned)),
                positionAt: (o) => analysis.snapshot.positionAt(o),
            });
            span.end("ok", {
                targetKind: { raw: computation.targetKind, cls: "diagnostic.metadata" },
                served: { raw: computation.result !== undefined, cls: "diagnostic.metadata" },
                virtual: {
                    raw: computation.result?.virtualContent !== undefined,
                    cls: "diagnostic.metadata",
                },
            });
            return computation.result;
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }
    highlights(_req: SqlLanguageRequest): Promise<readonly HighlightResult[] | undefined> {
        return Promise.resolve(undefined); // B13 / LS-5
    }
    semanticTokens(_req: DiagnosticsRequest): Promise<SemanticTokensResult | undefined> {
        return Promise.resolve(undefined); // B13 / LS-5
    }

    folding(req: DiagnosticsRequest): Promise<readonly FoldingRangeResult[] | undefined> {
        const analysis = this.analyze(req.text, req.version);
        return Promise.resolve(
            computeFolding(analysis.snapshot, analysis.lexed.tokens, analysis.segments),
        );
    }

    documentSymbols(req: DiagnosticsRequest): Promise<readonly DocumentSymbolResult[] | undefined> {
        const analysis = this.analyze(req.text, req.version);
        return Promise.resolve(
            computeDocumentSymbols(analysis.snapshot, analysis.lexed.tokens, analysis.segments),
        );
    }
}

/** Privacy-safe end-of-pass span fields: counts and reason names only. */
function diagnosticsSpanFields(result: DiagnosticsPassResult): Record<string, RawField> {
    let errorCount = 0;
    let warningCount = 0;
    for (const d of result.diagnostics) {
        if (d.severity === "error") {
            errorCount++;
        } else if (d.severity === "warning") {
            warningCount++;
        }
    }
    let suppressedTotal = 0;
    const reasonParts: string[] = [];
    for (const [reason, n] of Object.entries(result.suppressed)) {
        suppressedTotal += n;
        reasonParts.push(`${reason}:${n}`);
    }
    return {
        diagnosticCount: { raw: result.diagnostics.length, cls: "diagnostic.metadata" },
        errorCount: { raw: errorCount, cls: "diagnostic.metadata" },
        warningCount: { raw: warningCount, cls: "diagnostic.metadata" },
        suppressedTotal: { raw: suppressedTotal, cls: "diagnostic.metadata" },
        suppressionReasons: { raw: reasonParts.sort().join(","), cls: "diagnostic.metadata" },
    };
}

/** Zero-width sketch for caret positions outside any statement. */
function emptySketch(offset: number): StatementSketch {
    return {
        kind: "other",
        span: { start: offset, end: offset },
        scopes: [{ id: 0, span: { start: offset, end: offset } }],
        clauses: [],
        sources: [],
        selectItems: [],
        ctes: [],
        declares: [],
    };
}
