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
import { removeUndefinedProperties, getUriKey } from "../utils/utils";
import * as Utils from "../models/utils";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import MainController from "./mainController";
import * as vscodeMssql from "vscode-mssql";
import { ObjectExplorerService } from "../objectExplorer/objectExplorerService";
import { sendActionEvent } from "../telemetry/telemetry";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { IConnectionProfile } from "../models/interfaces";

/**
 * Time to wait after opening a document to check if it's the
 * result of a save or rename operation. This is needed to avoid auto-connecting
 * a document that was just transferred an active connection.
 */
const waitTimeMsOnOpenAfterSaveOrRename = 500;

/**
 * Gets document signature based on language, line count and text content. This
 * is used to identify untitled documents that have been saved to disk.
 */
function getDocumentSignature(document: vscode.TextDocument): string {
    const maxLinesToCheck = 100; // Limit content length to avoid performance issues with very large documents
    return `${document.languageId} - ${document.lineCount} lines - ${document.getText(
        new vscode.Range(0, 0, Math.min(document.lineCount, maxLinesToCheck), 0),
    )}`;
}

/**
 * Service for creating untitled documents for SQL query
 */
export default class SqlDocumentService implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    // Track documents created by this service to avoid auto-connecting them on open.
    // WeakSet ensures entries are garbage collected with the documents.
    private _ownedDocuments: WeakSet<vscode.TextDocument> = new WeakSet();
    private _ongoingCreates: Map<string, Promise<vscode.TextEditor>> = new Map();
    private _uriBeingRenamedOrSaved: Set<string> = new Set();
    private _newUriFromRenameOrSave: Set<string> = new Set();

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
            vscode.workspace.onWillSaveTextDocument((event) => {
                event.waitUntil(this.onWillSaveTextDocument(event));
            }),
        );

        this._disposables.push(
            vscode.workspace.onWillRenameFiles((event) => {
                event.waitUntil(this.onWillRenameFiles(event));
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

        let connectionStrategy: ConnectionStrategy;
        let nodeType: string | undefined;
        let sourceNode: TreeNodeInfo | undefined;

        if (node) {
            // Case 1: User right-clicked on an OE node and selected "New Query"
            nodeType = node.nodeType;
            connectionStrategy = ConnectionStrategy.CopyConnectionFromInfo;
            sourceNode = node;
        } else if (this._lastActiveConnectionInfo) {
            // Case 2: User triggered "New Query" from command palette and the active document has a connection
            nodeType = "previousEditor";
            connectionStrategy = ConnectionStrategy.CopyLastActive;
        } else if (this.objectExplorerTree.selection?.length === 1) {
            // Case 3: User triggered "New Query" from command palette while they have a connected OE node selected
            sourceNode = this.objectExplorerTree.selection[0];
            nodeType = sourceNode.nodeType;
            connectionStrategy = ConnectionStrategy.CopyConnectionFromInfo;
        } else {
            // Case 4: User triggered "New Query" from command palette and there's no reasonable context
            connectionStrategy = ConnectionStrategy.PromptForConnection;
        }

        const connectionCreds = sourceNode?.connectionProfile;

        if (connectionCreds) {
            await this._connectionMgr.handlePasswordBasedCredentials(connectionCreds);
        }

        const newEditor = await this.newQuery({
            content,
            connectionStrategy: connectionStrategy,
            connectionInfo: connectionCreds,
        });

        if (sourceNode && connectionCreds) {
            // newQuery may refresh the Entra token, so update the OE node's connection profile
            sourceNode.updateEntraTokenInfo(connectionCreds);
        }

        const newEditorUri = getUriKey(newEditor.document.uri);

        const connectionResult = this._connectionMgr.getConnectionInfo(newEditorUri);

        // Only remove from MRU when we reused an explicit profile from OE context.
        if (connectionCreds) {
            await this._connectionMgr.connectionStore.removeRecentlyUsed(
                connectionCreds as IConnectionProfile,
            );
        }

        sendActionEvent(
            TelemetryViews.CommandPalette,
            TelemetryActions.NewQuery,
            {
                nodeType: nodeType,
                isContainer: connectionCreds?.containerName ? "true" : "false",
            },
            undefined,
            connectionCreds as IConnectionProfile,
            this._connectionMgr.getServerInfo(connectionResult?.credentials),
        );
    }

    dispose() {
        this._disposables.forEach((d) => d.dispose());
    }

    /**
     * Called by vscode when a text document is about to be saved.
     * We use this event to detect when an untitled document is being saved to disk, so that we can transfer connection
     * and query runner state to the new URI of the document after it's saved.
     * @param event The event representing the document that is about to be saved
     */
    public async onWillSaveTextDocument(event: vscode.TextDocumentWillSaveEvent): Promise<any> {
        const newDocumentSignature = getDocumentSignature(event.document);
        const untitledDocumentWithSameSignature = vscode.workspace.textDocuments.find(
            (doc) =>
                doc.uri.scheme === LocalizedConstants.untitledScheme &&
                getDocumentSignature(doc) === newDocumentSignature,
        );
        if (untitledDocumentWithSameSignature) {
            this._uriBeingRenamedOrSaved.add(getUriKey(untitledDocumentWithSameSignature.uri));
            this._newUriFromRenameOrSave.add(getUriKey(event.document.uri));
            await this.updateUri(
                getUriKey(untitledDocumentWithSameSignature.uri),
                getUriKey(event.document.uri),
            );
        }
    }

    /**
     * Called by vscode when files are about to be renamed. We use this event to transfer connection
     * and query runner state to the new URI of the document after it's renamed.
     */
    public async onWillRenameFiles(event: vscode.FileWillRenameEvent): Promise<any> {
        for (const file of event.files) {
            const oldUri = getUriKey(file.oldUri);
            const newUri = getUriKey(file.newUri);
            this._uriBeingRenamedOrSaved.add(oldUri);
            this._newUriFromRenameOrSave.add(newUri);
            await this.updateUri(oldUri, newUri);
        }
    }

    /**
     * Called by vscode when a text document is closed.
     * Handles cleaning up any state related to the closed document.
     * For renames and saves, the onWillRenameFiles and onWillSaveTextDocument listeners are fired first,
     * we ignore those uris in onDidCloseTextDocument to avoid cleaning up state for documents that are being renamed or saved.
     * @param doc The document that was closed
     */
    public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
        if (this._uriBeingRenamedOrSaved.has(getUriKey(doc.uri))) {
            /**
             * This document is being renamed or saved, so we ignore the close event
             * to avoid cleaning up state that will be needed after the rename/save
             */
            this._uriBeingRenamedOrSaved.delete(getUriKey(doc.uri));
            return;
        }

        if (this._connectionMgr === undefined || doc === undefined || doc.uri === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        let closedDocumentUri: string = getUriKey(doc.uri);

        // Pass along the close event to the other handlers.
        await this._outputContentProvider?.onDidCloseTextDocument(doc);
        await this._connectionMgr.onDidCloseTextDocument(doc);

        // Remove diagnostics for the related file
        let diagnostics = SqlToolsServerClient.instance.diagnosticCollection;
        if (diagnostics.has(doc.uri)) {
            diagnostics.delete(doc.uri);
        }

        // Delete filters and dimension states for the closed document
        store.deleteUriState(closedDocumentUri);
    }

    /**
     * Called by vscode when a text document is opened. Checks if a SQL file was opened
     * to enable features of our extension for the document.
     */
    public async onDidOpenTextDocument(doc: vscode.TextDocument): Promise<void> {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        this._connectionMgr.onDidOpenTextDocument(doc);
        const docUri = getUriKey(doc.uri);

        // Only SQL documents should run the rename/save open delay and auto-connect logic.
        if (doc.languageId !== Constants.languageId) {
            this._newUriFromRenameOrSave.delete(docUri);
            return;
        }

        // set encoding to false
        this._statusview?.languageFlavorChanged(docUri, Constants.mssqlProviderName);

        /**
         * Since there is no reliable way to detect if this open is a result of
         * untitled document being saved to disk or being renamed, we wait for
         * 0.5 seconds for those events to finish and check if open document is
         * the new saved/renamed document. If it is, we skip auto-connecting
         */
        await new Promise((resolve) => setTimeout(resolve, waitTimeMsOnOpenAfterSaveOrRename));
        if (this._newUriFromRenameOrSave.has(docUri)) {
            this._newUriFromRenameOrSave.delete(docUri);
            return;
        }

        await this.waitForOngoingCreates();

        // This becomes a no-op if the there is no last active connection.
        if (!this._lastActiveConnectionInfo) {
            return;
        }

        /**
         * If the document is connected now, beccause the user didn't waitForOngoingCreates
         * or other checks to complete we don't want to overwrite that connection by
         * auto-connecting. So we skip it.
         */
        if (
            !this._ownedDocuments.has(doc) &&
            !this._connectionMgr.isConnected(docUri) &&
            !this._connectionMgr.isConnecting(docUri)
        ) {
            await this._connectionMgr.connect(
                docUri,
                Utils.deepClone(this._lastActiveConnectionInfo),
            );
        }
    }

    /**
     * Updates the last active connection info when the active editor changes,
     * We use this info to determine connection info for new query editors to auto-connect to.
     * @param editor The new active text editor.
     */
    public async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
        this._statusview?.hideLastShownStatusBar(); // hide the last shown status bar since the active editor has changed

        if (!editor?.document) {
            return;
        }

        const activeDocumentUri = getUriKey(editor.document.uri);
        const connectionInfo = this._connectionMgr?.getConnectionInfo(activeDocumentUri);

        /**
         * Update the last active connection info only if:
         * 1. Active connection has been established (has connectionId), AND
         * 2. It's not still in the process of connecting (connecting is false)
         */
        if (connectionInfo?.connectionId && !connectionInfo?.connecting) {
            this._lastActiveConnectionInfo = Utils.deepClone(connectionInfo.credentials);
        }
        this._statusview?.updateStatusBarForEditor(editor, connectionInfo);
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
            const connectionResult = await this._connectionMgr.connect(
                documentKey,
                connectionConfig.connectionInfo,
            );

            if (connectionResult) {
                /**
                 * Skip creating an Object Explorer session if one already exists for the connection.
                 */
                if (!this.objectExplorerService?.hasSession(connectionConfig.connectionInfo)) {
                    await this._mainController.createObjectExplorerSession(
                        connectionConfig.connectionInfo,
                    );
                }

                if (options.connectionInfo && connectionConfig.connectionInfo) {
                    const tokenUpdates = removeUndefinedProperties({
                        azureAccountToken: connectionConfig.connectionInfo.azureAccountToken,
                        expiresOn: connectionConfig.connectionInfo.expiresOn,
                    });

                    if (Object.keys(tokenUpdates).length > 0) {
                        Object.assign(options.connectionInfo, tokenUpdates);
                    }
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
                const credentials = await this._connectionMgr.promptToConnect();
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

    /**
     * Handles updating the URI of a document when it is renamed or saved.
     * This includes transferring connection and query runner state to the new URI.
     * @param oldUri old URI of the document
     * @param newUri new URI of the document
     */
    private async updateUri(oldUri: string, newUri: string) {
        // Transfer the connection to the new URI
        await this._connectionMgr?.transferConnectionToFile(oldUri, newUri);

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
