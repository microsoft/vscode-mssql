'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import Utils = require('../models/utils');
import { RecentConnections } from '../models/recentConnections';
import Interfaces = require('../models/interfaces');
import { ConnectionUI } from '../views/connectionUI'
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient'
import { LanguageClient, RequestType, NotificationType } from 'vscode-languageclient';

var mssql = require('mssql');

export namespace ConnectionRequest {
     export const type: RequestType<ConnectionDetails, any, void> = { get method() { return 'connection/connect'; } };
}

class ConnectionDetails
{
    public serverName: string;

    public databaseName: string;

    public userName: string;

    public password: string;
}

class ConnectionResult
{
    public connectionId: number;

    public messages: string;
}

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
            var connectionDetails = new ConnectionDetails();
            connectionDetails.userName = connectionCreds.user
            connectionDetails.password = connectionCreds.password;
            connectionDetails.serverName = connectionCreds.server;
            connectionDetails.databaseName = connectionCreds.database;

            var client: LanguageClient = SqlToolsServerClient.getInstance().getClient();
            client.sendRequest(ConnectionRequest.type, connectionDetails).then((result) => {


            });

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