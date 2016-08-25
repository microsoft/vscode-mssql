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

export default class MainController implements vscode.Disposable {
    private _context: vscode.ExtensionContext;
    private _event: events.EventEmitter = new events.EventEmitter();
    private _outputContentProvider: SqlOutputContentProvider;
    private _statusview: StatusView;
    private _connectionMgr: ConnectionManager;
    private _prompter: IPrompter;
    private _vscodeWrapper: VscodeWrapper;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    private registerCommand(command: string): void {
        const self = this;
        this._context.subscriptions.push(vscode.commands.registerCommand(command, () => {
            self._event.emit(command);
        }));
    }

    dispose(): void {
        this.deactivate();
    }

    public deactivate(): void {
        Utils.logDebug(Constants.extensionDeactivated);
        this.onDisconnect();
        this._statusview.dispose();
    }

    public activate(): void {
        const self = this;

        let activationTimer = new Utils.Timer();

        // register VS Code commands
        this.registerCommand(Constants.cmdConnect);
        this._event.on(Constants.cmdConnect, () => { self.onNewConnection(); });
        this.registerCommand(Constants.cmdDisconnect);
        this._event.on(Constants.cmdDisconnect, () => { self.onDisconnect(); });
        this.registerCommand(Constants.cmdRunQuery);
        this._event.on(Constants.cmdRunQuery, () => { self.onRunQuery(); });
        this.registerCommand(Constants.cmdCreateProfile);
        this._event.on(Constants.cmdCreateProfile, () => { self.onCreateProfile(); });
        this.registerCommand(Constants.cmdRemoveProfile);
        this._event.on(Constants.cmdRemoveProfile, () => { self.onRemoveProfile(); });
        this.registerCommand(Constants.cmdChooseDatabase);
        this._event.on(Constants.cmdChooseDatabase, () => { self.onChooseDatabase(); } );

        this._vscodeWrapper = new VscodeWrapper();

        // initialize language service client
        SqlToolsServerClient.instance.initialize(this._context);

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
    }

    // Choose a new database from the current server
    private onChooseDatabase(): Promise<boolean> {
        return this._connectionMgr.onChooseDatabase();
    }

    // Close active connection, if any
    private onDisconnect(): Promise<any> {
        return this._connectionMgr.onDisconnect();
    }

    // Let users pick from a list of connections
    public onNewConnection(): Promise<boolean> {
        return this._connectionMgr.onNewConnection();
    }

    // get the T-SQL query from the editor, run it and show output
    public onRunQuery(): void {
        if (!Utils.isEditingSqlFile()) {
            Utils.showWarnMsg(Constants.msgOpenSqlFile);
        } else {
            let editor = this._vscodeWrapper.activeTextEditor;
            let uri = this._vscodeWrapper.activeTextEditorUri;
            let title = editor.document.fileName;
            let queryText: string;

            if (editor.selection.isEmpty) {
                queryText = editor.document.getText();
            } else {
                queryText = editor.document.getText(new vscode.Range(editor.selection.start, editor.selection.end));
            }
            this._outputContentProvider.runQuery(this._connectionMgr, this._statusview, uri, queryText, title);
        }
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
     * Access the connection manager for testing
     */
    public get connectionManager(): ConnectionManager {
        return this._connectionMgr;
    }
}
