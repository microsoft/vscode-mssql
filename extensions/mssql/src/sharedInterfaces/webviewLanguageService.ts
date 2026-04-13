/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";

// ------------------------------- < Webview Completion > ------------------------------------

/**
 * Parameters for a completion request from a webview Monaco editor to the extension host.
 */
export interface WebviewCompletionParams {
    /** The ownerUri identifying the connection/session context */
    ownerUri: string;
    /** Cursor position (1-based, Monaco convention) */
    position: { lineNumber: number; column: number };
    /** Text from start of current line to cursor, for trigger character detection */
    textUntilPosition: string;
    /** Full editor content, needed by the service to parse the document */
    fullText: string;
}

/**
 * A completion item mapped to Monaco's CompletionItem format.
 */
export interface WebviewCompletionItem {
    label: string;
    kind: number; // Monaco CompletionItemKind
    insertText: string;
    detail?: string;
    documentation?: string;
    sortText?: string;
    filterText?: string;
    preselect?: boolean;
    range?: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
}

/**
 * Result of a webview completion request.
 */
export interface WebviewCompletionResult {
    suggestions: WebviewCompletionItem[];
}

/**
 * Request type for completions from webview Monaco editors.
 */
export namespace WebviewCompletionRequest {
    export const type = new RequestType<WebviewCompletionParams, WebviewCompletionResult, void>(
        "webview/completion",
    );
}

// ------------------------------- < Webview Format Document > ------------------------------------

/**
 * A text edit returned by the SQL Tools Service formatter, in Monaco's
 * 1-based range convention.
 */
export interface WebviewFormatTextEdit {
    range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
    text: string;
}

/**
 * Parameters for a document/range formatting request from a webview Monaco editor.
 */
export interface WebviewFormatDocumentParams {
    /** The ownerUri identifying the connection/session context */
    ownerUri: string;
    /** Full editor content — synced to the STS before the formatter runs */
    fullText: string;
    /** Formatting options, matching Monaco/LSP FormattingOptions */
    options: {
        tabSize: number;
        insertSpaces: boolean;
    };
    /**
     * Optional selection range for "Format Selection". Monaco 1-based line/column.
     * When omitted, the whole document is formatted.
     */
    range?: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
}

/**
 * Result of a webview format request.
 */
export interface WebviewFormatDocumentResult {
    edits: WebviewFormatTextEdit[];
}

/**
 * Request type for document formatting from webview Monaco editors.
 */
export namespace WebviewFormatDocumentRequest {
    export const type = new RequestType<
        WebviewFormatDocumentParams,
        WebviewFormatDocumentResult,
        void
    >("webview/formatDocument");
}

// ------------------------------- < Webview Diagnostics > ------------------------------------

/**
 * A single diagnostic produced by the SQL Tools Service, already mapped to
 * Monaco's 1-based line/column convention and MarkerSeverity scale.
 */
export interface WebviewDiagnostic {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    message: string;
    /** Monaco MarkerSeverity — Error=8, Warning=4, Info=2, Hint=1 */
    severity: number;
    source?: string;
    code?: string;
}

/**
 * Parameters for a diagnostics notification pushed from the extension host to
 * a webview's embedded Monaco editor. The full current set replaces any
 * previously-applied markers for the same ownerUri.
 */
export interface WebviewDiagnosticsParams {
    ownerUri: string;
    diagnostics: WebviewDiagnostic[];
}

/**
 * Notification type for publishing diagnostics to webview Monaco editors.
 */
export namespace WebviewDiagnosticsNotification {
    export const type = new NotificationType<WebviewDiagnosticsParams>("webview/diagnostics");
}

// ------------------------------- < Webview Document Sync > ------------------------------------

/**
 * Parameters for syncing editor content from the webview to the extension host.
 * Sent on every editor change so the STS always has up-to-date document content
 * before completion requests arrive.
 */
export interface WebviewDocumentSyncParams {
    ownerUri: string;
    fullText: string;
}

/**
 * Notification type for document content sync from webview Monaco editors.
 */
export namespace WebviewDocumentSyncNotification {
    export const type = new NotificationType<WebviewDocumentSyncParams>("webview/documentSync");
}

// ------------------------------- < Webview Definition > ------------------------------------

/**
 * Parameters for a definition request from a webview Monaco editor.
 */
export interface WebviewDefinitionParams {
    ownerUri: string;
    position: { lineNumber: number; column: number };
    fullText: string;
}

/**
 * A location result mapped to Monaco's 1-based range convention.
 */
export interface WebviewLocationItem {
    uri: string;
    range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
}

/**
 * A definition result that includes the script content so the webview's
 * embedded Monaco editor can display it without filesystem access.
 */
export interface WebviewDefinitionItem {
    /** Display name for the definition (e.g. "dbo.Students") */
    name: string;
    /** The full CREATE script for the object */
    content: string;
    /** Range within the content to highlight */
    range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
}

/**
 * Result of a webview definition request.
 */
export interface WebviewDefinitionResult {
    definitions: WebviewDefinitionItem[];
}

/**
 * Request type for definition from webview Monaco editors.
 */
export namespace WebviewDefinitionRequest {
    export const type = new RequestType<WebviewDefinitionParams, WebviewDefinitionResult, void>(
        "webview/definition",
    );
}

/**
 * Request type for opening a definition in a VS Code editor tab.
 * The extension host resolves the definition via STS and opens the
 * resulting temp file in a real editor.
 */
export namespace WebviewOpenDefinitionRequest {
    export const type = new RequestType<WebviewDefinitionParams, void, void>(
        "webview/openDefinition",
    );
}

// ------------------------------- < Webview Hover > ------------------------------------

/**
 * Parameters for a hover request from a webview Monaco editor.
 */
export interface WebviewHoverParams {
    ownerUri: string;
    position: { lineNumber: number; column: number };
    fullText: string;
}

/**
 * Result of a webview hover request.
 */
export interface WebviewHoverResult {
    contents: { value: string }[];
    range?: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
    };
}

/**
 * Request type for hover from webview Monaco editors.
 */
export namespace WebviewHoverRequest {
    export const type = new RequestType<WebviewHoverParams, WebviewHoverResult, void>(
        "webview/hover",
    );
}

// ------------------------------- < Webview Signature Help > ------------------------------------

/**
 * Parameters for a signature help request from a webview Monaco editor.
 */
export interface WebviewSignatureHelpParams {
    ownerUri: string;
    position: { lineNumber: number; column: number };
    fullText: string;
}

/**
 * A parameter within a signature.
 */
export interface WebviewParameterInformation {
    label: string;
    documentation?: string;
}

/**
 * A single signature with its parameters.
 */
export interface WebviewSignatureInformation {
    label: string;
    documentation?: string;
    parameters: WebviewParameterInformation[];
}

/**
 * Result of a webview signature help request.
 */
export interface WebviewSignatureHelpResult {
    signatures: WebviewSignatureInformation[];
    activeSignature: number;
    activeParameter: number;
}

/**
 * Request type for signature help from webview Monaco editors.
 */
export namespace WebviewSignatureHelpRequest {
    export const type = new RequestType<
        WebviewSignatureHelpParams,
        WebviewSignatureHelpResult,
        void
    >("webview/signatureHelp");
}

// ------------------------------- < LSP to Monaco Mapping > ------------------------------------

/**
 * Maps LSP CompletionItemKind values to Monaco CompletionItemKind values.
 *
 * LSP:   Text=1, Method=2, Function=3, Constructor=4, Field=5, Variable=6,
 *        Class=7, Interface=8, Module=9, Property=10, Unit=11, Value=12,
 *        Enum=13, Keyword=14, Snippet=15, Color=16, File=17, Reference=18,
 *        Folder=19, EnumMember=20, Constant=21, Struct=22, Event=23,
 *        Operator=24, TypeParameter=25
 *
 * Monaco: Method=0, Function=1, Constructor=2, Field=3, Variable=4,
 *         Class=5, Struct=6, Interface=7, Module=8, Property=9, Event=10,
 *         Operator=11, Unit=12, Value=13, Constant=14, Enum=15,
 *         EnumMember=16, Keyword=17, Text=18, Color=19, File=20,
 *         Reference=21, Customcolor=22, Folder=23, TypeParameter=24,
 *         User=25, Issue=26, Snippet=27
 *
 * SQL Tools Service specific mappings:
 *   Tables/Views -> File (LSP 17) -> Monaco File (20)
 *   Columns      -> Field (LSP 5) -> Monaco Field (3)
 *   Schemas      -> Module (LSP 9) -> Monaco Module (8)
 *   Functions    -> Value (LSP 12) -> Monaco Value (13)
 *   Keywords     -> Keyword (LSP 14) -> Monaco Keyword (17)
 *   Databases    -> Method (LSP 2) -> Monaco Method (0)
 */
const LSP_TO_MONACO_KIND: Record<number, number> = {
    1: 18, // Text
    2: 0, // Method
    3: 1, // Function
    4: 2, // Constructor
    5: 3, // Field (columns)
    6: 4, // Variable
    7: 5, // Class
    8: 7, // Interface
    9: 8, // Module (schemas)
    10: 9, // Property
    11: 12, // Unit
    12: 13, // Value (functions in SQL service)
    13: 15, // Enum
    14: 17, // Keyword
    15: 27, // Snippet
    16: 19, // Color
    17: 20, // File (tables/views)
    18: 21, // Reference
    19: 23, // Folder
    20: 16, // EnumMember
    21: 14, // Constant
    22: 6, // Struct
    23: 10, // Event
    24: 11, // Operator
    25: 24, // TypeParameter
};

/**
 * Converts an LSP CompletionItemKind to Monaco CompletionItemKind.
 * Falls back to Text (18) for unknown kinds.
 */
export function mapLspKindToMonaco(lspKind: number | undefined): number {
    if (lspKind === undefined) {
        return 18; // Text
    }
    return LSP_TO_MONACO_KIND[lspKind] ?? 18;
}
