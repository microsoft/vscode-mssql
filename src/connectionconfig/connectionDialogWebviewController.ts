/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import {
    ActivityStatus,
    ActivityObject,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import {
    AuthenticationType,
    AzureSubscriptionInfo,
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    AddFirewallRuleDialogProps,
    IConnectionDialogProfile,
    TrustServerCertDialogProps,
} from "../sharedInterfaces/connectionDialog";
import { ConnectionCompleteParams } from "../models/contracts/connection";
import {
    FormItemActionButton,
    FormItemOptions,
} from "../reactviews/common/forms/form";
import {
    ConnectionDialog as Loc,
    Common as LocCommon,
    refreshTokenLabel,
} from "../constants/locConstants";
import {
    azureSubscriptionFilterConfigKey,
    confirmVscodeAzureSignin,
    fetchServersFromAzure,
    getAccounts,
    getTenants,
    promptForAzureSubscriptionFilter,
} from "./azureHelpers";
import {
    sendActionEvent,
    sendErrorEvent,
    startActivity,
} from "../telemetry/telemetry";

import { ApiStatus } from "../sharedInterfaces/webview";
import { AzureController } from "../azure/azureController";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { IConnectionInfo } from "vscode-mssql";
import { Logger } from "../models/logger";
import MainController from "../controllers/mainController";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { UserSurvey } from "../nps/userSurvey";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    connectionCertValidationFailedErrorCode,
    connectionFirewallErrorCode,
} from "./connectionConstants";
import { getConnectionDisplayName } from "../models/connectionInfo";
import { getErrorMessage } from "../utils/utils";
import { l10n } from "vscode";
import {
    CredentialsQuickPickItemType,
    IConnectionCredentialsQuickPickItem,
    IConnectionProfile,
} from "../models/interfaces";
import { IAccount } from "../models/contracts/azure";
import {
    generateConnectionComponents,
    getActiveFormComponents,
    getFormComponent,
    groupAdvancedOptions,
} from "./formComponentHelpers";

export class ConnectionDialogWebviewController extends ReactWebviewPanelController<
    ConnectionDialogWebviewState,
    ConnectionDialogReducers
> {
    //#region Properties

    public static mainOptions: readonly (keyof IConnectionDialogProfile)[] = [
        "server",
        "trustServerCertificate",
        "authenticationType",
        "user",
        "password",
        "savePassword",
        "accountId",
        "tenantId",
        "database",
        "encrypt",
    ];

    private static _logger: Logger;

    private _connectionToEditCopy: IConnectionDialogProfile | undefined;
    private _azureSubscriptions: Map<string, AzureSubscription>;

    //#endregion

    constructor(
        context: vscode.ExtensionContext,
        private _mainController: MainController,
        private _objectExplorerProvider: ObjectExplorerProvider,
        private _connectionToEdit?: IConnectionInfo,
    ) {
        super(context, "connectionDialog", new ConnectionDialogWebviewState(), {
            title: Loc.connectionDialog,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "connectionDialogEditor_dark.svg",
                ),
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "connectionDialogEditor_light.svg",
                ),
            },
        });

        if (!ConnectionDialogWebviewController._logger) {
            const vscodeWrapper = new VscodeWrapper();
            const channel = vscodeWrapper.createOutputChannel(
                Loc.connectionDialog,
            );
            ConnectionDialogWebviewController._logger = Logger.create(channel);
        }

        this.registerRpcHandlers();
        this.initializeDialog().catch((err) => {
            void vscode.window.showErrorMessage(getErrorMessage(err));

            // The spots in initializeDialog() that handle potential PII have their own error catches that emit error telemetry with `includeErrorMessage` set to false.
            // Everything else during initialization shouldn't have PII, so it's okay to include the error message here.
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.Initialize,
                err,
                true, // includeErrorMessage
            );
        });
    }

    private async initializeDialog() {
        try {
            await this.updateLoadedConnections(this.state);
            this.updateState();
        } catch (err) {
            void vscode.window.showErrorMessage(getErrorMessage(err));
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.Initialize,
                err,
                false, // includeErrorMessage
            );
        }

        try {
            if (this._connectionToEdit) {
                await this.loadConnectionToEdit();
            } else {
                await this.loadEmptyConnection();
            }
        } catch (err) {
            await this.loadEmptyConnection();
            void vscode.window.showErrorMessage(getErrorMessage(err));

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.Initialize,
                err,
                false, // includeErrorMessage
            );
        }

        this.state.connectionComponents = {
            components: await generateConnectionComponents(
                this._mainController.connectionManager,
                getAccounts(this._mainController.azureAccountService),
                this.getAzureActionButtons(),
            ),
            mainOptions: [...ConnectionDialogWebviewController.mainOptions],
            topAdvancedOptions: [
                "port",
                "applicationName",
                // TODO: 'autoDisconnect',
                // TODO: 'sslConfiguration',
                "connectTimeout",
                "multiSubnetFailover",
            ],
            groupedAdvancedOptions: [], // computed below
        };

        this.state.connectionComponents.groupedAdvancedOptions =
            groupAdvancedOptions(this.state.connectionComponents);

        await this.updateItemVisibility();
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer(
            "setConnectionInputType",
            async (state, payload) => {
                this.state.selectedInputMode = payload.inputMode;
                await this.updateItemVisibility();
                this.updateState();

                if (
                    this.state.selectedInputMode ===
                    ConnectionInputMode.AzureBrowse
                ) {
                    await this.loadAllAzureServers(state);
                }

                return state;
            },
        );

        this.registerReducer("formAction", async (state, payload) => {
            if (payload.event.isAction) {
                const component = getFormComponent(
                    this.state,
                    payload.event.propertyName,
                );
                if (component && component.actionButtons) {
                    const actionButton = component.actionButtons.find(
                        (b) => b.id === payload.event.value,
                    );
                    if (actionButton?.callback) {
                        await actionButton.callback();
                    }
                }
            } else {
                (this.state.connectionProfile[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;
                await this.validateConnectionProfile(
                    this.state.connectionProfile,
                    payload.event.propertyName,
                );
                await this.handleAzureMFAEdits(payload.event.propertyName);
            }
            await this.updateItemVisibility();

            return state;
        });

        this.registerReducer("loadConnection", async (state, payload) => {
            sendActionEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadConnection,
            );

            this._connectionToEditCopy = structuredClone(payload.connection);
            this.clearFormError();
            this.state.connectionProfile = payload.connection;

            this.state.selectedInputMode = this._connectionToEditCopy
                .connectionString
                ? ConnectionInputMode.ConnectionString
                : ConnectionInputMode.Parameters;
            await this.updateItemVisibility();
            await this.handleAzureMFAEdits("azureAuthType");
            await this.handleAzureMFAEdits("accountId");

            return state;
        });

        this.registerReducer("connect", async (state) => {
            return this.connectHelper(state);
        });

        this.registerReducer("loadAzureServers", async (state, payload) => {
            await this.loadAzureServersForSubscription(
                state,
                payload.subscriptionId,
            );

            return state;
        });

        this.registerReducer("addFirewallRule", async (state, payload) => {
            const [startIp, endIp] =
                typeof payload.ip === "string"
                    ? [payload.ip, payload.ip]
                    : [payload.ip.startIp, payload.ip.endIp];

            console.debug(
                `Setting firewall rule: "${payload.name}" (${startIp} - ${endIp})`,
            );
            let account, tokenMappings;

            try {
                ({ account, tokenMappings } =
                    await this.constructAzureAccountForTenant(
                        payload.tenantId,
                    ));
            } catch (err) {
                state.formError = Loc.errorCreatingFirewallRule(
                    `"${payload.name}" (${startIp} - ${endIp})`,
                    getErrorMessage(err),
                );

                state.dialog = undefined;

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.AddFirewallRule,
                    err,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        failure: "constructAzureAccountForTenant",
                    },
                );

                return state;
            }

            const result =
                await this._mainController.connectionManager.firewallService.createFirewallRule(
                    {
                        account: account,
                        firewallRuleName: payload.name,
                        startIpAddress: startIp,
                        endIpAddress: endIp,
                        serverName: this.state.connectionProfile.server,
                        securityTokenMappings: tokenMappings,
                    },
                );

            if (!result.result) {
                state.formError = Loc.errorCreatingFirewallRule(
                    `"${payload.name}" (${startIp} - ${endIp})`,
                    result.errorMessage,
                );

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.AddFirewallRule,
                    new Error(result.errorMessage),
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        failure: "firewallService.createFirewallRule",
                    },
                );
            }

            sendActionEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.AddFirewallRule,
            );

            state.dialog = undefined;
            this.updateState(state);

            return await this.connectHelper(state);
        });

        this.registerReducer("closeDialog", async (state) => {
            state.dialog = undefined;
            return state;
        });

        this.registerReducer("filterAzureSubscriptions", async (state) => {
            await promptForAzureSubscriptionFilter(state);
            await this.loadAllAzureServers(state);

            return state;
        });

        this.registerReducer("refreshConnectionsList", async (state) => {
            await this.updateLoadedConnections(state);

            return state;
        });

        this.registerReducer(
            "deleteSavedConnection",
            async (state, payload) => {
                const confirm = await vscode.window.showQuickPick(
                    [LocCommon.delete, LocCommon.cancel],
                    {
                        title: LocCommon.areYouSureYouWantTo(
                            Loc.deleteTheSavedConnection(
                                payload.connection.displayName,
                            ),
                        ),
                    },
                );

                if (confirm !== LocCommon.delete) {
                    return state;
                }

                const success =
                    await this._mainController.connectionManager.connectionStore.removeProfile(
                        payload.connection as IConnectionProfile,
                    );

                if (success) {
                    await this.updateLoadedConnections(state);
                }

                return state;
            },
        );

        this.registerReducer(
            "removeRecentConnection",
            async (state, payload) => {
                await this._mainController.connectionManager.connectionStore.removeRecentlyUsed(
                    payload.connection as IConnectionProfile,
                );

                await this.updateLoadedConnections(state);

                return state;
            },
        );
    }

    //#region Helpers

    //#region Connection helpers

    private async updateItemVisibility() {
        let hiddenProperties: (keyof IConnectionDialogProfile)[] = [];

        if (
            this.state.selectedInputMode === ConnectionInputMode.Parameters ||
            this.state.selectedInputMode === ConnectionInputMode.AzureBrowse
        ) {
            if (
                this.state.connectionProfile.authenticationType !==
                AuthenticationType.SqlLogin
            ) {
                hiddenProperties.push("user", "password", "savePassword");
            }
            if (
                this.state.connectionProfile.authenticationType !==
                AuthenticationType.AzureMFA
            ) {
                hiddenProperties.push("accountId", "tenantId");
            }
            if (
                this.state.connectionProfile.authenticationType ===
                AuthenticationType.AzureMFA
            ) {
                // Hide tenantId if accountId has only one tenant
                const tenants = await getTenants(
                    this._mainController.azureAccountService,
                    this.state.connectionProfile.accountId,
                );
                if (tenants.length === 1) {
                    hiddenProperties.push("tenantId");
                }
            }
        }

        for (const component of Object.values(
            this.state.connectionComponents.components,
        )) {
            component.hidden = hiddenProperties.includes(
                component.propertyName,
            );
        }
    }

    private async validateConnectionProfile(
        connectionProfile: IConnectionDialogProfile,
        propertyName?: keyof IConnectionDialogProfile,
    ): Promise<string[]> {
        const erroredInputs = [];
        if (propertyName) {
            const component = getFormComponent(this.state, propertyName);
            if (component && component.validate) {
                component.validation = component.validate(
                    this.state,
                    connectionProfile[propertyName],
                );
                if (!component.validation.isValid) {
                    erroredInputs.push(component.propertyName);
                }
            }
        } else {
            getActiveFormComponents(this.state)
                .map((x) => this.state.connectionComponents.components[x])
                .forEach((c) => {
                    if (c.hidden) {
                        c.validation = {
                            isValid: true,
                            validationMessage: "",
                        };
                        return;
                    } else {
                        if (c.validate) {
                            c.validation = c.validate(
                                this.state,
                                connectionProfile[c.propertyName],
                            );
                            if (!c.validation.isValid) {
                                erroredInputs.push(c.propertyName);
                            }
                        }
                    }
                });
        }

        return erroredInputs;
    }

    /** Returns a copy of `connection` that's been cleaned up by clearing the properties that aren't being used
     * (e.g. due to form selections, like authType and inputMode) */
    private cleanConnection(
        connection: IConnectionDialogProfile,
    ): IConnectionDialogProfile {
        const cleanedConnection = structuredClone(connection);

        // Clear values for inputs that are hidden due to form selections
        for (const option of Object.values(
            this.state.connectionComponents.components,
        )) {
            if (option.hidden) {
                (cleanedConnection[
                    option.propertyName as keyof IConnectionDialogProfile
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = undefined;
            }
        }

        // Clear values for inputs that are not applicable due to the selected input mode
        if (
            this.state.selectedInputMode === ConnectionInputMode.Parameters ||
            this.state.selectedInputMode === ConnectionInputMode.AzureBrowse
        ) {
            cleanedConnection.connectionString = undefined;
        } else if (
            this.state.selectedInputMode ===
            ConnectionInputMode.ConnectionString
        ) {
            Object.keys(cleanedConnection).forEach((key) => {
                if (key !== "connectionString" && key !== "profileName") {
                    cleanedConnection[key] = undefined;
                }
            });
        }

        return cleanedConnection;
    }

    private async loadConnections(): Promise<{
        savedConnections: IConnectionDialogProfile[];
        recentConnections: IConnectionDialogProfile[];
    }> {
        const unsortedConnections: IConnectionCredentialsQuickPickItem[] =
            this._mainController.connectionManager.connectionStore.loadAllConnections(
                true /* addRecentConnections */,
            );

        const savedConnections = unsortedConnections
            .filter(
                (c) =>
                    c.quickPickItemType ===
                    CredentialsQuickPickItemType.Profile,
            )
            .map((c) => c.connectionCreds);

        const recentConnections = unsortedConnections
            .filter(
                (c) => c.quickPickItemType === CredentialsQuickPickItemType.Mru,
            )
            .map((c) => c.connectionCreds);

        sendActionEvent(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadRecentConnections,
            undefined, // additionalProperties
            {
                savedConnectionsCount: savedConnections.length,
                recentConnectionsCount: recentConnections.length,
            },
        );

        return {
            recentConnections: await Promise.all(
                recentConnections
                    .map((conn) => {
                        try {
                            return this.initializeConnectionForDialog(conn);
                        } catch (ex) {
                            console.error(
                                "Error initializing recent connection: " +
                                    getErrorMessage(ex),
                            );

                            sendErrorEvent(
                                TelemetryViews.ConnectionDialog,
                                TelemetryActions.LoadConnections,
                                ex,
                                false, // includeErrorMessage
                                undefined, // errorCode
                                undefined, // errorType
                                {
                                    connectionType: "recent",
                                    authType: conn.authenticationType,
                                },
                            );

                            return Promise.resolve(undefined);
                        }
                    })
                    .filter((c) => c !== undefined),
            ),
            savedConnections: await Promise.all(
                savedConnections
                    .map((conn) => {
                        try {
                            return this.initializeConnectionForDialog(conn);
                        } catch (ex) {
                            console.error(
                                "Error initializing saved connection: " +
                                    getErrorMessage(ex),
                            );

                            sendErrorEvent(
                                TelemetryViews.ConnectionDialog,
                                TelemetryActions.LoadConnections,
                                ex,
                                false, // includeErrorMessage
                                undefined, // errorCode
                                undefined, // errorType
                                {
                                    connectionType: "saved",
                                    authType: conn.authenticationType,
                                },
                            );

                            return Promise.resolve(undefined);
                        }
                    })
                    .filter((c) => c !== undefined),
            ),
        };
    }

    private async updateLoadedConnections(state: ConnectionDialogWebviewState) {
        const loadedConnections = await this.loadConnections();

        state.recentConnections = loadedConnections.recentConnections;
        state.savedConnections = loadedConnections.savedConnections;
    }

    private async validateProfile(
        connectionProfile?: IConnectionDialogProfile,
    ): Promise<string[]> {
        if (!connectionProfile) {
            connectionProfile = this.state.connectionProfile;
        }

        // clean the connection by clearing the options that aren't being used
        const cleanedConnection = this.cleanConnection(connectionProfile);

        return await this.validateConnectionProfile(cleanedConnection);
    }

    private async connectHelper(
        state: ConnectionDialogWebviewState,
    ): Promise<ConnectionDialogWebviewState> {
        this.clearFormError();
        this.state.connectionStatus = ApiStatus.Loading;
        this.updateState();

        const cleanedConnection: IConnectionDialogProfile =
            this.cleanConnection(this.state.connectionProfile);

        const erroredInputs = await this.validateProfile(cleanedConnection);

        if (erroredInputs.length > 0) {
            this.state.connectionStatus = ApiStatus.Error;
            console.warn(
                "One more more inputs have errors: " + erroredInputs.join(", "),
            );
            return state;
        }

        try {
            try {
                const result =
                    await this._mainController.connectionManager.connectionUI.validateAndSaveProfileFromDialog(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        cleanedConnection as any,
                    );

                if (result.errorMessage) {
                    return await this.handleConnectionErrorCodes(result, state);
                }
            } catch (error) {
                this.state.formError = getErrorMessage(error);
                this.state.connectionStatus = ApiStatus.Error;

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.CreateConnection,
                    error,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        connectionInputType: this.state.selectedInputMode,
                        authMode:
                            this.state.connectionProfile.authenticationType,
                    },
                );

                return state;
            }

            sendActionEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.CreateConnection,
                {
                    result: "success",
                    newOrEditedConnection: this._connectionToEditCopy
                        ? "edited"
                        : "new",
                    connectionInputType: this.state.selectedInputMode,
                    authMode: this.state.connectionProfile.authenticationType,
                },
            );

            if (this._connectionToEditCopy) {
                await this._mainController.connectionManager.getUriForConnection(
                    this._connectionToEditCopy,
                );
                await this._objectExplorerProvider.removeConnectionNodes([
                    this._connectionToEditCopy,
                ]);

                await this._mainController.connectionManager.connectionStore.removeProfile(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this._connectionToEditCopy as any,
                );
                this._objectExplorerProvider.refresh(undefined);
            }

            await this._mainController.connectionManager.connectionUI.saveProfile(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.state.connectionProfile as any,
            );
            const node =
                await this._mainController.createObjectExplorerSessionFromDialog(
                    this.state.connectionProfile,
                );

            this._objectExplorerProvider.refresh(undefined);
            await this.updateLoadedConnections(state);
            this.updateState();

            this.state.connectionStatus = ApiStatus.Loaded;
            await this._mainController.objectExplorerTree.reveal(node, {
                focus: true,
                select: true,
                expand: true,
            });
            await this.panel.dispose();
            await UserSurvey.getInstance().promptUserForNPSFeedback();
        } catch (error) {
            this.state.connectionStatus = ApiStatus.Error;

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.CreateConnection,
                error,
                undefined, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    connectionInputType: this.state.selectedInputMode,
                    authMode: this.state.connectionProfile.authenticationType,
                },
            );

            return state;
        }
        return state;
    }

    private async handleConnectionErrorCodes(
        result: ConnectionCompleteParams,
        state: ConnectionDialogWebviewState,
    ): Promise<ConnectionDialogWebviewState> {
        if (result.errorNumber === connectionCertValidationFailedErrorCode) {
            this.state.connectionStatus = ApiStatus.Error;
            this.state.dialog = {
                type: "trustServerCert",
                message: result.errorMessage,
            } as TrustServerCertDialogProps;

            // connection failing because the user didn't trust the server cert is not an error worth logging;
            // just prompt the user to trust the cert

            return state;
        } else if (result.errorNumber === connectionFirewallErrorCode) {
            this.state.connectionStatus = ApiStatus.Error;

            const handleFirewallErrorResult =
                await this._mainController.connectionManager.firewallService.handleFirewallRule(
                    result.errorNumber,
                    result.errorMessage,
                );

            if (!handleFirewallErrorResult.result) {
                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.AddFirewallRule,
                    new Error(result.errorMessage),
                    true, // includeErrorMessage; parse failed because it couldn't detect an IP address, so that'd be the only PII
                    undefined, // errorCode
                    undefined, // errorType
                );

                // Proceed with 0.0.0.0 as the client IP, and let user fill it out manually.
                handleFirewallErrorResult.ipAddress = "0.0.0.0";
            }

            const auth = await confirmVscodeAzureSignin();
            const tenants = await auth.getTenants();

            this.state.dialog = {
                type: "addFirewallRule",
                message: result.errorMessage,
                clientIp: handleFirewallErrorResult.ipAddress,
                tenants: tenants.map((t) => {
                    return {
                        name: t.displayName,
                        id: t.tenantId,
                    };
                }),
            } as AddFirewallRuleDialogProps;

            return state;
        }

        this.state.formError = result.errorMessage;
        this.state.connectionStatus = ApiStatus.Error;

        sendActionEvent(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.CreateConnection,
            {
                result: "connectionError",
                errorNumber: String(result.errorNumber),
                newOrEditedConnection: this._connectionToEditCopy
                    ? "edited"
                    : "new",
                connectionInputType: this.state.selectedInputMode,
                authMode: this.state.connectionProfile.authenticationType,
            },
        );

        return state;
    }

    private async loadConnectionToEdit() {
        if (this._connectionToEdit) {
            this._connectionToEditCopy = structuredClone(
                this._connectionToEdit,
            );
            const connection = await this.initializeConnectionForDialog(
                this._connectionToEdit,
            );
            this.state.connectionProfile = connection;

            this.state.selectedInputMode =
                connection.connectionString && connection.server === undefined
                    ? ConnectionInputMode.ConnectionString
                    : ConnectionInputMode.Parameters;
            this.updateState();
        }
    }

    private async loadEmptyConnection() {
        const emptyConnection = {
            authenticationType: AuthenticationType.SqlLogin,
            connectTimeout: 15, // seconds
            applicationName: "vscode-mssql",
        } as IConnectionDialogProfile;
        this.state.connectionProfile = emptyConnection;
    }

    private async initializeConnectionForDialog(
        connection: IConnectionInfo,
    ): Promise<IConnectionDialogProfile> {
        // Load the password if it's saved
        const isConnectionStringConnection =
            connection.connectionString !== undefined &&
            connection.connectionString !== "";
        if (!isConnectionStringConnection) {
            const password =
                await this._mainController.connectionManager.connectionStore.lookupPassword(
                    connection,
                    isConnectionStringConnection,
                );
            connection.password = password;
        } else {
            // If the connection is a connection string connection with SQL Auth:
            //   * the full connection string is stored as the "password" in the credential store
            //   * we need to extract the password from the connection string
            // If the connection is a connection string connection with a different auth type, then there's nothing in the credential store.

            const connectionString =
                await this._mainController.connectionManager.connectionStore.lookupPassword(
                    connection,
                    isConnectionStringConnection,
                );

            if (connectionString) {
                const passwordIndex = connectionString
                    .toLowerCase()
                    .indexOf("password=");

                if (passwordIndex !== -1) {
                    // extract password from connection string; found between 'Password=' and the next ';'
                    const passwordStart = passwordIndex + "password=".length;
                    const passwordEnd = connectionString.indexOf(
                        ";",
                        passwordStart,
                    );
                    if (passwordEnd !== -1) {
                        connection.password = connectionString.substring(
                            passwordStart,
                            passwordEnd,
                        );
                    }

                    // clear the connection string from the IConnectionDialogProfile so that the ugly connection string key
                    // that's used to look up the actual connection string (with password) isn't displayed
                    connection.connectionString = "";
                }
            }
        }

        const dialogConnection = connection as IConnectionDialogProfile;
        // Set the display name
        dialogConnection.displayName = dialogConnection.profileName
            ? dialogConnection.profileName
            : getConnectionDisplayName(connection);
        return dialogConnection;
    }

    //#endregion

    //#region Azure helpers

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        const actionButtons: FormItemActionButton[] = [];
        actionButtons.push({
            label: Loc.signIn,
            id: "azureSignIn",
            callback: async () => {
                const account =
                    await this._mainController.azureAccountService.addAccount();
                const accountsComponent = getFormComponent(
                    this.state,
                    "accountId",
                );
                if (accountsComponent) {
                    accountsComponent.options = await getAccounts(
                        this._mainController.azureAccountService,
                    );
                    this.state.connectionProfile.accountId = account.key.id;
                    this.updateState();
                    await this.handleAzureMFAEdits("accountId");
                }
            },
        });

        if (
            this.state.connectionProfile.authenticationType ===
                AuthenticationType.AzureMFA &&
            this.state.connectionProfile.accountId
        ) {
            const account = (
                await this._mainController.azureAccountService.getAccounts()
            ).find(
                (account) =>
                    account.displayInfo.userId ===
                    this.state.connectionProfile.accountId,
            );
            if (account) {
                const session =
                    await this._mainController.azureAccountService.getAccountSecurityToken(
                        account,
                        undefined,
                    );
                const isTokenExpired = AzureController.isTokenInValid(
                    session.token,
                    session.expiresOn,
                );
                if (isTokenExpired) {
                    actionButtons.push({
                        label: refreshTokenLabel,
                        id: "refreshToken",
                        callback: async () => {
                            const account = (
                                await this._mainController.azureAccountService.getAccounts()
                            ).find(
                                (account) =>
                                    account.displayInfo.userId ===
                                    this.state.connectionProfile.accountId,
                            );
                            if (account) {
                                const session =
                                    await this._mainController.azureAccountService.getAccountSecurityToken(
                                        account,
                                        undefined,
                                    );
                                ConnectionDialogWebviewController._logger.log(
                                    "Token refreshed",
                                    session.expiresOn,
                                );
                            }
                        },
                    });
                }
            }
        }
        return actionButtons;
    }

    private async handleAzureMFAEdits(
        propertyName: keyof IConnectionDialogProfile,
    ) {
        const mfaComponents: (keyof IConnectionDialogProfile)[] = [
            "accountId",
            "tenantId",
            "authenticationType",
        ];
        if (mfaComponents.includes(propertyName)) {
            if (
                this.state.connectionProfile.authenticationType !==
                AuthenticationType.AzureMFA
            ) {
                return;
            }
            const accountComponent = getFormComponent(this.state, "accountId");
            const tenantComponent = getFormComponent(this.state, "tenantId");
            let tenants: FormItemOptions[] = [];
            switch (propertyName) {
                case "accountId":
                    tenants = await getTenants(
                        this._mainController.azureAccountService,
                        this.state.connectionProfile.accountId,
                    );
                    if (tenantComponent) {
                        tenantComponent.options = tenants;
                        if (tenants && tenants.length > 0) {
                            this.state.connectionProfile.tenantId =
                                tenants[0].value;
                        }
                    }
                    accountComponent.actionButtons =
                        await this.getAzureActionButtons();
                    break;
                case "tenantId":
                    break;
                case "authenticationType":
                    const firstOption = accountComponent.options[0];
                    if (firstOption) {
                        this.state.connectionProfile.accountId =
                            firstOption.value;
                    }
                    tenants = await getTenants(
                        this._mainController.azureAccountService,
                        this.state.connectionProfile.accountId,
                    );
                    if (tenantComponent) {
                        tenantComponent.options = tenants;
                        if (tenants && tenants.length > 0) {
                            this.state.connectionProfile.tenantId =
                                tenants[0].value;
                        }
                    }
                    accountComponent.actionButtons =
                        await this.getAzureActionButtons();
                    break;
            }
        }
    }

    private async constructAzureAccountForTenant(
        tenantId: string,
    ): Promise<{ account: IAccount; tokenMappings: {} }> {
        const auth = await confirmVscodeAzureSignin();
        const subs = await auth.getSubscriptions(false /* filter */);
        const sub = subs.filter((s) => s.tenantId === tenantId)[0];

        if (!sub) {
            throw new Error(
                Loc.errorLoadingAzureAccountInfoForTenantId(tenantId),
            );
        }

        const token = await sub.credential.getToken(".default");

        const session = await sub.authentication.getSession();

        const account: IAccount = {
            displayInfo: {
                displayName: session.account.label,
                userId: session.account.label,
                name: session.account.label,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                accountType: (session.account as any).type as any,
            },
            key: {
                providerId: "microsoft",
                id: session.account.label,
            },
            isStale: false,
            properties: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                azureAuthType: 0 as any,
                providerSettings: undefined,
                isMsAccount: false,
                owningTenant: undefined,
                tenants: [
                    {
                        displayName: sub.tenantId,
                        id: sub.tenantId,
                        userId: token.token,
                    },
                ],
            },
        };

        const tokenMappings = {};
        tokenMappings[sub.tenantId] = {
            Token: token.token,
        };

        return { account, tokenMappings };
    }

    private async loadAzureSubscriptions(
        state: ConnectionDialogWebviewState,
    ): Promise<Map<string, AzureSubscription[]> | undefined> {
        let endActivity: ActivityObject;
        try {
            const auth = await confirmVscodeAzureSignin();

            if (!auth) {
                state.formError = l10n.t("Azure sign in failed.");
                return undefined;
            }

            state.loadingAzureSubscriptionsStatus = ApiStatus.Loading;
            this.updateState();

            // getSubscriptions() below checks this config setting if filtering is specified.  If the user has this set, then we use it; if not, we get all subscriptions.
            // The specific vscode config setting it uses is hardcoded into the VS Code Azure SDK, so we need to use the same value here.
            const shouldUseFilter =
                vscode.workspace
                    .getConfiguration()
                    .get<
                        string[] | undefined
                    >(azureSubscriptionFilterConfigKey) !== undefined;

            endActivity = startActivity(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureSubscriptions,
            );

            this._azureSubscriptions = new Map(
                (await auth.getSubscriptions(shouldUseFilter)).map((s) => [
                    s.subscriptionId,
                    s,
                ]),
            );
            const tenantSubMap = this.groupBy<string, AzureSubscription>(
                Array.from(this._azureSubscriptions.values()),
                "tenantId",
            ); // TODO: replace with Object.groupBy once ES2024 is supported

            const subs: AzureSubscriptionInfo[] = [];

            for (const t of tenantSubMap.keys()) {
                for (const s of tenantSubMap.get(t)) {
                    subs.push({
                        id: s.subscriptionId,
                        name: s.name,
                        loaded: false,
                    });
                }
            }

            state.azureSubscriptions = subs;
            state.loadingAzureSubscriptionsStatus = ApiStatus.Loaded;

            endActivity.end(
                ActivityStatus.Succeeded,
                undefined, // additionalProperties
                {
                    subscriptionCount: subs.length,
                },
            );
            this.updateState();

            return tenantSubMap;
        } catch (error) {
            state.formError = l10n.t("Error loading Azure subscriptions.");
            state.loadingAzureSubscriptionsStatus = ApiStatus.Error;
            console.error(state.formError + "\n" + getErrorMessage(error));
            endActivity.endFailed(error, false);
            return undefined;
        }
    }

    private async loadAllAzureServers(
        state: ConnectionDialogWebviewState,
    ): Promise<void> {
        const endActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadAzureServers,
        );
        try {
            const tenantSubMap = await this.loadAzureSubscriptions(state);

            if (!tenantSubMap) {
                return;
            }

            if (tenantSubMap.size === 0) {
                state.formError = l10n.t(
                    "No subscriptions available.  Adjust your subscription filters to try again.",
                );
            } else {
                state.loadingAzureServersStatus = ApiStatus.Loading;
                state.azureServers = [];
                this.updateState();
                const promiseArray: Promise<void>[] = [];
                for (const t of tenantSubMap.keys()) {
                    for (const s of tenantSubMap.get(t)) {
                        promiseArray.push(
                            this.loadAzureServersForSubscription(
                                state,
                                s.subscriptionId,
                            ),
                        );
                    }
                }
                await Promise.all(promiseArray);
                endActivity.end(
                    ActivityStatus.Succeeded,
                    undefined, // additionalProperties
                    {
                        subscriptionCount: promiseArray.length,
                    },
                );

                state.loadingAzureServersStatus = ApiStatus.Loaded;
                return;
            }
        } catch (error) {
            state.formError = l10n.t("Error loading Azure databases.");
            state.loadingAzureServersStatus = ApiStatus.Error;
            console.error(state.formError + "\n" + getErrorMessage(error));

            endActivity.endFailed(
                error,
                false, // includeErrorMessage
            );
            return;
        }
    }

    private async loadAzureServersForSubscription(
        state: ConnectionDialogWebviewState,
        subscriptionId: string,
    ) {
        const azSub = this._azureSubscriptions.get(subscriptionId);
        const stateSub = state.azureSubscriptions.find(
            (s) => s.id === subscriptionId,
        );

        try {
            const servers = await fetchServersFromAzure(azSub);
            state.azureServers.push(...servers);
            stateSub.loaded = true;
            this.updateState();
            console.log(
                `Loaded ${servers.length} servers for subscription ${azSub.name} (${azSub.subscriptionId})`,
            );
        } catch (error) {
            console.error(
                Loc.errorLoadingAzureDatabases(
                    azSub.name,
                    azSub.subscriptionId,
                ),
                +"\n" + getErrorMessage(error),
            );

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureServers,
                error,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
            );
        }
    }

    //#endregion

    //#region Miscellanous helpers

    private clearFormError() {
        this.state.formError = "";
        for (const component of getActiveFormComponents(this.state).map(
            (x) => this.state.connectionComponents.components[x],
        )) {
            component.validation = undefined;
        }
    }

    private groupBy<K, V>(values: V[], key: keyof V): Map<K, V[]> {
        return values.reduce((rv, x) => {
            const keyValue = x[key] as K;
            if (!rv.has(keyValue)) {
                rv.set(keyValue, []);
            }
            rv.get(keyValue)!.push(x);
            return rv;
        }, new Map<K, V[]>());
    }

    //#endregion

    //#endregion
}
