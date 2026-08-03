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
import { getCloudId, getCloudProviderSettings } from "../azure/providerSettings";
import {
    azureStatusesToRetry,
    AzureSqlDatabaseStatus,
    VsCodeAzureHelper,
} from "../connectionconfig/azureHelpers";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
    MissingEntraAuthAccountError,
} from "../azure/vscodeEntraMfaUtils";
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
import {
    AuthenticationTypes,
    EncryptOptions,
    IConnectionGroup,
    IConnectionProfile,
} from "../models/interfaces";
import { PlatformInformation } from "../models/platform";
import * as Utils from "../models/utils";
import { IPrompter, IQuestion, QuestionTypes } from "../prompts/question";
import { Deferred } from "../protocol";
import { ConnectionUI } from "../views/connectionUI";
import StatusView from "../views/statusView";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";
import {
    ActivityObject,
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { changeLanguageServiceForFile } from "../languageservice/utils";
import { AddFirewallRuleWebviewController } from "./addFirewallRuleWebviewController";
import { getErrorMessage, uuid } from "../utils/utils";
import { ILogger } from "../sharedInterfaces/logger";
import { logger } from "../models/logger";
import { getServerTypes, canCheckDatabasePauseStatus } from "../models/connectionInfo";
import * as AzureConstants from "../azure/constants";
import { ChangePasswordService } from "../services/changePasswordService";
import { checkIfConnectionIsDockerContainer } from "../docker/dockerUtils";
import { PreviewFeature, previewService } from "../previews/previewService";

/**
 * Maximum number of connection retries when a target serverless Azure SQL database is
 * not online.
 */
export const serverlessWakeMaxRetryAttempts = 2;

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

    /**
     * Messages returned from the SQL Tools Service during connection
     */
    public messages: string;

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
    private _uriToConnectionCompleteParamsMap: Map<
        string,
        Deferred<ConnectionContracts.ConnectionCompleteParams>
    >;
    private _keyVaultTokenCache: Map<string, IToken> = new Map<string, IToken>();
    private _accountService: AccountService;
    private _firewallService: FirewallService;
    public azureController: AzureController;
    private _changePasswordService: ChangePasswordService;

    private _onConnectionsChangedEmitter: vscode.EventEmitter<void> =
        new vscode.EventEmitter<void>();
    public readonly onConnectionsChanged: vscode.Event<void> =
        this._onConnectionsChangedEmitter.event;

    private _onSuccessfulConnectionEmitter: vscode.EventEmitter<ConnectionSuccessfulEvent> =
        new vscode.EventEmitter<ConnectionSuccessfulEvent>();
    public readonly onSuccessfulConnection: vscode.Event<ConnectionSuccessfulEvent> =
        this._onSuccessfulConnectionEmitter.event;

    public initialized: Deferred<void> = new Deferred<void>();

    private _entraLogger: ILogger;

    constructor(
        private context: vscode.ExtensionContext,
        statusView: StatusView,
        prompter: IPrompter,
        private _logger?: ILogger,
        private _client?: SqlToolsServerClient,
        private _connectionStore?: ConnectionStore,
        private _credentialStore?: CredentialStore,
        private _connectionUI?: ConnectionUI,
        private _accountStore?: AccountStore,
    ) {
        this._statusView = statusView;
        this._connections = {};
        this._connectionCredentialsToServerInfoMap = new Map<IConnectionInfo, IServerInfo>();
        this._uriToConnectionCompleteParamsMap = new Map<
            string,
            Deferred<ConnectionContracts.ConnectionCompleteParams>
        >();

        if (!this.client) {
            this.client = SqlToolsServerClient.instance;
        }
        if (!this._logger) {
            this._logger = logger.withPrefix("ConnectionManager");
        }

        this._entraLogger = logger.withPrefix("Entra Auth");

        if (!this._credentialStore) {
            this._credentialStore = new CredentialStore(context);
        }

        if (!this._connectionStore) {
            this._connectionStore = new ConnectionStore(context, this._credentialStore);
        }

        if (!this._accountStore) {
            this._accountStore = new AccountStore(context);
        }

        if (!this._connectionUI) {
            this._connectionUI = new ConnectionUI(this, this._accountStore, prompter);
        }

        if (!this.azureController) {
            this.azureController = new MsalAzureController(
                context,
                prompter,
                this._credentialStore,
            );
        }

        // Initiate the firewall service
        this._accountService = new AccountService(
            this.client,
            this._accountStore,
            this.azureController,
        );
        this._firewallService = new FirewallService(this._accountService);

        this._changePasswordService = new ChangePasswordService(this.client, this.context);

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
            this.client.onNotification(
                ConnectionContracts.RefreshTokenNotification.type,
                this.handleRefreshTokenNotification(),
            );
        }
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.connectionStore.initialized;
        await this.performConnectionStartupChecks();

        this.initialized.resolve();
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

    public get accountService(): AccountService {
        return this._accountService;
    }

    public get firewallService(): FirewallService {
        return this._firewallService;
    }

    public get changePasswordService(): ChangePasswordService {
        return this._changePasswordService;
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
            Utils.isNotEmpty(this._connections[fileUri].connectionId) &&
            this._connections[fileUri].connecting === false &&
            this._connections[fileUri].errorNumber === undefined &&
            this._connections[fileUri].errorMessage === undefined
        );
    }

    public isConnecting(fileUri: string): boolean {
        return fileUri in this._connections && this._connections[fileUri].connecting;
    }

    /**
     * Finds the closest-matching profile from the saved connections for the given partial connection profile
     * @param connProfile partial connection profile to match against
     * @returns closest-matching connection profile from the saved connections. If none is found, returns {score: MatchScore.NotMatch}
     */
    public async findMatchingProfile(
        connProfile: IConnectionProfile,
    ): Promise<{ profile: IConnectionProfile; score: Utils.MatchScore }> {
        return this.connectionStore.findMatchingProfile(connProfile);
    }

    /**
     * For Azure MFA connections, ensures the accountId is present in the connection info.
     * If accountId is missing, attempts to find it from saved connection profiles.
     * Ex: This is needed when opening connections from stored profiles like .scmp and publish.xml files.
     * @param connectionInfo The connection info to populate with accountId if missing (modified in place)
     * @returns true if accountId was found and populated, false otherwise
     */
    public async ensureAccountIdForAzureMfa(connectionInfo: IConnectionInfo): Promise<boolean> {
        const matchResult = await this.findMatchingProfile(new ConnectionProfile(connectionInfo));

        // Only use the accountId if we have a strong match (at least server-level match)
        // to avoid using the wrong account for connections to the same server
        if (
            matchResult &&
            matchResult.profile &&
            matchResult.profile.accountId &&
            matchResult.score >= Utils.MatchScore.Server
        ) {
            connectionInfo.accountId = matchResult.profile.accountId;
            return true;
        }
        return false;
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
        return this.client.sendRequest(ConnectionContracts.ParseConnectionStringRequest.type, {
            connectionString,
        });
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
    public async sendRequest<P, R, E>(requestType: RequestType<P, R, E>, params?: P): Promise<R> {
        return await this.client.sendRequest(requestType, params);
    }

    /**
     * Registers interest in the `connection/complete` notification for a URI and returns a
     * promise that resolves with the completion params. The `connection/connect` request only
     * acknowledges that a connection attempt started; the actual outcome arrives later via
     * this notification. Callers that send ConnectionRequest directly (e.g. notebook cell
     * IntelliSense registration) use this to observe the real result — call BEFORE sending
     * the request, and pair with {@link cancelConnectionCompleteExpectation} on timeout so
     * the pending entry doesn't leak.
     */
    public expectConnectionComplete(
        ownerUri: string,
    ): Promise<ConnectionContracts.ConnectionCompleteParams> {
        const deferred = new Deferred<ConnectionContracts.ConnectionCompleteParams>();
        this._uriToConnectionCompleteParamsMap.set(ownerUri, deferred);
        return deferred.promise;
    }

    /**
     * Removes a pending `connection/complete` expectation registered via
     * {@link expectConnectionComplete} (no-op if it already resolved).
     * @param expectation When provided, the entry is only removed if it still
     * belongs to this expectation — a later expectConnectionComplete call for
     * the same URI supersedes the old one, and a stale caller's cleanup must
     * not cancel the newer expectation.
     */
    public cancelConnectionCompleteExpectation(
        ownerUri: string,
        expectation?: Promise<ConnectionContracts.ConnectionCompleteParams>,
    ): void {
        const pending = this._uriToConnectionCompleteParamsMap.get(ownerUri);
        if (!pending) {
            return;
        }
        if (expectation && pending.promise !== expectation) {
            return;
        }
        this._uriToConnectionCompleteParamsMap.delete(ownerUri);
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
            const autoDisable: boolean | undefined = await vscode.workspace
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

                    await vscode.workspace
                        .getConfiguration()
                        .update(
                            Constants.configAutoDisableNonTSqlLanguageService,
                            true,
                            vscode.ConfigurationTarget.Global,
                        );
                } else if (selectedOption === LocalizedConstants.msgNo) {
                    await vscode.workspace
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

                self._logger.info(logMessage);
            }
        };
    }

    /**
     * Handles the account/refreshToken notification from the service.
     * Acquires a fresh token using VS Code accounts or MSAL, then sends
     * account/tokenRefreshed back to the service.
     */
    public handleRefreshTokenNotification(): NotificationHandler<ConnectionContracts.RefreshTokenParams> {
        const self = this;
        return (params: ConnectionContracts.RefreshTokenParams): void => {
            void (async () => {
                const useVscodeAccountsForEntraMFA = previewService.isFeatureEnabled(
                    PreviewFeature.UseVscodeAccountsForEntraMFA,
                );

                // Always send a tokenRefreshed notification back to STS so it can unblock
                // IntelliSense (via TokenUpdateUris). On failure, send empty token/expiresOn=0;
                // STS's TryUpdateAccessToken will no-op on an empty token.
                const sendFailureNotification = () => {
                    self.client?.sendNotification(
                        ConnectionContracts.TokenRefreshedNotification.type,
                        { token: "", expiresOn: 0, uri: params.uri },
                    );
                };

                try {
                    let token: string | undefined;
                    let expiresOn: number | undefined;

                    if (useVscodeAccountsForEntraMFA) {
                        const tokenInfo = await acquireTokenFromVscodeAccountForResource(
                            getCloudResourceEndpoint("sqlResource"),
                            params.accountId,
                            params.tenantId,
                        );
                        token = tokenInfo.token.token;
                        expiresOn = tokenInfo.token.expiresOn;
                    } else {
                        if (!params.accountId) {
                            self._logger?.debug(
                                `Cannot refresh token: no accountId provided in refresh request for URI ${params.uri}`,
                            );
                            sendErrorEvent(
                                TelemetryViews.ConnectionManager,
                                TelemetryActions.RefreshTokenNotification,
                                new Error("Missing accountId in refresh token notification"),
                                true, // includeErrorMessage
                                "missingAccountId",
                                undefined,
                                {
                                    useVscodeAccountsForEntraMFA: String(
                                        useVscodeAccountsForEntraMFA,
                                    ),
                                },
                                {
                                    currentTimestamp: Math.floor(Date.now() / 1000),
                                },
                            );

                            sendFailureNotification();

                            return;
                        }

                        const account = await self.accountStore.getAccount(params.accountId);
                        if (!account) {
                            self._logger?.debug(
                                `Cannot refresh token: account ${params.accountId} not found in account store`,
                            );
                            sendErrorEvent(
                                TelemetryViews.ConnectionManager,
                                TelemetryActions.RefreshTokenNotification,
                                new Error("Account not found in account store"),
                                true, // includeErrorMessage
                                "accountNotFound",
                                undefined,
                                {
                                    useVscodeAccountsForEntraMFA: String(
                                        useVscodeAccountsForEntraMFA,
                                    ),
                                },
                                {
                                    currentTimestamp: Math.floor(Date.now() / 1000),
                                },
                            );

                            sendFailureNotification();

                            return;
                        }

                        const resource = getCloudProviderSettings(account.key.providerId).settings
                            .sqlResource!;

                        const refreshedToken = await self.azureController.refreshAccessToken(
                            account,
                            self.accountStore,
                            params.tenantId,
                            resource,
                        );

                        if (refreshedToken) {
                            token = refreshedToken.token;
                            expiresOn = refreshedToken.expiresOn;
                        }
                    }

                    if (!token) {
                        sendErrorEvent(
                            TelemetryViews.ConnectionManager,
                            TelemetryActions.RefreshTokenNotification,
                            new Error("Token refresh did not produce a token"),
                            true, // includeErrorMessage
                            "tokenNotRefreshed",
                            undefined,
                            {
                                useVscodeAccountsForEntraMFA: String(useVscodeAccountsForEntraMFA),
                            },
                            {
                                currentTimestamp: Math.floor(Date.now() / 1000),
                                ...(expiresOn !== undefined
                                    ? { refreshedTokenExpirationTimestamp: expiresOn }
                                    : {}),
                            },
                        );

                        sendFailureNotification();

                        return;
                    }

                    if (!self.client) {
                        sendErrorEvent(
                            TelemetryViews.ConnectionManager,
                            TelemetryActions.RefreshTokenNotification,
                            new Error(
                                "Service client unavailable while sending refreshed token notification",
                            ),
                            true, // includeErrorMessage
                            "serviceClientUnavailable",
                            undefined,
                            {
                                useVscodeAccountsForEntraMFA: String(useVscodeAccountsForEntraMFA),
                            },
                            {
                                currentTimestamp: Math.floor(Date.now() / 1000),
                                ...(expiresOn !== undefined
                                    ? { refreshedTokenExpirationTimestamp: expiresOn }
                                    : {}),
                            },
                        );

                        // client is unavailable so we cannot unblock STS here
                        return;
                    }

                    sendActionEvent(
                        TelemetryViews.ConnectionManager,
                        TelemetryActions.RefreshTokenNotification,
                        {
                            useVscodeAccountsForEntraMFA: String(useVscodeAccountsForEntraMFA),
                        },
                        {
                            currentTimestamp: Math.floor(Date.now() / 1000),
                            refreshedTokenExpirationTimestamp:
                                expiresOn !== undefined ? expiresOn : 0,
                        },
                    );

                    self.client.sendNotification(
                        ConnectionContracts.TokenRefreshedNotification.type,
                        {
                            token: token,
                            expiresOn: expiresOn ?? 0,
                            uri: params.uri,
                        },
                    );
                } catch (error) {
                    self._logger?.debug(
                        `Failed to refresh token for URI ${params.uri}: ${getErrorMessage(error)}`,
                    );

                    sendErrorEvent(
                        TelemetryViews.ConnectionManager,
                        TelemetryActions.RefreshTokenNotification,
                        error instanceof Error ? error : new Error(getErrorMessage(error)),
                        false, // includeErrorMessage
                        "exception",
                        undefined,
                        {
                            useVscodeAccountsForEntraMFA: String(useVscodeAccountsForEntraMFA),
                        },
                        {
                            currentTimestamp: Math.floor(Date.now() / 1000),
                        },
                    );

                    sendFailureNotification();
                }
            })();
        };
    }

    /**
     * Public for testing purposes only.
     */
    public handleConnectionCompleteNotification(): NotificationHandler<ConnectionContracts.ConnectionCompleteParams> {
        // Using a lambda here to perform variable capture on the 'this' reference
        const self = this;
        return async (result: ConnectionContracts.ConnectionCompleteParams): Promise<void> => {
            const fileUri = result.ownerUri;
            const completionPromise = self._uriToConnectionCompleteParamsMap.get(fileUri);
            if (completionPromise) {
                completionPromise.resolve(result);
                self._uriToConnectionCompleteParamsMap.delete(fileUri);
            }
        };
    }

    public async showInstructionTextAsWarning(
        profile: IConnectionProfile,
        reconnectAction: IReconnectAction,
    ): Promise<void> {
        const selection = await vscode.window.showWarningMessage(
            LocalizedConstants.Connection.trustServerCertificateMustBeEnabledMessage +
                " " +
                LocalizedConstants.Connection.trustServerCertificateMustBeEnabledPrompt,
            { modal: false },
            LocalizedConstants.enableTrustServerCertificate,
            LocalizedConstants.readMore,
            LocalizedConstants.Common.cancel,
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
            void vscode.env.openExternal(vscode.Uri.parse(Constants.encryptionBlogLink));
            await this.showInstructionTextAsWarning(profile, reconnectAction);
        } else if (selection === LocalizedConstants.Common.cancel) {
            await reconnectAction(undefined);
        }
    }

    /**
     * Handles SSL errors by showing a warning message and allowing the user to update their connection profile.
     * @param profile The connection profile to update.
     * @returns The updated connection information or undefined if the user cancels the operation.
     */
    public async handleSSLError(profile: IConnectionProfile): Promise<IConnectionInfo | undefined> {
        let updatedConn: IConnectionInfo | undefined;
        await this.showInstructionTextAsWarning(profile, async (updatedConnection) => {
            // If the operation was cancelled, we return undefined indicating that the connection was not fixed.
            if (!updatedConnection) {
                return;
            }
            vscode.commands.executeCommand(
                Constants.cmdConnectObjectExplorerProfile,
                updatedConnection,
            );
            updatedConn = updatedConnection;
        });
        return updatedConn;
    }

    /**
     * Handles a firewall error by showing the Add Firewall Rule dialog to the user.
     * @param credentials The connection info for the connection that had the firewall error
     * @param errorMessage The error message from the firewall error
     * @returns Whether the firewall error was handled (i.e. user added a rule)
     */
    public async handleFirewallError(
        credentials: IConnectionInfo,
        errorMessage: string,
    ): Promise<boolean> {
        const addFirewallRuleController = new AddFirewallRuleWebviewController(
            this.context,
            {
                serverName: credentials.server,
                errorMessage: errorMessage,
            },
            this.firewallService,
        );
        addFirewallRuleController.panel.reveal();

        return await addFirewallRuleController.dialogResult;
    }

    /**
     * Tries to add a connection to the list of most recently used connections. It saves the original credentials used to create the connection.
     * @param connection The original connection returned from the connect operation. It could be null if the connection operation was not successful.
     */
    private async tryAddMruConnection(connection: ConnectionInfo): Promise<void> {
        if (connection?.credentials) {
            let connectionToSave: IConnectionInfo = Object.assign({}, connection.credentials);
            await this._connectionStore.addRecentlyUsed(connectionToSave);
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
        const fileUri = Utils.getActiveTextEditorUri();
        if (!this.isConnected(fileUri)) {
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
            this._logger.info(
                LocalizedConstants.msgChangingDatabase(
                    newDatabaseCredentials.database,
                    newDatabaseCredentials.server,
                    fileUri,
                ),
            );
            await this.disconnect(fileUri);
            await this.connect(fileUri, newDatabaseCredentials);
            this._logger.info(
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
        const fileUri = Utils.getActiveTextEditorUri();
        if (!this.isConnected(fileUri)) {
            return false;
        }
        await this.disconnect(fileUri);
        await this.connect(fileUri, newDatabaseCredentials);
        this._logger.info(
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
        const fileUri = Utils.getActiveTextEditorUri();
        if (fileUri && Utils.isEditingSqlFile()) {
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
            await vscode.window.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            return false;
        }
    }

    // close active connection, if any
    public onDisconnect(): Promise<boolean> {
        const fileUri = Utils.getActiveTextEditorUri();
        if (!fileUri) {
            vscode.window.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            return Promise.resolve(false);
        }
        return this.disconnect(fileUri);
    }

    /**
     * Disconnect from the database
     * @param fileUri The URI of the file to disconnect
     * @returns A promise that resolves to a boolean indicating success or failure
     */
    public async disconnect(fileUri: string): Promise<boolean> {
        if (this.isConnected(fileUri)) {
            let disconnectParams = new ConnectionContracts.DisconnectParams();
            disconnectParams.ownerUri = fileUri;

            const result: ConnectionContracts.DisconnectResult = await this.client.sendRequest(
                ConnectionContracts.DisconnectRequest.type,
                disconnectParams,
            );
            if (this.statusView) {
                this.statusView.setNotConnected(fileUri);
            }
            if (result) {
                this._logger.info(LocalizedConstants.msgDisconnected(fileUri));
            }

            this.removeActiveConnection(fileUri);
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
         * TODO: aaskhan find the underlying issue that causes the mismatch in encoding and fix it.
         */
        vscode.commands.executeCommand(
            "setContext",
            "mssql.connections",
            Object.keys(this._connections)
                .filter((key) => this.isConnected(key))
                .map((key) => {
                    try {
                        key = vscode.Uri.parse(key).toString();
                    } catch {
                        // ignore invalid URIs (for example OE-only keys) in context resource list
                        return undefined;
                    }
                    return key;
                })
                .filter((key): key is string => !!key),
        );

        vscode.commands.executeCommand(
            "setContext",
            "mssql.connecting",
            Object.keys(this._connections)
                .filter((key) => this.isConnecting(key))
                .map((key) => {
                    try {
                        key = vscode.Uri.parse(key).toString();
                    } catch {
                        // ignore invalid URIs (for example OE-only keys) in context resource list
                        return undefined;
                    }
                    return key;
                })
                .filter((key): key is string => !!key),
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
            let result = await this.connect(fileUri, connectionCreds);
            if (result) {
                return connectionCreds;
            } else {
                return undefined;
            }
        }
    }

    /**
     * Get the server info for a connection
     * @param connectionCreds
     */
    public getServerInfo(connectionCredentials: IConnectionInfo): IServerInfo {
        if (!connectionCredentials) {
            return undefined;
        }
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
    public async promptToConnect(): Promise<IConnectionInfo> {
        const fileUri = Utils.getActiveTextEditorUri();
        if (!fileUri) {
            // A text document needs to be open before we can connect
            vscode.window.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            return undefined;
        }

        if (!Utils.isEditingSqlFile()) {
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
     * throws if token refresh fails or if account/profile cannot be found.
     */
    public async refreshEntraTokenIfNeeded(connectionInfo: IConnectionInfo) {
        // 1. Validate that the connection is using Entra auth
        if (connectionInfo.authenticationType !== Constants.azureMfa) {
            return;
        }

        // 2. If the user is using VS Code accounts for Entra MFA, use that flow to refresh the token.
        // STS cannot read VS Code auth sessions, so this path still needs to pass a token.
        if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
            const expiry = Utils.epochToDisplay(connectionInfo.expiresOn * 1000);

            if (
                AzureController.isTokenValid(
                    connectionInfo.azureAccountToken,
                    connectionInfo.expiresOn,
                )
            ) {
                this._entraLogger?.debug(
                    `Entra token for account ${connectionInfo.user} (${connectionInfo.email}) is still valid until ${connectionInfo.expiresOn} (${expiry.iso}, ${expiry.relative}). No refresh needed.`,
                );
                return;
            }

            this._entraLogger?.debug(
                `Entra token for account ${connectionInfo.user} (${connectionInfo.email}) expired at ${connectionInfo.expiresOn} (${expiry.iso}, ${expiry.relative}) and needs to be refreshed.`,
            );

            const tokenInfo = await acquireTokenFromVscodeAccountForResource(
                getCloudResourceEndpoint("sqlResource"),
                connectionInfo.accountId,
                connectionInfo.tenantId,
                connectionInfo.email ?? connectionInfo.user,
            );

            connectionInfo.azureAccountToken = tokenInfo.token.token;
            connectionInfo.expiresOn = tokenInfo.token.expiresOn;
            connectionInfo.accountId = tokenInfo.account.id;
            connectionInfo.tenantId = tokenInfo.tenantId;
            connectionInfo.user = tokenInfo.account.label;
            connectionInfo.email = tokenInfo.session.account.label;

            return;
        }

        // 3. Otherwise, use the MSAL flow. STS registers a SqlAuthenticationProvider
        // and reads the shared MSAL cache, so do not pass a pre-acquired SQL token.
        let account: IAccount | undefined;

        if (connectionInfo.accountId) {
            account = await this.accountStore.getAccount(connectionInfo.accountId);
        } else {
            // Send telemetry to identify code paths where accountId is missing
            sendErrorEvent(
                TelemetryViews.ConnectionManager,
                TelemetryActions.Connect,
                new Error("Azure MFA connection missing accountId in refreshEntraTokenIfNeeded"),
                true, // includeErrorMessage
            );
            throw new Error(LocalizedConstants.cannotConnect);
        }

        if (!account) {
            this._logger?.debug(
                `No account found in account store for accountId ${connectionInfo.accountId}. Cannot refresh Entra token.`,
            );

            throw new MissingEntraAuthAccountError(
                LocalizedConstants.Accounts.entraAccountNotAvailableThroughMsal(
                    connectionInfo.email ?? connectionInfo.user ?? connectionInfo.accountId ?? "",
                    connectionInfo.tenantId,
                ),
            );
            //LocalizedConstants.msgAccountNotFound
        }

        connectionInfo.user =
            account.displayInfo.email ??
            account.displayInfo.userId ??
            account.displayInfo.displayName;
        connectionInfo.email = account.displayInfo.email;
        connectionInfo.tenantId ??= account.properties?.owningTenant?.id;

        // Keep the MSAL account cache fresh before handing SQL token acquisition to STS.
        // This may prompt for sign-in if the account can no longer refresh silently,
        // but the returned non-SQL token is intentionally not sent to SqlClient.
        await this.azureController.refreshAccessToken(
            account,
            this.accountStore,
            connectionInfo.tenantId,
            getCloudProviderSettings(account.key.providerId).settings.armResource,
        );

        connectionInfo.azureAccountToken = undefined;
        connectionInfo.expiresOn = undefined;

        this._logger?.debug(
            `Using SQL Authentication Provider for MSAL Entra account ${connectionInfo.user} and tenant ${connectionInfo.tenantId}.`,
        );
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
            if (
                Utils.isEmpty(password) &&
                !(connectionCreds as IConnectionProfile).emptyPasswordInput
            ) {
                password = await this.connectionStore.lookupPassword(connectionCreds);
                if (!password) {
                    password = await this.connectionUI.promptForPassword();
                    // If user provided empty password, set the flag to avoid re-prompting
                    if (password === undefined || password === "") {
                        (connectionCreds as IConnectionProfile).emptyPasswordInput = true;
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

    public async checkForDockerConnection(profile: IConnectionProfile): Promise<string> {
        if (!profile.containerName) {
            const serverInfo = this.getServerInfo(profile);
            let machineName = "";
            if (serverInfo) {
                machineName = (serverInfo as any)["machineName"];
            }
            const containerName = await checkIfConnectionIsDockerContainer(machineName);
            if (containerName) {
                profile.containerName = containerName;
                // if the connection is a docker container, make sure to set the container name for future use
                await this.connectionStore.saveProfile(profile);
                return containerName;
            }
        }
        return "";
    }

    /**
     * Creates a new connection with provided credentials.
     * @param fileUri file URI for the connection. If not provided, a new URI will be generated.
     * @param credentials credentials to connect with
     * @param shouldHandleErrors whether to handle connection errors with UI prompts.
     * If false, the method will return false on error instead of trying to fix it.
     * To be used by connection dialog where errors are handled in the dialog itself.
     * @returns true if connection was successful, false otherwise.
     */
    public async connect(
        fileUri: string,
        credentials: IConnectionInfo,
        options: {
            shouldHandleErrors?: boolean;
            connectionSource?: string;
            serverlessWakeFailedAttempts?: number;
        } = {},
    ): Promise<boolean> {
        const {
            shouldHandleErrors = true,
            connectionSource = "",
            serverlessWakeFailedAttempts = 0,
        } = options;

        const connectionActivity = startActivity(
            TelemetryViews.ConnectionManager,
            TelemetryActions.Connect,
            undefined, // Default correlation id
            {
                serverTypes: getServerTypes(credentials).join(","),
                cloudType: getCloudId(),
                connectionSource: connectionSource,
            },
            undefined,
            credentials,
            undefined,
            true, // include call stack
        );

        if (!fileUri) {
            fileUri = `${ObjectExplorerUtils.getNodeUriFromProfile(credentials as IConnectionProfile)}_${uuid()}`;
        }

        credentials = await this.prepareConnectionInfo(credentials, connectionActivity);

        // Check if the connection is one that we can check for pause status (i.e., a Azure SQL database using Entra MFA auth)
        const isPauseAwareConnection =
            shouldHandleErrors && canCheckDatabasePauseStatus(credentials);

        // If the connection can be checked, start the serverless status check in parallel with the connection attempt.
        // The result determines silent retry if the connection attempt times out.
        const serverlessStatusPromise: Promise<AzureSqlDatabaseStatus> = isPauseAwareConnection
            ? VsCodeAzureHelper.getAzureSqlDatabaseStatus(credentials, undefined, "direct connect")
            : Promise.resolve("UnableToCheck");
        // Add the connection to the active connections list
        let connectionInfo: ConnectionInfo = new ConnectionInfo();
        connectionInfo.credentials = credentials;
        connectionInfo.connecting = true;

        this._connections[fileUri] = connectionInfo;
        this._onConnectionsChangedEmitter.fire();
        this.updateConnectionsContext();

        // Note: must call flavor changed before connecting, or the timer showing an animation doesn't occur
        if (this.statusView) {
            this.statusView.languageFlavorChanged(fileUri, Constants.mssqlProviderName);
            this.statusView.setConnecting(fileUri, credentials);
            this.statusView.languageFlavorChanged(fileUri, Constants.mssqlProviderName);
        }

        this._logger.info(LocalizedConstants.msgConnecting(credentials.server, fileUri));

        // Create connection request params
        const connectionDetails = ConnectionCredentials.createConnectionDetails(credentials);
        let connectParams = new ConnectionContracts.ConnectParams();
        connectParams.ownerUri = fileUri;
        connectParams.connection = connectionDetails;

        const connectionCompletePromise =
            new Deferred<ConnectionContracts.ConnectionCompleteParams>();
        this._uriToConnectionCompleteParamsMap.set(
            connectParams.ownerUri,
            connectionCompletePromise,
        );

        let initResponse: boolean;
        let initRequestCompleted = false;
        try {
            setTimeout(() => {
                if (!initRequestCompleted) {
                    connectionActivity.update({
                        longRunningIntialization: "true",
                    });
                }
            }, Constants.stsImmediateActivityTimeout);
            initResponse = await this.client.sendRequest(
                ConnectionContracts.ConnectionRequest.type,
                connectParams,
            );
            initRequestCompleted = true;
        } catch (error) {
            initRequestCompleted = true;
            this.removeActiveConnection(fileUri);
            connectionCompletePromise.reject(error);
            this._uriToConnectionCompleteParamsMap.delete(connectParams.ownerUri);
            delete this._connections[fileUri];
            /**
             * If the initial connection attempt fails, log the error and return false.
             * We don’t invoke error callbacks here because the failure happens before
             * the SQL client even starts connecting. At this stage there’s nothing to
             * retry or recover from.
             */
            connectionActivity.endFailed(
                error,
                false, // includeErrorMessage
            );
            return false;
        }

        /**
         * If the initial connection attempt fails, log the error and return false.
         * We don’t invoke error callbacks here because the failure happens before
         * the SQL client even starts connecting. At this stage there’s nothing to
         * retry or recover from.
         */
        if (!initResponse) {
            const initialConnectionError = new Error("Failed to initiate connection");
            this.removeActiveConnection(fileUri);
            connectionCompletePromise.reject(initialConnectionError);
            this._uriToConnectionCompleteParamsMap.delete(connectParams.ownerUri);
            delete this._connections[fileUri];
            connectionActivity.endFailed(
                initialConnectionError,
                true, // include error message
            );
            return false;
        }

        connectionActivity.update({
            connectionInitiated: "true",
        });

        const result = await connectionCompletePromise.promise;

        connectionInfo.connecting = false;

        this._connections[fileUri] = connectionInfo;
        this.updateConnectionsContext();

        if (Utils.isNotEmpty(result.connectionId)) {
            /**
             * Connection was successful
             */

            await this.handleConnectionSuccess(fileUri, connectionInfo, result);
            connectionActivity.end(
                ActivityStatus.Succeeded,
                undefined,
                undefined,
                connectionInfo?.credentials,
                result?.serverInfo,
            );
            return true;
        } else {
            let errorType = "";

            // If the connection is pause-aware and the timeout is retryable, attempt a silent retry.
            if (isPauseAwareConnection && this.isServerlessWakeRetryableTimeout(result)) {
                const failedAttempts = serverlessWakeFailedAttempts + 1;
                if (
                    await this.shouldRetryForPausedServerlessDatabase(
                        connectionInfo.credentials,
                        failedAttempts,
                        serverlessStatusPromise,
                    )
                ) {
                    connectionActivity.update({ retryConnection: "true" });
                    connectionActivity.end(ActivityStatus.Retrying);

                    return await this.connect(fileUri, connectionInfo.credentials, {
                        shouldHandleErrors,
                        connectionSource,
                        serverlessWakeFailedAttempts: failedAttempts,
                    });
                }
            }

            if (shouldHandleErrors) {
                const errorHandlingResult = await this.handleConnectionErrors(
                    result,
                    connectionInfo.credentials,
                );

                errorType = errorHandlingResult?.errorHandled;
                connectionActivity.update({
                    retryConnection: errorHandlingResult?.isHandled ? "true" : "false",
                });
                if (errorHandlingResult.isHandled) {
                    connectionActivity.end(ActivityStatus.Retrying);
                    return await this.connect(fileUri, errorHandlingResult.updatedCredentials, {
                        connectionSource: connectionSource,
                    });
                }
            }

            connectionInfo.errorNumber = result.errorNumber;
            connectionInfo.errorMessage = result.errorMessage;
            connectionInfo.messages = result.messages;
            connectionInfo.connecting = false;

            this.statusView.setConnectionError(fileUri, connectionInfo.credentials, result);
            this._logger.error(
                LocalizedConstants.msgConnectionFailed(
                    connectionInfo.credentials.server,
                    result.errorMessage ? result.errorMessage : result.messages,
                ),
            );
            this._onConnectionsChangedEmitter.fire();
            this.updateConnectionsContext();
            connectionActivity.endFailed(
                new Error(result.errorMessage),
                false, // Do not include error message
                result.errorNumber?.toString() ?? errorType,
                undefined,
                {
                    containsError: "true",
                    errorType,
                },
                undefined,
                connectionInfo.credentials,
                result.serverInfo,
            );
            return false;
        }
    }

    /**
     * Determines whether a failed connection/expand result represents a timeout that could
     * be caused by a paused/resuming serverless database.
     */
    public isServerlessWakeRetryableTimeout(error: SqlConnectionError): boolean {
        if (!error) {
            return false;
        }

        if (
            error.errorCode &&
            Constants.serverlessWakeTimeoutErrorCodes.includes(error.errorCode)
        ) {
            return true;
        }

        if (error.errorNumber === Constants.errorConnectionTimeout) {
            return true;
        }

        return false;
    }

    /**
     * Determines whether a timed-out connection/expand attempt should be silently retried.
     *
     * The connection/expand attempt has already timed out by the time this is called, so we only
     * consult the pause-state check if it has ALREADY resolved. If it's still in flight we do NOT
     * wait for it (which could take much longer than the connection timeout for users with many
     * subscriptions) — we surface the timeout error immediately instead.
     *
     * @param credentials the connection being attempted.
     * @param failedAttempts number of connection attempts that have already failed (including initial attempt).
     * @param statusPromise In-flight status check promise. Resolves to an
     *   {@link AzureSqlDatabaseStatus} (never `undefined`); `undefined` from the race below means
     *   the check hadn't resolved yet.
     * @param databaseName optional database name override for the status check.
     */
    public async shouldRetryForPausedServerlessDatabase(
        credentials: IConnectionInfo,
        failedAttempts: number,
        statusPromise: Promise<AzureSqlDatabaseStatus>,
        databaseName?: string,
    ): Promise<boolean> {
        if (
            failedAttempts >= serverlessWakeMaxRetryAttempts + 1 ||
            !canCheckDatabasePauseStatus(credentials, databaseName)
        ) {
            return false;
        }

        // Peek at the status check without waiting: race it against an already-resolved `undefined`.
        // Since the status check never resolves to `undefined`, a resulting `undefined` unambiguously
        // means "the check hasn't finished yet" -> don't retry, surface the timeout now.
        const status = await Promise.race([statusPromise, Promise.resolve(undefined)]);

        if (status === undefined) {
            this._logger.info(
                `Serverless pause-aware retry: pause-state check for database "${databaseName ?? credentials.database}" on "${credentials.server}" did not finish before the connection timeout; surfacing the error without retrying.`,
            );
            return false;
        }

        if (!azureStatusesToRetry.includes(status)) {
            return false;
        }

        this._logger.info(
            `Serverless pause-aware retry: database "${databaseName ?? credentials.database}" on "${credentials.server}" is ${status}; suppressing the connection timeout and retrying silently (attempt ${
                failedAttempts + 1
            }/${serverlessWakeMaxRetryAttempts + 1}).`,
        );
        return true;
    }

    /**
     * Does preparation steps on the connection info before trying to connect.
     * @param credentials The connection info to prepare
     * @returns The prepared connection info
     */
    public async prepareConnectionInfo(
        credentials: IConnectionInfo,
        telemetryActivity?: ActivityObject,
    ): Promise<IConnectionInfo> {
        const telemetryActivityErrorType = "ConnectionPreparationError";
        // Verify that the connection info has server or connection string
        if (!credentials.server && !credentials.connectionString) {
            const error = new Error(LocalizedConstants.serverNameMissing);
            telemetryActivity?.endFailed(
                error,
                true, // includeErrorMessage
                "MissingServerName",
                telemetryActivityErrorType,
                undefined,
            );
            throw new Error(LocalizedConstants.serverNameMissing);
        }

        // Handle Entra token validity
        if (credentials.authenticationType === Constants.azureMfa) {
            try {
                await this.refreshEntraTokenIfNeeded(credentials);
            } catch (error) {
                telemetryActivity?.endFailed(
                    error,
                    false, // do not include error message
                    "EntraTokenValidityConfirmationFailed",
                    telemetryActivityErrorType,
                    undefined,
                );
                throw error;
            }
        }

        // Handle password-based credentials
        const passwordResult = await this.handlePasswordBasedCredentials(credentials);
        if (!passwordResult) {
            // User cancelled the password prompt
            const passwordError = new Error(LocalizedConstants.cannotConnect);
            telemetryActivity?.endFailed(
                passwordError,
                true, // includeErrorMessage
                "PasswordHandlingFailed",
                telemetryActivityErrorType,
                undefined,
            );
            throw passwordError;
        }

        // Handle connection string-based credentials
        if (
            credentials.connectionString?.includes(ConnectionStore.CRED_PREFIX) &&
            credentials.connectionString?.includes("isConnectionString:true")
        ) {
            let connectionString = await this.connectionStore.lookupPassword(credentials, true);
            credentials.connectionString = connectionString;
        }

        if (
            credentials.authenticationType ===
            Utils.authTypeToString(AuthenticationTypes.Integrated)
        ) {
            credentials.azureAccountToken = undefined;
        }

        telemetryActivity?.update({
            connectionPrepared: "true",
        });
        return credentials;
    }

    /**
     * Handles the steps to take on a successful connection.
     * @param fileUri uri of the file the connection is for
     * @param connectionInfo the connection info object to update
     * @param result the result of the connection
     * @returns A promise that resolves when all steps are complete
     */
    private async handleConnectionSuccess(
        fileUri: string,
        connectionInfo: ConnectionInfo,
        result: ConnectionContracts.ConnectionCompleteParams,
    ): Promise<void> {
        /**
         * Connection was successful
         */

        // Legacy connection string code. TODO: MAYBE GET RID OF THIS.
        if (connectionInfo.credentials.connectionString) {
            connectionInfo.credentials = await this.populateCredentialsFromConnectionString(
                connectionInfo.credentials,
                result.connectionSummary,
            );
        }
        // END legacy connection string code.

        // Saving server info to the map
        this._connectionCredentialsToServerInfoMap.set(
            connectionInfo.credentials,
            result.serverInfo,
        );

        let newCredentials: IConnectionInfo = <any>{};
        Object.assign<IConnectionInfo, IConnectionInfo>(newCredentials, connectionInfo.credentials);

        if (result.connectionSummary?.databaseName) {
            newCredentials.database = result.connectionSummary.databaseName;
        }

        connectionInfo.connectionId = result.connectionId;
        connectionInfo.serverInfo = result.serverInfo;
        connectionInfo.credentials = newCredentials;
        connectionInfo.errorNumber = undefined;
        connectionInfo.errorMessage = undefined;

        void this.statusView.connectSuccess(fileUri, newCredentials, connectionInfo.serverInfo);

        this.statusView.languageServiceStatusChanged(
            fileUri,
            LocalizedConstants.updatingIntelliSenseStatus,
        );

        this._onSuccessfulConnectionEmitter.fire({
            connection: connectionInfo,
            fileUri: fileUri,
        });

        this._logger.info(
            LocalizedConstants.msgConnectedServerInfo(
                connectionInfo?.credentials?.server,
                fileUri,
                JSON.stringify(connectionInfo.serverInfo),
            ),
        );
        sendActionEvent(
            TelemetryViews.ConnectionManager,
            TelemetryActions.CreateConnectionResult,
            {
                connectedEngineEditionId: String(result.serverInfo.engineEditionId),
            },
            {
                connectedEngineEditionId: result.serverInfo.engineEditionId,
            },
            newCredentials as IConnectionProfile,
            result.serverInfo,
        );

        await this.handlePasswordStorageOnConnect(connectionInfo.credentials as IConnectionProfile);

        await this.tryAddMruConnection(connectionInfo);

        await this.addActiveConnection(fileUri, connectionInfo);
    }

    /**
     * General handler for sql client related connection errors. This is shared
     * between object explorer and the connection manager.
     * @param errorNumber Error number code
     * @param errorMessage Error message
     * @param credentials Credentials used for the connection
     * @param message Additional message information
     * @return An object indicating whether the error was handled, the updated credentials if applicable,
     * and an optional string indicating the type of error that was handled (for telemetry purposes).
     */
    public async handleConnectionErrors(
        error: SqlConnectionError,
        credentials: IConnectionInfo,
    ): Promise<{
        isHandled: boolean;
        updatedCredentials: IConnectionInfo;
        errorHandled?: SqlConnectionErrorType;
    }> {
        // Helper for "learn more" prompts
        const showWithHelp = async (message: string, helpLabel: string, helpUrl: string) => {
            const action = await vscode.window.showErrorMessage(message, helpLabel);
            if (action === helpLabel) {
                await vscode.env.openExternal(vscode.Uri.parse(helpUrl));
            }
        };

        const errorType = await getSqlConnectionErrorType(error, credentials);
        const { errorNumber, errorMessage, message } = error;

        if (errorType === SqlConnectionErrorType.PasswordExpired) {
            const result = await this._changePasswordService.handleChangePassword(credentials);
            if (result) {
                credentials.password = result;
                //save password to credential store if needed
                await this.connectionStore.saveProfilePasswordIfNeeded(
                    credentials as IConnectionProfile,
                );
                return {
                    isHandled: true,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.PasswordExpired,
                };
            } else {
                Utils.showErrorMsg(
                    LocalizedConstants.msgConnectionErrorPasswordExpired(errorNumber, errorMessage),
                );
                return {
                    isHandled: false,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.PasswordExpired,
                };
            }
        } else if (errorType === SqlConnectionErrorType.TrustServerCertificateNotEnabled) {
            const updatedConnection = await this.handleSSLError(credentials as IConnectionProfile);
            if (updatedConnection) {
                return {
                    isHandled: true,
                    updatedCredentials: updatedConnection,
                    errorHandled: SqlConnectionErrorType.TrustServerCertificateNotEnabled,
                };
            } else {
                return {
                    isHandled: false,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.TrustServerCertificateNotEnabled,
                };
            }
        } else if (errorType === SqlConnectionErrorType.FirewallRuleError) {
            const wasCreated = await this.handleFirewallError(credentials, errorMessage);
            if (wasCreated === true /** dialog closed is undefined */) {
                return {
                    isHandled: true,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.FirewallRuleError,
                };
            } else {
                Utils.showErrorMsg(
                    LocalizedConstants.msgConnectionError(errorNumber, errorMessage),
                );
                return {
                    isHandled: false,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.FirewallRuleError,
                };
            }
        } else if (errorType === SqlConnectionErrorType.KerberosNonWindows) {
            await showWithHelp(
                LocalizedConstants.msgConnectionError2(errorMessage),
                LocalizedConstants.help,
                Constants.integratedAuthHelpLink,
            );
            return {
                isHandled: false,
                updatedCredentials: credentials,
                errorHandled: SqlConnectionErrorType.KerberosNonWindows,
            };
        } else if (errorType === SqlConnectionErrorType.EntraTokenExpired) {
            try {
                await this.refreshEntraTokenIfNeeded(credentials);
                return {
                    isHandled: true,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.EntraTokenExpired,
                };
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                if (errorMessage !== LocalizedConstants.cannotConnect) {
                    Utils.showErrorMsg(errorMessage);
                }
                return {
                    isHandled: false,
                    updatedCredentials: credentials,
                    errorHandled: SqlConnectionErrorType.EntraTokenExpired,
                };
            }
        } else {
            // Generic error handling
            if (errorNumber) {
                Utils.showErrorMsg(
                    LocalizedConstants.msgConnectionError(errorNumber, errorMessage),
                );
            } else {
                const displayMsg = errorMessage || message;
                if (displayMsg) {
                    Utils.showErrorMsg(LocalizedConstants.msgConnectionError2(displayMsg));
                }
            }
            return {
                isHandled: false,
                updatedCredentials: credentials,
                errorHandled: SqlConnectionErrorType.Generic,
            };
        }
    }

    private addActiveConnection(fileUri: string, connectionInfo: ConnectionInfo) {
        this._connections[fileUri] = connectionInfo;
        this._onConnectionsChangedEmitter.fire();
        this.updateConnectionsContext();
    }

    private removeActiveConnection(fileUri: string): void {
        delete this._connections[fileUri];
        this._onConnectionsChangedEmitter.fire();
        this.updateConnectionsContext();
    }

    public async onCancelConnect(promptToConfirm: boolean = true): Promise<void> {
        if (promptToConfirm) {
            const result = await this.connectionUI.promptToCancelConnection();
            if (!result) {
                return;
            }
        }
        await this.cancelConnect();
    }

    public async cancelConnect(): Promise<void> {
        let fileUri = Utils.getActiveTextEditorUri();
        if (!fileUri || Utils.isEmpty(fileUri)) {
            return;
        }

        let cancelParams: ConnectionContracts.CancelConnectParams =
            new ConnectionContracts.CancelConnectParams();
        cancelParams.ownerUri = fileUri;

        const cancelActivity = startActivity(
            TelemetryViews.ConnectionManager,
            TelemetryActions.CancelConnection,
        );
        let cancelRequestCompleted = false;
        setTimeout(() => {
            if (!cancelRequestCompleted) {
                cancelActivity.endFailed(
                    new Error("Cancellation timed out"),
                    true, // include error message
                );
            }
        }, Constants.stsImmediateActivityTimeout);

        try {
            const result = await this.client.sendRequest(
                ConnectionContracts.CancelConnectRequest.type,
                cancelParams,
            );
            cancelRequestCompleted = true;
            if (result) {
                this.statusView.setNotConnected(fileUri);
                cancelActivity.end(ActivityStatus.Succeeded);
                // Force cleanup of promises and state
                const completionPromise = this._uriToConnectionCompleteParamsMap.get(fileUri);
                if (completionPromise) {
                    completionPromise.reject(new Error("Connection cancelled"));
                    this._uriToConnectionCompleteParamsMap.delete(fileUri);
                }
                this.removeActiveConnection(fileUri);
            } else {
                cancelActivity.endFailed(
                    new Error(
                        "Failed to cancel connection. Most likely connection already established.",
                    ),
                    true, // include error message
                );
            }
        } catch (error) {
            cancelRequestCompleted = true;
            cancelActivity.endFailed(
                error,
                false, // do not include error message
            );
        }
    }

    /**
     * Called when the 'Manage Connection Profiles' command is issued.
     */
    public async onManageProfiles(): Promise<void> {
        // Show quick pick to create, edit, or remove profiles
        await this.connectionUI.promptToManageProfiles();
    }

    public async onClearPooledConnections(): Promise<void> {
        return await this._client.sendRequest(ClearPooledConnectionsRequest.type, {});
    }

    public async onCreateProfile(): Promise<boolean> {
        this.connectionUI.openConnectionDialog();
        return false;
    }

    public onRemoveProfile(): Promise<boolean> {
        return this.connectionUI.removeProfile();
    }

    public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
        let docUri: string = doc.uri.toString();

        // If this file isn't connected, then don't do anything
        if (!this.isConnected(docUri)) {
            return;
        }

        // Disconnect the document's connection when we close it
        await this.disconnect(docUri);
    }

    public onDidOpenTextDocument(doc: vscode.TextDocument): void {
        let uri = doc.uri.toString();
        if (doc.languageId === "sql" && typeof this._connections[uri] === "undefined") {
            this.statusView.setNotConnected(uri);
        }
    }

    /**
     * Moves the connection from one URI to another.
     * @param oldFileUri File URI to transfer connection info from
     * @param newFileUri File URI to transfer connection info to
     * @returns true if a transfer occurred; otherwise false
     */
    public async transferConnectionToFile(
        oldFileUri: string,
        newFileUri: string,
    ): Promise<boolean> {
        if (!oldFileUri || !newFileUri || oldFileUri === newFileUri) {
            return false;
        }

        // If old isn't connected or new is already connected, there is nothing to transfer.
        if (!this.isConnected(oldFileUri) || this.isConnected(newFileUri)) {
            return false;
        }

        const creds: IConnectionInfo | undefined = this._connections[oldFileUri]?.credentials;
        if (!creds) {
            return false;
        }

        // Deep-clone credentials so that connect()/prepareConnectionInfo() mutations
        // (e.g. token/password updates) don't affect the old connection's state
        // if the transfer fails.
        const clonedCreds: IConnectionInfo = Utils.deepClone(creds);
        const didConnect = await this.connect(newFileUri, clonedCreds);
        if (!didConnect) {
            return false;
        }

        // Best effort cleanup of old URI after successful transfer.
        if (this.isConnected(oldFileUri)) {
            await this.disconnect(oldFileUri);
        }

        return true;
    }

    public async refreshAzureAccountToken(uri: string): Promise<void> {
        const connectionInfo = this._connections[uri];
        if (!connectionInfo) {
            // No connection for this URI, nothing to do
            return;
        }
        await this.refreshEntraTokenIfNeeded(connectionInfo.credentials);
    }

    public async addAccount(): Promise<IAccount> {
        let account = await this.connectionUI.addNewAccount();
        if (account) {
            vscode.window.showInformationMessage(
                LocalizedConstants.accountAddedSuccessfully(account.displayInfo.displayName),
            );
        } else {
            vscode.window.showErrorMessage(LocalizedConstants.accountCouldNotBeAdded);
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
                        vscode.window.showInformationMessage(
                            LocalizedConstants.accountRemovedSuccessfully,
                        );
                    } catch (e) {
                        vscode.window.showErrorMessage(
                            LocalizedConstants.accountRemovalFailed(e.message),
                        );
                    }
                }
            });
        } else {
            vscode.window.showInformationMessage(LocalizedConstants.noAzureAccountForRemoval);
        }
    }

    public onClearAzureTokenCache(): void {
        this.azureController.clearTokenCache();
        vscode.window.showInformationMessage(LocalizedConstants.Accounts.clearedEntraTokenCache);
    }

    /**
     * Perform startup checks for connections:
     * - migrates legacy connection strings
     * - emits basic connection stats
     */
    private async performConnectionStartupChecks(): Promise<void> {
        this._logger.trace("Beginning connection startup checks");

        const connections: IConnectionProfile[] =
            await this.connectionStore.readAllConnections(false);
        const connectionGroups: IConnectionGroup[] =
            await this.connectionStore.readAllConnectionGroups();

        const migrationTally = {
            migrated: 0,
            notNeeded: 0,
            error: 0,
        };

        const orderingTally = {
            orderedConnections: 0,
            orderedGroups: 0,
        };

        for (const connection of connections) {
            const result = await this.migrateLegacyConnection(connection);

            migrationTally[result] = (migrationTally[result] || 0) + 1;

            if (connection.order !== undefined) {
                orderingTally.orderedConnections++;
            }
        }

        for (const group of connectionGroups) {
            if (group.order !== undefined) {
                orderingTally.orderedGroups++;
            }
        }

        if (migrationTally.migrated > 0) {
            this._logger.info(
                `Completed migration of legacy Connection String connections. (${migrationTally.migrated} migrated, ${migrationTally.notNeeded} not needed, ${migrationTally.error} errored)`,
            );
        } else {
            this._logger.info(
                `No legacy Connection String connections found to migrate. (${migrationTally.notNeeded} not needed, ${migrationTally.error} errored)`,
            );
        }

        sendActionEvent(
            TelemetryViews.Connection,
            TelemetryActions.Stats,
            {}, // properties
            {
                connectionCount: connections.length,
                connectionGroupCount: connectionGroups.length,
                ...migrationTally,
                ...orderingTally,
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

            vscode.window.showErrorMessage(
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

    /**
     * Handles the `account/securityTokenRequest` request from SQL Tools Service.
     *
     * This request is used for two distinct purposes:
     *
     * 1. **Entra MFA via VS Code accounts** (`params.accountId` present): STS is running in
     *    `--request-mfa-token-from-client` mode (`useVscodeAccountsForEntraMFA` enabled) and
     *    needs an access token for the given Entra account + tenant + resource.
     *
     * 2. **Always Encrypted / Azure Key Vault** (`params.accountId` absent): STS needs a token
     *    for `https://vault.azure.net/` to decrypt a Column Encryption Key protected by an
     *    AKV-based Column Master Key. The user is prompted via QuickPick to select an account
     *    and tenant. When `useVscodeAccountsForEntraMFA` is enabled the account list comes from
     *    VS Code's authentication provider; otherwise it comes from the MSAL account store.
     *    Acquired tokens are cached in `_keyVaultTokenCache` for the lifetime of the session.
     */
    private async handleSecurityTokenRequest(
        params: RequestSecurityTokenParams,
    ): Promise<RequestSecurityTokenResponse> {
        if (params.accountId) {
            this._entraLogger.info(
                `VS Code accounts token request received for ${params.resource} with accountId '${params.accountId}' and tenantId '${params.tenantId}'`,
            );
            try {
                const resourceEndpoint = params.resource || getCloudResourceEndpoint("sqlResource");
                const tokenInfo = await acquireTokenFromVscodeAccountForResource(
                    resourceEndpoint,
                    params.accountId,
                    params.tenantId,
                );

                const expiry = Utils.epochToDisplay(
                    tokenInfo.token.expiresOn ? tokenInfo.token.expiresOn * 1000 : undefined,
                );
                this._entraLogger.info(
                    `VS Code accounts token acquired successfully for ${resourceEndpoint} with accountId '${params.accountId}' and tenantId '${params.tenantId}'; expires on ${tokenInfo.token.expiresOn} (${expiry.iso}, ${expiry.relative})`,
                );

                return {
                    accountKey: params.accountId,
                    token: tokenInfo.token.token,
                    expiresOn: tokenInfo.token.expiresOn,
                };
            } catch (error) {
                this._logger.error(
                    `VS Code accounts token acquisition failed: ${getErrorMessage(error)}`,
                );
                sendErrorEvent(
                    TelemetryViews.ConnectionManager,
                    TelemetryActions.AcquireVsCodeAccountToken,
                    error instanceof Error ? error : new Error(getErrorMessage(error)),
                    /* includeErrorMessage */ false,
                    /* errorCode */ undefined,
                    /* errorType */ undefined,
                    {},
                );
                return { accountKey: "", token: "", expiresOn: 0 };
            }
        }

        // Key Vault / Always Encrypted path
        const cacheKey = JSON.stringify(params);

        // Cache check is independent of auth provider
        if (this._keyVaultTokenCache.has(cacheKey)) {
            const cached = this._keyVaultTokenCache.get(cacheKey)!;
            if (AzureController.isTokenExpired(cached.expiresOn)) {
                this._keyVaultTokenCache.delete(cacheKey);
            } else {
                return {
                    accountKey: cached.key,
                    token: cached.token,
                    expiresOn: cached.expiresOn,
                };
            }
        }

        try {
            const activeUri = Utils.getActiveTextEditorUri();
            const activeAccountId = activeUri
                ? this._connections[activeUri]?.credentials?.accountId
                : undefined;

            let getAccounts: () => Promise<
                { label: string; description: string | undefined; value: string }[]
            >;
            let getTenants: (accountId: string) => Promise<{ id: string; displayName: string }[]>;
            let acquireToken: (accountId: string, tenantId: string) => Promise<IToken | undefined>;
            let onSignIn: () => Promise<string | undefined>;

            if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
                this._logger.debug("AKV token request received (VS Code accounts path)");
                getAccounts = async () => {
                    const accounts = await VsCodeAzureHelper.getAccounts();
                    return accounts.map((a) => ({
                        label:
                            a.id === activeAccountId
                                ? LocalizedConstants.Connection.currentAccount(a.label)
                                : a.label,
                        description: a.id,
                        value: a.id,
                    }));
                };
                getTenants = async (accountId) => {
                    const tenants = await VsCodeAzureHelper.getTenantsForAccount(accountId);
                    return tenants.map((t) => ({
                        id: t.tenantId ?? "",
                        displayName: t.displayName ?? t.tenantId ?? "",
                    }));
                };
                acquireToken = async (accountId, tenantId) => {
                    const tokenInfo = await acquireTokenFromVscodeAccountForResource(
                        getCloudResourceEndpoint("azureKeyVaultResource"),
                        accountId,
                        tenantId,
                    );

                    return tokenInfo.token;
                };
                onSignIn = async () => {
                    const result = await VsCodeAzureHelper.signIn();
                    if (!result.auth) {
                        throw new Error(LocalizedConstants.Connection.noAccountSelected);
                    }
                    return result.newAccountId;
                };
            } else {
                getAccounts = async () => {
                    const accounts = await this._accountStore.getAccounts();
                    return accounts.map((a) => ({
                        label:
                            a.key.id === activeAccountId
                                ? LocalizedConstants.Connection.currentAccount(a.displayInfo.name)
                                : a.displayInfo.name,
                        description: a.displayInfo.email,
                        value: a.key.id,
                    }));
                };
                getTenants = async (accountId) => {
                    const account = await this._accountStore.getAccount(accountId);
                    return (
                        account?.properties?.tenants?.map((t) => ({
                            id: t.id,
                            displayName: t.displayName,
                        })) ?? []
                    );
                };
                acquireToken = async (accountId, tenantId) => {
                    const account = await this._accountStore.getAccount(accountId);
                    return this.azureController.getAccountSecurityToken(
                        account,
                        tenantId,
                        getCloudProviderSettings(account.key.providerId).settings
                            .azureKeyVaultResource,
                    );
                };
                onSignIn = async () => {
                    const newAccount = await this.addAccount();
                    if (!newAccount) {
                        throw new Error(LocalizedConstants.Connection.noAccountSelected);
                    }
                    return newAccount.key.id;
                };
            }

            const accountId = await this.selectAccount(await getAccounts(), onSignIn);

            if (!accountId) {
                throw new Error(LocalizedConstants.Connection.noAccountSelected);
            }

            const tenantId = await this.selectTenantId(await getTenants(accountId));
            const result = await acquireToken(accountId, tenantId);

            if (!result) {
                throw new Error(
                    LocalizedConstants.Connection.failedToAcquireToken(accountId, tenantId),
                );
            }

            this._keyVaultTokenCache.set(cacheKey, result);
            return { accountKey: result.key, token: result.token, expiresOn: result.expiresOn };
        } catch (error) {
            this._logger.error(`Security token request failed: ${getErrorMessage(error)}`);
            vscode.window.showErrorMessage(
                LocalizedConstants.Connection.securityTokenRequestFailed(
                    getErrorMessage(error),
                    "Azure Key Vault",
                ),
            );
            // Return empty response rather than letting the error propagate
            // to STS as a null reference
            return { accountKey: "", token: "", expiresOn: 0 };
        }
    }

    /**
     * Shows a QuickPick to select an account from a normalized list of items.
     * If the user selects the "sign in" sentinel, `onSignIn` is called to obtain a new account.
     * Throws if the QuickPick is dismissed without a selection.
     */
    private async selectAccount(
        items: { label: string; description: string | undefined; value: string }[],
        onSignIn: () => Promise<string | undefined>,
    ): Promise<string | undefined> {
        const signInItem: ValueQuickPickItem<string> = {
            label: LocalizedConstants.Connection.signInToAzure,
            description: LocalizedConstants.Connection.signInToAzure,
            value: LocalizedConstants.Connection.signInToAzure,
        };

        const quickPickItems: ValueQuickPickItem<string>[] = [
            ...items.map((item) => ({
                label: item.label,
                description: item.description,
                value: item.value,
            })),
            signInItem,
        ];

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: LocalizedConstants.Connection.SelectAccountForKeyVault,
        });

        if (selected === undefined) {
            throw new Error(LocalizedConstants.Connection.noAccountSelected);
        }

        if (selected === signInItem) {
            return onSignIn();
        }

        return selected.value;
    }

    /**
     * Shows a QuickPick to select a tenant. Auto-selects if only one tenant is available.
     * @param tenants Normalized list of tenants with `id` and `displayName`.
     */
    private async selectTenantId(
        tenants: Array<{ id: string; displayName: string }>,
    ): Promise<string> {
        if (tenants.length === 1) {
            return tenants[0].id;
        }

        const items: ValueQuickPickItem<string>[] = tenants.map((tenant) => ({
            label: tenant.displayName,
            description: tenant.id,
            value: tenant.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: LocalizedConstants.Connection.SelectTenant,
        });

        if (!selected) {
            throw new Error(LocalizedConstants.Connection.NoTenantSelected);
        }

        return selected.value;
    }
}

interface ValueQuickPickItem<T> extends vscode.QuickPickItem {
    value: T;
}

export interface SqlConnectionError {
    message?: string;
    errorNumber?: number;
    errorMessage?: string;
    errorCode?: string;
}

export enum SqlConnectionErrorType {
    PasswordExpired = "passwordExpired",
    TrustServerCertificateNotEnabled = "trustServerCertificate",
    FirewallRuleError = "firewallRule",
    KerberosNonWindows = "kerberosNonWindows",
    EntraTokenExpired = "entraTokenExpired",
    Generic = "generic",
}

export async function getSqlConnectionErrorType(
    error: SqlConnectionError,
    credentials: IConnectionInfo,
): Promise<SqlConnectionErrorType> {
    const platformInfo = await PlatformInformation.getCurrent();

    const { errorNumber, errorMessage } = error;
    if (
        errorNumber === Constants.errorPasswordExpired ||
        errorNumber === Constants.errorPasswordNeedsReset
    ) {
        return SqlConnectionErrorType.PasswordExpired;
    } else if (errorNumber === Constants.errorSSLCertificateValidationFailed) {
        return SqlConnectionErrorType.TrustServerCertificateNotEnabled;
    } else if (errorNumber === Constants.errorFirewallRule) {
        return SqlConnectionErrorType.FirewallRuleError;
    } else if (
        !platformInfo.isWindows &&
        errorMessage?.includes(Constants.errorKerberosSubString)
    ) {
        return SqlConnectionErrorType.KerberosNonWindows;
    } else if (
        credentials.authenticationType === Constants.azureMfa &&
        needsAccountRefresh(errorMessage, credentials.user)
    ) {
        return SqlConnectionErrorType.EntraTokenExpired;
    } else {
        return SqlConnectionErrorType.Generic;
    }
}

/**
 * Checks if the account needs to be refreshed based on the error message.
 * @param result The result of the session creation.
 * @param username The username of the account.
 * @returns
 */
function needsAccountRefresh(errorMessage: string, username: string): boolean {
    let email = username?.includes(" - ")
        ? username.substring(username.indexOf("-") + 2)
        : username;
    return (
        errorMessage.includes(AzureConstants.AADSTS70043) ||
        errorMessage.includes(AzureConstants.AADSTS50173) ||
        errorMessage.includes(AzureConstants.AADSTS50020) ||
        errorMessage.includes(AzureConstants.AADSTS50078) ||
        errorMessage.includes(AzureConstants.mdsUserAccountNotReceived) ||
        errorMessage.includes(Utils.formatString(AzureConstants.mdsUserAccountNotFound, email))
    );
}
