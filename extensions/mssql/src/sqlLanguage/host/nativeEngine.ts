/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native engine host wrapper (design 05 §6.1 host/nativeEngine). Owns the
 * per-document analysis cache (lex + segment, keyed by version) and emits the
 * sqlLanguage.lex / sqlLanguage.segment spans (sizes and durations only —
 * never text). LS-0 serves folding + document symbols; schema-aware features
 * arrive per batch (B9+) and return undefined until then, which the router
 * reports honestly as unserved.
 */

import { diag } from "../../diagnostics/diagnosticsCore";
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
import { SegmentResult, segment } from "../core/segmenter";
import { TextSnapshot } from "../core/text/textSnapshot";
import { ISqlLanguageMetadataProvider } from "../provider/types";
import { computeDocumentSymbols } from "../features/documentSymbols";
import { computeFolding } from "../features/folding";
import { StatementSketch, sketchStatement } from "../core/sketch";
import { ScriptOverlay, SketchedStatement, buildOverlay } from "../core/overlay";
import { bindStatement } from "../core/binder";
import { classifyContext } from "../core/context";
import { computeCompletion } from "../features/completion";

export interface NativeEngineOptions {
    readonly snippetsEnabled: boolean;
    readonly keywordCasing: "upper" | "lower";
}

interface AnalyzedStatement extends SketchedStatement {
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

export class NativeSqlLanguageEngine implements SqlLanguageFeatureEngine {
    readonly engineId = "nativeTypeScript" as const;

    private analysis: DocumentAnalysis | undefined;
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
    }

    get metadataProvider(): ISqlLanguageMetadataProvider {
        return this.provider;
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
            // Statement containing the caret, else the nearest one before it
            // (trailing mid-edit positions belong to the prior statement).
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
                !/^\s*$/.test(req.text.slice(target.sketch.span.end, offset))
            ) {
                // Non-whitespace between the last statement and the caret that
                // the segmenter did not attach — treat as statement start.
                target = undefined;
            }
            const pinned = this.provider.pin();
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
            span.end("ok", {
                contextKind: { raw: context.kind, cls: "diagnostic.metadata" },
                itemCount: { raw: result.items.length, cls: "diagnostic.metadata" },
                isIncomplete: { raw: result.isIncomplete, cls: "diagnostic.metadata" },
            });
            return Promise.resolve(result);
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }
    hover(_req: SqlLanguageRequest): Promise<HoverResult | undefined> {
        return Promise.resolve(undefined); // B11 / LS-3
    }
    signatureHelp(_req: SqlLanguageRequest): Promise<SignatureHelpResult | undefined> {
        return Promise.resolve(undefined); // B11 / LS-3
    }
    diagnostics(_req: DiagnosticsRequest): Promise<DiagnosticsResult | undefined> {
        return Promise.resolve(undefined); // B10 / LS-2
    }
    definition(_req: SqlLanguageRequest): Promise<DefinitionLocationResult | undefined> {
        return Promise.resolve(undefined); // B12 / LS-4
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
