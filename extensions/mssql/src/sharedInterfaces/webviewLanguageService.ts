/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";

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
