/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as events from 'events';
import vscode = require('vscode');
import Constants = require('../models/constants');
import Utils = require('../models/utils');
import { SqlOutputContentProvider } from '../models/SqlOutputContentProvider';
import StatusView from '../views/statusView';
import ConnectionManager from './connectionManager';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import CodeAdapter from '../prompts/adapter';
import Telemetry from '../models/telemetry';
import VscodeWrapper from './vscodeWrapper';
import { ISelectionData } from './../models/interfaces';
import * as path from 'path';
import fs = require('fs');

/**
 * The main controller class that initializes the extension
 */
export default class MainController implements vscode.Disposable {
    private _context: vscode.ExtensionContext;
    private _event: events.EventEmitter = new events.EventEmitter();
    private _outputContentProvider: SqlOutputContentProvider;
    private _statusview: StatusView;
    private _connectionMgr: ConnectionManager;
    private _prompter: IPrompter;
    private _vscodeWrapper: VscodeWrapper;
    private _initialized: boolean = false;
    private _lastSavedUri: string;
    private _lastSavedTimer: Utils.Timer;

    /**
     * The main controller constructor
     * @constructor
     */
    constructor(context: vscode.ExtensionContext,
                connectionManager?: ConnectionManager,
                vscodeWrapper?: VscodeWrapper) {
        this._context = context;
        if (connectionManager) {
            this._connectionMgr = connectionManager;
        }
        if (vscodeWrapper) {
            this._vscodeWrapper = vscodeWrapper;
        }
    }

    /**
     * Helper method to setup command registrations
     */
    private registerCommand(command: string): void {
        const self = this;
        this._context.subscriptions.push(vscode.commands.registerCommand(command, () => {
            self._event.emit(command);
        }));
    }

    /**
     * Disposes the controller
     */
    dispose(): void {
        this.deactivate();
    }

    /**
     * Deactivates the extension
     */
    public deactivate(): void {
        Utils.logDebug(Constants.extensionDeactivated);
        this.onDisconnect();
        this._statusview.dispose();
    }

    /**
     * Initializes the extension
     */
    public activate():  Promise<boolean> {
        const self = this;

        let activationTimer = new Utils.Timer();

        // register VS Code commands
        this.registerCommand(Constants.cmdConnect);
        this._event.on(Constants.cmdConnect, () => { self.runAndLogErrors(self.onNewConnection()); });
        this.registerCommand(Constants.cmdDisconnect);
        this._event.on(Constants.cmdDisconnect, () => { self.runAndLogErrors(self.onDisconnect()); });
        this.registerCommand(Constants.cmdRunQuery);
        this._event.on(Constants.cmdRunQuery, () => { self.onRunQuery(); });
        this.registerCommand(Constants.cmdManageConnectionProfiles);
        this._event.on(Constants.cmdManageConnectionProfiles, () => { self.runAndLogErrors(self.onManageProfiles()); });
        this.registerCommand(Constants.cmdChooseDatabase);
        this._event.on(Constants.cmdChooseDatabase, () => { self.onChooseDatabase(); } );
        this.registerCommand(Constants.cmdShowReleaseNotes);
        this._event.on(Constants.cmdShowReleaseNotes, () => { self.launchReleaseNotesPage(); } );

        this._vscodeWrapper = new VscodeWrapper();

        // Add handlers for VS Code generated commands
        this._vscodeWrapper.onDidCloseTextDocument(params => this.onDidCloseTextDocument(params));
        this._vscodeWrapper.onDidOpenTextDocument(params => this.onDidOpenTextDocument(params));
        this._vscodeWrapper.onDidSaveTextDocument(params => this.onDidSaveTextDocument(params));

        return this.initialize(activationTimer);
    }

    /**
     * Returns a flag indicating if the extension is initialized
     */
    public isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * Initializes the extension
     */
    public initialize(activationTimer: Utils.Timer): Promise<boolean> {
        const self = this;

        // initialize language service client
        return new Promise<boolean>( (resolve, reject) => {
                SqlToolsServerClient.instance.initialize(self._context).then(() => {

                // Init status bar
                self._statusview = new StatusView();

                // Init CodeAdapter for use when user response to questions is needed
                self._prompter = new CodeAdapter();

                // Init content provider for results pane
                self._outputContentProvider = new SqlOutputContentProvider(self._context, self._statusview);
                let registration = vscode.workspace.registerTextDocumentContentProvider(SqlOutputContentProvider.providerName, self._outputContentProvider);
                self._context.subscriptions.push(registration);

                // Init connection manager and connection MRU
                self._connectionMgr = new ConnectionManager(self._context, self._statusview, self._prompter);

                activationTimer.end();

                // telemetry for activation
                Telemetry.sendTelemetryEvent(self._context, 'ExtensionActivated', {},
                    { activationTime: activationTimer.getDuration() }
                );

                self.showReleaseNotesPrompt();

                Utils.logDebug(Constants.extensionActivated);
                self._initialized = true;
                resolve(true);
            });
        });
    }

    /**
     * Choose a new database from the current server
     */
    private onChooseDatabase(): Promise<boolean> {
        if (this.CanRunCommand()) {
            return this._connectionMgr.onChooseDatabase();
        }
    }

    /**
     * Close active connection, if any
     */
    private onDisconnect(): Promise<any> {
        if (this.CanRunCommand()) {
            return this._connectionMgr.onDisconnect();
        }
    }

    /**
     * Manage connection profiles (create, edit, remove).
     */
    private onManageProfiles(): Promise<boolean> {
        if (this.CanRunCommand()) {
            return this._connectionMgr.onManageProfiles();
        }
    }

    /**
     * Let users pick from a list of connections
     */
    public onNewConnection(): Promise<boolean> {
        if (this.CanRunCommand()) {
            return this._connectionMgr.onNewConnection();
        }
    }

    /**
     * get the T-SQL query from the editor, run it and show output
     */
    public onRunQuery(): void {
        if (!this.CanRunCommand()) {
            return;
        }
        const self = this;
        if (!this._vscodeWrapper.isEditingSqlFile) {
            // Prompt the user to change the language mode to SQL before running a query
            this._connectionMgr.connectionUI.promptToChangeLanguageMode().then( result => {
                if (result) {
                    self.onRunQuery();
                }
            }).catch(err => {
                self._vscodeWrapper.showErrorMessage(Constants.msgError + err);
            });
        } else if (!this._connectionMgr.isConnected(this._vscodeWrapper.activeTextEditorUri)) {
            // If we are disconnected, prompt the user to choose a connection before executing
            this.onNewConnection().then(result => {
                if (result) {
                    self.onRunQuery();
                }
            }).catch(err => {
                self._vscodeWrapper.showErrorMessage(Constants.msgError + err);
            });
        } else {
            let editor = this._vscodeWrapper.activeTextEditor;
            let uri = this._vscodeWrapper.activeTextEditorUri;
            let title = path.basename(editor.document.fileName);
            let querySelection: ISelectionData;

            // Calculate the selection if we have a selection, otherwise we'll use null to indicate
            // the entire document is the selection
            if (!editor.selection.isEmpty) {
                let selection = editor.selection;
                querySelection = {
                    startLine: selection.start.line,
                    startColumn: selection.start.character,
                    endLine: selection.end.line,
                    endColumn: selection.end.character
                };
            }

            // Trim down the selection. If it is empty after selecting, then we don't execute
            if (editor.document.getText(editor.selection).trim().length === 0) {
                return;
            }

            this._outputContentProvider.runQuery(this._statusview, uri, querySelection, title);
        }
    }

    /**
     * Executes a callback and logs any errors raised
     */
    private runAndLogErrors<T>(promise: Promise<T>): Promise<T> {
        let self = this;
        return promise.catch(err => {
            self._vscodeWrapper.showErrorMessage(Constants.msgError + err);
        });
    }

    /**
     * Access the connection manager for testing
     */
    public get connectionManager(): ConnectionManager {
        return this._connectionMgr;
    }

    /**
     * Verifies the extension is initilized and if not shows an error message
     */
    private CanRunCommand(): boolean {
        if (this._connectionMgr === undefined) {
            Utils.showErrorMsg(Constants.extensionNotInitializedError);
            return false;
        }
        return true;
    }

    /**
     * Prompt the user to view release notes if this is new extension install
     */
    private showReleaseNotesPrompt(): void {
        let self = this;
        if (!this.doesExtensionLaunchedFileExist()) {
            // ask the user to view a scenario document
            let confirmText = 'View Now';
            this._vscodeWrapper.showInformationMessage(
                    'View a walkthrough of common vscode-mssql scenarios?', confirmText)
                .then((choice) => {
                    if (choice === confirmText) {
                        self.launchReleaseNotesPage();
                    }
                });
        }
    }

    /**
     * Shows the release notes page in the preview browser
     */
    private launchReleaseNotesPage(): void {
        // get the URI for the release notes page
        let docUri = vscode.Uri.file(
            this._context.asAbsolutePath(
                'out/src/views/htmlcontent/src/docs/index.html'));

        // show the release notes page in the preview window
        vscode.commands.executeCommand(
            'vscode.previewHtml',
            docUri,
            vscode.ViewColumn.One,
            'vscode-mssql Release Notes');
    }

    /**
     * Check if the extension launched file exists.
     * This is to detect when we are running in a clean install scenario.
     */
    private doesExtensionLaunchedFileExist(): boolean {
        // check if file already exists on disk
        let filePath = this._context.asAbsolutePath('extensionlaunched.dat');
        try {
            // this will throw if the file does not exist
            fs.statSync(filePath);
            return true;
        } catch (err) {
            try {
                // write out the "first launch" file if it doesn't exist
                fs.writeFile(filePath, 'launched');
            } catch (err) {
                // ignore errors writing first launch file since there isn't really
                // anything we can do to recover in this situation.
            }
            return false;
        }
    }

    /**
     * Called by VS Code when a text document closes. This will dispatch calls to other
     * controllers as needed. Determines if this was a closed file or if it was an instance
     * where a file was saved to disk after being an untitled file.
     * @param doc The document that was closed
     */
    private onDidCloseTextDocument(doc: vscode.TextDocument): void {
        let closedDocumentUri: string = doc.uri.toString();
        let closedDocumentUriScheme: string = doc.uri.scheme;

        // Did we save a document before this close event? Was it an untitled document?
        if (this._lastSavedUri && this._lastSavedTimer && closedDocumentUriScheme === Constants.untitledScheme) {
            // Stop the save timer
            this._lastSavedTimer.end();

            // Check that we saved a document *just* before this close event
            // If so, then we saved an untitled document and need to update where necessary
            if (this._lastSavedTimer.getDuration() < Constants.untitledSaveTimeThreshold) {
                this._connectionMgr.onUntitledFileSaved(closedDocumentUri, this._lastSavedUri);
            }

            // Reset the save timer
            this._lastSavedTimer = undefined;
            this._lastSavedUri = undefined;
        } else {
            // Pass along the close event to the other handlers
            this._connectionMgr.onDidCloseTextDocument(doc);
            this._outputContentProvider.onDidCloseTextDocument(doc);
        }
    }

    /**
     * Called by VS Code when a text document is opened. Checks if a SQL file was opened
     * to enable features of our extension for the document.
     */
    private onDidOpenTextDocument(doc: vscode.TextDocument): void {
        this._connectionMgr.onDidOpenTextDocument(doc);
    }

    /**
     * Called by VS Code when a text document is saved. Will trigger a timer to
     * help determine if the file was a file saved from an untitled file.
     * @param doc The document that was saved
     */
    private onDidSaveTextDocument(doc: vscode.TextDocument): void {
        let savedDocumentUri: string = doc.uri.toString();

        // Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
        this._lastSavedTimer = new Utils.Timer();
        this._lastSavedTimer.start();
        this._lastSavedUri = savedDocumentUri;
    }
}
