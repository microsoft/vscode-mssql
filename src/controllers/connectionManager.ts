'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import * as Contracts from '../models/contracts';
import Utils = require('../models/utils');
import Interfaces = require('../models/interfaces');
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import Telemetry from '../models/telemetry';
import VscodeWrapper from './vscodeWrapper';

// Information for a document's connection
class ConnectionInfo {
    // Connection GUID returned from the service host
    public connectionId: string;

    // Credentials used to connect
    public credentials: Interfaces.IConnectionCredentials;
}

// ConnectionManager class is the main controller for connection management
export default class ConnectionManager {
    private _client: SqlToolsServerClient;
    private _context: vscode.ExtensionContext;
    private _statusView: StatusView;
    private _prompter: IPrompter;
    private _connections: { [fileUri: string]: ConnectionInfo };
    private _connectionUI: ConnectionUI;
    private _vscodeWrapper: VscodeWrapper;

    constructor(context: vscode.ExtensionContext, statusView: StatusView, prompter: IPrompter, client?: SqlToolsServerClient) {
        this._context = context;
        this._statusView = statusView;
        this._prompter = prompter;
        this._connectionUI = new ConnectionUI(context, prompter);
        this._connections = {};

        if (typeof client === 'undefined') {
            this.client = SqlToolsServerClient.instance;
        } else {
            this.client = client;
        }

        this.vscodeWrapper = new VscodeWrapper();
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    private get client(): SqlToolsServerClient {
        return this._client;
    }

    private set client(client: SqlToolsServerClient) {
        this._client = client;
    }

    // Exposed for testing purposes
    public get client(): LanguageClient {
        return this._client;
    }

    private get connectionUI(): ConnectionUI {
        return this._connectionUI;
    }

    private get statusView(): StatusView {
        return this._statusView;
    }

    // Exposed for testing purposes
    public get connectionCount(): number {
        return Object.keys(this._connections).length;
    }

    public isConnected(fileUri: string): boolean {
        return (fileUri in this._connections);
    }

    // choose database to use on current server
    public onChooseDatabase(): void {
        const self = this;
        const fileUri = this.vscodeWrapper.activeTextEditorUri;

        if (!self.isConnected(fileUri)) {
            this.vscodeWrapper.showWarningMessage(Constants.msgChooseDatabaseNotConnected);
            return;
        }

        self.connectionUI.showDatabasesOnCurrentServer(self._connections[fileUri].credentials).then( newDatabaseCredentials => {
            if (typeof newDatabaseCredentials !== 'undefined') {
                self.disconnect(fileUri).then( () => {
                    self.connect(fileUri, newDatabaseCredentials);
                });
            }
        });
    }

    // close active connection, if any
    public onDisconnect(): Promise<boolean> {
        return this.disconnect(this.vscodeWrapper.activeTextEditorUri);
    }

    public disconnect(fileUri: string): Promise<boolean> {
        const self = this;

        return new Promise<boolean>((resolve, reject) => {
            if (self.isConnected(fileUri)) {
                let disconnectParams = new Contracts.DisconnectParams();
                disconnectParams.ownerUri = fileUri;

                self.client.sendRequest(Contracts.DisconnectRequest.type, disconnectParams).then((result) => {
                    self.statusView.notConnected(fileUri);
                    delete self._connections[fileUri];

                    resolve(result);
                });
            }
            resolve(true);
        });
    }

    // let users pick from a picklist of connections
    public onNewConnection(): Promise<boolean> {
        const self = this;
        const fileUri = this.vscodeWrapper.activeTextEditorUri;

        if (fileUri === '') {
            // A text document needs to be open before we can connect
            this.vscodeWrapper.showInformationMessage(Constants.msgOpenSqlFile);
        }

        return new Promise<boolean>((resolve, reject) => {
            // show connection picklist
            self.connectionUI.showConnections()
            .then(function(connectionCreds): void {
                if (connectionCreds) {
                    // close active connection
                    self.disconnect(fileUri).then(function(): void {
                        // connect to the server/database
                        self.connect(fileUri, connectionCreds)
                        .then(function(): void {
                            resolve(true);
                        });
                    });
                }
            });
        });
    }

    // create a new connection with the connectionCreds provided
    public connect(fileUri: string, connectionCreds: Interfaces.IConnectionCredentials): Promise<boolean> {
        const self = this;

        return new Promise<boolean>((resolve, reject) => {
            let extensionTimer = new Utils.Timer();

            self.statusView.connecting(fileUri, connectionCreds);

            // package connection details for request message
            let connectionDetails = new Contracts.ConnectionDetails();
            connectionDetails.userName = connectionCreds.user;
            connectionDetails.password = connectionCreds.password;
            connectionDetails.serverName = connectionCreds.server;
            connectionDetails.databaseName = connectionCreds.database;

            let connectParams = new Contracts.ConnectParams();
            connectParams.ownerUri = fileUri;
            connectParams.connection = connectionDetails;

            let serviceTimer = new Utils.Timer();

            // send connection request message to service host
            self.client.sendRequest(Contracts.ConnectionRequest.type, connectParams).then((result) => {
                // handle connection complete callback
                serviceTimer.end();

                if (result.connectionId && result.connectionId !== '') {
                    // We have a valid connection
                    let connection = new ConnectionInfo();
                    connection.connectionId = result.connectionId;
                    connection.credentials = connectionCreds;
                    self._connections[fileUri] = connection;

                    self.statusView.connectSuccess(fileUri, connectionCreds);

                    extensionTimer.end();

                    Telemetry.sendTelemetryEvent(self._context, 'DatabaseConnected', {}, {
                        extensionConnectionTime: extensionTimer.getDuration() - serviceTimer.getDuration(),
                        serviceConnectionTime: serviceTimer.getDuration()
                    });

                    resolve(true);
                } else {
                    Utils.showErrorMsg(Constants.msgError + Constants.msgConnectionError);
                    self.statusView.connectError(fileUri, connectionCreds, result.messages);
                    self.connectionUI.showConnectionErrors(result.messages);

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
