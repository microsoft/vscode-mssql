'use strict';
import vscode = require('vscode');
import { ConnectionCredentials } from '../models/connectionCredentials';
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
import {NotificationHandler} from 'vscode-languageclient';

/**
 * Information for a document's connection. Exported for testing purposes.
 */
export class ConnectionInfo {
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
    private _connections: { [fileUri: string]: ConnectionInfo };
    private _connectionUI: ConnectionUI;

    constructor(context: vscode.ExtensionContext,
                statusView: StatusView,
                prompter: IPrompter,
                private _client?: SqlToolsServerClient,
                private _vscodeWrapper?: VscodeWrapper) {
        this._context = context;
        this._statusView = statusView;
        this._prompter = prompter;
        this._connections = {};

        if (!this.client) {
            this.client = SqlToolsServerClient.instance;
        }
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }

        this._connectionUI = new ConnectionUI(context, prompter, this.vscodeWrapper);

        this.client.onNotification(Contracts.ConnectionChangedNotification.type, this.handleConnectionChangedNotification());
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    /**
     * Exposed for testing purposes
     */
    public get client(): SqlToolsServerClient {
        return this._client;
    }

    /**
     * Exposed for testing purposes
     */
    public set client(client: SqlToolsServerClient) {
        this._client = client;
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

    /**
     * Exposed for testing purposes.
     */
    public getConnectionInfo(fileUri: string): ConnectionInfo {
        return this._connections[fileUri];
    }

    /**
     * Public for testing purposes only.
     */
    public handleConnectionChangedNotification(): NotificationHandler<Contracts.ConnectionChangedParams> {
        const self = this;
        return event => {
            if (self.isConnected(event.ownerUri)) {
                let connectionInfo: ConnectionInfo = self._connections[event.ownerUri];
                connectionInfo.credentials.server = event.connection.serverName;
                connectionInfo.credentials.database = event.connection.databaseName;
                connectionInfo.credentials.user = event.connection.userName;

                self._statusView.connectSuccess(event.ownerUri, connectionInfo.credentials);

                let logMessage = `Changed database context to \"${event.connection.databaseName}\" for document \"${event.ownerUri}\"`;
                self.vscodeWrapper.logToOutputChannel(logMessage);
            }
        };
    }

    // choose database to use on current server
    public onChooseDatabase(): Promise<boolean> {
        const self = this;
        const fileUri = this.vscodeWrapper.activeTextEditorUri;

        return new Promise<boolean>( (resolve, reject) => {
            if (!self.isConnected(fileUri)) {
                self.vscodeWrapper.showWarningMessage(Constants.msgChooseDatabaseNotConnected);
                resolve(false);
                return;
            }

            // Get list of databases on current server
            let listParams = new Contracts.ListDatabasesParams();
            listParams.ownerUri = fileUri;
            self.client.sendRequest(Contracts.ListDatabasesRequest.type, listParams).then( result => {
                // Then let the user select a new database to connect to
                self.connectionUI.showDatabasesOnCurrentServer(self._connections[fileUri].credentials, result.databaseNames).then( newDatabaseCredentials => {
                    if (newDatabaseCredentials) {
                        self.disconnect(fileUri).then( () => {
                            self.connect(fileUri, newDatabaseCredentials).then( () => {
                                resolve(true);
                            }).catch(err => {
                                reject(err);
                            });
                        }).catch(err => {
                            reject(err);
                        });
                    }
                }).catch(err => {
                    reject(err);
                });
            });
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

        return new Promise<boolean>((resolve, reject) => {
            if (!fileUri || !self.vscodeWrapper.isEditingSqlFile) {
                // A text document needs to be open before we can connect
                this.vscodeWrapper.showInformationMessage(Constants.msgOpenSqlFile);
                resolve(false);
                return;
            }

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
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCreds);
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
