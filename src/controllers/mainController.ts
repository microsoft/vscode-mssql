/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as events from 'events';
import vscode = require('vscode');
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import Utils = require('../models/utils');
import { SqlOutputContentProvider } from '../models/SqlOutputContentProvider';
import { RebuildIntelliSenseNotification } from '../models/contracts/languageService';
import StatusView from '../views/statusView';
import ConnectionManager from './connectionManager';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import CodeAdapter from '../prompts/adapter';
import Telemetry from '../models/telemetry';
import VscodeWrapper from './vscodeWrapper';
import UntitledSqlDocumentService from './untitledSqlDocumentService';
import { ISelectionData } from './../models/interfaces';
import * as path from 'path';
import fs = require('fs');

let opener = require('opener');

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
    private _lastOpenedUri: string;
    private _lastOpenedTimer: Utils.Timer;
    private _untitledSqlDocumentService: UntitledSqlDocumentService;

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
        this._vscodeWrapper = vscodeWrapper || new VscodeWrapper();

        this._untitledSqlDocumentService = new UntitledSqlDocumentService(this._vscodeWrapper);
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
        Utils.logDebug(LocalizedConstants.extensionDeactivated);
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
        this._event.on(Constants.cmdConnect, () => { self.runAndLogErrors(self.onNewConnection(), 'onNewConnection'); });
        this.registerCommand(Constants.cmdDisconnect);
        this._event.on(Constants.cmdDisconnect, () => { self.runAndLogErrors(self.onDisconnect(), 'onDisconnect'); });
        this.registerCommand(Constants.cmdRunQuery);
        this._event.on(Constants.cmdRunQuery, () => { self.onRunQuery(); });
        this.registerCommand(Constants.cmdManageConnectionProfiles);
        this._event.on(Constants.cmdManageConnectionProfiles, () => { self.runAndLogErrors(self.onManageProfiles(), 'onManageProfiles'); });
        this.registerCommand(Constants.cmdChooseDatabase);
        this._event.on(Constants.cmdChooseDatabase, () => { self.runAndLogErrors(self.onChooseDatabase(), 'onChooseDatabase') ; } );
        this.registerCommand(Constants.cmdCancelQuery);
        this._event.on(Constants.cmdCancelQuery, () => { self.onCancelQuery(); });
        this.registerCommand(Constants.cmdShowGettingStarted);
        this._event.on(Constants.cmdShowGettingStarted, () => { self.launchGettingStartedPage(); });
        this.registerCommand(Constants.cmdNewQuery);
        this._event.on(Constants.cmdNewQuery, () => { self.runAndLogErrors(self.onNewQuery(), 'onNewQuery'); });
        this.registerCommand(Constants.cmdRebuildIntelliSenseCache);
        this._event.on(Constants.cmdRebuildIntelliSenseCache, () => { self.onRebuildIntelliSense(); });

        // this._vscodeWrapper = new VscodeWrapper();

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
                // Initialize telemetry
                Telemetry.initialize(self._context);

                SqlToolsServerClient.instance.initialize(self._context).then(serverResult => {

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
                Telemetry.sendTelemetryEvent('ExtensionActivated', {},
                    { activationTime: activationTimer.getDuration(), serviceInstalled: serverResult.installedBeforeInitializing ? 1 : 0 }
                );

                self.showReleaseNotesPrompt();

                Utils.logDebug(LocalizedConstants.extensionActivated);
                self._initialized = true;
                resolve(true);
            }).catch(err => {
                Telemetry.sendTelemetryEventForException(err, 'initialize');
                reject(err);
            });
        });
    }

    /**
     * Handles the command to cancel queries
     */
    private onCancelQuery(): void {
        try {
            let uri = this._vscodeWrapper.activeTextEditorUri;
            Telemetry.sendTelemetryEvent('CancelQuery');
            this._outputContentProvider.cancelQuery(uri);
        } catch (err) {
            Telemetry.sendTelemetryEventForException(err, 'onCancelQuery');
        }
    }

    /**
     * Choose a new database from the current server
     */
    private onChooseDatabase(): Promise<boolean> {
        if (this.CanRunCommand()) {
            return this._connectionMgr.onChooseDatabase();
        }
        return Promise.resolve(false);
    }

    /**
     * Close active connection, if any
     */
    private onDisconnect(): Promise<any> {
        if (this.CanRunCommand()) {
            let fileUri = this._vscodeWrapper.activeTextEditorUri;
            let queryRunner = this._outputContentProvider.getQueryRunner(fileUri);
            if (queryRunner && queryRunner.isExecutingQuery) {
                this._outputContentProvider.cancelQuery(fileUri);
            }
            return this._connectionMgr.onDisconnect();
        }
        return Promise.resolve(false);
    }

    /**
     * Manage connection profiles (create, edit, remove).
     */
    private onManageProfiles(): Promise<boolean> {
        if (this.CanRunCommand()) {
            Telemetry.sendTelemetryEvent('ManageProfiles');
            return this._connectionMgr.onManageProfiles();
        }
        return Promise.resolve(false);
    }

    /**
     * Let users pick from a list of connections
     */
    public onNewConnection(): Promise<boolean> {
        if (this.CanRunCommand()) {
            return this._connectionMgr.onNewConnection();
        }
        return Promise.resolve(false);
    }

    /**
     * Clear and rebuild the IntelliSense cache
     */
    public onRebuildIntelliSense(): void {
        if (this.CanRunCommand()) {
            const fileUri = this._vscodeWrapper.activeTextEditorUri;
            if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
                this._statusview.languageServiceStatusChanged(fileUri, LocalizedConstants.updatingIntelliSenseStatus);
                SqlToolsServerClient.instance.sendNotification(RebuildIntelliSenseNotification.type, {
                    ownerUri: fileUri
                });
            } else {
                this._vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            }
        }
    }

    /**
     * get the T-SQL query from the editor, run it and show output
     */
    public onRunQuery(): void {
        try {
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
                    self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
                });
            } else if (!this._connectionMgr.isConnected(this._vscodeWrapper.activeTextEditorUri)) {
                // If we are disconnected, prompt the user to choose a connection before executing
                this.onNewConnection().then(result => {
                    if (result) {
                        self.onRunQuery();
                    }
                }).catch(err => {
                    self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
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
                let selectionToTrim = editor.selection.isEmpty ? undefined : editor.selection;
                if (editor.document.getText(selectionToTrim).trim().length === 0) {
                    return;
                }

                Telemetry.sendTelemetryEvent('RunQuery');

                this._outputContentProvider.runQuery(this._statusview, uri, querySelection, title);
            }
        } catch (err) {
            Telemetry.sendTelemetryEventForException(err, 'OnRunquery');
        }

    }

    /**
     * Executes a callback and logs any errors raised
     */
    private runAndLogErrors<T>(promise: Promise<T>, handlerName: string): Promise<T> {
        let self = this;
        return promise.catch(err => {
            self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
            Telemetry.sendTelemetryEventForException(err, handlerName);
        });
    }

    /**
     * Access the connection manager for testing
     */
    public get connectionManager(): ConnectionManager {
        return this._connectionMgr;
    }

    public set connectionManager(connectionManager: ConnectionManager) {
        this._connectionMgr = connectionManager;
    }

    public set untitledSqlDocumentService(untitledSqlDocumentService: UntitledSqlDocumentService) {
        this._untitledSqlDocumentService = untitledSqlDocumentService;
    }


    /**
     * Verifies the extension is initilized and if not shows an error message
     */
    private CanRunCommand(): boolean {
        if (this._connectionMgr === undefined) {
            Utils.showErrorMsg(LocalizedConstants.extensionNotInitializedError);
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
                    'View mssql for Visual Studio Code release notes?', confirmText)
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
        opener(Constants.changelogLink);
    }

     /**
      * Shows the Getting Started page in the preview browser
      */
    private launchGettingStartedPage(): void {
        opener(Constants.gettingStartedGuideLink);
    }

    /**
     * Opens a new query and creates new connection
     */
    public onNewQuery(): Promise<boolean> {
        if (this.CanRunCommand()) {
            return this._untitledSqlDocumentService.newQuery().then(x => {
                return this._connectionMgr.onNewConnection();
            });
        }
        return Promise.resolve(false);
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
     * controllers as needed. Determines if this was a normal closed file, a untitled closed file,
     * or a renamed file
     * @param doc The document that was closed
     */
    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        let closedDocumentUri: string = doc.uri.toString();
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
        if (this._lastSavedUri &&
                closedDocumentUriScheme === LocalizedConstants.untitledScheme &&
                this._lastSavedTimer.getDuration() < Constants.untitledSaveTimeThreshold) {
            // Untitled file was saved and connection will be transfered
            this._connectionMgr.transferFileConnection(closedDocumentUri, this._lastSavedUri);

        // If there was an openTextDoc event just before this closeTextDoc event then we know it was a rename
        } else if (this._lastOpenedUri &&
                this._lastOpenedTimer.getDuration() < Constants.renamedOpenTimeThreshold) {
            // File was renamed and connection will be transfered
            this._connectionMgr.transferFileConnection(closedDocumentUri, this._lastOpenedUri);

        } else {
            // Pass along the close event to the other handlers for a normal closed file
            this._connectionMgr.onDidCloseTextDocument(doc);
            this._outputContentProvider.onDidCloseTextDocument(doc);
        }


        // Reset special case timers and events
        this._lastSavedUri = undefined;
        this._lastSavedTimer = undefined;
        this._lastOpenedTimer = undefined;
        this._lastOpenedUri = undefined;
    }

    /**
     * Called by VS Code when a text document is opened. Checks if a SQL file was opened
     * to enable features of our extension for the document.
     */
    public onDidOpenTextDocument(doc: vscode.TextDocument): void {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        this._connectionMgr.onDidOpenTextDocument(doc);

        // Setup properties incase of rename
        this._lastOpenedTimer = new Utils.Timer();
        this._lastOpenedTimer.start();
        this._lastOpenedUri = doc.uri.toString();
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

        let savedDocumentUri: string = doc.uri.toString();

        // Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
        this._lastSavedTimer = new Utils.Timer();
        this._lastSavedTimer.start();
        this._lastSavedUri = savedDocumentUri;
    }
}
