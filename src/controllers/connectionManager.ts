'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import Utils = require('../models/utils');
import Interfaces = require('../models/interfaces');
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';

const mssql = require('mssql');

export default class ConnectionManager {
    private _context: vscode.ExtensionContext;
    private _statusView: StatusView;
    private _connection;
    private _connectionCreds: Interfaces.IConnectionCredentials;
    private _connectionUI: ConnectionUI;

    constructor(context: vscode.ExtensionContext, statusView: StatusView) {
        this._context = context;
        this._statusView = statusView;
        this._connectionUI = new ConnectionUI();
    }

    get connectionCredentials(): Interfaces.IConnectionCredentials {
        return this._connectionCreds;
    }

    get connection(): any {
        return this._connection;
    }

    private get connectionUI(): ConnectionUI {
        return this._connectionUI;
    }

    private get statusView(): StatusView {
        return this._statusView;
    }

    get isConnected(): boolean {
        return this._connection && this._connection.connected;
    }

    // close active connection, if any
    public onDisconnect(): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            if (this.isConnected) {
                this._connection.close();
            }

            this._connection = undefined;
            this._connectionCreds = undefined;
            this.statusView.notConnected();
            resolve(true);
        });
    }

    // let users pick from a picklist of connections
    public onNewConnection(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            // show connection picklist
            self.connectionUI.showConnections()
            .then(function(connectionCreds): void {
                // close active connection
                self.onDisconnect().then(function(): void {
                    // connect to the server/database
                    self.connect(connectionCreds)
                    .then(function(): void {
                        resolve(true);
                    });
                });
            });
        });
    }

    // create a new connection with the connectionCreds provided
    public connect(connectionCreds: Interfaces.IConnectionCredentials): Promise<any> {
        const self = this;
        return new Promise<any>((resolve, reject) => {
            const connection = new mssql.Connection(connectionCreds);
            self.statusView.connecting(connectionCreds);
            connection.connect()
            .then(function(): void {
                self._connectionCreds = connectionCreds;
                self._connection = connection;
                self.statusView.connectSuccess(connectionCreds);
                resolve();
            })
            .catch(function(err): void {
                self.statusView.connectError(connectionCreds, err);
                Utils.showErrorMsg(Constants.msgError + err);
                reject(err);
            });
        });
    }
}
