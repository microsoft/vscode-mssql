'use strict';
import vscode = require('vscode');
import { ConnectionCredentials } from '../models/connectionCredentials';
import Constants = require('../models/constants');
import * as ConnectionContracts from '../models/contracts/connection';
import * as LanguageServiceContracts from '../models/contracts/languageService';
import Utils = require('../models/utils');
import Interfaces = require('../models/interfaces');
import { ConnectionStore } from '../models/connectionStore';
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import Telemetry from '../models/telemetry';
import VscodeWrapper from './vscodeWrapper';
import {NotificationHandler} from 'vscode-languageclient';
import {Runtime, PlatformInformation} from '../models/platform';

let opener = require('opener');

/**
 * Information for a document's connection. Exported for testing purposes.
 */
export class ConnectionInfo {
    /**
     * Connection GUID returned from the service host
     */
    public connectionId: string;

    /**
     * Credentials used to connect
     */
    public credentials: Interfaces.IConnectionCredentials;

    /**
     * Callback for when a connection notification is received.
     */
    public connectHandler: (result: boolean, error?: any) => void;

    /**
     * Information about the SQL Server instance.
     */
    public serverInfo: ConnectionContracts.ServerInfo;

    /**
     * Timer for tracking extension connection time.
     */
    public extensionTimer: Utils.Timer;

    /**
     * Timer for tracking service connection time.
     */
    public serviceTimer: Utils.Timer;

    /**
     * Whether the connection is in the process of connecting.
     */
    public connecting: boolean;
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

        this._connectionUI = new ConnectionUI(this, this._connectionStore, prompter, this.vscodeWrapper);

        if (this.client !== undefined) {
            this.client.onNotification(ConnectionContracts.ConnectionChangedNotification.type, this.handleConnectionChangedNotification());
            this.client.onNotification(ConnectionContracts.ConnectionCompleteNotification.type, this.handleConnectionCompleteNotification());
            this.client.onNotification(LanguageServiceContracts.IntelliSenseReadyNotification.type, this.handleLanguageServiceUpdateNotification());
        }
    }

    /**
     * Exposed for testing purposes
     */
    public get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    /**
     * Exposed for testing purposes
     */
    public set vscodeWrapper(wrapper: VscodeWrapper) {
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

    /**
     * Exposed for testing purposes
     */
    public get statusView(): StatusView {
        return this._statusView;
    }

    /**
     * Exposed for testing purposes
     */
    public set statusView(value: StatusView) {
        this._statusView = value;
    }

    /**
     * Exposed for testing purposes
     */
    public get connectionStore(): ConnectionStore {
        return this._connectionStore;
    }

    /**
     * Exposed for testing purposes
     */
    public set connectionStore(value: ConnectionStore) {
        this._connectionStore = value;
    }

    /**
     * Exposed for testing purposes
     */
    public get connectionCount(): number {
        return Object.keys(this._connections).length;
    }

    public isConnected(fileUri: string): boolean {
        return (fileUri in this._connections && this._connections[fileUri].connectionId && Utils.isNotEmpty(this._connections[fileUri].connectionId));
    }

    private isConnecting(fileUri: string): boolean {
        return (fileUri in this._connections && this._connections[fileUri].connecting);
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
    public handleLanguageServiceUpdateNotification(): NotificationHandler<LanguageServiceContracts.IntelliSenseReadyParams> {
        // Using a lambda here to perform variable capture on the 'this' reference
        const self = this;
        return (event: LanguageServiceContracts.IntelliSenseReadyParams): void => {
            self._statusView.languageServiceUpdated(event.ownerUri);
        };
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

                self._statusView.connectSuccess(event.ownerUri, connectionInfo.credentials, connectionInfo.serverInfo);

                let logMessage = Utils.formatString(Constants.msgChangedDatabaseContext, event.connection.databaseName, event.ownerUri);

                self.vscodeWrapper.logToOutputChannel(logMessage);
            }
        };
    }

    /**
     * Public for testing purposes only.
     */
    public handleConnectionCompleteNotification(): NotificationHandler<ConnectionContracts.ConnectionCompleteParams> {
        // Using a lambda here to perform variable capture on the 'this' reference
        const self = this;
        return (result: ConnectionContracts.ConnectionCompleteParams): void => {
            let fileUri = result.ownerUri;
            let connection = self.getConnectionInfo(fileUri);
            connection.serviceTimer.end();
            connection.connecting = false;

            let mruConnection: Interfaces.IConnectionCredentials = <any>{};

            if (Utils.isNotEmpty(result.connectionId)) {
                // We have a valid connection
                // Copy credentials as the database name will be updated
                let newCredentials: Interfaces.IConnectionCredentials = <any>{};
                Object.assign<Interfaces.IConnectionCredentials, Interfaces.IConnectionCredentials>(newCredentials, connection.credentials);
                if (result.connectionSummary && result.connectionSummary.databaseName) {
                    newCredentials.database = result.connectionSummary.databaseName;
                }

                self.handleConnectionSuccess(fileUri, connection, newCredentials, result);
                mruConnection = connection.credentials;
            } else {
                self.handleConnectionErrors(fileUri, connection, result);
                mruConnection = undefined;
            }

            self.tryAddMruConnection(connection, mruConnection);
        };
    }

    private handleConnectionSuccess(fileUri: string,
                                    connection: ConnectionInfo,
                                    newCredentials: Interfaces.IConnectionCredentials,
                                    result: ConnectionContracts.ConnectionCompleteParams): void {
        connection.connectionId = result.connectionId;
        connection.serverInfo = result.serverInfo;
        connection.credentials = newCredentials;

        this.statusView.connectSuccess(fileUri, newCredentials, connection.serverInfo);
        this.statusView.languageServiceUpdating(fileUri);

        this._vscodeWrapper.logToOutputChannel(
            Utils.formatString(Constants.msgConnectedServerInfo, connection.credentials.server, fileUri, JSON.stringify(connection.serverInfo))
        );

        connection.extensionTimer.end();

        Telemetry.sendTelemetryEvent('DatabaseConnected', {
            connectionType: connection.serverInfo ? (connection.serverInfo.isCloud ? 'Azure' : 'Standalone') : '',
            serverVersion: connection.serverInfo ? connection.serverInfo.serverVersion : '',
            serverEdition: connection.serverInfo ? connection.serverInfo.serverEdition : '',
            serverOs: connection.serverInfo ? this.getIsServerLinux(connection.serverInfo.osVersion) : ''
        }, {
            isEncryptedConnection: connection.credentials.encrypt ? 1 : 0,
            isIntegratedAuthentication: connection.credentials.authenticationType === 'Integrated' ? 1 : 0,
            extensionConnectionTime: connection.extensionTimer.getDuration() - connection.serviceTimer.getDuration(),
            serviceConnectionTime: connection.serviceTimer.getDuration()
        });
    }

    private handleConnectionErrors(fileUri: string, connection: ConnectionInfo, result: ConnectionContracts.ConnectionCompleteParams): void {
        if (result.errorNumber && result.errorMessage && !Utils.isEmpty(result.errorMessage)) {
            // Check if the error is an expired password
            if (result.errorNumber === Constants.errorPasswordExpired || result.errorNumber === Constants.errorPasswordNeedsReset) {
                // TODO: we should allow the user to change their password here once corefx supports SqlConnection.ChangePassword()
                Utils.showErrorMsg(Utils.formatString(Constants.msgConnectionErrorPasswordExpired, result.errorNumber, result.errorMessage));
            } else {
                Utils.showErrorMsg(Utils.formatString(Constants.msgConnectionError, result.errorNumber, result.errorMessage));
            }
        } else {
            PlatformInformation.GetCurrent().then( platformInfo => {
                if (platformInfo.runtimeId === Runtime.OSX_10_11_64 &&
                result.messages.indexOf('Unable to load DLL \'System.Security.Cryptography.Native\'') !== -1) {
                     this.vscodeWrapper.showErrorMessage(Utils.formatString(Constants.msgConnectionError2,
                     Constants.macOpenSslErrorMessage), Constants.macOpenSslHelpButton).then(action => {
                        if (action && action === Constants.macOpenSslHelpButton) {
                            opener(Constants.macOpenSslHelpLink);
                        }
                     });
                } else {
                        Utils.showErrorMsg(Utils.formatString(Constants.msgConnectionError2, result.messages));
                }
            });

        }
        this.statusView.connectError(fileUri, connection.credentials, result);
        this.vscodeWrapper.logToOutputChannel(
            Utils.formatString(Constants.msgConnectionFailed, connection.credentials.server, result.errorMessage ? result.errorMessage : result.messages)
        );
    }

    private tryAddMruConnection(connection: ConnectionInfo, newConnection: Interfaces.IConnectionCredentials): void {
        if (newConnection) {
            let connectionToSave: Interfaces.IConnectionCredentials = Object.assign({}, newConnection);
            this._connectionStore.addRecentlyUsed(connectionToSave)
            .then(() => {
                connection.connectHandler(true);
            }, err => {
                connection.connectHandler(false, err);
            });
        } else {
            connection.connectHandler(false);
        }
    }

    /**
     * Clear the recently used connections list in the connection store
     */
    public clearRecentConnectionsList(): Promise<void> {
        return this.connectionStore.clearRecentlyUsed();
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
                        self.vscodeWrapper.logToOutputChannel(
                            Utils.formatString(Constants.msgChangingDatabase, newDatabaseCredentials.database, newDatabaseCredentials.server, fileUri)
                        );

                        self.disconnect(fileUri).then( () => {
                            self.connect(fileUri, newDatabaseCredentials).then( () => {
                                Telemetry.sendTelemetryEvent('UseDatabase');

                                self.vscodeWrapper.logToOutputChannel(
                                    Utils.formatString(Constants.msgChangedDatabase, newDatabaseCredentials.database, newDatabaseCredentials.server, fileUri)
                                );
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
                    if (result) {
                        Telemetry.sendTelemetryEvent('DatabaseDisconnected');

                        self.vscodeWrapper.logToOutputChannel(
                            Utils.formatString(Constants.msgDisconnected, fileUri)
                        );
                    }

                    delete self._connections[fileUri];

                    resolve(result);
                });
            } else if (self.isConnecting(fileUri)) {
                // Prompt the user to cancel connecting
                self.onCancelConnect();
                resolve(true);
            } else {
                resolve(true);
            }
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
            let connectionInfo: ConnectionInfo = new ConnectionInfo();
            connectionInfo.extensionTimer = new Utils.Timer();
            connectionInfo.credentials = connectionCreds;
            connectionInfo.connecting = true;
            this._connections[fileUri] = connectionInfo;

            self.statusView.connecting(fileUri, connectionCreds);
            self.vscodeWrapper.logToOutputChannel(
                Utils.formatString(Constants.msgConnecting, connectionCreds.server, fileUri)
            );

            // Setup the handler for the connection complete notification to call
            connectionInfo.connectHandler = ((connectResult, error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(connectResult);
                }
            });

            // package connection details for request message
            const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCreds);
            let connectParams = new ConnectionContracts.ConnectParams();
            connectParams.ownerUri = fileUri;
            connectParams.connection = connectionDetails;

            connectionInfo.serviceTimer = new Utils.Timer();

            // send connection request message to service host
            self.client.sendRequest(ConnectionContracts.ConnectionRequest.type, connectParams).then((result) => {
                if (!result) {
                    // Failed to process connect request
                    resolve(false);
                }
            }, err => {
                // Catch unexpected errors and return over the Promise reject callback
                reject(err);
            });
        });
    }

    public onCancelConnect(): void {
        this.connectionUI.promptToCancelConnection().then(result => {
            if (result) {
                this.cancelConnect();
            }
        });
    }

    public cancelConnect(): void {
        let fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!fileUri || Utils.isEmpty(fileUri)) {
            return;
        }

        let cancelParams: ConnectionContracts.CancelConnectParams = new ConnectionContracts.CancelConnectParams();
        cancelParams.ownerUri = fileUri;

        const self = this;
        this.client.sendRequest(ConnectionContracts.CancelConnectRequest.type, cancelParams).then(result => {
            if (result) {
                self.statusView.notConnected(fileUri);
            }
        });
    }

    /**
     * Called when the 'Manage Connection Profiles' command is issued.
     */
    public onManageProfiles(): Promise<boolean> {
        // Show quick pick to create, edit, or remove profiles
        return this._connectionUI.promptToManageProfiles();
    }

    public onCreateProfile(): Promise<boolean> {
        let self = this;
        return new Promise<boolean>((resolve, reject) => {
            self.connectionUI.createAndSaveProfile(self.vscodeWrapper.isEditingSqlFile)
                .then(profile => resolve(profile ? true : false));
        });
    }

    public onRemoveProfile(): Promise<boolean> {
        return this.connectionUI.removeProfile();
    }

    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
        let docUri: string = doc.uri.toString();

        // If this file isn't connected, then don't do anything
        if (!this.isConnected(docUri)) {
            return;
        }

        // Disconnect the document's connection when we close it
        this.disconnect(docUri);
    }

    public onDidOpenTextDocument(doc: vscode.TextDocument): void {
        let uri = doc.uri.toString();
        if (doc.languageId === 'sql' && typeof(this._connections[uri]) === 'undefined') {
            this.statusView.notConnected(uri);
        }
    }

    public onUntitledFileSaved(untitledUri: string, savedUri: string): void {
        // Is the new file connected or the old file not connected?
        if (!this.isConnected(untitledUri) || this.isConnected(savedUri)) {
            return;
        }

        // Connect the saved uri and disconnect the untitled uri on successful connection
        let creds: Interfaces.IConnectionCredentials = this._connections[untitledUri].credentials;
        this.connect(savedUri, creds).then(result => {
            if (result) {
                this.disconnect(untitledUri);
            }
        });
    }

    private getIsServerLinux(osVersion: string): string {
        if (osVersion) {
            if (osVersion.indexOf('Linux') !== -1) {
                return 'Linux';
            } else {
                return 'Windows';
            }
        }
        return '';
    }
}
