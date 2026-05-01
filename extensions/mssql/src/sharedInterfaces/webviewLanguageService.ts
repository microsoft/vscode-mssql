/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";

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
