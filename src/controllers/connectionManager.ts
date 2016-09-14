'use strict';
import vscode = require('vscode');
import { ConnectionCredentials } from '../models/connectionCredentials';
import Constants = require('../models/constants');
import * as ConnectionContracts from '../models/contracts/connection';
import Utils = require('../models/utils');
import Interfaces = require('../models/interfaces');
import { ConnectionStore } from '../models/connectionStore';
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import Telemetry from '../models/telemetry';
import { Timer } from '../models/utils';
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

    /**
     * Information about the SQL Server instance.
     */
    public serverInfo: ConnectionContracts.ServerInfo;
}

// ConnectionManager class is the main controller for connection management
export default class ConnectionManager {
    private _context: vscode.ExtensionContext;
    private _statusView: StatusView;
    private _prompter: IPrompter;
    private _connections: { [fileUri: string]: ConnectionInfo };
    private _connectionUI: ConnectionUI;
    private _lastSavedUri: string;
    private _lastSavedTimer: Timer;

    constructor(context: vscode.ExtensionContext,
                statusView: StatusView,
                prompter: IPrompter,
                private _client?: SqlToolsServerClient,
                private _vscodeWrapper?: VscodeWrapper,
                private _connectionStore?: ConnectionStore) {
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

        if (!this._connectionStore) {
            this._connectionStore = new ConnectionStore(context);
        }

        this._connectionUI = new ConnectionUI(this._connectionStore, prompter, this.vscodeWrapper);

        this.vscodeWrapper.onDidCloseTextDocument(params => this.onDidCloseTextDocument(params));
        this.vscodeWrapper.onDidSaveTextDocument(params => this.onDidSaveTextDocument(params));

        if (this.client !== undefined) {
            this.client.onNotification(ConnectionContracts.ConnectionChangedNotification.type, this.handleConnectionChangedNotification());
        }
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

    /**
     * Get the connection view.
     */
    public get connectionUI(): ConnectionUI {
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
    public handleConnectionChangedNotification(): NotificationHandler<ConnectionContracts.ConnectionChangedParams> {
        // Using a lambda here to perform variable capture on the 'this' reference
        const self = this;
        return (event: ConnectionContracts.ConnectionChangedParams): void => {
            if (self.isConnected(event.ownerUri)) {
                let connectionInfo: ConnectionInfo = self._connections[event.ownerUri];
                connectionInfo.credentials.server = event.connection.serverName;
                connectionInfo.credentials.database = event.connection.databaseName;
                connectionInfo.credentials.user = event.connection.userName;

                self._statusView.connectSuccess(event.ownerUri, connectionInfo.credentials);

                let logMessage = Utils.formatString(Constants.msgChangedDatabaseContext, event.connection.databaseName, event.ownerUri);

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
            let listParams = new ConnectionContracts.ListDatabasesParams();
            listParams.ownerUri = fileUri;
            self.client.sendRequest(ConnectionContracts.ListDatabasesRequest.type, listParams).then( result => {
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
                let disconnectParams = new ConnectionContracts.DisconnectParams();
                disconnectParams.ownerUri = fileUri;

                self.client.sendRequest(ConnectionContracts.DisconnectRequest.type, disconnectParams).then((result) => {
                    self.statusView.notConnected(fileUri);
                    delete self._connections[fileUri];

                    resolve(result);
                });
            }
            resolve(true);
        });
    }

    /**
     * Helper to show all connections and perform connect logic.
     */
    private showConnectionsAndConnect(resolve: any, reject: any, fileUri: string): void {
        const self = this;

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
            } else {
                resolve(false);
            }
        });
    }

    // let users pick from a picklist of connections
    public onNewConnection(): Promise<boolean> {
        const self = this;
        const fileUri = this.vscodeWrapper.activeTextEditorUri;

        return new Promise<boolean>((resolve, reject) => {
            if (!fileUri) {
                // A text document needs to be open before we can connect
                self.vscodeWrapper.showWarningMessage(Constants.msgOpenSqlFile);
                resolve(false);
                return;
            } else if (!self.vscodeWrapper.isEditingSqlFile) {
                self.connectionUI.promptToChangeLanguageMode().then( result => {
                    if (result) {
                        self.showConnectionsAndConnect(resolve, reject, fileUri);
                    } else {
                        resolve(false);
                    }
                });
                return;
            }

            self.showConnectionsAndConnect(resolve, reject, fileUri);
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
            let connectParams = new ConnectionContracts.ConnectParams();
            connectParams.ownerUri = fileUri;
            connectParams.connection = connectionDetails;

            let serviceTimer = new Utils.Timer();

            // send connection request message to service host
            self.client.sendRequest(ConnectionContracts.ConnectionRequest.type, connectParams).then((result) => {
                // handle connection complete callback
                serviceTimer.end();

                if (result.connectionId && result.connectionId !== '') {
                    // We have a valid connection
                    // Copy credentials as the database name will be updated
                    let newCredentials: Interfaces.IConnectionCredentials = <any>{};
                    Object.assign<Interfaces.IConnectionCredentials, Interfaces.IConnectionCredentials>(newCredentials, connectionCreds);
                    if (result.connectionSummary && result.connectionSummary.databaseName) {
                        newCredentials.database = result.connectionSummary.databaseName;
                    }
                    let connection = new ConnectionInfo();
                    connection.connectionId = result.connectionId;
                    connection.serverInfo = result.serverInfo;
                    connection.credentials = newCredentials;
                    self._connections[fileUri] = connection;

                    self.statusView.connectSuccess(fileUri, newCredentials);

                    this._vscodeWrapper.logToOutputChannel(
                        Utils.formatString(Constants.msgConnectedServerInfo, connection.credentials.server, fileUri, JSON.stringify(connection.serverInfo))
                    );

                    extensionTimer.end();

                    Telemetry.sendTelemetryEvent(self._context, 'DatabaseConnected', {
                        connectionType: connection.serverInfo.isCloud ? 'Azure' : 'Standalone',
                        serverVersion: connection.serverInfo.serverVersion,
                        serverOs: connection.serverInfo.osVersion
                    }, {
                        isEncryptedConnection: connection.credentials.encrypt ? 1 : 0,
                        isIntegratedAuthentication: connection.credentials.authenticationType === 'Integrated' ? 1 : 0,
                        extensionConnectionTime: extensionTimer.getDuration() - serviceTimer.getDuration(),
                        serviceConnectionTime: serviceTimer.getDuration()
                    });
                    return newCredentials;
                } else {
                    Utils.showErrorMsg(Constants.msgError + Constants.msgConnectionError);
                    self.statusView.connectError(fileUri, connectionCreds, result.messages);
                    self.connectionUI.showConnectionErrors(result.messages);
                    return undefined;
                }
            }).then( (newConnection: Interfaces.IConnectionCredentials) => {
                if (newConnection) {
                    let connectionToSave: Interfaces.IConnectionCredentials = Object.assign({}, newConnection);
                    self._connectionStore.addRecentlyUsed(connectionToSave)
                    .then(() => {
                        resolve(true);
                    }, err => {
                        reject(err);
                    });
                } else {
                    resolve(false);
                }
            }, err => {
                // Catch unexpected errors and return over the Promise reject callback
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

    private onDidCloseTextDocument(doc: vscode.TextDocument): void {
        const closedDocumentUri: string = doc.uri.toString();
        const closedDocumentUriScheme: string = doc.uri.scheme;

        if (this._lastSavedTimer &&
            this._lastSavedUri &&                                   // Did we save a document before this close event?
            closedDocumentUriScheme === Constants.untitledScheme && // Did we close an untitled document?
            !this.isConnected(this._lastSavedUri) &&                // Is the new file saved to disk not connected yet?
            this.isConnected(closedDocumentUri)) {                  // Was the untitled document connected?

            // Check that we saved a document *just* before this close event
            // If so, then we saved an untitled document and need to update its connection since its URI changed
            this._lastSavedTimer.end();
            if (this._lastSavedTimer.getDuration() < Constants.untitledSaveTimeThreshold) {
                const creds: Interfaces.IConnectionCredentials = this._connections[closedDocumentUri].credentials;

                // Connect the file uri saved on disk
                this.connect(this._lastSavedUri, creds).then( result => {
                    if (result) {
                        // And disconnect the untitled uri
                        this.disconnect(closedDocumentUri);
                    }
                });
            }

            this._lastSavedTimer = undefined;
            this._lastSavedUri = undefined;
        } else if (this.isConnected(closedDocumentUri)) {
            // Disconnect the document's connection when we close it
            this.disconnect(closedDocumentUri);
        }
    }

    private onDidSaveTextDocument(doc: vscode.TextDocument): void {
        const savedDocumentUri: string = doc.uri.toString();

        // Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
        this._lastSavedTimer = new Timer();
        this._lastSavedTimer.start();
        this._lastSavedUri = savedDocumentUri;
    }

}
