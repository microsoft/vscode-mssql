/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    UriOwnershipApi,
    UriOwnershipConfig,
    UriOwnershipDeferredConfig,
    CoordinatingExtensionInfo,
} from "./types";
import { SET_CONTEXT_COMMAND } from "./constants";
import { discoverCoordinatingExtensions, getExtensionDisplayName } from "./discovery";

/**
 * Coordinates URI ownership between multiple SQL extensions.
 *
 * This class handles:
 * 1. Exposing an API for other extensions to query if this extension owns a URI
 * 2. Discovering other SQL extensions that declare coordination capabilities
 * 3. Listening for ownership changes from coordinating extensions
 * 4. Setting VS Code context keys to hide/show UI elements appropriately
 * 5. Automatically releasing URIs when another extension takes ownership (via `releaseUri` callback)
 *
 * ## Deferred Initialization
 *
 * If your connection manager isn't available at construction time, you can use deferred initialization:
 *
 * ```typescript
 * // Create coordinator early (API is immediately available)
 * const coordinator = new UriOwnershipCoordinator(context, {
 *   hideUiContextKey: "mssql.hideUIElements",
 * });
 *
 * // Export API immediately
 * return { uriOwnershipApi: coordinator.uriOwnershipApi };
 *
 * // Later, after connection manager is ready:
 * coordinator.initialize({
 *   ownsUri: (uri) => connectionManager.isConnected(uri),
 *   onDidChangeOwnership: connectionManager.onConnectionsChanged,
 *   releaseUri: (uri) => connectionManager.disconnect(uri),
 * });
 * ```
 *
 * ## Race Condition Bug Fix
 *
 * **Problem:** When both extensions connect to the same URI, both hide their UI.
 *
 * **Scenario:** User is connected to MSSQL, then runs "PGSQL: New Query"
 *
 * 1. PostgreSQL creates a new SQL document
 * 2. MSSQL's onDidOpenTextDocument fires and auto-connects (using last active connection)
 * 3. PostgreSQL shows its connection picker, user selects a PostgreSQL connection
 * 4. PostgreSQL connects to the document
 * 5. Now BOTH extensions are connected to the same URI!
 *
 * **Without fix:**
 * - MSSQL sees PostgreSQL owns the URI → sets mssql.hideUIElements = true → hides MSSQL UI
 * - PostgreSQL sees MSSQL owns the URI → sets pgsql.hideUIElements = true → hides PostgreSQL UI
 * - Result: BOTH extensions hide their UI, user sees nothing!
 *
 * **Solution:** Provide a `releaseUri` callback in the config. When another extension takes
 * ownership of a URI that this extension is also connected to, the coordinator automatically
 * calls `releaseUri` to disconnect, yielding ownership to the other extension.
 *
 * ## Immediate Usage (when connection manager is available)
 *
 * ```typescript
 * const coordinator = new UriOwnershipCoordinator(context, {
 *   hideUiContextKey: "mssql.hideUIElements",
 *   ownsUri: (uri) => connectionManager.isConnected(uri) || connectionManager.isConnecting(uri),
 *   onDidChangeOwnership: connectionManager.onConnectionsChanged,
 *   releaseUri: (uri) => connectionManager.disconnect(uri),
 * });
 *
 * return { uriOwnershipApi: coordinator.uriOwnershipApi };
 * ```
 */
export class UriOwnershipCoordinator {
    /**
     * The API to expose to other extensions for ownership coordination.
     */
    public readonly uriOwnershipApi: UriOwnershipApi;

    /**
     * Event that fires when a coordinating extension's URI ownership changes.
     * Useful for CodeLens providers to refresh their lenses.
     */
    public readonly onCoordinatingOwnershipChanged: vscode.Event<void>;

    private readonly _context: vscode.ExtensionContext;
    private readonly _hideUiContextKey: string;
    private readonly _coordinatingExtensionApis: Map<string, UriOwnershipApi> = new Map();
    private readonly _coordinatingOwnershipChangedEmitter = new vscode.EventEmitter<void>();
    private readonly _uriOwnershipChangedEmitter = new vscode.EventEmitter<void>();

    private _coordinatingExtensions: CoordinatingExtensionInfo[] = [];
    private _ownsUri: ((uri: string) => boolean) | undefined;
    private _releaseUri: ((uri: string) => void | Promise<void>) | undefined;
    private _initialized = false;

    constructor(context: vscode.ExtensionContext, config: UriOwnershipConfig) {
        this._context = context;
        this._hideUiContextKey = config.hideUiContextKey;

        // Register emitters for disposal
        this._context.subscriptions.push(this._coordinatingOwnershipChangedEmitter);
        this._context.subscriptions.push(this._uriOwnershipChangedEmitter);

        // Set up the ownership API (works even before initialize)
        this.uriOwnershipApi = {
            ownsUri: (uri: vscode.Uri): boolean => {
                return this._ownsUri?.(uri.toString(true)) ?? false;
            },
            onDidChangeUriOwnership: this._uriOwnershipChangedEmitter.event,
        };

        this.onCoordinatingOwnershipChanged = this._coordinatingOwnershipChangedEmitter.event;

        // If config includes callbacks, initialize immediately
        if (config.ownsUri && config.onDidChangeOwnership) {
            this._initializeCallbacks({
                ownsUri: config.ownsUri,
                onDidChangeOwnership: config.onDidChangeOwnership,
                releaseUri: config.releaseUri,
            });
        }

        // Discover and register coordinating extensions
        this._discoverAndRegisterExtensions();
        this._registerActiveEditorListener();
        this._registerExtensionChangeListener();
    }

    /**
     * Initialize the coordinator with connection callbacks.
     * Call this when your connection manager becomes available.
     *
     * If callbacks were provided in the constructor, this method does nothing.
     *
     * @param config The deferred configuration with connection callbacks
     */
    public initialize(config: UriOwnershipDeferredConfig): void {
        if (this._initialized) {
            return;
        }
        this._initializeCallbacks(config);
    }

    private _initializeCallbacks(config: UriOwnershipDeferredConfig): void {
        if (this._initialized) {
            return;
        }

        this._ownsUri = config.ownsUri;
        this._releaseUri = config.releaseUri;
        this._initialized = true;

        // Subscribe to ownership changes to fire the public event
        this._context.subscriptions.push(
            config.onDidChangeOwnership(() => {
                this._uriOwnershipChangedEmitter.fire();
            }),
        );

        // Update context now that we can check ownership
        this._updateUriOwnershipContext();
    }

    /**
     * Gets the extension ID that owns the given URI, if any coordinating extension owns it.
     *
     * @param uri The URI to check
     * @returns The owning extension's ID, or undefined if no coordinating extension owns it
     */
    public getOwningCoordinatingExtension(uri: vscode.Uri): string | undefined {
        for (const [extensionId, api] of this._coordinatingExtensionApis.entries()) {
            if (api.ownsUri(uri)) {
                return extensionId;
            }
        }
        return undefined;
    }

    /**
     * Checks if a URI is owned by a coordinating extension.
     *
     * @param uri The URI to check
     * @returns true if owned by a coordinating extension, false otherwise
     */
    public isOwnedByCoordinatingExtension(uri: vscode.Uri): boolean {
        return this.getOwningCoordinatingExtension(uri) !== undefined;
    }

    /**
     * Checks if the active editor's URI is owned by a coordinating extension.
     * If so, shows an information message and returns true.
     *
     * Use this to guard commands that should not run on documents owned by other extensions.
     *
     * @param warningMessage Optional custom warning message. If not provided, a default message is used.
     * @returns true if the URI is owned by another extension (command should be blocked), false otherwise
     */
    public isActiveEditorOwnedByOtherExtensionWithWarning(warningMessage?: string): boolean {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        if (activeUri) {
            const owningExtensionId = this.getOwningCoordinatingExtension(activeUri);
            if (owningExtensionId) {
                const extensionName = getExtensionDisplayName(
                    owningExtensionId,
                    this._coordinatingExtensions,
                );
                const message =
                    warningMessage ||
                    `This file is connected to ${extensionName}. Please use ${extensionName} commands for this file.`;
                void vscode.window.showInformationMessage(message);
                return true;
            }
        }
        return false;
    }

    /**
     * Gets the list of discovered coordinating extensions.
     */
    public getCoordinatingExtensions(): ReadonlyArray<CoordinatingExtensionInfo> {
        return this._coordinatingExtensions;
    }

    // ==================== Private Methods ====================

    private _discoverAndRegisterExtensions(): void {
        this._coordinatingExtensions = discoverCoordinatingExtensions(this._context.extension.id);

        for (const extInfo of this._coordinatingExtensions) {
            const extension = vscode.extensions.getExtension(extInfo.extensionId);
            if (!extension) {
                continue;
            }

            if (!extension.isActive) {
                extension.activate().then(
                    (exports) => {
                        this._registerCoordinatingExtensionApi(extInfo.extensionId, exports);
                    },
                    (err) => {
                        console.error(
                            `[${this._context.extension.id}] Error activating coordinating extension ${extInfo.extensionId}: ${err}`,
                        );
                    },
                );
            } else {
                this._registerCoordinatingExtensionApi(extInfo.extensionId, extension.exports);
            }
        }
    }

    private _registerCoordinatingExtensionApi(extensionId: string, exports: unknown): void {
        const api = (exports as { uriOwnershipApi?: UriOwnershipApi })?.uriOwnershipApi;
        if (api) {
            this._coordinatingExtensionApis.set(extensionId, api);

            // Listen for URI ownership changes from the coordinating extension
            if (api.onDidChangeUriOwnership) {
                this._context.subscriptions.push(
                    api.onDidChangeUriOwnership(() => {
                        this._updateUriOwnershipContext();
                    }),
                );
            }
        }
    }

    private _registerActiveEditorListener(): void {
        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this._updateUriOwnershipContext();
            }),
        );

        // Set initial context based on current active editor
        this._updateUriOwnershipContext();
    }

    private _registerExtensionChangeListener(): void {
        // Handle extensions installed/uninstalled after activation
        this._context.subscriptions.push(
            vscode.extensions.onDidChange(() => {
                this._refreshCoordinatingExtensions();
            }),
        );
    }

    private _refreshCoordinatingExtensions(): void {
        const newExtensions = discoverCoordinatingExtensions(this._context.extension.id);

        // Find newly added extensions
        for (const extInfo of newExtensions) {
            if (!this._coordinatingExtensionApis.has(extInfo.extensionId)) {
                const extension = vscode.extensions.getExtension(extInfo.extensionId);
                if (extension?.isActive) {
                    this._registerCoordinatingExtensionApi(extInfo.extensionId, extension.exports);
                }
            }
        }

        this._coordinatingExtensions = newExtensions;
    }

    /**
     * Updates the VS Code context based on whether the current active editor's URI
     * is owned by a coordinating extension.
     *
     * Also handles the race condition where both extensions connect to the same URI:
     * If another extension owns a URI that we're also connected to, we automatically
     * release our connection to yield ownership.
     */
    private _updateUriOwnershipContext(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            void vscode.commands.executeCommand(
                SET_CONTEXT_COMMAND,
                this._hideUiContextKey,
                false,
            );
            return;
        }

        const uri = activeEditor.document.uri;
        const uriString = uri.toString(true);
        const isOwnedByOther = this.isOwnedByCoordinatingExtension(uri);
        const isOwnedBySelf = this._ownsUri?.(uriString) ?? false;

        /**
         * BUG FIX: Race condition when both extensions connect to the same URI
         *
         * Scenario: User is connected to MSSQL, then runs "PGSQL: New Query"
         *
         * 1. PostgreSQL creates a new SQL document
         * 2. MSSQL's onDidOpenTextDocument fires and auto-connects (using last active connection)
         * 3. PostgreSQL shows its connection picker, user selects a PostgreSQL connection
         * 4. PostgreSQL connects to the document
         * 5. Now BOTH extensions are connected to the same URI!
         *
         * Without this fix:
         * - MSSQL sees PostgreSQL owns the URI → sets mssql.hideUIElements = true → hides MSSQL UI
         * - PostgreSQL sees MSSQL owns the URI → sets pgsql.hideUIElements = true → hides PostgreSQL UI
         * - Result: BOTH extensions hide their UI, user sees nothing!
         *
         * With this fix:
         * - When we detect the other extension owns a URI that we're also connected to,
         *   we call releaseUri to disconnect ourselves and yield ownership to the other extension.
         * - This ensures only one extension is connected at a time, and only that extension shows its UI.
         */
        if (isOwnedByOther && isOwnedBySelf && this._releaseUri) {
            void Promise.resolve(this._releaseUri(uriString));
        }

        void vscode.commands.executeCommand(
            SET_CONTEXT_COMMAND,
            this._hideUiContextKey,
            isOwnedByOther,
        );

        // Notify listeners (e.g., CodeLens providers) that ownership may have changed
        this._coordinatingOwnershipChangedEmitter.fire();
    }
}
