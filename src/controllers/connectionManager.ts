/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import vscode = require('vscode');
import { ConnectionCredentials } from '../models/connectionCredentials';
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import * as ConnectionContracts from '../models/contracts/connection';
import * as LanguageServiceContracts from '../models/contracts/languageService';
import Utils = require('../models/utils');
import { ConnectionStore } from '../models/connectionStore';
import { ConnectionUI } from '../views/connectionUI';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import { IPrompter } from '../prompts/question';
import VscodeWrapper from './vscodeWrapper';
import { NotificationHandler } from 'vscode-languageclient';
import { Runtime, PlatformInformation } from '../models/platform';
import { Deferred } from '../protocol';
import { AccountService } from '../azure/accountService';
import { FirewallService } from '../firewall/firewallService';
import { IConnectionCredentials, IConnectionProfile } from '../models/interfaces';
import { ConnectionSummary } from '../models/contracts/connection';
import { AccountStore } from '../azure/accountStore';
import { ConnectionProfile } from '../models/connectionProfile';
import { QuestionTypes, IQuestion } from '../prompts/question';
import { IAccount } from '../models/contracts/azure/accountInterfaces';

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
    public credentials: IConnectionCredentials;

    /**
     * Callback for when a connection notification is received.
     */
    public connectHandler: (result: boolean, error?: any) => void;

    /**
     * Information about the SQL Server instance.
     */
    public serverInfo: ConnectionContracts.ServerInfo;

    /**
     * Whether the connection is in the process of connecting.
     */
    public connecting: boolean;

    /**
     * The MS SQL error number coming from the server
     */
    public errorNumber: number;

    /**
     * The MS SQL error message coming from the server
     */
    public errorMessage: string;

    public get loginFailed(): boolean {
        return this.errorNumber && this.errorNumber === Constants.errorLoginFailed;
    }
}

// ConnectionManager class is the main controller for connection management
export default class ConnectionManager {
    private _statusView: StatusView;
    private _connections: { [fileUri: string]: ConnectionInfo };
    private _connectionCredentialsToServerInfoMap:
        Map<IConnectionCredentials, ConnectionContracts.ServerInfo>;
    private _uriToConnectionPromiseMap: Map<string, Deferred<boolean>>;
    private _failedUriToFirewallIpMap: Map<string, string>;
    private _accountService: AccountService;
    private _firewallService: FirewallService;

    constructor(context: vscode.ExtensionContext,
                statusView: StatusView,
                prompter: IPrompter,
                private _client?: SqlToolsServerClient,
                private _vscodeWrapper?: VscodeWrapper,
                private _connectionStore?: ConnectionStore,
                private _connectionUI?: ConnectionUI,
                private _accountStore?: AccountStore) {
        this._statusView = statusView;
        this._connections = {};
        this._connectionCredentialsToServerInfoMap =
            new Map<IConnectionCredentials, ConnectionContracts.ServerInfo>();
        this._uriToConnectionPromiseMap = new Map<string, Deferred<boolean>>();


        if (!this.client) {
            this.client = SqlToolsServerClient.instance;
        }
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }

        if (!this._connectionStore) {
            this._connectionStore = new ConnectionStore(context);
        }

        if (!this._accountStore) {
            this._accountStore = new AccountStore(context);
        }

        if (!this._connectionUI) {
            this._connectionUI = new ConnectionUI(this, context, this._connectionStore, this._accountStore, prompter, this.vscodeWrapper);
        }

        // Initiate the firewall service
        this._accountService = new AccountService(this.client, this.vscodeWrapper);
        this._firewallService = new FirewallService(this._accountService);
        this._failedUriToFirewallIpMap = new Map<string, string>();

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
    public get accountStore(): AccountStore {
        return this._accountStore;
    }

    /**
     * Exposed for testing purposes
     */
    public set accountStore(value: AccountStore) {
        this._accountStore = value;
    }

    /**
     * Exposed for testing purposes
     */
    public get connectionCount(): number {
        return Object.keys(this._connections).length;
    }

    public get failedUriToFirewallIpMap(): Map<string, string> {
        return this._failedUriToFirewallIpMap;
    }

    public get accountService(): AccountService {
        return this._accountService;
    }

    public get firewallService(): FirewallService {
        return this._firewallService;
    }

    public isActiveConnection(credential: IConnectionCredentials): boolean {
        const connectedCredentials = Object.keys(this._connections).map((uri) => this._connections[uri].credentials);
        for (let connectedCredential of connectedCredentials) {
            if (Utils.isSameConnection(credential, connectedCredential)) {
                return true;
            }
        }
        return false;
    }

    public getUriForConnection(connection: IConnectionCredentials): string {
        for (let uri of Object.keys(this._connections)) {
            if (Utils.isSameConnection(this._connections[uri].credentials, connection)) {
                return uri;
            }
        }
        return undefined;
    }

    public isConnected(fileUri: string): boolean {
        return (fileUri in this._connections && this._connections[fileUri].connectionId && Utils.isNotEmpty(this._connections[fileUri].connectionId));
    }

    public isConnecting(fileUri: string): boolean {
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
        return (event: LanguageServiceContracts.IntelliSenseReadyParams): void => {
            this._statusView.languageServiceStatusChanged(event.ownerUri, LocalizedConstants.intelliSenseUpdatedStatus);
            let connection = this.getConnectionInfo(event.ownerUri);
            if (connection !== undefined) {
                let numberOfCharacters: number = 0;
                if (this.vscodeWrapper.activeTextEditor !== undefined
                && this.vscodeWrapper.activeTextEditor.document !== undefined) {
                    let document = this.vscodeWrapper.activeTextEditor.document;
                    numberOfCharacters = document.getText().length;
                }
            }
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

                let logMessage = Utils.formatString(LocalizedConstants.msgChangedDatabaseContext, event.connection.databaseName, event.ownerUri);

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
        return async (result: ConnectionContracts.ConnectionCompleteParams): Promise<void> => {
            let fileUri = result.ownerUri;
            let connection = self.getConnectionInfo(fileUri);
            connection.connecting = false;

            let mruConnection: IConnectionCredentials = <any>{};

            if (Utils.isNotEmpty(result.connectionId)) {
                // Convert to credentials if it's a connection string based connection
                if (connection.credentials.connectionString) {
                    connection.credentials = this.populateCredentialsFromConnectionString(connection.credentials, result.connectionSummary);
                }
                this._connectionCredentialsToServerInfoMap.set(connection.credentials, result.serverInfo);

                // We have a valid connection
                // Copy credentials as the database name will be updated
                let newCredentials: IConnectionCredentials = <any>{};
                Object.assign<IConnectionCredentials, IConnectionCredentials>(newCredentials, connection.credentials);
                if (result.connectionSummary && result.connectionSummary.databaseName) {
                    newCredentials.database = result.connectionSummary.databaseName;
                }

                self.handleConnectionSuccess(fileUri, connection, newCredentials, result);
                mruConnection = connection.credentials;
                const promise = self._uriToConnectionPromiseMap.get(result.ownerUri);
                if (promise) {
                    promise.resolve(true);
                    self._uriToConnectionPromiseMap.delete(result.ownerUri);
                }
            } else {
                mruConnection = undefined;
                const promise = self._uriToConnectionPromiseMap.get(result.ownerUri);
                if (promise) {
                    if (result.errorMessage) {
                        await self.handleConnectionErrors(fileUri, connection, result);
                        promise.reject(result.errorMessage);
                        self._uriToConnectionPromiseMap.delete(result.ownerUri);
                    } else if (result.messages) {
                        promise.reject(result.messages);
                        self._uriToConnectionPromiseMap.delete(result.ownerUri);
                    }
                }
                await self.handleConnectionErrors(fileUri, connection, result);
            }

            await self.tryAddMruConnection(connection, mruConnection);
        };
    }

    private handleConnectionSuccess(fileUri: string,
                                    connection: ConnectionInfo,
                                    newCredentials: IConnectionCredentials,
                                    result: ConnectionContracts.ConnectionCompleteParams): void {
        connection.connectionId = result.connectionId;
        connection.serverInfo = result.serverInfo;
        connection.credentials = newCredentials;
        connection.errorNumber = undefined;
        connection.errorMessage = undefined;

        this.statusView.connectSuccess(fileUri, newCredentials, connection.serverInfo);
        this.statusView.languageServiceStatusChanged(fileUri, LocalizedConstants.updatingIntelliSenseStatus);

        this._vscodeWrapper.logToOutputChannel(
            Utils.formatString(LocalizedConstants.msgConnectedServerInfo, connection.credentials.server, fileUri, JSON.stringify(connection.serverInfo))
        );
    }

    private async handleConnectionErrors(fileUri: string, connection: ConnectionInfo, result: ConnectionContracts.ConnectionCompleteParams): Promise<void> {
        if (result.errorNumber && result.errorMessage && !Utils.isEmpty(result.errorMessage)) {
            // Check if the error is an expired password
            if (result.errorNumber === Constants.errorPasswordExpired || result.errorNumber === Constants.errorPasswordNeedsReset) {
                // TODO: we should allow the user to change their password here once corefx supports SqlConnection.ChangePassword()
                Utils.showErrorMsg(Utils.formatString(LocalizedConstants.msgConnectionErrorPasswordExpired, result.errorNumber, result.errorMessage));
            } else if (result.errorNumber !== Constants.errorLoginFailed) {
                Utils.showErrorMsg(Utils.formatString(LocalizedConstants.msgConnectionError, result.errorNumber, result.errorMessage));
                // check whether it's a firewall rule error
                let firewallResult = await this.firewallService.handleFirewallRule(result.errorNumber, result.errorMessage);
                if (firewallResult.result && firewallResult.ipAddress) {
                    this._failedUriToFirewallIpMap.set(fileUri, firewallResult.ipAddress);
                }
            }
            connection.errorNumber = result.errorNumber;
            connection.errorMessage = result.errorMessage;
        } else {
            const platformInfo = await PlatformInformation.getCurrent();
            if (!platformInfo.isWindows() && result.errorMessage && result.errorMessage.includes('Kerberos')) {
                const action = await this.vscodeWrapper.showErrorMessage(
                    Utils.formatString(LocalizedConstants.msgConnectionError2, result.errorMessage),
                    LocalizedConstants.macOpenSslHelpButton);
                if (action && action === LocalizedConstants.macOpenSslHelpButton) {
                    await vscode.env.openExternal(vscode.Uri.parse(Constants.integratedAuthHelpLink));
                }
            } else if (platformInfo.runtimeId === Runtime.OSX_10_11_64 &&
            result.messages.indexOf('Unable to load DLL \'System.Security.Cryptography.Native\'') !== -1) {
                const action = await this.vscodeWrapper.showErrorMessage(Utils.formatString(LocalizedConstants.msgConnectionError2,
                    LocalizedConstants.macOpenSslErrorMessage), LocalizedConstants.macOpenSslHelpButton);
                if (action && action === LocalizedConstants.macOpenSslHelpButton) {
                    await vscode.env.openExternal(vscode.Uri.parse(Constants.macOpenSslHelpLink));
                }
            } else {
                Utils.showErrorMsg(Utils.formatString(LocalizedConstants.msgConnectionError2, result.messages));
            }
        }
        this.statusView.connectError(fileUri, connection.credentials, result);
        this.vscodeWrapper.logToOutputChannel(
            Utils.formatString(
                LocalizedConstants.msgConnectionFailed,
                connection.credentials.server,
                result.errorMessage ? result.errorMessage : result.messages)
        );
    }

    private async tryAddMruConnection(connection: ConnectionInfo, newConnection: IConnectionCredentials): Promise<void> {
        if (newConnection) {
            let connectionToSave: IConnectionCredentials = Object.assign({}, newConnection);
            try {
                await this._connectionStore.addRecentlyUsed(connectionToSave);
                connection.connectHandler(true);
            } catch (err) {
                connection.connectHandler(false, err);
            }
        } else {
            connection.connectHandler(false);
        }
    }

    /**
     * Populates a credential object based on the credential connection string
     */
    private populateCredentialsFromConnectionString(credentials: IConnectionCredentials, connectionSummary: ConnectionSummary): IConnectionCredentials {
        // populate credential details
        credentials.database = connectionSummary.databaseName;
        credentials.user = connectionSummary.userName;
        credentials.server = connectionSummary.serverName;

        // save credentials if needed
        let isPasswordBased: boolean = ConnectionCredentials.isPasswordBasedConnectionString(credentials.connectionString);
        if (isPasswordBased) {
            // save the connection string here
            this._connectionStore.saveProfileWithConnectionString(credentials as IConnectionProfile);
            // replace the conn string from the profile
            credentials.connectionString = ConnectionStore.formatCredentialId(credentials.server,
                credentials.database, credentials.user, ConnectionStore.CRED_PROFILE_USER, true);

            // set auth type
            credentials.authenticationType = Constants.sqlAuthentication;

            // set savePassword to true so that credentials are automatically
            // deleted if the settings file is manually changed
            (credentials as IConnectionProfile).savePassword = true;
        } else {
            credentials.authenticationType = 'Integrated';
        }

        return credentials;
    }

    /**
     * Clear the recently used connections list in the connection store
     */
    public clearRecentConnectionsList(): Promise<void> {
        return this.connectionStore.clearRecentlyUsed();
    }

    // choose database to use on current server from UI
    public async onChooseDatabase(): Promise<boolean> {
        const fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!this.isConnected(fileUri)) {
            this.vscodeWrapper.showWarningMessage(LocalizedConstants.msgChooseDatabaseNotConnected);
            return false;
        }

        // Get list of databases on current server
        let listParams = new ConnectionContracts.ListDatabasesParams();
        listParams.ownerUri = fileUri;
        const result = await this.client.sendRequest(ConnectionContracts.ListDatabasesRequest.type, listParams);
        // Then let the user select a new database to connect to
        const newDatabaseCredentials = await this.connectionUI.showDatabasesOnCurrentServer(this._connections[fileUri].credentials, result.databaseNames);
        if (newDatabaseCredentials) {
            this.vscodeWrapper.logToOutputChannel(
                Utils.formatString(LocalizedConstants.msgChangingDatabase, newDatabaseCredentials.database, newDatabaseCredentials.server, fileUri)
            );
            await this.disconnect(fileUri);
            await this.connect(fileUri, newDatabaseCredentials);
            this.vscodeWrapper.logToOutputChannel(
                Utils.formatString(
                    LocalizedConstants.msgChangedDatabase,
                    newDatabaseCredentials.database,
                    newDatabaseCredentials.server, fileUri)
            );
            return true;
        } else {
            return false;
        }
    }

    public async changeDatabase(newDatabaseCredentials: IConnectionCredentials): Promise<boolean> {
        const fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!this.isConnected(fileUri)) {
            this.vscodeWrapper.showWarningMessage(LocalizedConstants.msgChooseDatabaseNotConnected);
            return false;
        }
        await this.disconnect(fileUri);
        await this.connect(fileUri, newDatabaseCredentials);
        this.vscodeWrapper.logToOutputChannel(
            Utils.formatString(
                LocalizedConstants.msgChangedDatabase,
                newDatabaseCredentials.database,
                newDatabaseCredentials.server, fileUri));
        return true;
    }

    public async onChooseLanguageFlavor(isSqlCmdMode: boolean = false, isSqlCmd: boolean = false): Promise<boolean> {
        const fileUri = this._vscodeWrapper.activeTextEditorUri;
        if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
            if (isSqlCmdMode) {
                SqlToolsServerClient.instance.sendNotification(LanguageServiceContracts.LanguageFlavorChangedNotification.type,
                    <LanguageServiceContracts.DidChangeLanguageFlavorParams> {
                    uri: fileUri,
                    language: isSqlCmd ? 'sqlcmd' : 'sql',
                    flavor: 'MSSQL'
                });
                return true;
            }
            const flavor = await this._connectionUI.promptLanguageFlavor();
            if (!flavor) {
                return false;
            }
            this.statusView.languageFlavorChanged(fileUri, flavor);
            SqlToolsServerClient.instance.sendNotification(LanguageServiceContracts.LanguageFlavorChangedNotification.type,
                <LanguageServiceContracts.DidChangeLanguageFlavorParams> {
                uri: fileUri,
                language: 'sql',
                flavor: flavor
            });
            return true;
        } else {
            await this._vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            return false;
        }
    }

    // close active connection, if any
    public onDisconnect(): Promise<boolean> {
        return this.disconnect(this.vscodeWrapper.activeTextEditorUri);
    }

    public async disconnect(fileUri: string): Promise<boolean> {
        if (this.isConnected(fileUri)) {
            let disconnectParams = new ConnectionContracts.DisconnectParams();
            disconnectParams.ownerUri = fileUri;

            const result = await this.client.sendRequest(ConnectionContracts.DisconnectRequest.type, disconnectParams);
            if (this.statusView) {
                this.statusView.notConnected(fileUri);
            }
            if (result) {
                this.vscodeWrapper.logToOutputChannel(
                    Utils.formatString(LocalizedConstants.msgDisconnected, fileUri)
                );
            }

            delete this._connections[fileUri];
            return result;

        } else if (this.isConnecting(fileUri)) {
            // Prompt the user to cancel connecting
            await this.onCancelConnect();
            return true;
        } else {
            return true;
        }
    }

    /**
     * Helper to show all connections and perform connect logic.
     */
    public async showConnectionsAndConnect(fileUri: string): Promise<IConnectionCredentials> {
        // show connection picklist
        const connectionCreds = await this.connectionUI.showConnections();
        if (connectionCreds) {
            // close active connection
            await this.disconnect(fileUri);
            // connect to the server/database
            const result = await this.connect(fileUri, connectionCreds);
            await this.handleConnectionResult(result, fileUri, connectionCreds);
        }
        return connectionCreds;
    }

    /**
     * Get the server info for a connection
     * @param connectionCreds
     */
    public getServerInfo(connectionCredentials: IConnectionCredentials): ConnectionContracts.ServerInfo {
        if (this._connectionCredentialsToServerInfoMap.has(connectionCredentials)) {
            return this._connectionCredentialsToServerInfoMap.get(connectionCredentials);
        }
    }

    /**
     * Verifies the connection result. If connection failed because of invalid credentials,
     * tries to connect again by asking user for different credentials
     * @param result Connection result
     * @param fileUri file Uri
     * @param connectionCreds Connection Profile
     */
    private async handleConnectionResult(result: boolean, fileUri: string, connectionCreds: IConnectionCredentials): Promise<boolean> {
        let connection = this._connections[fileUri];
        if (!result && connection && connection.loginFailed) {
            const newConnection = await this.connectionUI.createProfileWithDifferentCredentials(connectionCreds);
            if (newConnection) {
                const newResult = this.connect(fileUri, newConnection);
                connection = this._connections[fileUri];
                if (!newResult && connection && connection.loginFailed) {
                    Utils.showErrorMsg(Utils.formatString(LocalizedConstants.msgConnectionError, connection.errorNumber, connection.errorMessage));
                }
                return newResult;
            } else {
                return true;
            }
        } else {
            return true;
        }
    }

    /**
     * Delete a credential from the credential store
     */
    public async deleteCredential(profile: IConnectionProfile): Promise<boolean> {
        return await this._connectionStore.deleteCredential(profile);
    }

    // let users pick from a picklist of connections
    public async onNewConnection(): Promise<IConnectionCredentials> {
        const fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!fileUri) {
            // A text document needs to be open before we can connect
            this.vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            return undefined;
        } else if (!this.vscodeWrapper.isEditingSqlFile) {
            const result = await this.connectionUI.promptToChangeLanguageMode();
            if (result) {
                const credentials = await this.showConnectionsAndConnect(fileUri);
                return credentials;
            } else {
                return undefined;
            }
        }
        const creds = await this.showConnectionsAndConnect(fileUri);
        return creds;
    }

    // create a new connection with the connectionCreds provided
    public async connect(fileUri: string, connectionCreds: IConnectionCredentials, promise?: Deferred<boolean>): Promise<boolean> {
        const self = this;
        let connectionPromise = new Promise<boolean>(async (resolve, reject) => {
            let connectionInfo: ConnectionInfo = new ConnectionInfo();
            connectionInfo.credentials = connectionCreds;
            connectionInfo.connecting = true;
            this._connections[fileUri] = connectionInfo;

            // Note: must call flavor changed before connecting, or the timer showing an animation doesn't occur
            if (self.statusView) {
                self.statusView.languageFlavorChanged(fileUri, Constants.mssqlProviderName);
                self.statusView.connecting(fileUri, connectionCreds);
                self.statusView.languageFlavorChanged(fileUri, Constants.mssqlProviderName);
            }
            self.vscodeWrapper.logToOutputChannel(
                Utils.formatString(LocalizedConstants.msgConnecting, connectionCreds.server, fileUri)
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

            // send connection request message to service host
            this._uriToConnectionPromiseMap.set(connectParams.ownerUri, promise);
            try {
                const result = await self.client.sendRequest(ConnectionContracts.ConnectionRequest.type, connectParams);
                if (!result) {
                    // Failed to process connect request
                    resolve(false);
                }
            } catch (error) {
                reject(error);
            }
        });
        let connectionResult = await connectionPromise;
        return connectionResult;
    }

    public async onCancelConnect(): Promise<void> {
        const result = await this.connectionUI.promptToCancelConnection();
        if (result) {
            await this.cancelConnect();
        }
    }

    public async cancelConnect(): Promise<void> {
        let fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!fileUri || Utils.isEmpty(fileUri)) {
            return;
        }

        let cancelParams: ConnectionContracts.CancelConnectParams = new ConnectionContracts.CancelConnectParams();
        cancelParams.ownerUri = fileUri;

        const result = await this.client.sendRequest(ConnectionContracts.CancelConnectRequest.type, cancelParams);
        if (result) {
            this.statusView.notConnected(fileUri);
        }
    }

    /**
     * Called when the 'Manage Connection Profiles' command is issued.
     */
    public onManageProfiles(): Promise<boolean> {
        // Show quick pick to create, edit, or remove profiles
        return this._connectionUI.promptToManageProfiles();
    }

    public async onCreateProfile(): Promise<boolean> {
        let self = this;
        const profile = await self.connectionUI.createAndSaveProfile(self.vscodeWrapper.isEditingSqlFile);
        return profile ? true : false;
    }

    public onRemoveProfile(): Promise<boolean> {
        return this.connectionUI.removeProfile();
    }

    public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
        let docUri: string = doc.uri.toString(true);

        // If this file isn't connected, then don't do anything
        if (!this.isConnected(docUri)) {
            return;
        }

        // Disconnect the document's connection when we close it
        await this.disconnect(docUri);
    }

    public onDidOpenTextDocument(doc: vscode.TextDocument): void {
        let uri = doc.uri.toString(true);
        if (doc.languageId === 'sql' && typeof(this._connections[uri]) === 'undefined') {
            this.statusView.notConnected(uri);
        }
    }

    public async transferFileConnection(oldFileUri: string, newFileUri: string): Promise<void> {
        // Is the new file connected or the old file not connected?
        if (!this.isConnected(oldFileUri) || this.isConnected(newFileUri)) {
            return;
        }

        // Connect the saved uri and disconnect the untitled uri on successful connection
        let creds: IConnectionCredentials = this._connections[oldFileUri].credentials;
        let result = await this.connect(newFileUri, creds);
        if (result) {
            await this.disconnect(oldFileUri);
        }
    }

    public async removeAccount(prompter: IPrompter): Promise<void> {
        // list options for accounts to remove
        let questions: IQuestion[] = [];
        let azureAccountChoices = ConnectionProfile.getAccountChoices(this._accountStore);

        questions.push(
            {
                type: QuestionTypes.expand,
                name: 'account',
                message: LocalizedConstants.azureChooseAccount,
                choices: azureAccountChoices
            }
        );

        return prompter.prompt<IAccount>(questions, true).then(async answers => {
            if (answers.account) {
                this._accountStore.removeAccount(answers.account.key.id);
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
