'use strict';
import * as events from 'events';
import vscode = require('vscode');

import Constants = require('../models/constants');
import Utils = require('../models/utils');
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import StatusView from '../views/statusView';
import ConnectionManager from './connectionManager';
import QueryRunner from './queryRunner';

export default class MainController implements vscode.Disposable {
    private _context: vscode.ExtensionContext;
    private _event: events.EventEmitter = new events.EventEmitter();
    private _outputContentProvider: SqlOutputContentProvider;
    private _statusview: StatusView;
    private _connectionMgr: ConnectionManager;

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
        Utils.logDebug(Constants.gExtensionDeactivated);
        this.onDisconnect();
        this._statusview.dispose();
    }

    public activate(): void {
        const self = this;

        // register VS Code commands
        this.registerCommand(Constants.gCmdConnect);
        this._event.on(Constants.gCmdConnect, () => { self.onNewConnection(); });
        this.registerCommand(Constants.gCmdDisconnect);
        this._event.on(Constants.gCmdDisconnect, () => { self.onDisconnect(); });
        this.registerCommand(Constants.gCmdRunQuery);
        this._event.on(Constants.gCmdRunQuery, () => { self.onRunQuery(); });

        // Init status bar
        this._statusview = new StatusView();

        // Init connection manager and connection MRU
        this._connectionMgr = new ConnectionManager(self._context, self._statusview);

        // Init content provider for results pane
        this._outputContentProvider = new SqlOutputContentProvider(self._context);
        let registration = vscode.workspace.registerTextDocumentContentProvider(SqlOutputContentProvider.providerName, self._outputContentProvider);
        this._context.subscriptions.push(registration);

        Utils.logDebug(Constants.gExtensionActivated);
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
            Utils.showWarnMsg(Constants.gMsgOpenSqlFile);
        } else {
            const self = this;
            let qr = new QueryRunner(self._connectionMgr, self._statusview, self._outputContentProvider);
            qr.onRunQuery();
        }
    }
}
