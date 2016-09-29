'use strict';
import * as events from 'events';
import vscode = require('vscode');

import Constants = require('../models/constants');
import Utils = require('../models/utils');
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import StatusView from '../views/statusView';
import ConnectionManager from './connectionManager';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import CodeAdapter from '../prompts/adapter';
import Telemetry from '../models/telemetry';
import VscodeWrapper from './vscodeWrapper';
import { ISelectionData } from './../models/interfaces';

export default class MainController implements vscode.Disposable {
    // MEMBER VARIABLES ////////////////////////////////////////////////////

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

    // CONSTRUCTOR /////////////////////////////////////////////////////////
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

    // PROPERTIES //////////////////////////////////////////////////////////

    /**
     * Access the connection manager for testing
     */
    public get connectionManager(): ConnectionManager {
        return this._connectionMgr;
    }

    // PUBLIC METHODS //////////////////////////////////////////////////////

    public deactivate(): void {
        Utils.logDebug(Constants.extensionDeactivated);
        this.onDisconnect();
        this._statusview.dispose();
    }

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
        this.registerCommand(Constants.cmdCancelQuery);
        this._event.on(Constants.cmdCancelQuery, self.onRunQuery);
        this.registerCommand(Constants.cmdCreateProfile);
        this._event.on(Constants.cmdCreateProfile, () => { self.runAndLogErrors(self.onCreateProfile()); });
        this.registerCommand(Constants.cmdRemoveProfile);
        this._event.on(Constants.cmdRemoveProfile, () => { self.runAndLogErrors(self.onRemoveProfile()); });
        this.registerCommand(Constants.cmdChooseDatabase);
        this._event.on(Constants.cmdChooseDatabase, () => { self.onChooseDatabase(); } );
        this.registerCommand(Constants.cmdOpenConnectionSettings);
        this._event.on(Constants.cmdOpenConnectionSettings, () => { self.onOpenConnectionSettings(); } );

        this._vscodeWrapper = new VscodeWrapper();

        // Add handlers for VS Code generated commands
        this._vscodeWrapper.onDidCloseTextDocument(params => this.onDidCloseTextDocument(params));
        this._vscodeWrapper.onDidSaveTextDocument(params => this.onDidSaveTextDocument(params));

        return this.initialize(activationTimer);
    }

    public isInitialized(): boolean {
        return this._initialized;
    }

    public initialize(activationTimer: Utils.Timer): Promise<boolean> {
        // initialize language service client
        return new Promise<boolean>( (resolve, reject) => {
            SqlToolsServerClient.instance.initialize(this._context).then(() => {
                const self = this;
                // Init status bar
                this._statusview = new StatusView();

                // Init CodeAdapter for use when user response to questions is needed
                this._prompter = new CodeAdapter();

                // Init content provider for results pane
                this._outputContentProvider = new SqlOutputContentProvider(self._context, self._statusview);
                let registration = vscode.workspace.registerTextDocumentContentProvider(SqlOutputContentProvider.providerName, self._outputContentProvider);
                this._context.subscriptions.push(registration);

                // Init connection manager and connection MRU
                this._connectionMgr = new ConnectionManager(self._context, self._statusview, self._prompter);

                activationTimer.end();

                // telemetry for activation
                Telemetry.sendTelemetryEvent(this._context, 'ExtensionActivated', {},
                    { activationTime: activationTimer.getDuration() }
                );

                Utils.logDebug(Constants.extensionActivated);
                this._initialized = true;
                resolve(true);
            });
        });
    }

    // Choose a new database from the current server
    public onChooseDatabase(): Promise<boolean> {
        return this._connectionMgr.onChooseDatabase();
    }

    // Close active connection, if any
    public onDisconnect(): Promise<any> {
        return this._connectionMgr.onDisconnect();
    }

    // Let users pick from a list of connections
    public onNewConnection(): Promise<boolean> {
        return this._connectionMgr.onNewConnection();
    }

    // get the T-SQL query from the editor, run it and show output
    public onRunQuery(): void {
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
            let title = editor.document.fileName;
            let querySelection: ISelectionData;

            if (!editor.selection.isEmpty) {
                let selection = editor.selection;
                querySelection = {
                    startLine: selection.start.line,
                    startColumn: selection.start.character,
                    endLine: selection.end.line,
                    endColumn: selection.end.character
                };
            }
            this._outputContentProvider.runQuery(this._statusview, uri, querySelection, title);
        }
    }

    public onCancelQuery(): void {
        this._outputContentProvider.cancelQuery(this._vscodeWrapper.activeTextEditorUri);
    }

    // Prompts to create a new SQL connection profile
    public onCreateProfile(): Promise<boolean> {
        return this._connectionMgr.onCreateProfile();
    }

    // Prompts to remove a registered SQL connection profile
    public onRemoveProfile(): Promise<boolean> {
        return this._connectionMgr.onRemoveProfile();
    }

    /**
     * Opens the settings file where connection profiles are stored.
     */
    public onOpenConnectionSettings(): void {
        this._connectionMgr.connectionUI.openConnectionProfileConfigFile();
    }

    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
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
                // OutputContentProvider doesn't need to
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

    public onDidSaveTextDocument(doc: vscode.TextDocument): void {
        let savedDocumentUri: string = doc.uri.toString();

        // Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
        this._lastSavedTimer = new Utils.Timer();
        this._lastSavedTimer.start();
        this._lastSavedUri = savedDocumentUri;
    }

    public dispose(): void {
        this.deactivate();
    }

    // PRIVATE HELPERS /////////////////////////////////////////////////////
    private registerCommand(command: string): void {
        const self = this;
        this._context.subscriptions.push(vscode.commands.registerCommand(command, () => {
            self._event.emit(command);
        }));
    }

    private runAndLogErrors<T>(promise: Promise<T>): Promise<T> {
        let self = this;
        return promise.catch(err => {
            self._vscodeWrapper.showErrorMessage(Constants.msgError + err);
        });
    }
}
