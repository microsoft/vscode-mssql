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

interface DocumentAnalysis {
    readonly version: number;
    readonly textLength: number;
    readonly snapshot: TextSnapshot;
    readonly lexed: LexResult;
    readonly segments: SegmentResult;
}

export class NativeSqlLanguageEngine implements SqlLanguageFeatureEngine {
    readonly engineId = "nativeTypeScript" as const;

    private analysis: DocumentAnalysis | undefined;
    private provider: ISqlLanguageMetadataProvider;

    constructor(provider: ISqlLanguageMetadataProvider) {
        this.provider = provider;
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
        const analysis: DocumentAnalysis = {
            version,
            textLength: text.length,
            snapshot,
            lexed,
            segments,
        };
        this.analysis = analysis;
        return analysis;
    }

    completion(_req: CompletionRequest): Promise<CompletionResult | undefined> {
        return Promise.resolve(undefined); // B9 / LS-1
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
