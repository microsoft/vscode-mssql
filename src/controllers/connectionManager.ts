'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import * as Contracts from '../models/contracts';
import Utils = require('../models/utils');
import Interfaces = require('../models/interfaces');
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { LanguageClient } from 'vscode-languageclient';
import { IPrompter } from '../prompts/question';
import Telemetry from '../models/telemetry';

// Information for a document's connection
class ConnectionInfo {
    // Connection GUID returned from the service host
    public connectionId: string;

    // Credentials used to connect
    public credentials: Interfaces.IConnectionCredentials;
}

// ConnectionManager class is the main controller for connection management
export default class ConnectionManager {
    private _context: vscode.ExtensionContext;
    private _statusView: StatusView;
    private _prompter: IPrompter;
    private _connections: { [fileName: string]: ConnectionInfo };
    private _connectionUI: ConnectionUI;

    constructor(context: vscode.ExtensionContext, statusView: StatusView, prompter: IPrompter) {
        this._context = context;
        this._statusView = statusView;
        this._prompter = prompter;
        this._connectionUI = new ConnectionUI(context, prompter);
        this._connections = {};
    }

    private get connectionUI(): ConnectionUI {
        return this._connectionUI;
    }

    private get statusView(): StatusView {
        return this._statusView;
    }

    public isConnected(fileName: string): boolean {
        return (fileName in this._connections);
    }

    // choose database to use on current server
    public onChooseDatabase(): void {
        const self = this;
        const fileName = self._connectionUI.activeFileUri;

        if (!self.isConnected(fileName)) {
            Utils.showWarnMsg(Constants.msgChooseDatabaseNotConnected);
            return;
        }

        self.connectionUI.showDatabasesOnCurrentServer(self._connections[fileName].credentials).then( newDatabaseCredentials => {
            if (typeof newDatabaseCredentials !== 'undefined') {
                self.disconnect(fileName).then( () => {
                    self.connect(fileName, newDatabaseCredentials);
                });
            }
        });
    }

    // close active connection, if any
    public onDisconnect(): Promise<any> {
        return this.disconnect(this._connectionUI.activeFileUri);
    }

    public disconnect(fileName: string): Promise<any> {
        const self = this;

        return new Promise<any>((resolve, reject) => {
            if (this.isConnected(fileName)) {
                let disconnectParams = new Contracts.DisconnectParams();
                disconnectParams.ownerUri = fileName;

                let client: LanguageClient = SqlToolsServerClient.getInstance().getClient();
                client.sendRequest(Contracts.DisconnectRequest.type, disconnectParams).then((result) => {
                    this.statusView.notConnected(fileName);
                    delete self._connections[fileName];

                    resolve(result);
                });
            }
            resolve(true);
        });
    }

    // let users pick from a picklist of connections
    public onNewConnection(): Promise<boolean> {
        const self = this;
        const fileName = self._connectionUI.activeFileUri;

        if (fileName === '') {
            // A text document needs to be open before we can connect
            Utils.showInfoMsg(Constants.msgOpenSqlFile);
        }

        return new Promise<boolean>((resolve, reject) => {
            // show connection picklist
            self.connectionUI.showConnections()
            .then(function(connectionCreds): void {
                // close active connection
                self.disconnect(fileName).then(function(): void {
                    // connect to the server/database
                    self.connect(fileName, connectionCreds)
                    .then(function(): void {
                        resolve(true);
                    });
                });
            });
        });
    }

    // create a new connection with the connectionCreds provided
    public connect(fileName: string, connectionCreds: Interfaces.IConnectionCredentials): Promise<any> {
        const self = this;

        return new Promise<any>((resolve, reject) => {
            let extensionTimer = new Utils.Timer();

            self.statusView.connecting(fileName, connectionCreds);

            // package connection details for request message
            let connectionDetails = new Contracts.ConnectionDetails();
            connectionDetails.userName = connectionCreds.user;
            connectionDetails.password = connectionCreds.password;
            connectionDetails.serverName = connectionCreds.server;
            connectionDetails.databaseName = connectionCreds.database;

            let connectParams = new Contracts.ConnectParams();
            connectParams.ownerUri = fileName;
            connectParams.connection = connectionDetails;

            let serviceTimer = new Utils.Timer();

            // send connection request message to service host
            let client: LanguageClient = SqlToolsServerClient.getInstance().getClient();
            client.sendRequest(Contracts.ConnectionRequest.type, connectParams).then((result) => {
                // handle connection complete callback
                serviceTimer.end();

                if (result.connectionId && result.connectionId !== '') {
                    // We have a valid connection
                    let connection = new ConnectionInfo();
                    connection.connectionId = result.connectionId;
                    connection.credentials = connectionCreds;
                    self._connections[fileName] = connection;

                    self.statusView.connectSuccess(fileName, connectionCreds);

                    extensionTimer.end();

                    Telemetry.sendTelemetryEvent(self._context, 'DatabaseConnected', {}, {
                        extensionConnectionTime: extensionTimer.getDuration() - serviceTimer.getDuration(),
                        serviceConnectionTime: serviceTimer.getDuration()
                    });

                    resolve();
                } else {
                    Utils.showErrorMsg(Constants.msgError + result.messages);
                    self.statusView.connectError(fileName, connectionCreds, result.messages);

                    reject();
                }
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
