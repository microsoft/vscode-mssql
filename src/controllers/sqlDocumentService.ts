/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager, { ConnectionSuccessfulEvent } from "./connectionManager";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import StatusView from "../views/statusView";
import store from "../queryResult/singletonStore";
import SqlToolsServerClient from "../languageservice/serviceclient";
import { getUriKey } from "../utils/utils";
import * as Utils from "../models/utils";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import MainController from "./mainController";
import * as vscodeMssql from "vscode-mssql";
import { Deferred } from "../protocol";
// no-op imports removed after execution flow simplification
/**
 * Service for creating untitled documents for SQL query
 */
export default class SqlDocumentService implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    // Track documents created by this service to avoid auto-connecting them on open.
    // WeakSet ensures entries are garbage collected with the documents.
    private _ownedDocuments: WeakSet<vscode.TextDocument> = new WeakSet();
    private _ongoingCreates: Map<string, Promise<vscode.TextEditor>> = new Map();

    private _lastSavedUri: string | undefined;
    private _lastSavedTimer: Utils.Timer | undefined;
    private _lastOpenedUri: string | undefined;
    private _lastOpenedTimer: Utils.Timer | undefined;

    private _lastActiveConnectionInfo: vscodeMssql.IConnectionInfo | undefined;

    private _connectionMgr: ConnectionManager | undefined;
    private _outputContentProvider: SqlOutputContentProvider | undefined;
    private _statusview: StatusView | undefined;

    constructor(private _mainController: MainController) {
        // In unit tests mocks may provide an undefined main controller; guard initialization.
        this._connectionMgr = this._mainController?.connectionManager;
        this._outputContentProvider = this._mainController?.outputContentProvider;
        this._statusview = this._mainController?.statusview;
        this.setupListeners();
    }

    private setupListeners(): void {
        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument(async (doc) => {
                await this.onDidCloseTextDocument(doc);
            }),
        );

        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument(async (doc) => {
                await this.onDidOpenTextDocument(doc);
            }),
        );

        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor(async (editor) => {
                await this.onDidChangeActiveTextEditor(editor);
            }),
        );

        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                this.onDidSaveTextDocument(doc);
            }),
        );

        if (this._connectionMgr) {
            this._disposables.push(
                this._connectionMgr.onSuccessfulConnection((params) =>
                    this.onSuccessfulConnection(params),
                ),
            );
        }
    }

    dispose() {
        this._disposables.forEach((d) => d.dispose());
    }

    /**
     * Called by VS Code when a text document closes. This will dispatch calls to other
     * controllers as needed. Determines if this was a normal closed file, a untitled closed file,
     * or a renamed file
     * @param doc The document that was closed
     */
    public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
        if (this._connectionMgr === undefined || doc === undefined || doc.uri === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        let closedDocumentUri: string = getUriKey(doc.uri);
        let closedDocumentUriScheme: string = doc.uri.scheme;

        // Stop timers if they have been started
        if (this._lastSavedTimer) {
            this._lastSavedTimer.end();
        }

        if (this._lastOpenedTimer) {
            this._lastOpenedTimer.end();
        }

        // Determine which event caused this close event

        // If there was a saveTextDoc event just before this closeTextDoc event and it
        // was untitled then we know it was an untitled save
        if (
            this._lastSavedUri &&
            closedDocumentUriScheme === LocalizedConstants.untitledScheme &&
            this._lastSavedTimer?.getDuration() < Constants.untitledSaveTimeThreshold
        ) {
            // Untitled file was saved and connection will be transfered
            await this.updateUri(closedDocumentUri, this._lastSavedUri);

            // If there was an openTextDoc event just before this closeTextDoc event then we know it was a rename
        } else if (
            this._lastOpenedUri &&
            this._lastSavedTimer?.getDuration() < Constants.untitledSaveTimeThreshold
        ) {
            await this.updateUri(closedDocumentUri, this._lastOpenedUri);
        } else {
            // Pass along the close event to the other handlers for a normal closed file
            await this._outputContentProvider?.onDidCloseTextDocument(doc);
            await this._connectionMgr.onDidCloseTextDocument(doc);
        }

        // Reset special case timers and events
        this._lastSavedUri = undefined;
        this._lastSavedTimer = undefined;
        this._lastOpenedTimer = undefined;
        this._lastOpenedUri = undefined;

        // Remove diagnostics for the related file
        let diagnostics = SqlToolsServerClient.instance.diagnosticCollection;
        if (diagnostics.has(doc.uri)) {
            diagnostics.delete(doc.uri);
        }

        // Delete filters and dimension states for the closed document
        store.deleteMainKey(closedDocumentUri);
    }

    /**
     * Called by VS Code when a text document is opened. Checks if a SQL file was opened
     * to enable features of our extension for the document.
     */
    public async onDidOpenTextDocument(doc: vscode.TextDocument): Promise<void> {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        this._connectionMgr.onDidOpenTextDocument(doc);

        await this.waitForOngoingCreates();

        if (
            this._lastActiveConnectionInfo &&
            doc.languageId === Constants.languageId &&
            !this._ownedDocuments.has(doc)
        ) {
            await this._connectionMgr.connect(
                getUriKey(doc.uri),
                Utils.deepClone(this._lastActiveConnectionInfo),
            );
        }

        if (doc && doc.languageId === Constants.languageId) {
            // set encoding to false
            this._statusview?.languageFlavorChanged(
                getUriKey(doc.uri),
                Constants.mssqlProviderName,
            );
        }

        // Setup properties incase of rename
        this._lastOpenedTimer = new Utils.Timer();
        this._lastOpenedTimer.start();

        if (doc && doc.uri) {
            this._lastOpenedUri = getUriKey(doc.uri);
        }
    }

    public async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor?.document) {
            return;
        }

        const activeDocumentUri = getUriKey(editor.document.uri);
        const activeConnection =
            await this._connectionMgr?.getConnectionInfoFromUri(activeDocumentUri);

        if (activeConnection) {
            this._lastActiveConnectionInfo = Utils.deepClone(activeConnection);
        }
    }

    /**
     * Called by VS Code when a text document is saved. Will trigger a timer to
     * help determine if the file was a file saved from an untitled file.
     * @param doc The document that was saved
     */
    public onDidSaveTextDocument(doc: vscode.TextDocument): void {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }

        // Set encoding to false by giving true as argument
        let savedDocumentUri: string = getUriKey(doc.uri);

        // Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
        this._lastSavedTimer = new Utils.Timer();
        this._lastSavedTimer.start();
        this._lastSavedUri = savedDocumentUri;
    }

    private async onSuccessfulConnection(params: ConnectionSuccessfulEvent): Promise<void> {
        const activeEditorKey = getUriKey(vscode.window.activeTextEditor?.document.uri);
        const credentials = params?.connection?.credentials;
        if (!credentials) {
            return;
        }
        /**
         * Update the last active connection info only if:
         *   1. The active editor matches the one that just connected, OR
         *   2. No previous connection info has been stored yet.
         *
         * This prevents overwriting the last active connection info with credentials
         * from a different editor than the one currently active.
         */
        if (activeEditorKey === params.fileUri || !this._lastActiveConnectionInfo) {
            this._lastActiveConnectionInfo = Utils.deepClone(credentials);
        }
    }

    /**
     * Wait for all ongoing create operations to complete
     */
    /**
     * Waits for any in-flight newQuery create operations to settle.
     * Does not throw if any creation failed.
     */
    public async waitForOngoingCreates(): Promise<void> {
        const pending = Array.from(this._ongoingCreates.values());
        if (pending.length === 0) {
            return;
        }
        await Promise.allSettled(pending);
    }

    /**
     * Creates a new untitled SQL document and shows it in an editor.
     * @param options Options for creating the new document
     * @returns The newly created text editor
     */
    public async newQuery(options: NewQueryOptions): Promise<vscode.TextEditor> {
        // Create a unique key for this operation to handle potential duplicates
        const operationKey = `${Date.now()}-${Math.random()}`;
        try {
            const newQueryPromise = new Promise<vscode.TextEditor>(async (resolve, reject) => {
                try {
                    const normalized: NewQueryOptions = options ?? {
                        copyLastActiveConnection: true,
                    };

                    // Resolve connection info from URI if requested
                    let resolvedConnectionInfo = normalized.connectionInfo;
                    let shouldCopyLastActive = normalized.copyLastActiveConnection ?? true;

                    if (
                        normalized.copyConnectionFromUri &&
                        !resolvedConnectionInfo &&
                        this._connectionMgr
                    ) {
                        resolvedConnectionInfo = this._connectionMgr.getConnectionInfoFromUri(
                            normalized.copyConnectionFromUri,
                        );
                        // If we got connection info from URI, don't copy last active connection
                        if (resolvedConnectionInfo) {
                            shouldCopyLastActive = false;
                        }
                    }

                    const editor = await this.createDocument(
                        shouldCopyLastActive,
                        normalized.content,
                        resolvedConnectionInfo,
                    );

                    const newDocumentUriKey = getUriKey(editor.document.uri);
                    this._statusview?.languageFlavorChanged(
                        newDocumentUriKey,
                        Constants.mssqlProviderName,
                    );
                    this._statusview?.sqlCmdModeChanged(newDocumentUriKey, false);
                    resolve(editor);
                } catch (err) {
                    reject(err);
                }
            });
            this._ongoingCreates.set(operationKey, newQueryPromise);

            return await newQueryPromise;
        } finally {
            // Clean up the pending operation
            this._ongoingCreates.delete(operationKey);
        }
    }

    private async createDocument(
        copyLastActiveConnection: boolean,
        content?: string,
        connectionInfo?: vscodeMssql.IConnectionInfo,
    ): Promise<vscode.TextEditor> {
        const doc = await vscode.workspace.openTextDocument({
            language: "sql",
            content: content,
        });
        // Mark as owned as soon as the document is created/opened to cover the
        // window where onDidOpenTextDocument may fire before showTextDocument resolves.
        this._ownedDocuments.add(doc);

        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            preview: false,
        });

        const newDocumentUriKey = getUriKey(editor.document.uri);
        const connectionCreationPromise = new Deferred<boolean>();
        if (copyLastActiveConnection && this._lastActiveConnectionInfo) {
            await this._connectionMgr?.connect(
                newDocumentUriKey,
                this._lastActiveConnectionInfo,
                connectionCreationPromise,
            );
        } else if (connectionInfo) {
            await this._connectionMgr?.connect(
                newDocumentUriKey,
                connectionInfo,
                connectionCreationPromise,
            );
        }
        await connectionCreationPromise.promise;
        return editor;
    }

    private async updateUri(oldUri: string, newUri: string) {
        // Transfer the connection to the new URI
        await this._connectionMgr?.copyConnectionToFile(oldUri, newUri);

        // Call STS  & Query Runner to update URI
        await this._outputContentProvider?.updateQueryRunnerUri(oldUri, newUri);

        // Update the URI in the output content provider query result map
        this._outputContentProvider?.onUntitledFileSaved(oldUri, newUri);
    }
}

/**
 * Options for creating a new SQL document.
 */
export type NewQueryOptions = {
    /** Initial document content. */
    content?: string;

    /**
     * When true, copies the last active connection (if any) to the new document.
     * Ignored if `connectionInfo` or `copyConnectionFromUri` is provided.
     */
    copyLastActiveConnection?: boolean;

    /** Explicit connection to apply to the new document. */
    connectionInfo?: vscodeMssql.IConnectionInfo;

    /**
     * When provided, copies the connection from the specified URI to the new document.
     * Takes precedence over `copyLastActiveConnection` but is ignored if `connectionInfo` is provided.
     */
    copyConnectionFromUri?: string;
};
