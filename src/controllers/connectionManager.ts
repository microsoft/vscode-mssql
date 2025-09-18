/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { NotificationHandler, RequestType } from "vscode-languageclient";
import { ConnectionDetails, IConnectionInfo, IServerInfo, IToken } from "vscode-mssql";
import { AccountService } from "../azure/accountService";
import { AccountStore } from "../azure/accountStore";
import { AzureController } from "../azure/azureController";
import { MsalAzureController } from "../azure/msal/msalAzureController";
import providerSettings from "../azure/providerSettings";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { CredentialStore } from "../credentialstore/credentialstore";
import { FirewallService } from "../firewall/firewallService";
import SqlToolsServerClient from "../languageservice/serviceclient";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { ConnectionProfile } from "../models/connectionProfile";
import { ConnectionStore } from "../models/connectionStore";
import {
    IAccount,
    RequestSecurityTokenParams,
    RequestSecurityTokenResponse,
    SecurityTokenRequest,
} from "../models/contracts/azure";
import * as ConnectionContracts from "../models/contracts/connection";
import { ClearPooledConnectionsRequest, ConnectionSummary } from "../models/contracts/connection";
import * as LanguageServiceContracts from "../models/contracts/languageService";
import { EncryptOptions, IConnectionProfile } from "../models/interfaces";
import { PlatformInformation, Runtime } from "../models/platform";
import * as Utils from "../models/utils";
import { IPrompter, IQuestion, QuestionTypes } from "../prompts/question";
import { Deferred } from "../protocol";
import { ConnectionUI } from "../views/connectionUI";
import StatusView from "../views/statusView";
import VscodeWrapper from "./vscodeWrapper";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { DatabaseObjectSearchService } from "../services/databaseObjectSearchService";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { changeLanguageServiceForFile } from "../languageservice/utils";
import { AddFirewallRuleWebviewController } from "./addFirewallRuleWebviewController";
import { getErrorMessage } from "../utils/utils";
import { Logger } from "../models/logger";
import { getServerTypes } from "../models/connectionInfo";

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
    public credentials: IConnectionInfo;

    /**
     * Callback for when a connection notification is received.
     */
    public connectHandler: (result: boolean, error?: any) => void;

    public connectionCompleteHandler: (
        result: ConnectionContracts.ConnectionCompleteParams,
    ) => void;

    /**
     * Information about the SQL Server instance.
     */
    public serverInfo: IServerInfo;

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
        return this.errorNumber !== undefined && this.errorNumber === Constants.errorLoginFailed;
    }
}

export interface IReconnectAction {
    /**
     * Reconnect to the server with the provided profile
     * @param profile The connection profile to use for reconnection. If undefined, the connection creation was cancelled.
     */
    (profile: IConnectionProfile | undefined): Promise<void>;
}

export interface ConnectionSuccessfulEvent {
    connection: ConnectionInfo;
    fileUri: string;
}

// ConnectionManager class is the main controller for connection management
export default class ConnectionManager {
    private _statusView: StatusView;
    private _connections: { [fileUri: string]: ConnectionInfo };
    private _connectionCredentialsToServerInfoMap: Map<IConnectionInfo, IServerInfo>;
    private _uriToConnectionPromiseMap: Map<string, Deferred<boolean>>;
    private _uriToConnectionCompleteParamsMap: Map<
        string,
        Deferred<ConnectionContracts.ConnectionCompleteParams>
    >;
    private _failedUriToFirewallIpMap: Map<string, ConnectionContracts.ConnectionCompleteParams>;
    private _failedUriToSSLMap: Map<string, string>;
    private _keyVaultTokenCache: Map<string, IToken> = new Map<string, IToken>();
    private _accountService: AccountService;
    private _firewallService: FirewallService;
    public azureController: AzureController;

    private _onConnectionsChangedEmitter: vscode.EventEmitter<void> =
        new vscode.EventEmitter<void>();
    public readonly onConnectionsChanged: vscode.Event<void> =
        this._onConnectionsChangedEmitter.event;

    private _onSuccessfulConnectionEmitter: vscode.EventEmitter<ConnectionSuccessfulEvent> =
        new vscode.EventEmitter<ConnectionSuccessfulEvent>();
    public readonly onSuccessfulConnection: vscode.Event<ConnectionSuccessfulEvent> =
        this._onSuccessfulConnectionEmitter.event;

    public initialized: Deferred<void> = new Deferred<void>();

    constructor(
        private context: vscode.ExtensionContext,
        statusView: StatusView,
        prompter: IPrompter,
        private _useLegacyConnectionExperience: boolean = false,
        private _logger?: Logger,
        private _client?: SqlToolsServerClient,
        private _vscodeWrapper?: VscodeWrapper,
        private _connectionStore?: ConnectionStore,
        private _credentialStore?: CredentialStore,
        private _connectionUI?: ConnectionUI,
        private _accountStore?: AccountStore,
    ) {
        this._statusView = statusView;
        this._connections = {};
        this._connectionCredentialsToServerInfoMap = new Map<IConnectionInfo, IServerInfo>();
        this._uriToConnectionPromiseMap = new Map<string, Deferred<boolean>>();
        this._uriToConnectionCompleteParamsMap = new Map<
            string,
            Deferred<ConnectionContracts.ConnectionCompleteParams>
        >();

        if (!this.client) {
            this.client = SqlToolsServerClient.instance;
        }
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }

        if (!this._logger) {
            this._logger = Logger.create(this._vscodeWrapper.outputChannel, "ConnectionManager");
        }

        if (!this._credentialStore) {
            this._credentialStore = new CredentialStore(context, this._vscodeWrapper);
        }

        if (!this._connectionStore) {
            this._connectionStore = new ConnectionStore(context, this._credentialStore);
        }

        if (!this._accountStore) {
            this._accountStore = new AccountStore(context, this.vscodeWrapper);
        }

        if (!this._connectionUI) {
            this._connectionUI = new ConnectionUI(
                this,
                context,
                this._connectionStore,
                this._accountStore,
                prompter,
                _useLegacyConnectionExperience,
                this.vscodeWrapper,
            );
        }

        if (!this.azureController) {
            this.azureController = new MsalAzureController(
                context,
                prompter,
                this._credentialStore,
            );

            this.azureController.init();
        }

        // Initiate the firewall service
        this._accountService = new AccountService(
            this.client,
            this._accountStore,
            this.azureController,
        );
        this._firewallService = new FirewallService(this._accountService);
        this._failedUriToFirewallIpMap = new Map<
            string,
            ConnectionContracts.ConnectionCompleteParams
        >();
        this._failedUriToSSLMap = new Map<string, string>();

        if (this.client !== undefined) {
            this.client.onNotification(
                ConnectionContracts.ConnectionChangedNotification.type,
                this.handleConnectionChangedNotification(),
            );
            this.client.onNotification(
                ConnectionContracts.ConnectionCompleteNotification.type,
                this.handleConnectionCompleteNotification(),
            );
            this.client.onNotification(
                LanguageServiceContracts.IntelliSenseReadyNotification.type,
                this.handleLanguageServiceUpdateNotification(),
            );
            this.client.onNotification(
                LanguageServiceContracts.NonTSqlNotification.type,
                this.handleNonTSqlNotification(),
            );
            this.client.onRequest(
                SecurityTokenRequest.type,
                this.handleSecurityTokenRequest.bind(this),
            );
        }
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.connectionStore.initialized;
        await this.migrateLegacyConnectionProfiles();

        this.initialized.resolve();
    }

    /**
     * Exposed for testing purposes
     */
    public get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper!;
    }

    /**
     * Exposed for testing purposes
     */
    public set vscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    public get activeConnections(): { [fileUri: string]: ConnectionInfo } {
        return this._connections;
    }

    /**
     * Exposed for testing purposes
     */
    public get client(): SqlToolsServerClient {
        return this._client!;
    }

    /**
     * Exposed for testing purposes
     */
    public set client(client: SqlToolsServerClient) {
        this._client = client;
    }

    /**
     * Get the connection view
     */
    public get connectionUI(): ConnectionUI {
        return this._connectionUI!;
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
        return this._connectionStore!;
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
        return this._accountStore!;
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

    public get failedUriToFirewallIpMap(): Map<
        string,
        ConnectionContracts.ConnectionCompleteParams
    > {
        return this._failedUriToFirewallIpMap;
    }

    public get failedUriToSSLMap(): Map<string, string> {
        return this._failedUriToSSLMap;
    }

    public get accountService(): AccountService {
        return this._accountService;
    }

    public get firewallService(): FirewallService {
        return this._firewallService;
    }

    public isActiveConnection(credential: IConnectionInfo): boolean {
        const connectedCredentials = Object.keys(this._connections).map(
            (uri) => this._connections[uri].credentials,
        );
        for (let connectedCredential of connectedCredentials) {
            if (Utils.isSameConnectionInfo(credential, connectedCredential)) {
                return true;
            }
        }
        return false;
    }

    public getUriForConnection(connection: IConnectionInfo): string {
        for (let uri of Object.keys(this._connections)) {
            if (Utils.isSameConnectionInfo(this._connections[uri].credentials, connection)) {
                return uri;
            }
        }
        return undefined;
    }

    public getUriForScmpConnection(connection: IConnectionInfo): string {
        for (let uri of Object.keys(this._connections)) {
            if (Utils.isSameScmpConnection(this._connections[uri].credentials, connection)) {
                return uri;
            }
        }
        return undefined;
    }

    public isConnected(fileUri: string): boolean {
        return (
            fileUri in this._connections &&
            this._connections[fileUri].connectionId &&
            Utils.isNotEmpty(this._connections[fileUri].connectionId)
        );
    }

    public isConnecting(fileUri: string): boolean {
        return fileUri in this._connections && this._connections[fileUri].connecting;
    }

    public async findMatchingProfile(
        connProfile: IConnectionProfile,
    ): Promise<{ profile: IConnectionProfile; score: Utils.MatchScore } | undefined> {
        return this.connectionStore.findMatchingProfile(connProfile);
    }

    /**
     * Get the connection string for the provided connection Uri or ConnectionDetails.
     * @param connectionUriOrDetails Either the connection Uri for the connection or the connection details for the connection is required.
     * @param includePassword (optional) if password should be included in connection string; default is false
     * @param includeApplicationName (optional) if application name should be included in connection string; default is true
     * @returns connection string for the connection
     */
    public async getConnectionString(
        connectionUriOrDetails: string | ConnectionDetails,
        includePassword: boolean = false,
        includeApplicationName: boolean = true,
    ): Promise<string> {
        const listParams = new ConnectionContracts.GetConnectionStringParams();
        if (typeof connectionUriOrDetails === "string") {
            listParams.ownerUri = connectionUriOrDetails;
        } else {
            listParams.connectionDetails = connectionUriOrDetails;
        }
        listParams.includePassword = includePassword;
        listParams.includeApplicationName = includeApplicationName;
        return this.client.sendRequest(
            ConnectionContracts.GetConnectionStringRequest.type,
            listParams,
        );
    }

    /**
     * Parses the connection string into a ConnectionDetails object
     */
    public async parseConnectionString(connectionString: string): Promise<ConnectionDetails> {
        return await this.client.sendRequest(
            ConnectionContracts.ParseConnectionStringRequest.type,
            connectionString,
        );
    }

    /**
     * Set connection details for the provided connection info
     * Able to use this for getConnectionString requests to STS that require ConnectionDetails type
     * @param connectionInfo connection info of the connection
     * @returns connection details credentials for the connection
     */
    public createConnectionDetails(connectionInfo: IConnectionInfo): ConnectionDetails {
        return ConnectionCredentials.createConnectionDetails(connectionInfo);
    }

    /**
     * Send a request to the SQL Tools Server client
     * @param requestType The type of the request
     * @param params The params to pass with the request
     * @returns A promise object for when the request receives a response
     */
    public async sendRequest<P, R, E, R0>(
        requestType: RequestType<P, R, E, R0>,
        params?: P,
    ): Promise<R> {
        return await this.client.sendRequest(requestType, params);
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
            this._statusView.languageServiceStatusChanged(
                event.ownerUri,
                LocalizedConstants.intelliSenseUpdatedStatus,
            );
        };
    }

    public handleNonTSqlNotification(): NotificationHandler<LanguageServiceContracts.NonTSqlParams> {
        // Using a lambda here to perform variable capture on the 'this' reference

        return async (event: LanguageServiceContracts.NonTSqlParams): Promise<void> => {
            const autoDisable: boolean | undefined = await this._vscodeWrapper
                .getConfiguration()
                .get(Constants.configAutoDisableNonTSqlLanguageService);

            // autoDisable set to false, so do nothing
            if (autoDisable === false) {
                return;
            }
            // autoDisable set to true, so disable language service
            else if (autoDisable) {
                changeLanguageServiceForFile(
                    SqlToolsServerClient.instance,
                    event.ownerUri,
                    Constants.noneProviderName,
                    this._statusView,
                );
            }
            // autoDisable not set yet; prompt the user for what to do
            else {
                const selectedOption = await vscode.window.showInformationMessage(
                    LocalizedConstants.autoDisableNonTSqlLanguageServicePrompt,
                    LocalizedConstants.msgYes,
                    LocalizedConstants.msgNo,
                );

                if (selectedOption === LocalizedConstants.msgYes) {
                    changeLanguageServiceForFile(
                        SqlToolsServerClient.instance,
                        event.ownerUri,
                        Constants.noneProviderName,
                        this._statusView,
                    );

                    sendActionEvent(
                        TelemetryViews.QueryEditor,
                        TelemetryActions.DisableLanguageServiceForNonTSqlFiles,
                        { selectedOption: LocalizedConstants.msgYes },
                    );

                    await this._vscodeWrapper
                        .getConfiguration()
                        .update(
                            Constants.configAutoDisableNonTSqlLanguageService,
                            true,
                            vscode.ConfigurationTarget.Global,
                        );
                } else if (selectedOption === LocalizedConstants.msgNo) {
                    await this._vscodeWrapper
                        .getConfiguration()
                        .update(
                            Constants.configAutoDisableNonTSqlLanguageService,
                            false,
                            vscode.ConfigurationTarget.Global,
                        );
                    sendActionEvent(
                        TelemetryViews.QueryEditor,
                        TelemetryActions.DisableLanguageServiceForNonTSqlFiles,
                        { selectedOption: LocalizedConstants.msgNo },
                    );
                } else {
                    sendActionEvent(
                        TelemetryViews.QueryEditor,
                        TelemetryActions.DisableLanguageServiceForNonTSqlFiles,
                        { selectedOption: LocalizedConstants.dismiss },
                    );
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

                void self._statusView.connectSuccess(
                    event.ownerUri,
                    connectionInfo.credentials,
                    connectionInfo.serverInfo,
                );

                let logMessage = LocalizedConstants.msgChangedDatabaseContext(
                    event.connection.databaseName,
                    event.ownerUri,
                );

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

            if (Utils.isNotEmpty(result.connectionId)) {
                // Convert to credentials if it's a connection string based connection
                if (connection.credentials.connectionString) {
                    connection.credentials = await this.populateCredentialsFromConnectionString(
                        connection.credentials,
                        result.connectionSummary,
                    );
                }
                this._connectionCredentialsToServerInfoMap.set(
                    connection.credentials,
                    result.serverInfo,
                );

                // We have a valid connection
                // Copy credentials as the database name will be updated
                let newCredentials: IConnectionInfo = <any>{};
                Object.assign<IConnectionInfo, IConnectionInfo>(
                    newCredentials,
                    connection.credentials,
                );
                if (result.connectionSummary && result.connectionSummary.databaseName) {
                    newCredentials.database = result.connectionSummary.databaseName;
                }
                self.handleConnectionSuccess(fileUri, connection, newCredentials, result);

                await this.handlePasswordStorageOnConnect(
                    connection.credentials as IConnectionProfile,
                );

                const promise = self._uriToConnectionPromiseMap.get(result.ownerUri);
                if (promise) {
                    promise.resolve(true);
                    self._uriToConnectionPromiseMap.delete(result.ownerUri);
                }
                const completePromise = self._uriToConnectionCompleteParamsMap.get(result.ownerUri);
                if (completePromise) {
                    completePromise.resolve(result);
                    self._uriToConnectionCompleteParamsMap.delete(result.ownerUri);
                }
            } else {
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
                const completePromise = self._uriToConnectionCompleteParamsMap.get(result.ownerUri);
                if (completePromise) {
                    completePromise.resolve(result);
                    self._uriToConnectionCompleteParamsMap.delete(result.ownerUri);
                }
                await self.handleConnectionErrors(fileUri, connection, result);
            }
            if (!result.errorMessage) {
                await self.tryAddMruConnection(connection);
            }
        };
    }

    private handleConnectionSuccess(
        fileUri: string,
        connection: ConnectionInfo,
        newCredentials: IConnectionInfo,
        result: ConnectionContracts.ConnectionCompleteParams,
    ): void {
        connection.connectionId = result.connectionId;
        connection.serverInfo = result.serverInfo;
        connection.credentials = newCredentials;
        connection.errorNumber = undefined;
        connection.errorMessage = undefined;

        void this.statusView.connectSuccess(fileUri, newCredentials, connection.serverInfo);
        this.statusView.languageServiceStatusChanged(
            fileUri,
            LocalizedConstants.updatingIntelliSenseStatus,
        );

        this._onSuccessfulConnectionEmitter.fire({
            connection,
            fileUri,
        });

        this._vscodeWrapper.logToOutputChannel(
            LocalizedConstants.msgConnectedServerInfo(
                connection.credentials.server,
                fileUri,
                JSON.stringify(connection.serverInfo),
            ),
        );
        sendActionEvent(
            TelemetryViews.ConnectionPrompt,
            TelemetryActions.CreateConnectionResult,
            undefined,
            undefined,
            newCredentials as IConnectionProfile,
            result.serverInfo,
        );
    }

    private async handleConnectionErrors(
        fileUri: string,
        connection: ConnectionInfo,
        result: ConnectionContracts.ConnectionCompleteParams,
    ): Promise<void> {
        if (result.errorNumber && result.errorMessage && !Utils.isEmpty(result.errorMessage)) {
            // Check if the error is an expired password
            if (
                result.errorNumber === Constants.errorPasswordExpired ||
                result.errorNumber === Constants.errorPasswordNeedsReset
            ) {
                // TODO: we should allow the user to change their password here once corefx supports SqlConnection.ChangePassword()
                Utils.showErrorMsg(
                    LocalizedConstants.msgConnectionErrorPasswordExpired(
                        result.errorNumber,
                        result.errorMessage,
                    ),
                );
            } else if (result.errorNumber === Constants.errorSSLCertificateValidationFailed) {
                // check if it's an SSL failed error
                this._failedUriToSSLMap.set(fileUri, result.errorMessage);
            } else if (result.errorNumber === Constants.errorFirewallRule) {
                let firewallResult = await this.firewallService.handleFirewallRule(
                    result.errorNumber,
                    result.errorMessage,
                );
                if (firewallResult.result && firewallResult.ipAddress) {
                    this.failedUriToFirewallIpMap.set(fileUri, result);
                } else {
                    Utils.showErrorMsg(
                        LocalizedConstants.msgConnectionError(
                            result.errorNumber,
                            result.errorMessage,
                        ),
                    );
                }
            } else {
                Utils.showErrorMsg(
                    LocalizedConstants.msgConnectionError(result.errorNumber, result.errorMessage),
                );
            }
            connection.errorNumber = result.errorNumber;
            connection.errorMessage = result.errorMessage;
        } else {
            const platformInfo = await PlatformInformation.getCurrent();
            if (
                !platformInfo.isWindows &&
                result.errorMessage &&
                result.errorMessage.includes("Kerberos")
            ) {
                const action = await this.vscodeWrapper.showErrorMessage(
                    LocalizedConstants.msgConnectionError2(result.errorMessage),
                    LocalizedConstants.macOpenSslHelpButton,
                );
                if (action && action === LocalizedConstants.macOpenSslHelpButton) {
                    await vscode.env.openExternal(
                        vscode.Uri.parse(Constants.integratedAuthHelpLink),
                    );
                }
            } else if (
                platformInfo.runtimeId === Runtime.OSX_10_11_64 &&
                result.messages.indexOf(
                    "Unable to load DLL 'System.Security.Cryptography.Native'",
                ) !== -1
            ) {
                const action = await this.vscodeWrapper.showErrorMessage(
                    LocalizedConstants.msgConnectionError2(
                        LocalizedConstants.macOpenSslErrorMessage,
                    ),
                    LocalizedConstants.macOpenSslHelpButton,
                );
                if (action && action === LocalizedConstants.macOpenSslHelpButton) {
                    await vscode.env.openExternal(vscode.Uri.parse(Constants.macOpenSslHelpLink));
                }
            } else {
                Utils.showErrorMsg(LocalizedConstants.msgConnectionError2(result.messages));
            }
        }
        this.statusView.connectError(fileUri, connection.credentials, result);
        this.vscodeWrapper.logToOutputChannel(
            LocalizedConstants.msgConnectionFailed(
                connection.credentials.server,
                result.errorMessage ? result.errorMessage : result.messages,
            ),
        );
        sendErrorEvent(
            TelemetryViews.ConnectionPrompt,
            TelemetryActions.CreateConnectionResult,
            new Error(result.errorMessage),
            false,
            result.errorNumber?.toString(),
            undefined,
            {
                containsError: "true",
            },
            undefined,
            connection.credentials as IConnectionProfile,
            result.serverInfo,
        );
    }

    public async showInstructionTextAsWarning(
        profile: IConnectionProfile,
        reconnectAction: IReconnectAction,
    ): Promise<void> {
        const selection = await this.vscodeWrapper.showWarningMessageAdvanced(
            LocalizedConstants.msgPromptSSLCertificateValidationFailed,
            { modal: false },
            [
                LocalizedConstants.enableTrustServerCertificate,
                LocalizedConstants.readMore,
                LocalizedConstants.Common.cancel,
            ],
        );
        if (selection === LocalizedConstants.enableTrustServerCertificate) {
            if (profile.connectionString) {
                // Append connection string with encryption options
                profile.connectionString = profile.connectionString.concat(
                    "; Encrypt=true; Trust Server Certificate=true;",
                );
            }
            profile.encrypt = EncryptOptions.Mandatory;
            profile.trustServerCertificate = true;
            await reconnectAction(profile);
        } else if (selection === LocalizedConstants.readMore) {
            this.vscodeWrapper.openExternal(Constants.encryptionBlogLink);
            await this.showInstructionTextAsWarning(profile, reconnectAction);
        } else if (selection === LocalizedConstants.Common.cancel) {
            await reconnectAction(undefined);
        }
    }

    public async handleSSLError(
        uri: string,
        profile: IConnectionProfile,
    ): Promise<IConnectionInfo | undefined> {
        let updatedConn: IConnectionInfo | undefined;
        await this.showInstructionTextAsWarning(profile, async (updatedConnection) => {
            // If the operation was cancelled, we return undefined indicating that the connection was not fixed.
            if (!updatedConnection) {
                this.failedUriToSSLMap.delete(uri);
                return;
            }
            vscode.commands.executeCommand(
                Constants.cmdConnectObjectExplorerProfile,
                updatedConnection,
            );
            updatedConn = updatedConnection;
        });
        this.failedUriToSSLMap.delete(uri);
        return updatedConn;
    }

    /**
     * Tries to add a connection to the list of most recently used connections. It saves the original credentials used to create the connection.
     * @param connection The original connection returned from the connect operation. It could be null if the connection operation was not successful.
     */
    private async tryAddMruConnection(connection: ConnectionInfo): Promise<void> {
        if (connection?.credentials) {
            let connectionToSave: IConnectionInfo = Object.assign({}, connection.credentials);
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
    private async populateCredentialsFromConnectionString(
        credentials: IConnectionInfo,
        connectionSummary: ConnectionSummary,
    ): Promise<IConnectionInfo> {
        // populate credential details
        credentials.database = connectionSummary.databaseName;
        credentials.user = connectionSummary.userName;
        credentials.server = connectionSummary.serverName;

        // save credentials if needed
        let isPasswordBased: boolean = ConnectionCredentials.isPasswordBasedConnectionString(
            credentials.connectionString,
        );
        if (isPasswordBased) {
            // save the connection string here
            await this._connectionStore.saveProfileWithConnectionString(
                credentials as IConnectionProfile,
            );
            // replace the conn string from the profile
            credentials.connectionString = ConnectionStore.formatCredentialId(
                credentials.server,
                credentials.database,
                credentials.user,
                ConnectionStore.CRED_PROFILE_USER,
                true,
            );

            // set auth type
            credentials.authenticationType = Constants.sqlAuthentication;

            // set savePassword to true so that credentials are automatically
            // deleted if the settings file is manually changed
            (credentials as IConnectionProfile).savePassword = true;
        } else {
            credentials.authenticationType = Constants.integratedauth;
        }

        return credentials;
    }

    /**
     * Clear the recently used connections list in the connection store.
     * @returns a boolean value indicating whether the credentials were deleted successfully.
     */
    public clearRecentConnectionsList(): Promise<boolean> {
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
        const result: ConnectionContracts.ListDatabasesResult = await this.client.sendRequest(
            ConnectionContracts.ListDatabasesRequest.type,
            listParams,
        );
        // Then let the user select a new database to connect to
        const newDatabaseCredentials = await this.connectionUI.showDatabasesOnCurrentServer(
            this._connections[fileUri].credentials,
            result.databaseNames,
        );
        if (newDatabaseCredentials) {
            this.vscodeWrapper.logToOutputChannel(
                LocalizedConstants.msgChangingDatabase(
                    newDatabaseCredentials.database,
                    newDatabaseCredentials.server,
                    fileUri,
                ),
            );
            await this.disconnect(fileUri);
            await this.connect(fileUri, newDatabaseCredentials);
            this.vscodeWrapper.logToOutputChannel(
                LocalizedConstants.msgChangedDatabase(
                    newDatabaseCredentials.database,
                    newDatabaseCredentials.server,
                    fileUri,
                ),
            );
            this._connections[fileUri].credentials = newDatabaseCredentials;
            return true;
        } else {
            return false;
        }
    }

    /**
     * Retrieves the list of databases for the connection specified by the given URI.
     * @param connectionUri The URI of the connection to list the databases for
     * @returns The list of databases retrieved from the connection
     */
    public async listDatabases(connectionUri: string): Promise<string[]> {
        await this.refreshAzureAccountToken(connectionUri);
        const listParams = new ConnectionContracts.ListDatabasesParams();
        listParams.ownerUri = connectionUri;
        const result: ConnectionContracts.ListDatabasesResult = await this.client.sendRequest(
            ConnectionContracts.ListDatabasesRequest.type,
            listParams,
        );
        return result.databaseNames;
    }

    public async changeDatabase(newDatabaseCredentials: IConnectionInfo): Promise<boolean> {
        const fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!this.isConnected(fileUri)) {
            this.vscodeWrapper.showWarningMessage(LocalizedConstants.msgChooseDatabaseNotConnected);
            return false;
        }
        await this.disconnect(fileUri);
        await this.connect(fileUri, newDatabaseCredentials);
        this.vscodeWrapper.logToOutputChannel(
            LocalizedConstants.msgChangedDatabase(
                newDatabaseCredentials.database,
                newDatabaseCredentials.server,
                fileUri,
            ),
        );
        return true;
    }

    public async onChooseLanguageFlavor(
        isSqlCmdMode: boolean = false,
        isSqlCmd: boolean = false,
    ): Promise<boolean> {
        const fileUri = this._vscodeWrapper.activeTextEditorUri;
        if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
            if (isSqlCmdMode) {
                SqlToolsServerClient.instance.sendNotification(
                    LanguageServiceContracts.LanguageFlavorChangedNotification.type,
                    <LanguageServiceContracts.DidChangeLanguageFlavorParams>{
                        uri: fileUri,
                        language: isSqlCmd ? "sqlcmd" : "sql",
                        flavor: "MSSQL",
                    },
                );
                return true;
            }
            const flavor = await this.connectionUI.promptLanguageFlavor();
            if (!flavor) {
                return false;
            }
            this.statusView.languageFlavorChanged(fileUri, flavor);
            SqlToolsServerClient.instance.sendNotification(
                LanguageServiceContracts.LanguageFlavorChangedNotification.type,
                <LanguageServiceContracts.DidChangeLanguageFlavorParams>{
                    uri: fileUri,
                    language: "sql",
                    flavor: flavor,
                },
            );
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

            const result: ConnectionContracts.DisconnectResult = await this.client.sendRequest(
                ConnectionContracts.DisconnectRequest.type,
                disconnectParams,
            );
            if (this.statusView) {
                this.statusView.notConnected(fileUri);
            }
            if (result) {
                this.vscodeWrapper.logToOutputChannel(LocalizedConstants.msgDisconnected(fileUri));
            }

            // Free any search metadata cached for this connection
            try {
                DatabaseObjectSearchService.clearCache(fileUri);
            } catch {
                // best-effort cleanup; ignore errors
            }

            this.removeActiveConnection(fileUri);
            this.updateConnectionsContext();
            return result;
        } else if (this.isConnecting(fileUri)) {
            // Prompt the user to cancel connecting
            await this.onCancelConnect();
            return true;
        } else {
            return true;
        }
    }

    private updateConnectionsContext() {
        /**
         * Making sure we keep encodings in the context. We need to convert the keys
         * to Uri and back to string because the keys in _connections might have skipped encoding.
         * This is done to match the behavior of how vscode core handles resource URIs in
         * contexts.
         * https://github.com/microsoft/vscode/blob/bb5a3c607b14787009f8e9fadb720beee596133c/src/vs/workbench/common/contextkeys.ts#L261C1-L262C1
         */
        vscode.commands.executeCommand(
            "setContext",
            "mssql.connections",
            Object.keys(this._connections).map((key) => {
                return vscode.Uri.parse(key).toString();
            }),
        );
    }

    /**
     * Helper to show all connections and perform connect logic.
     */
    public async showConnectionsAndConnect(fileUri: string): Promise<IConnectionInfo> {
        // show connection picklist
        const connectionProfileList = await this._connectionStore.getPickListItems();
        const connectionCreds = await this.connectionUI.promptForConnection(connectionProfileList);
        if (connectionCreds) {
            // close active connection
            await this.disconnect(fileUri);
            // connect to the server/database
            const result = await this.connect(fileUri, connectionCreds);

            const connectionOutcome = await this.handleConnectionResult(
                result,
                fileUri,
                connectionCreds,
            );
            if (!connectionOutcome) {
                // connection failed, return undefined
                return undefined;
            }
        }
        return connectionCreds;
    }

    /**
     * Get the server info for a connection
     * @param connectionCreds
     */
    public getServerInfo(connectionCredentials: IConnectionInfo): IServerInfo {
        if (this._connectionCredentialsToServerInfoMap.has(connectionCredentials)) {
            return this._connectionCredentialsToServerInfoMap.get(connectionCredentials);
        }
        for (const connection of this._connectionCredentialsToServerInfoMap.keys()) {
            if (Utils.isSameConnectionInfo(connection, connectionCredentials)) {
                return this._connectionCredentialsToServerInfoMap.get(connection);
            }
        }
    }

    /**
     * Verifies the connection result. If connection failed because of invalid credentials,
     * tries to connect again by asking user for different credentials
     * @param result Connection result
     * @param fileUri file Uri
     * @param connectionCreds Connection Profile
     */
    public async handleConnectionResult(
        result: boolean,
        fileUri: string,
        connectionCreds: IConnectionInfo,
    ): Promise<boolean> {
        let connection = this._connections[fileUri];
        if (!result && connection) {
            if (connection.loginFailed) {
                const newConnection =
                    await this.connectionUI.createProfileWithDifferentCredentials(connectionCreds);
                if (newConnection) {
                    const newResult = await this.connect(fileUri, newConnection);
                    connection = this._connections[fileUri];
                    if (!newResult && connection && connection.loginFailed) {
                        Utils.showErrorMsg(
                            LocalizedConstants.msgConnectionError(
                                connection.errorNumber,
                                connection.errorMessage,
                            ),
                        );
                    }
                    return newResult;
                } else {
                    return false;
                }
            } else if (
                connection.errorNumber === Constants.errorFirewallRule &&
                !this._useLegacyConnectionExperience
            ) {
                const addFirewallRuleController = new AddFirewallRuleWebviewController(
                    this.context,
                    this._vscodeWrapper,
                    {
                        serverName: connectionCreds.server,
                        errorMessage: connection.errorMessage,
                    },
                    this.firewallService,
                );
                addFirewallRuleController.panel.reveal();

                const wasCreated = await addFirewallRuleController.dialogResult;

                if (wasCreated === true /** dialog closed is undefined */) {
                    return await this.connect(fileUri, connection.credentials);
                } else {
                    return false;
                }
            } else if (connection.errorNumber === Constants.errorSSLCertificateValidationFailed) {
                const updatedConnection = await this.handleSSLError(
                    fileUri,
                    connectionCreds as IConnectionProfile,
                );
                if (updatedConnection) {
                    return await this.connect(fileUri, updatedConnection);
                } else {
                    return false;
                }
            }

            // Clean up failed connection and fire event to update UI elements like codelens
            delete this._connections[fileUri];
            this._onConnectionsChangedEmitter.fire();
            return false;
        } else {
            return true;
        }
    }

    /**
     * Delete a credential from the credential store
     */
    public async deleteCredential(profile: IConnectionProfile): Promise<void> {
        await this._connectionStore.deleteCredential(profile);
    }

    /**
     * Confirm that the is in a ready-to-connect state (active document is a SQL file),
     * then prompts the user to select a connection via quickpick
     * @returns the connection profile selected by the user, or undefined if canceled
     */
    public async onNewConnection(): Promise<IConnectionInfo> {
        const fileUri = this.vscodeWrapper.activeTextEditorUri;
        if (!fileUri) {
            // A text document needs to be open before we can connect
            this.vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            return undefined;
        }

        if (!this.vscodeWrapper.isEditingSqlFile) {
            if (!(await this.connectionUI.promptToChangeLanguageMode())) {
                return undefined; // cancel operation
            }
        }

        const connProfile = await this.showConnectionsAndConnect(fileUri);
        return connProfile;
    }

    /**
     * Checks the Entra token's validity, and refreshes if necessary.
     * Does nothing if connection is not using Entra auth.
     */
    public async confirmEntraTokenValidity(connectionInfo: IConnectionInfo) {
        if (connectionInfo.authenticationType !== Constants.azureMfa) {
            // Connection not using Entra auth, nothing to validate
            return;
        }

        if (
            AzureController.isTokenValid(connectionInfo.azureAccountToken, connectionInfo.expiresOn)
        ) {
            // Token not expired, nothing to refresh
            return;
        }

        let account: IAccount;
        let profile: ConnectionProfile;

        if (connectionInfo.accountId) {
            account = await this.accountStore.getAccount(connectionInfo.accountId);
            profile = new ConnectionProfile(connectionInfo);
        } else {
            throw new Error(LocalizedConstants.cannotConnect);
        }

        if (!account) {
            throw new Error(LocalizedConstants.msgAccountNotFound);
        }

        // Always set username
        connectionInfo.user = account.displayInfo.displayName;
        connectionInfo.email = account.displayInfo.email;
        profile.user = account.displayInfo.displayName;
        profile.email = account.displayInfo.email;

        const azureAccountToken = await this.azureController.refreshAccessToken(
            account,
            this.accountStore,
            profile.tenantId,
            providerSettings.resources.databaseResource!,
        );

        if (!azureAccountToken) {
            let errorMessage = LocalizedConstants.msgAccountRefreshFailed;
            let refreshResult = await this.vscodeWrapper.showErrorMessage(
                errorMessage,
                LocalizedConstants.refreshTokenLabel,
            );
            if (refreshResult === LocalizedConstants.refreshTokenLabel) {
                await this.azureController.populateAccountProperties(
                    profile,
                    this.accountStore,
                    providerSettings.resources.databaseResource!,
                );
            } else {
                throw new Error(LocalizedConstants.cannotConnect);
            }
        } else {
            connectionInfo.azureAccountToken = azureAccountToken.token;
            connectionInfo.expiresOn = azureAccountToken.expiresOn;
        }
    }

    /**
     * Handles password-based credential authentication by prompting for password if needed.
     * This method checks if a password is required and prompts the user if it's not saved or available.
     *
     * @param connectionCreds The connection credentials to process
     * @returns Promise that resolves to true if password handling was successful, false if user cancelled
     */
    public async handlePasswordBasedCredentials(
        connectionCreds: IConnectionInfo,
    ): Promise<boolean> {
        if (ConnectionCredentials.isPasswordBasedCredential(connectionCreds)) {
            // show password prompt if SQL Login and password isn't saved
            let password = connectionCreds.password;
            if (Utils.isEmpty(password)) {
                password = await this.connectionStore.lookupPassword(connectionCreds);
                if (!password) {
                    password = await this.connectionUI.promptForPassword();
                    if (!password) {
                        return false;
                    }
                }

                if (connectionCreds.authenticationType !== Constants.azureMfa) {
                    connectionCreds.azureAccountToken = undefined;
                }
                connectionCreds.password = password;
            }
        }
        return true;
    }

    /**
     * Saves password for the connection profile on successful connection.
     * NOTE: To be only called when the connection is successful.
     * @param profile Profile to save password for
     */
    public async handlePasswordStorageOnConnect(profile: IConnectionProfile): Promise<void> {
        await this.connectionStore.saveProfilePasswordIfNeeded(profile);
    }

    /**
     * create a new connection with the connectionCreds provided
     * @param fileUri
     * @param connectionCreds ConnectionInfo to connect with
     * @param promise Deferred promise to resolve when connection is complete
     * @returns true if connection is successful, false otherwise
     */
    public async connect(
        fileUri: string,
        connectionCreds: IConnectionInfo,
        promise?: Deferred<boolean>,
    ): Promise<boolean> {
        if (!connectionCreds.server && !connectionCreds.connectionString) {
            throw new Error(LocalizedConstants.serverNameMissing);
        }

        if (connectionCreds.authenticationType === Constants.azureMfa) {
            await this.confirmEntraTokenValidity(connectionCreds);
        }

        // Handle password-based credentials
        const passwordResult = await this.handlePasswordBasedCredentials(connectionCreds);
        if (!passwordResult) {
            return false;
        }

        let connectionPromise = new Promise<boolean>(async (resolve, reject) => {
            if (
                connectionCreds.connectionString?.includes(ConnectionStore.CRED_PREFIX) &&
                connectionCreds.connectionString?.includes("isConnectionString:true")
            ) {
                let connectionString = await this.connectionStore.lookupPassword(
                    connectionCreds,
                    true,
                );
                connectionCreds.connectionString = connectionString;
            }

            let connectionInfo: ConnectionInfo = new ConnectionInfo();
            connectionInfo.credentials = connectionCreds;
            connectionInfo.connecting = true;
            this.addActiveConnection(fileUri, connectionInfo);

            // Note: must call flavor changed before connecting, or the timer showing an animation doesn't occur
            if (this.statusView) {
                this.statusView.languageFlavorChanged(fileUri, Constants.mssqlProviderName);
                this.statusView.connecting(fileUri, connectionCreds);
                this.statusView.languageFlavorChanged(fileUri, Constants.mssqlProviderName);
            }

            this.vscodeWrapper.logToOutputChannel(
                LocalizedConstants.msgConnecting(connectionCreds.server, fileUri),
            );

            // Setup the handler for the connection complete notification to call
            connectionInfo.connectHandler = (connectResult, error) => {
                if (error) {
                    reject(error);
                } else {
                    this.updateConnectionsContext();
                    resolve(connectResult);
                }
            };

            // package connection details for request message
            const connectionDetails =
                ConnectionCredentials.createConnectionDetails(connectionCreds);
            let connectParams = new ConnectionContracts.ConnectParams();
            connectParams.ownerUri = fileUri;
            connectParams.connection = connectionDetails;

            // send connection request message to service host
            this._uriToConnectionPromiseMap.set(connectParams.ownerUri, promise!);
            try {
                const result = await this.client.sendRequest(
                    ConnectionContracts.ConnectionRequest.type,
                    connectParams,
                );
                if (result) {
                    sendActionEvent(TelemetryViews.ConnectionManager, TelemetryActions.Connect, {
                        serverTypes: getServerTypes(connectionCreds).join(","),
                    });
                } else {
                    // Failed to process connect request
                    sendErrorEvent(
                        TelemetryViews.ConnectionManager,
                        TelemetryActions.Connect,
                        new Error("Failed to initiate connection"),
                        true, // includeErrorMessage,
                        undefined, // errorCode
                        undefined, // errorType
                        {
                            serverTypes: getServerTypes(connectionCreds).join(","),
                        },
                    );
                    resolve(false);
                }
            } catch (error) {
                reject(error);
            }
        });
        return connectionPromise;
    }

    public async connectDialog(
        connectionCreds: IConnectionInfo,
    ): Promise<ConnectionContracts.ConnectionCompleteParams> {
        // If the connection info doesn't have server or connection string, throw an error
        if (!connectionCreds.server && !connectionCreds.connectionString) {
            throw new Error(LocalizedConstants.serverNameMissing);
        }

        // Check if the azure account token is present before sending connect request
        if (connectionCreds.authenticationType === Constants.azureMfa) {
            await this.confirmEntraTokenValidity(connectionCreds);
        }

        // Fetch the connection string from the connection store if necessary
        if (
            connectionCreds.connectionString?.includes(ConnectionStore.CRED_PREFIX) &&
            connectionCreds.connectionString?.includes("isConnectionString:true")
        ) {
            let connectionString = await this.connectionStore.lookupPassword(connectionCreds, true);
            connectionCreds.connectionString = connectionString;
        }

        const uri = ObjectExplorerUtils.getNodeUriFromProfile(
            connectionCreds as IConnectionProfile,
        );
        let connectionInfo: ConnectionInfo = new ConnectionInfo();
        connectionInfo.credentials = connectionCreds;
        connectionInfo.connecting = true;
        // Setup the handler for the connection complete notification to call
        connectionInfo.connectHandler = (connectionResult, error) => {};
        this._connections[uri] = connectionInfo;

        // Note: must call flavor changed before connecting, or the timer showing an animation doesn't occur
        if (this.statusView) {
            this.statusView.languageFlavorChanged(uri, Constants.mssqlProviderName);
            this.statusView.connecting(uri, connectionCreds);
            this.statusView.languageFlavorChanged(uri, Constants.mssqlProviderName);
        }

        // this.vscodeWrapper.logToOutputChannel(
        // 	Utils.formatString(LocalizedConstants.msgConnecting, connectionCreds.server, fileUri)
        // );

        const connectionDetails = ConnectionCredentials.createConnectionDetails(connectionCreds);
        let connectParams = new ConnectionContracts.ConnectParams();
        connectParams.ownerUri = uri;
        connectParams.connection = connectionDetails;

        const connectionCompletePromise =
            new Deferred<ConnectionContracts.ConnectionCompleteParams>();
        this._uriToConnectionCompleteParamsMap.set(
            connectParams.ownerUri,
            connectionCompletePromise,
        );

        try {
            const result = await this.client.sendRequest(
                ConnectionContracts.ConnectionRequest.type,
                connectParams,
            );
            if (!result) {
                // Failed to process connect request
                throw new Error("Failed to connect");
            }
        } catch (error) {
            throw new Error("Failed to connect");
        }

        return await connectionCompletePromise;
    }

    private addActiveConnection(fileUri: string, connectionInfo: ConnectionInfo) {
        this._connections[fileUri] = connectionInfo;
        this._onConnectionsChangedEmitter.fire();
    }

    private removeActiveConnection(fileUri: string): void {
        delete this._connections[fileUri];
        this._onConnectionsChangedEmitter.fire();
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

        let cancelParams: ConnectionContracts.CancelConnectParams =
            new ConnectionContracts.CancelConnectParams();
        cancelParams.ownerUri = fileUri;

        const result = await this.client.sendRequest(
            ConnectionContracts.CancelConnectRequest.type,
            cancelParams,
        );
        if (result) {
            this.statusView.notConnected(fileUri);
        }
    }

    /**
     * Called when the 'Manage Connection Profiles' command is issued.
     */
    public onManageProfiles(): Promise<boolean> {
        // Show quick pick to create, edit, or remove profiles
        return this.connectionUI.promptToManageProfiles();
    }

    public async onClearPooledConnections(): Promise<void> {
        return await this._client.sendRequest(ClearPooledConnectionsRequest.type, {});
    }

    public async onCreateProfile(): Promise<boolean> {
        let self = this;
        const profile = await self.connectionUI.createAndSaveProfile(
            self.vscodeWrapper.isEditingSqlFile,
        );
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
        if (doc.languageId === "sql" && typeof this._connections[uri] === "undefined") {
            this.statusView.notConnected(uri);
        }
    }

    /**
     * Copies the connection info from one file to another, optionally disconnecting the old file.
     * @param oldFileUri File to copy the connection info from
     * @param newFileUri File to copy the connection info to
     * @param keepOldConnected Whether to keep the old file connected after copying the connection info.  Defaults to false.
     * @returns
     */
    public async copyConnectionToFile(oldFileUri: string, newFileUri: string): Promise<void> {
        // Is the new file connected or the old file not connected?
        if (!this.isConnected(oldFileUri) || this.isConnected(newFileUri)) {
            return;
        }

        // Connect the saved uri and disconnect the untitled uri on successful connection
        let creds: IConnectionInfo = this._connections[oldFileUri].credentials;
        await this.connect(newFileUri, creds);
    }

    public async refreshAzureAccountToken(uri: string): Promise<void> {
        const profile = this.getConnectionInfo(uri);
        if (!profile) {
            this.vscodeWrapper.logToOutputChannel(LocalizedConstants.msgConnectionNotFound(uri));
            return;
        }

        // Wait for the pending reconnction promise if any
        const previousReconnectPromise = this._uriToConnectionPromiseMap.get(uri);
        if (previousReconnectPromise) {
            this.vscodeWrapper.logToOutputChannel(LocalizedConstants.msgFoundPendingReconnect(uri));
            try {
                const previousConnectionResult = await previousReconnectPromise;
                if (previousConnectionResult) {
                    this.vscodeWrapper.logToOutputChannel(
                        LocalizedConstants.msgPendingReconnectSuccess(uri),
                    );
                    return;
                }
                this.vscodeWrapper.logToOutputChannel(
                    LocalizedConstants.msgFoundPendingReconnectFailed(uri),
                );
            } catch (err) {
                this.vscodeWrapper.logToOutputChannel(
                    LocalizedConstants.msgFoundPendingReconnectError(uri, err),
                );
            }
        }

        const expiry = profile.credentials.expiresOn;
        if (typeof expiry === "number" && !Number.isNaN(expiry)) {
            if (AzureController.isTokenExpired(expiry)) {
                this.vscodeWrapper.logToOutputChannel(
                    LocalizedConstants.msgAcessTokenExpired(profile.connectionId, uri),
                );
                try {
                    let connectionResult = await this.connect(uri, profile.credentials);
                    if (!connectionResult) {
                        this.vscodeWrapper.showErrorMessage(
                            LocalizedConstants.msgRefreshConnection(profile.connectionId, uri),
                        );
                        throw new Error("Unable to refresh connection");
                    }
                    this.vscodeWrapper.logToOutputChannel(
                        LocalizedConstants.msgRefreshTokenSuccess(
                            profile.connectionId,
                            uri,
                            JSON.stringify(this.getConnectionInfo(uri)),
                        ),
                    );
                    return;
                } catch {
                    this.vscodeWrapper.showInformationMessage(
                        LocalizedConstants.msgRefreshTokenError,
                    );
                }
            }
            this.vscodeWrapper.logToOutputChannel(
                LocalizedConstants.msgRefreshTokenNotNeeded(profile.connectionId, uri),
            );
        }
        return;
    }

    public async addAccount(): Promise<IAccount> {
        let account = await this.connectionUI.addNewAccount();
        if (account) {
            this.vscodeWrapper.showInformationMessage(
                LocalizedConstants.accountAddedSuccessfully(account.displayInfo.displayName),
            );
        } else {
            this.vscodeWrapper.showErrorMessage(LocalizedConstants.accountCouldNotBeAdded);
        }
        return account;
    }

    public async removeAccount(prompter: IPrompter): Promise<void> {
        // list options for accounts to remove
        let questions: IQuestion[] = [];
        let azureAccountChoices = await ConnectionProfile.getAccountChoices(this._accountStore);

        if (azureAccountChoices.length > 0) {
            questions.push({
                type: QuestionTypes.expand,
                name: "account",
                message: LocalizedConstants.azureChooseAccount,
                choices: azureAccountChoices,
            });

            return prompter.prompt<IAccount>(questions, true).then(async (answers) => {
                if (answers?.account) {
                    try {
                        if (answers.account.key) {
                            await this._accountStore.removeAccount(answers.account.key.id);
                        } else {
                            await this._accountStore.pruneInvalidAccounts();
                        }
                        void this.azureController.removeAccount(answers.account);
                        this.vscodeWrapper.showInformationMessage(
                            LocalizedConstants.accountRemovedSuccessfully,
                        );
                    } catch (e) {
                        this.vscodeWrapper.showErrorMessage(
                            LocalizedConstants.accountRemovalFailed(e.message),
                        );
                    }
                }
            });
        } else {
            this.vscodeWrapper.showInformationMessage(LocalizedConstants.noAzureAccountForRemoval);
        }
    }

    public onClearTokenCache(): void {
        this.azureController.clearTokenCache();
        this.vscodeWrapper.showInformationMessage(LocalizedConstants.clearedAzureTokenCache);
    }

    private async migrateLegacyConnectionProfiles(): Promise<void> {
        this._logger.logDebug("Beginning migration of legacy connections");

        const connections: IConnectionProfile[] =
            await this.connectionStore.readAllConnections(false);
        const tally = {
            migrated: 0,
            notNeeded: 0,
            error: 0,
        };

        for (const connection of connections) {
            const result = await this.migrateLegacyConnection(connection);

            tally[result] = (tally[result] || 0) + 1;
        }

        if (tally.migrated > 0) {
            this._logger.verbose(
                `Completed migration of legacy Connection String connections. (${tally.migrated} migrated, ${tally.notNeeded} not needed, ${tally.error} errored)`,
            );
        } else {
            this._logger.verbose(
                `No legacy Connection String connections found to migrate. (${tally.notNeeded} not needed, ${tally.error} errored)`,
            );
        }

        sendActionEvent(
            TelemetryViews.General,
            TelemetryActions.MigrateLegacyConnections,
            {}, // properties
            {
                ...tally,
            },
        );
    }

    private async migrateLegacyConnection(
        profile: IConnectionProfile,
    ): Promise<"notNeeded" | "migrated" | "error"> {
        try {
            if (Utils.isEmpty(profile.connectionString)) {
                return "notNeeded"; // Not a connection string profile; skip
            }

            let connectionString = profile.connectionString;

            // Get the real connection string from credentials store if necessary
            if (connectionString.includes(ConnectionStore.CRED_CONNECTION_STRING_PREFIX)) {
                const retrievedString = await this.connectionStore.lookupPassword(profile, true);
                connectionString = retrievedString ?? connectionString;
            }

            // merge profile from connection string with existing profile
            const connDetails = await this.parseConnectionString(connectionString);
            const profileFromString = ConnectionCredentials.removeUndefinedProperties(
                ConnectionCredentials.createConnectionInfo(connDetails),
            );

            const newProfile: IConnectionProfile = {
                ...profileFromString,
                ...profile,
            };

            const passwordIndex = connectionString.toLowerCase().indexOf("password=");

            if (passwordIndex !== -1) {
                // extract password from connection string
                const passwordStart = passwordIndex + "password=".length;
                const passwordEnd = connectionString.indexOf(";", passwordStart);

                newProfile.password = connectionString.substring(
                    passwordStart,
                    passwordEnd === -1 ? undefined : passwordEnd, // if no further semicolon found, password must be the last item in the connection string
                );

                newProfile.savePassword = true;
            }

            // clear the old connection string from the profile as it no longer has useful information
            newProfile.connectionString = "";

            await this.connectionStore.saveProfile(newProfile);
            return "migrated";
        } catch (err) {
            this._logger.error(
                `Error migrating legacy connection with ID ${profile.id}: ${getErrorMessage(err)}`,
            );

            this.vscodeWrapper.showErrorMessage(
                LocalizedConstants.Connection.errorMigratingLegacyConnection(
                    profile.id,
                    getErrorMessage(err),
                ),
            );

            sendErrorEvent(
                TelemetryViews.General,
                TelemetryActions.MigrateLegacyConnections,
                err,
                false, // includeErrorMessage
            );

            return "error";
        }
    }

    /**
     * Get the connection info for a given file URI
     * @param uri The file URI
     * @returns The connection info or undefined if not found
     */
    public getConnectionInfoFromUri(uri: string): IConnectionInfo | undefined {
        if (this._connections[uri]) {
            return this._connections[uri].credentials;
        }
        return undefined;
    }

    private async handleSecurityTokenRequest(
        params: RequestSecurityTokenParams,
    ): Promise<RequestSecurityTokenResponse> {
        if (this._keyVaultTokenCache.has(JSON.stringify(params))) {
            const token = this._keyVaultTokenCache.get(JSON.stringify(params));
            const isExpired = AzureController.isTokenExpired(token.expiresOn);
            if (!isExpired) {
                return {
                    accountKey: token.key,
                    token: token.token,
                };
            } else {
                this._keyVaultTokenCache.delete(JSON.stringify(params));
            }
        }
        const account = await this.selectAccount();
        const tenant = await this.selectTenantId(account);

        const token = await this.azureController.getAccountSecurityToken(
            account,
            tenant,
            providerSettings.resources.azureKeyVaultResource,
        );

        this._keyVaultTokenCache.set(JSON.stringify(params), token);

        return {
            accountKey: token.key,
            token: token.token,
        };
    }

    private async selectAccount(): Promise<IAccount> {
        const activeEditorConnection =
            this._connections[this._vscodeWrapper.activeTextEditorUri]?.credentials;
        const currentAccountId = activeEditorConnection?.accountId;
        const accounts = await this._accountStore.getAccounts();

        const quickPickItems = this.createAccountQuickPickItems(accounts, currentAccountId);
        const selectedAccount = await this.showAccountQuickPick(quickPickItems);

        if (!selectedAccount) {
            throw new Error(LocalizedConstants.Connection.noAccountSelected);
        }

        return selectedAccount;
    }

    private createAccountQuickPickItems(
        accounts: IAccount[],
        currentAccountId?: string,
    ): AccountQuickPickItem[] {
        const accountItems: AccountQuickPickItem[] = accounts.map((account) => ({
            label:
                account.key.id === currentAccountId
                    ? LocalizedConstants.Connection.currentAccount(account.displayInfo.name)
                    : account.displayInfo.name,
            description: account.displayInfo.email,
            account,
        }));

        accountItems.push({
            label: LocalizedConstants.Connection.signInToAzure,
            description: LocalizedConstants.Connection.signInToAzure,
            account: undefined,
        });

        return accountItems;
    }

    private async showAccountQuickPick(
        items: AccountQuickPickItem[],
    ): Promise<IAccount | undefined> {
        const account = await new Promise<IAccount | undefined>((resolve, reject) => {
            const quickPick = vscode.window.createQuickPick<AccountQuickPickItem>();
            quickPick.items = items;
            quickPick.placeholder = LocalizedConstants.Connection.SelectAccountForKeyVault;

            quickPick.onDidAccept(async () => {
                try {
                    const selectedItem = quickPick.selectedItems[0];
                    if (!selectedItem) {
                        resolve(undefined);
                        return;
                    }

                    const account = selectedItem.account;
                    quickPick.dispose();
                    resolve(account);
                } catch (error) {
                    quickPick.dispose();
                    reject(error);
                }
            });
            quickPick.show();
        });
        return account;
    }

    private async selectTenantId(account: IAccount): Promise<string> {
        if (account.properties?.tenants?.length === 1) {
            return account.properties.tenants[0].id;
        }
        const tenantItems = account.properties.tenants.map((tenant) => ({
            label: tenant.displayName,
            description: tenant.id,
            tenant: tenant.id,
        }));

        const selectedTenant = await this.showTenantQuickPick(tenantItems);
        if (!selectedTenant) {
            throw new Error(LocalizedConstants.Connection.NoTenantSelected);
        }

        return selectedTenant;
    }

    private async showTenantQuickPick(items: TenantQuickPickItem[]): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            const quickPick = vscode.window.createQuickPick<TenantQuickPickItem>();
            quickPick.items = items;
            quickPick.placeholder = LocalizedConstants.Connection.SelectTenant;

            quickPick.onDidAccept(() => {
                const selectedItem = quickPick.selectedItems[0];
                if (selectedItem) {
                    quickPick.dispose();
                    resolve(selectedItem.tenant);
                } else {
                    quickPick.dispose();
                    resolve(undefined);
                }
            });

            quickPick.onDidHide(() => {
                quickPick.dispose();
            });

            quickPick.show();
        });
    }
}

interface AccountQuickPickItem {
    label: string;
    description: string;
    account?: IAccount;
}

interface TenantQuickPickItem {
    label: string;
    description: string;
    tenant: string; // Replace with proper tenant type
}
