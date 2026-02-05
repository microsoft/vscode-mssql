/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import MainController from "./controllers/mainController";
import ConnectionManager from "./controllers/connectionManager";
import * as locConstants from "./constants/locConstants";
import { getErrorMessage } from "./utils/utils";

/**
 * Friendly display names for coordinating extensions.
 */
const coordinatingExtensions: Record<string, string> = {
    "ms-ossdata.vscode-pgsql": "PostgreSQL",
};

/**
 * VS Code context key used to indicate when the active editor's URI is owned by another extension.
 * When true, MSSQL UI elements should be hidden for this editor.
 */
export const HIDE_UI_ELEMENTS_CONTEXT_VARIABLE = "mssql.hideUIElements";

/**
 * VS Code command to set context keys.
 */
export const SET_CONTEXT_COMMAND = "setContext";

export class UriOwnershipCoordinator {
    public uriOwnershipApi: vscodeMssql.UriOwnershipApi;
    private _connectionManager: ConnectionManager;
    private _coordinatingExtensionApis: Map<string, vscodeMssql.UriOwnershipApi> = new Map();
    private _coordinatingOwnershipChangedEmitter = new vscode.EventEmitter<void>();
    private _uriOwnershipChangedEmitter = new vscode.EventEmitter<void>();
    private _initialized = false;

    /**
     * Event that fires when a coordinating extension's URI ownership changes.
     * This can be used by CodeLens providers to refresh their lenses.
     */
    public readonly onCoordinatingOwnershipChanged: vscode.Event<void> =
        this._coordinatingOwnershipChangedEmitter.event;

    constructor(private _context: vscode.ExtensionContext) {
        this._context.subscriptions.push(this._coordinatingOwnershipChangedEmitter);
        this._context.subscriptions.push(this._uriOwnershipChangedEmitter);

        this.uriOwnershipApi = {
            ownsUri: (uri: vscode.Uri): boolean => {
                return this.isUriOwnedBySelf(uri);
            },
            onDidChangeUriOwnership: this._uriOwnershipChangedEmitter.event,
        };

        this.loadCoordinatingExtensionsApi();
        this.registerActiveEditorListener();
    }

    public initialize(mainController: MainController): void {
        if (this._initialized) {
            return;
        }
        this._connectionManager = mainController.connectionManager;
        this._initialized = true;

        // Subscribe to connection changes to fire ownership changed events
        this._context.subscriptions.push(
            this._connectionManager.onConnectionsChanged(() => {
                this._uriOwnershipChangedEmitter.fire();
            }),
        );
    }

    private isUriOwnedBySelf(uri: vscode.Uri): boolean {
        if (!this._connectionManager) {
            return false;
        }
        return (
            this._connectionManager.isConnected(uri.toString(true)) ||
            this._connectionManager.isConnecting(uri.toString(true))
        );
    }

    private loadCoordinatingExtensionsApi() {
        for (const extensionId of Object.keys(coordinatingExtensions)) {
            const extension = vscode.extensions.getExtension(extensionId);
            if (!extension) {
                continue;
            }
            if (!extension.isActive) {
                extension.activate().then(
                    (api) => {
                        this.registerCoordinatingExtensionApi(extensionId, api);
                    },
                    (err) => {
                        // Log error but continue
                        console.error(
                            `Error activating coordinating extension ${extensionId}: ${getErrorMessage(err)}`,
                        );
                    },
                );
            } else {
                this.registerCoordinatingExtensionApi(extensionId, extension.exports);
            }
        }
    }

    private registerCoordinatingExtensionApi(extensionId: string, exports: any) {
        const api = exports?.uriOwnershipApi as vscodeMssql.UriOwnershipApi;
        if (api) {
            this._coordinatingExtensionApis.set(extensionId, api);

            // Listen for URI ownership changes from the coordinating extension
            if (api.onDidChangeUriOwnership) {
                this._context.subscriptions.push(
                    api.onDidChangeUriOwnership(() => {
                        this.updateUriOwnershipContext();
                    }),
                );
            }
        }
    }

    /**
     * Registers a listener for active text editor changes to update the URI ownership context.
     */
    private registerActiveEditorListener(): void {
        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.updateUriOwnershipContext();
            }),
        );

        // Set initial context based on current active editor
        this.updateUriOwnershipContext();
    }

    /**
     * Updates the VS Code context based on whether the current active editor's URI
     * is owned by a coordinating extension.
     */
    private updateUriOwnershipContext(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            void vscode.commands.executeCommand(
                SET_CONTEXT_COMMAND,
                HIDE_UI_ELEMENTS_CONTEXT_VARIABLE,
                false,
            );
            return;
        }

        const uri = activeEditor.document.uri;
        const isOwnedByOther = this.isOwnedByCoordinatingExtension(uri);
        void vscode.commands.executeCommand(
            SET_CONTEXT_COMMAND,
            HIDE_UI_ELEMENTS_CONTEXT_VARIABLE,
            isOwnedByOther,
        );
        // Notify listeners (e.g., CodeLens providers) that ownership may have changed
        this._coordinatingOwnershipChangedEmitter.fire();
    }

    /**
     * Checks if a URI is owned by a coordinating extension.
     * @returns The extension ID if owned by a coordinating extension, undefined otherwise
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
     * @param uri The URI to check
     * @returns true if owned by a coordinating extension, false otherwise
     */
    public isOwnedByCoordinatingExtension(uri: vscode.Uri): boolean {
        return this.getOwningCoordinatingExtension(uri) !== undefined;
    }

    /**
     * Checks if the active editor's URI is owned by a coordinating extension.
     * If so, shows an information message and returns true.
     * @returns true if the URI is owned by another extension (command should be blocked), false otherwise
     */
    public isActiveEditorOwnedByOtherExtensionWithWarning(): boolean {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        if (activeUri) {
            const owningExtensionId = this.getOwningCoordinatingExtension(activeUri);
            if (owningExtensionId) {
                const extensionName =
                    coordinatingExtensions[owningExtensionId] || owningExtensionId;
                void vscode.window.showInformationMessage(
                    locConstants.Common.fileOwnedByOtherExtension(extensionName),
                );
                return true;
            }
        }
        return false;
    }
}
