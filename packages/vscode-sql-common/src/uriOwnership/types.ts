/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

/**
 * API exposed by SQL extensions for URI ownership coordination.
 * This allows extensions to query whether another extension "owns" a document
 * (i.e., has an active connection to it).
 */
export interface UriOwnershipApi {
    /**
     * Checks if this extension currently owns the given URI.
     * A URI is considered "owned" if the extension has an active or pending connection to it.
     * @param uri The URI to check ownership for
     * @returns true if this extension owns the URI, false otherwise
     */
    ownsUri(uri: vscode.Uri): boolean;

    /**
     * Event that fires when URI ownership changes.
     * This is fired when the extension connects to or disconnects from a document.
     */
    onDidChangeUriOwnership: vscode.Event<void>;
}

/**
 * Information about a coordinating SQL extension discovered via package.json.
 */
export interface CoordinatingExtensionInfo {
    /**
     * The unique extension identifier (e.g., "ms-mssql.mssql")
     */
    extensionId: string;

    /**
     * Human-readable display name for the extension (e.g., "SQL Server (MSSQL)")
     */
    displayName: string;
}

/**
 * Configuration for initializing the UriOwnershipCoordinator.
 *
 * Supports two modes:
 * 1. **Immediate mode**: Provide all callbacks directly if they're available at construction time
 * 2. **Deferred mode**: Provide a `getConfig` function that returns the full config later
 *
 * Use deferred mode when the connection manager or other dependencies aren't available
 * at extension activation time. Call `coordinator.initialize()` once dependencies are ready.
 */
export interface UriOwnershipConfig {
    /**
     * The VS Code context key to set when the active editor's URI is owned by another extension.
     * When true, this extension should hide its UI elements for that editor.
     * (e.g., "mssql.hideUIElements" or "pgsql.hideUIElements")
     */
    hideUiContextKey: string;

    /**
     * Function that checks if this extension currently owns the given URI.
     * @param uri The URI to check (as a string with skipEncoding=true)
     * @returns true if this extension owns the URI
     */
    ownsUri?: (uri: string) => boolean;

    /**
     * Event that fires when this extension's URI ownership changes.
     * (e.g., when a connection is established or disconnected)
     */
    onDidChangeOwnership?: vscode.Event<void>;

    /**
     * Optional callback to release/disconnect ownership of a URI.
     * Called automatically when another coordinating extension takes ownership of a URI
     * that this extension is currently connected to.
     *
     * This handles the race condition where both extensions connect to the same URI:
     * - Without this: Both extensions hide UI, user sees nothing
     * - With this: The extension that connected first yields to the other, ensuring only one is active
     *
     * @param uri The URI to release ownership of (as a string with skipEncoding=true)
     */
    releaseUri?: (uri: string) => void | Promise<void>;
}

/**
 * Deferred configuration callbacks provided during initialize().
 */
export interface UriOwnershipDeferredConfig {
    /**
     * Function that checks if this extension currently owns the given URI.
     * @param uri The URI to check (as a string with skipEncoding=true)
     * @returns true if this extension owns the URI
     */
    ownsUri: (uri: string) => boolean;

    /**
     * Event that fires when this extension's URI ownership changes.
     * (e.g., when a connection is established or disconnected)
     */
    onDidChangeOwnership: vscode.Event<void>;

    /**
     * Optional callback to release/disconnect ownership of a URI.
     */
    releaseUri?: (uri: string) => void | Promise<void>;
}

/**
 * The value of the vscode-sql-common-features contribution in package.json.
 *
 * Example in package.json:
 * ```json
 * {
 *   "displayName": "SQL Server (mssql)",
 *   "contributes": {
 *     "vscode-sql-common-features": {
 *       "uriOwnershipApi": true
 *     }
 *   }
 * }
 * ```
 */
export interface SqlExtensionCommonFeaturesContribution {
    /**
     * Whether this extension exposes the UriOwnershipApi for coordination.
     */
    uriOwnershipApi?: boolean;
}
