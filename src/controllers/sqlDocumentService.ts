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
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import { sendActionEvent } from "../telemetry/telemetry";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { IConnectionProfile } from "../models/interfaces";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

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

    public get objectExplorerService(): ObjectExplorerService | undefined {
        return this._mainController?.objectEpxplorerProvider?.objectExplorerService;
    }

    public get objectExplorerTree(): vscode.TreeView<TreeNodeInfo> {
        return this._mainController?.objectExplorerTree;
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

    /**
     * Opens a new query and creates new connection. Connection precedence is:
     * 1. User right-clicked on an OE node and selected "New Query": use that node's connection profile
     * 2. User triggered "New Query" from command palette and the active document has a connection: copy that to the new document
     * 3. User triggered "New Query" from command palette while they have a connected OE node selected: use that node's connection profile
     * 4. User triggered "New Query" from command palette and there's no reasonable context: prompt for connection to use
     */
    public async handleNewQueryCommand(node?: TreeNodeInfo, content?: string): Promise<boolean> {
        if (!this._connectionMgr || !this._mainController) {
            return false;
        }

        let connectionCreds: vscodeMssql.IConnectionInfo | undefined;
        let connectionStrategy: ConnectionStrategy;
        let nodeType: string | undefined;

        if (node) {
            // Case 1: User right-clicked on an OE node and selected "New Query"
            connectionCreds = node.connectionProfile;
            nodeType = node.nodeType;
            connectionStrategy = ConnectionStrategy.CopyConnectionFromInfo;
        } else if (this._lastActiveConnectionInfo) {
            // Case 2: User triggered "New Query" from command palette and the active document has a connection
            connectionCreds = undefined;
            nodeType = "previousEditor";
            connectionStrategy = ConnectionStrategy.CopyLastActive;
        } else if (this.objectExplorerTree.selection?.length === 1) {
            // Case 3: User triggered "New Query" from command palette while they have a connected OE node selected
            connectionCreds = this.objectExplorerTree.selection[0].connectionProfile;
            nodeType = this.objectExplorerTree.selection[0].nodeType;
            connectionStrategy = ConnectionStrategy.CopyConnectionFromInfo;
        } else {
            connectionStrategy = ConnectionStrategy.PromptForConnection;
        }

        if (connectionCreds) {
            await this._connectionMgr.handlePasswordBasedCredentials(connectionCreds);
        }

        await this.newQuery({
            content,
            connectionStrategy: connectionStrategy,
            connectionInfo: connectionCreds,
        });

        await this._connectionMgr.connectionStore.removeRecentlyUsed(
            connectionCreds as IConnectionProfile,
        );

        sendActionEvent(
            TelemetryViews.CommandPalette,
            TelemetryActions.NewQuery,
            {
                nodeType: nodeType,
                isContainer: connectionCreds?.containerName ? "true" : "false",
            },
            undefined,
            connectionCreds as IConnectionProfile,
            this._connectionMgr.getServerInfo(connectionCreds),
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
    public async newQuery(options: NewQueryOptions = {}): Promise<vscode.TextEditor> {
        const operationKey = Utils.generateGuid();

        try {
            const newQueryPromise = this.createNewQueryDocument(options);
            this._ongoingCreates.set(operationKey, newQueryPromise);
            return await newQueryPromise;
        } finally {
            this._ongoingCreates.delete(operationKey);
        }
    }

    private async createNewQueryDocument(options: NewQueryOptions): Promise<vscode.TextEditor> {
        // Create the document
        const editor = await this.createDocument(options.content);

        // Resolve connection strategy and info
        const connectionConfig = await this.resolveConnectionConfig(options);

        const documentKey = getUriKey(editor.document.uri);

        // Establish connection if needed
        if (
            connectionConfig?.shouldConnect &&
            connectionConfig?.connectionInfo &&
            this._connectionMgr
        ) {
            const connectionPromise = new Deferred<boolean>();

            await this._connectionMgr.connect(
                documentKey,
                connectionConfig.connectionInfo,
                connectionPromise,
            );

            const connectionResult = await connectionPromise.promise;
            if (connectionResult) {
                /**
                 * Skip creating an Object Explorer session if one already exists for the connection.
                 */
                if (!this.objectExplorerService?.hasSession(connectionConfig.connectionInfo)) {
                    await this._mainController.createObjectExplorerSession(
                        connectionConfig.connectionInfo,
                    );
                }
            }
        }

        // Update status views
        this._statusview?.languageFlavorChanged(documentKey, Constants.mssqlProviderName);
        this._statusview?.sqlCmdModeChanged(documentKey, false);

        return editor;
    }

    private async resolveConnectionConfig(
        options: NewQueryOptions,
    ): Promise<ResolvedConnectionConfig> {
        const strategy = options.connectionStrategy ?? ConnectionStrategy.CopyLastActive;

        switch (strategy) {
            case ConnectionStrategy.DoNotConnect:
                return { shouldConnect: false };

            case ConnectionStrategy.CopyConnectionFromInfo:
                if (!options.connectionInfo) {
                    throw new Error(
                        "connectionInfo is required when using CopyConnectionFromInfo connection strategy",
                    );
                }
                return {
                    shouldConnect: true,
                    connectionInfo: Utils.deepClone(options.connectionInfo),
                };

            case ConnectionStrategy.CopyFromUri:
                if (!options.sourceUri) {
                    throw new Error(
                        "sourceUri is required when using CopyFromUri connection strategy",
                    );
                }

                if (!this._connectionMgr) {
                    throw new Error("Connection manager is not available");
                }

                const resolvedConnectionInfo = this._connectionMgr.getConnectionInfoFromUri(
                    options.sourceUri,
                );

                /**
                 * In case there is no connection info associated with the provided URI,
                 * we return shouldConnect: false as we don't want to fail but still
                 * show a new query editor without a connection. The user can then manually
                 * connect if they want to.
                 */
                return resolvedConnectionInfo
                    ? {
                          shouldConnect: true,
                          connectionInfo: Utils.deepClone(resolvedConnectionInfo),
                      }
                    : { shouldConnect: false };

            case ConnectionStrategy.CopyLastActive:
                /**
                 * In case there is no connection info associated with the last active document,
                 * we return shouldConnect: false as we don't want to fail but still
                 * show a new query editor without a connection. The user can then manually
                 * connect if they want to.
                 */
                return this._lastActiveConnectionInfo
                    ? {
                          shouldConnect: true,
                          connectionInfo: Utils.deepClone(this._lastActiveConnectionInfo),
                      }
                    : { shouldConnect: false };

            case ConnectionStrategy.PromptForConnection:
            default:
                const credentials = await this._connectionMgr.onNewConnection();
                return { shouldConnect: true, connectionInfo: Utils.deepClone(credentials) };
        }
    }

    private async createDocument(content?: string): Promise<vscode.TextEditor> {
        // Create and open the document
        const doc = await vscode.workspace.openTextDocument({
            language: "sql",
            content: content,
        });

        // Mark as owned immediately
        this._ownedDocuments.add(doc);

        // Show the document in editor
        const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            preview: false,
        });
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
 * Connection strategy for new SQL documents.
 */
export enum ConnectionStrategy {
    /**
     * No connection will be established.
     */
    DoNotConnect = "doNotConnect",
    /**
     * Copy connection from the last active document
     */
    CopyLastActive = "copyLastActive",
    /**
     * Copy connection from explicitly provided connection info
     */
    CopyConnectionFromInfo = "copyConnectionFromInfo",
    /**
     * Copy connection from another document identified by URI
     */
    CopyFromUri = "copyFromUri",
    /**
     * Prompt the user to select a connection
     */
    PromptForConnection = "promptForConnection",
}

/**
 * Options for creating a new SQL document.
 */
export type NewQueryOptions = {
    /**
     * Initial document content.
     */
    content?: string;

    /**
     * Connection strategy to use (default: CopyLastActive)
     */
    connectionStrategy?: ConnectionStrategy;

    /**
     * Connection info to use when connectionStrategy is CopyConnectionFromInfo
     */
    connectionInfo?: vscodeMssql.IConnectionInfo;

    /**
     * Source URI to use when connectionStrategy is CopyFromUri
     */
    sourceUri?: string;
};

/**
 * Internal type for resolved connection configuration
 */
interface ResolvedConnectionConfig {
    shouldConnect: boolean;
    connectionInfo?: vscodeMssql.IConnectionInfo;
}
