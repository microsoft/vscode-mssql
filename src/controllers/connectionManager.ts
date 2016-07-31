'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import Utils = require('../models/utils');
import Interfaces = require('../models/interfaces');
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { LanguageClient, RequestType } from 'vscode-languageclient';
import { IPrompter } from '../prompts/question';

const mssql = require('mssql');

// Connection request message callback declaration
export namespace ConnectionRequest {
     export const type: RequestType<ConnectionDetails, ConnectionResult, void> = { get method(): string { return 'connection/connect'; } };
}

// Connention request message format
class ConnectionDetails {
    // server name
    public serverName: string;

    // database name
    public databaseName: string;

    // user name
    public userName: string;

    // unencrypted password
    public password: string;
}

// Connection response format
class ConnectionResult {
    // connection id returned from service host
    public connectionId: number;

    // any diagnostic messages return from the service host
    public messages: string;
}

// ConnectionManager class is the main controller for connection management
export default class ConnectionManager {
    private _context: vscode.ExtensionContext;
    private _statusView: StatusView;
    private _prompter: IPrompter;
    private _connection;
    private _connectionCreds: Interfaces.IConnectionCredentials;
    private _connectionUI: ConnectionUI;

    constructor(context: vscode.ExtensionContext, statusView: StatusView, prompter: IPrompter) {
        this._context = context;
        this._statusView = statusView;
        this._prompter = prompter;
        this._connectionUI = new ConnectionUI(context, prompter);
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
            // package connection details for request message
            let connectionDetails = new ConnectionDetails();
            connectionDetails.userName = connectionCreds.user;
            connectionDetails.password = connectionCreds.password;
            connectionDetails.serverName = connectionCreds.server;
            connectionDetails.databaseName = connectionCreds.database;

            // send connection request message to service host
            let client: LanguageClient = SqlToolsServerClient.getInstance().getClient();
            client.sendRequest(ConnectionRequest.type, connectionDetails).then((result) => {
                // handle connection complete callback
            });

            // legacy tedious connection until we fully move to service host
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

    public onCreateProfile(): Promise<boolean> {
        let self = this;
        return new Promise<any>((resolve, reject) => {
            self.connectionUI.createAndSaveProfile()
            .then(profile => {
                if (profile) {
                    resolve(true);
                } else {
                    resolve(false);
            }});
        });
    }

    public onRemoveProfile(): Promise<boolean> {
        return this.connectionUI.removeProfile();
    }
}
