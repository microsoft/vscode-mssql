'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import Utils = require('../models/utils');
import { RecentConnections } from '../models/recentConnections';
import Interfaces = require('../models/interfaces');
import { ConnectionUI } from '../views/connectionUI'
import StatusView from '../views/statusView';

var mssql = require('mssql');

export default class ConnectionManager
{
    private _context: vscode.ExtensionContext;
    private _statusView: StatusView;
    private _connection;
    private _connectionCreds: Interfaces.IConnectionCredentials;
    private _connectionUI: ConnectionUI;

    constructor(context: vscode.ExtensionContext, statusView: StatusView)
    {
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

    private get connectionUI() {
        return this._connectionUI;
    }

    private get statusView() {
        return this._statusView;
    }

    get isConnected() {
        return this._connection && this._connection.connected;
    }

    // close active connection, if any
    public onDisconnect()
    {
        return new Promise<any>((resolve, reject) =>
        {
            if(this.isConnected) {
                this._connection.close();
            }

            this._connection = null;
            this._connectionCreds = null;
            this.statusView.notConnected();
            resolve(true);
        });
    }

    // let users pick from a picklist of connections
    public onNewConnection()
    {
        const self = this;
        return new Promise<boolean>((resolve, reject) =>
        {
            // show connection picklist
            self.connectionUI.showConnections()
            .then(function(connectionCreds)
            {
                // close active connection
                self.onDisconnect().then(function()
                {
                    // connect to the server/database
                    self.connect(connectionCreds)
                    .then(function()
                    {
                        resolve(true);
                    });
                });
            });
        });
    }

    // create a new connection with the connectionCreds provided
    public connect(connectionCreds: Interfaces.IConnectionCredentials)
    {
        const self = this;
        return new Promise<any>((resolve, reject) =>
        {
            const connection = new mssql.Connection(connectionCreds);
            self.statusView.connecting(connectionCreds);
            connection.connect()
            .then(function() {
                self._connectionCreds = connectionCreds;
                self._connection = connection;
                self.statusView.connectSuccess(connectionCreds);
                resolve();
            })
            .catch(function(err) {
                self.statusView.connectError(connectionCreds, err);
                Utils.showErrorMsg(Constants.gMsgError + err);
                reject(err);
            });
        });
    }
}