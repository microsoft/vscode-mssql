/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "./connectionManager";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import StatusView from "../views/statusView";
import store from "../queryResult/singletonStore";
import SqlToolsServerClient from "../languageservice/serviceclient";
import { getUriKey } from "../utils/utils";
import * as Utils from "../models/utils";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import MainController from "./mainController";

/**
 * Service for creating untitled documents for SQL query
 */
export default class SqlDocumentService implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];

    public skipCopyConnectionUris: Set<string> = new Set();
    private _ongoingCreates: Map<string, Promise<vscode.TextEditor>> = new Map();

    private _lastSavedUri: string | undefined;
    private _lastSavedTimer: Utils.Timer | undefined;
    private _lastOpenedUri: string | undefined;
    private _lastOpenedTimer: Utils.Timer | undefined;
    /**
     * Tracks the previous editor for the purposes of transferring connections to a newly-opened file.
     * Set to undefined if the previous editor is not a SQL file (languageId === mssql).
     */
    private _previousActiveDocument: vscode.TextDocument | undefined;

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
        if (this.skipCopyConnectionUris.has(closedDocumentUri)) {
            this.skipCopyConnectionUris.delete(closedDocumentUri);
        }
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
        const skipCopyConnection = this.shouldSkipCopyConnection(getUriKey(doc.uri));

        if (
            this._previousActiveDocument &&
            doc.languageId === Constants.languageId &&
            !skipCopyConnection
        ) {
            void this._connectionMgr.copyConnectionToFile(
                getUriKey(this._previousActiveDocument.uri),
                getUriKey(doc.uri),
                true /* keepOldConnected */,
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

            // pre-opened tabs won't trigger onDidChangeActiveTextEditor, so set _previousActiveEditor here
            this._previousActiveDocument =
                doc.languageId === Constants.languageId ? doc : undefined;
        }
    }

    public async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
        if (editor?.document) {
            this._previousActiveDocument =
                editor.document.languageId === Constants.languageId ? editor.document : undefined;
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

    /**
     * Wait for all ongoing create operations to complete
     */
    public async waitForOngoingCreates(): Promise<vscode.TextEditor[]> {
        const pendingPromises = Array.from(this._ongoingCreates.values());
        return Promise.all(pendingPromises);
    }

    /**
     * Creates new untitled document for SQL query and opens in new editor tab
     * with optional content
     */
    public async newQuery(
        content?: string,
        shouldCopyLastActiveConnection: boolean = false,
    ): Promise<vscode.TextEditor> {
        // Create a unique key for this operation to handle potential duplicates
        const operationKey = `${Date.now()}-${Math.random()}`;
        try {
            const newQueryPromise = new Promise<vscode.TextEditor>(async (resolve) => {
                const editor = await this.createDocument(content, shouldCopyLastActiveConnection);
                resolve(editor);
            });
            this._ongoingCreates.set(operationKey, newQueryPromise);

            return await newQueryPromise;
        } finally {
            // Clean up the pending operation
            this._ongoingCreates.delete(operationKey);
        }
    }

    private async createDocument(
        content?: string,
        shouldCopyLastActiveConnection?: boolean,
    ): Promise<vscode.TextEditor> {
        const doc = await vscode.workspace.openTextDocument({
            language: "sql",
            content: content,
        });

        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            preview: false,
        });

        if (!shouldCopyLastActiveConnection) {
            this.skipCopyConnectionUris.add(getUriKey(editor.document.uri));
        }

        return editor;
    }

    public shouldSkipCopyConnection(uri: string): boolean {
        return this.skipCopyConnectionUris.has(uri);
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
