/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio language-service RPC contracts (qs/lang.*). Webview-safe:
 * plain JSON DTOs mirroring src/sqlLanguage/api.ts result shapes (duplicated
 * here — sharedInterfaces must stay standalone; structural typing lets the
 * host return the engine results directly). Positions and ranges are
 * ZERO-based {line, character} in UTF-16 code units; the webview converts
 * to/from Monaco's 1-based coordinates.
 *
 * vscode-jsonrpc request results cannot be `undefined` — absent results are
 * `null` (or empty container shapes) on the wire.
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";

export const QS_LANG_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface QsLangPosition {
    /** 0-based document line. */
    readonly line: number;
    /** 0-based UTF-16 character. */
    readonly character: number;
}

/**
 * Positional feature request (hover/signature/definition). textHash names the
 * webview editor text the position was computed against; the host converges
 * its mirror to it first — positional requests race the edit coalescer just
 * like completions do.
 */
export interface QsLangPositionalParams extends QsLangPosition {
    readonly textHash?: string;
}

export interface QsLangRange {
    readonly start: QsLangPosition;
    readonly end: QsLangPosition;
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export type QsLangCompletionItemKind =
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

export interface QsLangCompletionItem {
    readonly label: string;
    readonly kind: QsLangCompletionItemKind;
    readonly insertText: string;
    /** True when insertText contains snippet placeholders ($1 etc.). */
    readonly isSnippet?: boolean;
    readonly detail?: string;
    readonly documentation?: string;
    readonly sortText?: string;
    readonly filterText?: string;
    readonly commitCharacters?: readonly string[];
    /** Explicit replace range (star expansion); default is the caret word. */
    readonly replaceRange?: QsLangRange;
}

export interface QsLangCompletionParams extends QsLangPosition {
    /**
     * FNV-1a hash of the webview editor text at request time. The host
     * briefly awaits sync convergence to this hash before classifying —
     * completions raced the edit coalescer and bound one keystroke behind.
     */
    readonly textHash?: string;
    readonly trigger: "invoke" | "character";
    readonly triggerCharacter?: string;
}

export interface QsLangCompletionResult {
    /** Empty when the request could not be served. */
    readonly items: readonly QsLangCompletionItem[];
    readonly isIncomplete: boolean;
    readonly incompleteReason?: string;
}

// ---------------------------------------------------------------------------
// Hover / signature help / definition
// ---------------------------------------------------------------------------

export interface QsLangHoverResult {
    readonly contentsMarkdown: string;
    readonly range?: QsLangRange;
}

export interface QsLangSignatureParameter {
    readonly label: string;
    readonly documentation?: string;
}

export interface QsLangSignature {
    readonly label: string;
    readonly documentation?: string;
    readonly parameters: readonly QsLangSignatureParameter[];
}

export interface QsLangSignatureHelpResult {
    readonly signatures: readonly QsLangSignature[];
    readonly activeSignature: number;
    readonly activeParameter: number;
}

export interface QsLangDefinitionResult {
    /** In-document target; absent means no navigable definition. */
    readonly range?: QsLangRange;
}

// ---------------------------------------------------------------------------
// Structure features
// ---------------------------------------------------------------------------

export interface QsLangFoldingRange {
    /** 0-based first folded line. */
    readonly startLine: number;
    /** 0-based last folded line. */
    readonly endLine: number;
    readonly kind?: "comment" | "region" | "block";
}

export type QsLangDocumentSymbolKind =
    | "batch"
    | "statement"
    | "cte"
    | "tempTable"
    | "variable"
    | "object"
    | "region"
    | "label";

export interface QsLangDocumentSymbol {
    readonly name: string;
    readonly kind: QsLangDocumentSymbolKind;
    readonly range: QsLangRange;
    readonly children?: readonly QsLangDocumentSymbol[];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type QsLangDiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface QsLangDiagnostic {
    readonly range: QsLangRange;
    readonly severity: QsLangDiagnosticSeverity;
    readonly message: string;
    readonly code?: string;
    readonly source: string;
}

export interface QsLangDiagnosticsResult {
    readonly diagnostics: readonly QsLangDiagnostic[];
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface QsLangFeatureStatus {
    readonly feature: string;
    readonly maturity: string;
    readonly effectiveEngine: string;
    readonly circuitBroken: boolean;
}

export interface QsLangStatusResult {
    readonly preference: "sqlToolsService" | "nativeTypeScript";
    readonly features: readonly QsLangFeatureStatus[];
    readonly readiness: Record<string, string>;
    readonly metadataGeneration: number;
    readonly shadowConnectionState: "none" | "connected" | "invalidated";
}

// ---------------------------------------------------------------------------
// Requests (webview → host)
// ---------------------------------------------------------------------------

export namespace QsLangCompletionRequest {
    export const type = new RequestType<QsLangCompletionParams, QsLangCompletionResult, void>(
        "qs/lang.completion",
    );
}
export namespace QsLangHoverRequest {
    export const type = new RequestType<QsLangPositionalParams, QsLangHoverResult | null, void>(
        "qs/lang.hover",
    );
}
export namespace QsLangSignatureHelpRequest {
    export const type = new RequestType<
        QsLangPositionalParams,
        QsLangSignatureHelpResult | null,
        void
    >("qs/lang.signatureHelp");
}
export namespace QsLangDefinitionRequest {
    export const type = new RequestType<
        QsLangPositionalParams,
        QsLangDefinitionResult | null,
        void
    >("qs/lang.definition");
}
export namespace QsLangFoldingRequest {
    export const type = new RequestType<void, { ranges: readonly QsLangFoldingRange[] }, void>(
        "qs/lang.folding",
    );
}
export namespace QsLangDocumentSymbolsRequest {
    export const type = new RequestType<void, { symbols: readonly QsLangDocumentSymbol[] }, void>(
        "qs/lang.documentSymbols",
    );
}
export namespace QsLangDiagnosticsRequest {
    export const type = new RequestType<void, QsLangDiagnosticsResult, void>("qs/lang.diagnostics");
}
export namespace QsLangStatusRequest {
    export const type = new RequestType<void, QsLangStatusResult, void>("qs/lang.status");
}

// ---------------------------------------------------------------------------
// Notifications (host → webview)
// ---------------------------------------------------------------------------

/** Pushed when the effective engine publishes new markers for the document. */
export namespace QsLangDiagnosticsChangedNotification {
    export const type = new NotificationType<QsLangDiagnosticsResult>("qs/lang.diagnosticsChanged");
}
