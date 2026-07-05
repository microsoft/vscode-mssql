/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public engine interface (language-service design 05 §19 LS-0 task 2).
 * Both engines — native TypeScript and the STS v1 bridge — implement
 * SqlLanguageFeatureEngine; the LanguageFeatureRouter picks per feature.
 *
 * All shapes are JSON-safe (they cross the Query Studio webview RPC after a
 * trivial host mapping) and vscode-free (pure; lint-enforced). Positions are
 * ZERO-based line/character in UTF-16 code units.
 */

export interface SqlLanguagePosition {
    readonly line: number;
    readonly character: number;
}

export interface SqlLanguageRange {
    readonly start: SqlLanguagePosition;
    readonly end: SqlLanguagePosition;
}

/** Every request carries the full document text (v1) and its version. */
export interface SqlLanguageRequest {
    readonly text: string;
    readonly version: number;
    readonly position: SqlLanguagePosition;
}

// ---- completion -------------------------------------------------------------

export type SqlCompletionItemKind =
    | "keyword"
    | "table"
    | "view"
    | "column"
    | "schema"
    | "database"
    | "procedure"
    | "function"
    | "variable"
    | "parameter"
    | "snippet"
    | "join"
    | "systemObject";

export interface SqlCompletionItem {
    readonly label: string;
    readonly kind: SqlCompletionItemKind;
    readonly insertText: string;
    /** True when insertText contains snippet placeholders ($1 etc.). */
    readonly isSnippet?: boolean;
    readonly detail?: string;
    readonly documentation?: string;
    readonly sortText?: string;
    readonly filterText?: string;
    readonly commitCharacters?: readonly string[];
    /** Explicit replace range (star expansion); default is the caret word. */
    readonly replaceRange?: SqlLanguageRange;
}

export interface CompletionRequest extends SqlLanguageRequest {
    readonly trigger: "invoke" | "character";
    readonly triggerCharacter?: string;
}

export interface CompletionResult {
    readonly items: readonly SqlCompletionItem[];
    readonly isIncomplete: boolean;
    /** Honest degradation marker when readiness limited candidates (§4.2). */
    readonly incompleteReason?: string;
}

// ---- hover / signature -------------------------------------------------------

export interface HoverResult {
    readonly contentsMarkdown: string;
    readonly range?: SqlLanguageRange;
}

export interface SignatureParameterInfo {
    readonly label: string;
    readonly documentation?: string;
}

export interface SignatureInfo {
    readonly label: string;
    readonly documentation?: string;
    readonly parameters: readonly SignatureParameterInfo[];
}

export interface SignatureHelpResult {
    readonly signatures: readonly SignatureInfo[];
    readonly activeSignature: number;
    readonly activeParameter: number;
}

// ---- diagnostics --------------------------------------------------------------

export type SqlDiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface SqlDiagnostic {
    readonly range: SqlLanguageRange;
    readonly severity: SqlDiagnosticSeverity;
    readonly message: string;
    /** e.g. "mssql(207)" (design §11.3). */
    readonly code?: string;
    readonly source: string;
}

export interface DiagnosticsRequest {
    readonly text: string;
    readonly version: number;
}

export interface DiagnosticsResult {
    readonly diagnostics: readonly SqlDiagnostic[];
    /** Suppression-reason counts for telemetry/status (never identifier text). */
    readonly suppressed?: Readonly<Record<string, number>>;
}

// ---- definition ----------------------------------------------------------------

export interface DefinitionLocationResult {
    /** In-document target (aliases, variables, CTEs, temp tables). */
    readonly range?: SqlLanguageRange;
    /** Virtual/scripted content target (catalog objects), LS-4. */
    readonly virtualContent?: {
        readonly title: string;
        readonly text: string;
        readonly anchor?: SqlLanguagePosition;
    };
}

// ---- structure features ---------------------------------------------------------

export interface FoldingRangeResult {
    readonly startLine: number;
    readonly endLine: number;
    readonly kind?: "comment" | "region" | "block";
}

export interface DocumentSymbolResult {
    readonly name: string;
    readonly kind:
        | "batch"
        | "statement"
        | "cte"
        | "tempTable"
        | "variable"
        | "object"
        | "region"
        | "label";
    readonly range: SqlLanguageRange;
    readonly children?: readonly DocumentSymbolResult[];
}

export interface HighlightResult {
    readonly range: SqlLanguageRange;
    readonly kind: "read" | "write" | "text";
}

export interface SemanticTokensResult {
    /** Monaco/LSP delta-encoded token data. */
    readonly data: readonly number[];
}

// ---- the engine -----------------------------------------------------------------

export type SqlLanguageFeature =
    | "completion"
    | "hover"
    | "signatureHelp"
    | "diagnostics"
    | "definition"
    | "folding"
    | "documentSymbols"
    | "highlights"
    | "semanticTokens";

export interface SqlLanguageFeatureEngine {
    readonly engineId: "nativeTypeScript" | "sqlToolsServiceBridge";

    completion(req: CompletionRequest): Promise<CompletionResult | undefined>;
    hover(req: SqlLanguageRequest): Promise<HoverResult | undefined>;
    signatureHelp(req: SqlLanguageRequest): Promise<SignatureHelpResult | undefined>;
    diagnostics(req: DiagnosticsRequest): Promise<DiagnosticsResult | undefined>;
    definition(req: SqlLanguageRequest): Promise<DefinitionLocationResult | undefined>;
    folding(req: DiagnosticsRequest): Promise<readonly FoldingRangeResult[] | undefined>;
    documentSymbols(req: DiagnosticsRequest): Promise<readonly DocumentSymbolResult[] | undefined>;
    highlights(req: SqlLanguageRequest): Promise<readonly HighlightResult[] | undefined>;
    semanticTokens(req: DiagnosticsRequest): Promise<SemanticTokensResult | undefined>;
}

/** Per-feature rollout state (design §9.2). */
export type FeatureMaturity = "off" | "experimental" | "preview" | "defaultCandidate" | "default";

export type NativeCapabilityTable = Readonly<Record<SqlLanguageFeature, FeatureMaturity>>;
