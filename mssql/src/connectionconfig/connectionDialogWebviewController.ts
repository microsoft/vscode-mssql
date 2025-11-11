/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import { shallowEqualObjects } from "shallow-equal";

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
    ConnectionDialogFormItemSpec,
    ConnectionStringDialogProps,
    GetConnectionDisplayNameRequest,
    IAzureAccount,
    GetSqlAnalyticsEndpointUriFromFabricRequest,
    ChangePasswordDialogProps,
} from "../sharedInterfaces/connectionDialog";
import { FormItemActionButton, FormItemOptions } from "../sharedInterfaces/form";
import {
    ConnectionDialog as Loc,
    Common as LocCommon,
    Azure as LocAzure,
    Fabric as LocFabric,
    refreshTokenLabel,
} from "../constants/locConstants";
import * as LocAll from "../constants/locConstants";
import {
    getAccounts,
    getTenants,
    promptForAzureSubscriptionFilter,
    VsCodeAzureHelper,
} from "./azureHelpers";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";

import { ApiStatus } from "../sharedInterfaces/webview";
import { AzureController } from "../azure/azureController";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";
import MainController from "../controllers/mainController";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { UserSurvey } from "../nps/userSurvey";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    getConnectionDisplayName,
    getServerTypes,
    getDefaultConnection,
} from "../models/connectionInfo";
import { getErrorMessage } from "../utils/utils";
import { l10n } from "vscode";
import {
    CredentialsQuickPickItemType,
    IConnectionGroup,
    IConnectionProfile,
    IConnectionProfileWithSource,
} from "../models/interfaces";
import { generateConnectionComponents, groupAdvancedOptions } from "./formComponentHelpers";
import { FormWebviewController } from "../forms/formWebviewController";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { Deferred } from "../protocol";
import { configSelectedAzureSubscriptions } from "../constants/constants";
import * as AzureConstants from "../azure/constants";
import { AddFirewallRuleState } from "../sharedInterfaces/addFirewallRule";
import * as Utils from "../models/utils";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";
import { populateAzureAccountInfo } from "../controllers/addFirewallRuleWebviewController";
import { MssqlVSCodeAzureSubscriptionProvider } from "../azure/MssqlVSCodeAzureSubscriptionProvider";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { FabricHelper } from "../fabric/fabricHelper";
import { FabricSqlDbInfo, FabricWorkspaceInfo } from "../sharedInterfaces/fabric";
import {
    ConnectionInfo,
    getSqlConnectionErrorType,
    SqlConnectionErrorType,
} from "../controllers/connectionManager";
import {
    ChangePasswordWebviewRequest,
    ChangePasswordWebviewState,
} from "../sharedInterfaces/changePassword";
import { getCloudId } from "../azure/providerSettings";

const FABRIC_WORKSPACE_AUTOLOAD_LIMIT = 10;
export const CLEAR_TOKEN_CACHE = "clearTokenCache";
const CONNECTION_DIALOG_VIEW_ID = "connectionDialog";

export class ConnectionDialogWebviewController extends FormWebviewController<
    IConnectionDialogProfile,
    ConnectionDialogWebviewState,
    ConnectionDialogFormItemSpec,
    ConnectionDialogReducers
> {
    //#region Properties

    public readonly initialized: Deferred<void> = new Deferred<void>();

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

    private _connectionBeingEdited: IConnectionDialogProfile | undefined;
    private _azureSubscriptions: Map<string, AzureSubscription>;

    //#endregion

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _mainController: MainController,
        private _objectExplorerProvider: ObjectExplorerProvider,
        connectionToEdit?: IConnectionInfo,
        initialConnectionGroup?: IConnectionGroup,
    ) {
        super(
            context,
            vscodeWrapper,
            CONNECTION_DIALOG_VIEW_ID,
            CONNECTION_DIALOG_VIEW_ID,
            new ConnectionDialogWebviewState(),
            {
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
            },
        );

        this.registerRpcHandlers();
        void this.initializeDialog(connectionToEdit, initialConnectionGroup)
            .then(() => {
                this.updateState();
                this.initialized.resolve();
            })
            .catch((err) => {
                void vscode.window.showErrorMessage(getErrorMessage(err));

                // The spots in initializeDialog() that handle potential PII have their own error catches that emit error telemetry with `includeErrorMessage` set to false.
                // Everything else during initialization shouldn't have PII, so it's okay to include the error message here.
                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.Initialize,
                    err,
                    true, // includeErrorMessage
                    undefined, // errorCode,
                    "catchAll", // errorType
                );
                this.initialized.reject(getErrorMessage(err));
            });
    }

    private async initializeDialog(
        connectionToEdit: IConnectionInfo,
        initialConnectionGroup?: IConnectionGroup,
    ): Promise<void> {
        // Load connection form components
        this.state.formComponents = await generateConnectionComponents(
            this._mainController.connectionManager,
            getAccounts(this._mainController.azureAccountService, this.logger),
            this.getAzureActionButtons(),
            this.getConnectionGroups(this._mainController),
        );

        this.state.connectionComponents = {
            mainOptions: [...ConnectionDialogWebviewController.mainOptions],
            groupedAdvancedOptions: [], // computed below
        };

        this.state.connectionComponents.groupedAdvancedOptions = groupAdvancedOptions(
            this.state.formComponents as Record<
                keyof IConnectionDialogProfile,
                ConnectionDialogFormItemSpec
            >, // cast away the Partial type
            this.state.connectionComponents,
        );

        // Display intitial UI since it may take a moment for the connection to load
        // due to fetching Azure account and tenant info
        this.loadEmptyConnection();
        await this.updateItemVisibility();
        this.updateState();

        // Load saved/recent connections
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
                undefined, // errorCode,
                "loadSavedConnections", // errorType
            );
        }

        // Load connection (if specified); happens after form is loaded so that the form can be updated
        if (connectionToEdit) {
            try {
                await this.loadConnectionToEdit(connectionToEdit);
            } catch (err) {
                this.loadEmptyConnection();
                void vscode.window.showErrorMessage(getErrorMessage(err));

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.Initialize,
                    err,
                    false, // includeErrorMessage
                    undefined, // errorCode,
                    "loadConnectionToEdit", // errorType
                );
            }
        }

        if (initialConnectionGroup) {
            this.state.connectionProfile.groupId = initialConnectionGroup.id;
        }

        await this.updateItemVisibility();
    }

    private registerRpcHandlers() {
        this.registerReducer("setConnectionInputType", async (state, payload) => {
            this.state.selectedInputMode = payload.inputMode;
            await this.updateItemVisibility();
            state.formMessage = undefined;
            this.updateState();

            if (state.selectedInputMode === ConnectionInputMode.AzureBrowse) {
                // Start loading Azure servers if it isn't already complete or in progress
                if (
                    (state.loadingAzureSubscriptionsStatus === ApiStatus.NotStarted ||
                        state.loadingAzureSubscriptionsStatus === ApiStatus.Error) &&
                    (state.loadingAzureServersStatus === ApiStatus.NotStarted ||
                        state.loadingAzureServersStatus === ApiStatus.Error)
                ) {
                    await this.loadAllAzureServers(state);
                }
            } else if (state.selectedInputMode === ConnectionInputMode.FabricBrowse) {
                // Don't port connection information when switching to Fabric Browse
                state.connectionProfile.server = undefined;
                state.connectionProfile.database = undefined;
                state.connectionProfile.user = undefined;

                // Also clear old Fabric state
                state.fabricWorkspacesLoadStatus = { status: ApiStatus.NotStarted };
                state.fabricWorkspaces = [];

                if (!state.selectedAccountId) {
                    if (
                        state.loadingAzureAccountsStatus === ApiStatus.NotStarted ||
                        state.loadingAzureAccountsStatus === ApiStatus.Error
                    ) {
                        // Indicate we're checking for existing accounts
                        state.loadingAzureAccountsStatus = ApiStatus.Loading;
                        this.updateState(state);

                        state.azureAccounts = (await VsCodeAzureHelper.getAccounts()).map((a) => {
                            return {
                                id: a.id,
                                name: a.label,
                            } as IAzureAccount;
                        });

                        if (state.azureAccounts.length === 0) {
                            state.loadingAzureAccountsStatus = ApiStatus.NotStarted;
                        } else {
                            state.selectedAccountId = state.azureAccounts[0].id;
                            state.loadingAzureAccountsStatus = ApiStatus.Loaded;
                        }

                        this.updateState(state);
                    }
                }

                if (state.selectedAccountId && state.selectedTenantId) {
                    await this.loadFabricWorkspaces(
                        state,
                        state.selectedAccountId,
                        state.selectedTenantId,
                    );
                }
            }

            return state;
        });

        this.registerReducer("loadConnection", async (state, payload) => {
            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.LoadConnection);

            this._connectionBeingEdited = structuredClone(payload.connection);
            this.clearFormError();
            this.state.connectionProfile = payload.connection;
            this.state.selectedInputMode = ConnectionInputMode.Parameters;

            await this.updateItemVisibility();
            await this.handleAzureMFAEdits("azureAuthType");
            await this.handleAzureMFAEdits("accountId");

            await this.checkReadyToConnect();

            return state;
        });

        this.registerReducer("connect", async (state) => {
            return this.connectHelper(state);
        });

        this.registerReducer("loadAzureServers", async (state, payload) => {
            await this.loadAzureServersForSubscription(state, payload.subscriptionId);

            return state;
        });

        this.registerReducer("addFirewallRule", async (state, payload) => {
            (state.dialog as AddFirewallRuleDialogProps).props.addFirewallRuleStatus =
                ApiStatus.Loading;
            this.updateState(state);

            try {
                await this._mainController.connectionManager.firewallService.createFirewallRuleWithVscodeAccount(
                    payload.firewallRuleSpec,
                    this.state.connectionProfile.server,
                );
                state.dialog = undefined;
            } catch (err) {
                state.formMessage = { message: getErrorMessage(err) };
                state.dialog = undefined;

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.AddFirewallRule,
                    err,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    err.Name, // errorType
                    {
                        failure: err.Name,
                        cloudType: getCloudId(),
                    },
                );

                return state;
            }

            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.AddFirewallRule);

            state.dialog = undefined;
            this.updateState(state);

            return await this.connectHelper(state);
        });

        this.registerReducer("createConnectionGroup", async (state, payload) => {
            const createConnectionGroupResult: IConnectionGroup | string =
                await createConnectionGroup(
                    payload.connectionGroupSpec,
                    this._mainController.connectionManager,
                    TelemetryViews.ConnectionDialog,
                );
            if (typeof createConnectionGroupResult === "string") {
                // If the result is a string, it means there was an error creating the group
                state.formMessage = { message: createConnectionGroupResult };
            } else {
                // If the result is an IConnectionGroup, it means the group was created successfully
                state.connectionProfile.groupId = createConnectionGroupResult.id;
            }

            state.formComponents.groupId.options =
                await this._mainController.connectionManager.connectionUI.getConnectionGroupOptions();

            state.dialog = undefined;

            this.updateState(state);

            return await this.connectHelper(state);
        });

        this.registerReducer("openCreateConnectionGroupDialog", async (state) => {
            state.dialog = getDefaultConnectionGroupDialogProps();
            return state;
        });

        this.registerReducer("closeDialog", async (state) => {
            state.dialog = undefined;
            return state;
        });

        this.registerReducer("closeMessage", async (state) => {
            state.formMessage = undefined;
            return state;
        });

        this.registerReducer("filterAzureSubscriptions", async (state) => {
            try {
                if (await promptForAzureSubscriptionFilter(state, this.logger)) {
                    await this.loadAllAzureServers(state);
                }
            } catch (err) {
                this.state.formMessage = { message: getErrorMessage(err) };

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.FilterAzureSubscriptions,
                    err,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        cloudType: getCloudId(),
                    },
                );
            }

            return state;
        });

        this.registerReducer("refreshConnectionsList", async (state) => {
            await this.updateLoadedConnections(state);

            return state;
        });

        this.registerReducer("deleteSavedConnection", async (state, payload) => {
            const confirm = await vscode.window.showQuickPick(
                [LocCommon.delete, LocCommon.cancel],
                {
                    title: LocCommon.areYouSureYouWantTo(
                        Loc.deleteTheSavedConnection(getConnectionDisplayName(payload.connection)),
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
        });

        this.registerReducer("removeRecentConnection", async (state, payload) => {
            await this._mainController.connectionManager.connectionStore.removeRecentlyUsed(
                payload.connection as IConnectionProfile,
            );

            await this.updateLoadedConnections(state);

            return state;
        });

        this.registerReducer("loadFromConnectionString", async (state, payload) => {
            sendActionEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadFromConnectionString,
            );

            try {
                const connDetails =
                    await this._mainController.connectionManager.parseConnectionString(
                        payload.connectionString,
                    );

                state.connectionProfile = await this.hydrateConnectionDetailsFromProfile(
                    connDetails,
                    state.connectionProfile,
                );

                state.dialog = undefined; // Close the dialog

                if (state.connectionProfile.authenticationType === AuthenticationType.AzureMFA) {
                    await this.handleAzureMFAEdits("accountId");
                }

                await this.updateItemVisibility();

                return state;
            } catch (error) {
                // If there's an error parsing the connection string, show an error and keep dialog open
                this.logger.error("Error parsing connection string: " + getErrorMessage(error));

                const errorMessage = l10n.t(
                    "Invalid connection string: {0}",
                    getErrorMessage(error),
                );

                if (state.dialog?.type === "loadFromConnectionString") {
                    (state.dialog as ConnectionStringDialogProps).connectionStringError =
                        errorMessage;
                } else {
                    state.formMessage = { message: errorMessage };
                }

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.LoadFromConnectionString,
                    error,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                );

                return state;
            }
        });

        this.registerReducer("openConnectionStringDialog", async (state) => {
            if (state.selectedInputMode !== ConnectionInputMode.Parameters) {
                state.selectedInputMode = ConnectionInputMode.Parameters;
                state.formMessage = undefined;
                this.updateState(state);
            }

            try {
                let connectionString = "";

                // if the current connection is the untouched default connection, connection string is left empty
                if (!shallowEqualObjects(state.connectionProfile, getDefaultConnection())) {
                    const cleanedConnection = this.cleanConnection(state.connectionProfile);

                    const connectionDetails =
                        this._mainController.connectionManager.createConnectionDetails(
                            cleanedConnection,
                        );

                    let tempUserId = false;

                    if (
                        connectionDetails.options.authenticationType ===
                            AuthenticationType.AzureMFA &&
                        connectionDetails.options.user === undefined
                    ) {
                        // STS call for getting connection string expects a user when AzureMFA is used; if user is not set, set it to empty string
                        connectionDetails.options.user = "";
                        tempUserId = true;
                    }

                    connectionString =
                        await this._mainController.connectionManager.getConnectionString(
                            connectionDetails,
                            true /* includePassword */,
                        );

                    if (tempUserId) {
                        // remove temporary userId from connection string
                        connectionString.replace("User Id=;", "");
                    }
                }

                state.dialog = {
                    type: "loadFromConnectionString",
                    connectionString: connectionString,
                } as ConnectionStringDialogProps;
            } catch (error) {
                this.logger.error("Error generating connection string: " + getErrorMessage(error));
                state.dialog = {
                    type: "loadFromConnectionString",
                    connectionString: "",
                } as ConnectionStringDialogProps;
            }

            return state;
        });

        this.onRequest(GetConnectionDisplayNameRequest.type, async (payload) => {
            return getConnectionDisplayName(payload);
        });

        this.registerReducer("signIntoAzureForFirewallRule", async (state) => {
            if (state.dialog?.type !== "addFirewallRule") {
                return state;
            }

            await populateAzureAccountInfo(
                (state.dialog as AddFirewallRuleDialogProps).props,
                true /* forceSignInPrompt */,
            );

            return state;
        });

        this.registerReducer("signIntoAzureForBrowse", async (state, payload) => {
            if (payload.browseTarget === ConnectionInputMode.AzureBrowse) {
                if (state.selectedInputMode !== ConnectionInputMode.AzureBrowse) {
                    state.selectedInputMode = ConnectionInputMode.AzureBrowse;
                    state.formMessage = undefined;
                    this.updateState(state);
                }
            }

            if (state.loadingAzureAccountsStatus === ApiStatus.NotStarted) {
                state.loadingAzureAccountsStatus = ApiStatus.Loading;
                state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
                state.azureTenants = [];
                this.updateState(state);
            }

            const existingAccounts = state.azureAccounts.map((a) => a.id);

            try {
                await VsCodeAzureHelper.signIn(true /* forceSignInPrompt */);
            } catch (error) {
                this.logger.error("Error signing into Azure: " + getErrorMessage(error));
                state.formMessage = {
                    message: LocAzure.errorSigningIntoAzure(getErrorMessage(error)),
                };

                return state;
            }

            state.azureAccounts = (await VsCodeAzureHelper.getAccounts()).map((a) => {
                return {
                    id: a.id,
                    name: a.label,
                } as IAzureAccount;
            });

            // find the account that was added, and select it
            state.selectedAccountId = state.azureAccounts.find(
                (a) => !existingAccounts.includes(a.id),
            )?.id;

            state.loadingAzureAccountsStatus = ApiStatus.Loaded;
            this.updateState(state);

            if (payload.browseTarget === ConnectionInputMode.AzureBrowse) {
                await this.loadAllAzureServers(state);

                return state;
            }

            return state;
        });

        this.registerReducer("selectAzureAccount", async (state, payload) => {
            // Loading state
            state.selectedAccountId = payload.accountId;
            state.azureTenants = [];
            state.selectedTenantId = "";
            state.loadingAzureTenantsStatus = ApiStatus.Loading;

            this.updateState(state);

            // set the list of tenants and selected tenant
            const azureAccount = await VsCodeAzureHelper.getAccountById(payload.accountId);
            const tenants = await VsCodeAzureHelper.getTenantsForAccount(azureAccount);

            state.azureTenants = tenants.map((t) => ({
                id: t.tenantId,
                name: t.displayName,
            }));

            // Response from VS Code account system shows all tenants as "Home", so we need to extract the home tenant ID manually
            const homeTenantId = VsCodeAzureHelper.getHomeTenantIdForAccount(azureAccount);

            // For personal Microsoft accounts, the extracted tenant ID may not be one that the user has access to.
            // Only use the extracted tenant ID if it's in the tenant list; otherwise, default to the first.
            state.selectedTenantId = tenants.find((t) => t.tenantId === homeTenantId)
                ? homeTenantId
                : state.azureTenants.length > 0
                  ? state.azureTenants[0].id
                  : undefined;

            state.loadingAzureTenantsStatus = ApiStatus.Loaded;

            return state;
        });

        this.registerReducer("selectAzureTenant", async (state, payload) => {
            state.selectedTenantId = payload.tenantId;
            state.fabricWorkspacesLoadStatus = { status: ApiStatus.Loading };
            state.fabricWorkspaces = [];
            this.updateState(state);

            await this.loadFabricWorkspaces(state, state.selectedAccountId, state.selectedTenantId);

            // Fabric REST API rate-limits to 50 requests/user/minute,
            // so only auto-load contents of workspaces if they're below a safe threshold
            if (state.fabricWorkspaces.length <= FABRIC_WORKSPACE_AUTOLOAD_LIMIT) {
                this.updateState(state);

                const promiseArray: Promise<void>[] = [];

                for (const workspace of state.fabricWorkspaces) {
                    promiseArray.push(this.loadFabricDatabasesForWorkspace(state, workspace));
                }

                await Promise.all(promiseArray);
            }

            return state;
        });

        this.registerReducer("selectFabricWorkspace", async (state, payload) => {
            const workspace = state.fabricWorkspaces.find((w) => w.id === payload.workspaceId);
            this.state.connectionProfile.server = "";
            this.state.connectionProfile.database = "";

            if (
                (workspace && workspace.loadStatus.status === ApiStatus.NotStarted) ||
                workspace.loadStatus.status === ApiStatus.Error
            ) {
                await this.loadFabricDatabasesForWorkspace(state, workspace);
            }

            return state;
        });

        this.registerReducer("messageButtonClicked", async (state, payload) => {
            if (payload.buttonId === CLEAR_TOKEN_CACHE) {
                this._mainController.connectionManager.azureController.clearTokenCache();
                this.vscodeWrapper.showInformationMessage(LocAll.Accounts.clearedEntraTokenCache);
                this.state.formMessage = undefined;
            } else {
                this.logger.error(`Unknown message button clicked: ${payload.buttonId}`);
            }

            return state;
        });

        this.onRequest(GetSqlAnalyticsEndpointUriFromFabricRequest.type, async (payload) => {
            const getUriActivity = startActivity(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.GetSqlAnalyticsEndpointUrlFromFabric,
            );
            try {
                const result = FabricHelper.getFabricSqlEndpointServerUri(
                    payload.id,
                    payload.workspaceId,
                    payload.tenantId,
                );

                getUriActivity.end(ActivityStatus.Succeeded);

                return result;
            } catch (err) {
                this.logger.error(
                    `Failed to get URL for Fabric SQL Endpoint: ${getErrorMessage(err)}`,
                );

                getUriActivity.endFailed(
                    new Error("Failed to get URL for Fabric SQL Endpoint"),
                    true,
                );
                return undefined;
            }
        });

        this.onRequest(ChangePasswordWebviewRequest.type, async (newPassword: string) => {
            const passwordChangeResponse =
                await this._mainController.connectionManager.changePasswordService.changePassword(
                    this.state.connectionProfile,
                    newPassword,
                );
            if (passwordChangeResponse.result) {
                this.state.dialog = undefined;
                this.state.connectionProfile.password = newPassword;
                this.updateState();
                const state = await this.connectHelper(this.state);
                this.updateState(state);
            } else {
                return passwordChangeResponse;
            }
        });
    }

    //#region Helpers

    //#region Connection helpers

    override async afterSetFormProperty(
        propertyName: keyof IConnectionDialogProfile,
    ): Promise<void> {
        await this.handleAzureMFAEdits(propertyName);
    }

    private async checkReadyToConnect(): Promise<void> {
        const fullValidation = await this.validateForm(
            this.state.connectionProfile,
            undefined,
            false,
        );

        this.state.readyToConnect = fullValidation.length === 0;
    }

    async updateItemVisibility() {
        let hiddenProperties: (keyof IConnectionDialogProfile)[] = [];

        if (this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin) {
            hiddenProperties.push("user", "password", "savePassword");
        }
        if (this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA) {
            hiddenProperties.push("accountId", "tenantId");
        }
        if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA) {
            let tenants = [];

            if (this.state.connectionProfile.accountId !== undefined) {
                tenants = await getTenants(
                    this._mainController.azureAccountService,
                    this.state.connectionProfile.accountId,
                    this.logger,
                );
            }

            // Hide tenantId if not signed in or accountId has only one tenant
            if (tenants.length < 2) {
                hiddenProperties.push("tenantId");
            }
        }

        for (const component of Object.values(this.state.formComponents)) {
            component.hidden = hiddenProperties.includes(component.propertyName);
        }

        await this.checkReadyToConnect();
    }

    protected getActiveFormComponents(
        state: ConnectionDialogWebviewState,
    ): (keyof IConnectionDialogProfile)[] {
        return [...state.connectionComponents.mainOptions, "groupId"];
    }

    /** Returns a copy of `connection` that's been cleaned up by clearing the properties that aren't being used
     * (e.g. due to form selections, like authType and inputMode) */
    private cleanConnection(connection: IConnectionDialogProfile): IConnectionDialogProfile {
        const cleanedConnection = structuredClone(connection);

        // Clear values for inputs that are hidden due to form selections
        for (const option of Object.values(this.state.formComponents)) {
            if (option.hidden) {
                (cleanedConnection[
                    option.propertyName as keyof IConnectionDialogProfile
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = undefined;
            }
        }

        cleanedConnection.connectionString = undefined;

        if (cleanedConnection.secureEnclaves !== "Enabled") {
            cleanedConnection.attestationProtocol = undefined;
            cleanedConnection.enclaveAttestationUrl = undefined;
        }

        return cleanedConnection;
    }

    private async loadConnections(): Promise<{
        savedConnections: IConnectionDialogProfile[];
        recentConnections: IConnectionDialogProfile[];
    }> {
        const unsortedConnections: IConnectionProfileWithSource[] =
            await this._mainController.connectionManager.connectionStore.readAllConnections(
                true /* includeRecentConnections */,
            );

        const savedConnections = unsortedConnections.filter(
            (c) => c.profileSource === CredentialsQuickPickItemType.Profile,
        );

        const recentConnections = unsortedConnections.filter(
            (c) => c.profileSource === CredentialsQuickPickItemType.Mru,
        );

        sendActionEvent(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadRecentConnections,
            undefined, // additionalProperties
            {
                savedConnectionsCount: savedConnections.length,
                recentConnectionsCount: recentConnections.length,
            },
        );

        const self = this;

        function processConnections(
            conns: IConnectionProfileWithSource[],
            connType: "recent" | "saved",
        ) {
            return conns
                .map((conn) => {
                    try {
                        return self.initializeConnectionForDialog(conn);
                    } catch (err) {
                        self.logger.error(
                            `Error initializing ${connType} connection: ${getErrorMessage(err)}`,
                        );

                        sendErrorEvent(
                            TelemetryViews.ConnectionDialog,
                            TelemetryActions.LoadConnections,
                            err,
                            false, // includeErrorMessage
                            undefined, // errorCode
                            undefined, // errorType
                            {
                                connectionType: connType,
                                authType: conn.authenticationType,
                            },
                        );

                        return Promise.resolve(undefined);
                    }
                })
                .filter((c) => c !== undefined);
        }

        return {
            recentConnections: await Promise.all(processConnections(recentConnections, "recent")),
            savedConnections: await Promise.all(processConnections(savedConnections, "saved")),
        };
    }

    private async updateLoadedConnections(state: ConnectionDialogWebviewState) {
        const loadedConnections = await this.loadConnections();

        state.recentConnections = loadedConnections.recentConnections;
        state.savedConnections = loadedConnections.savedConnections;
    }

    private async validateProfile(connectionProfile?: IConnectionDialogProfile): Promise<string[]> {
        if (!connectionProfile) {
            connectionProfile = this.state.connectionProfile;
        }

        // clean the connection by clearing the options that aren't being used
        const cleanedConnection = this.cleanConnection(connectionProfile);

        return await this.validateForm(cleanedConnection);
    }

    private async connectHelper(
        state: ConnectionDialogWebviewState,
    ): Promise<ConnectionDialogWebviewState> {
        this.clearFormError();
        this.state.connectionStatus = ApiStatus.Loading;
        this.updateState();

        let cleanedConnection: IConnectionDialogProfile = this.cleanConnection(
            this.state.connectionProfile,
        );

        const erroredInputs = await this.validateProfile(cleanedConnection);

        if (erroredInputs.length > 0) {
            this.state.connectionStatus = ApiStatus.Error;
            this.logger.warn("One more more inputs have errors: " + erroredInputs.join(", "));
            return state;
        }

        try {
            try {
                const tempConnectionUri = Utils.generateGuid();
                const result = await this._mainController.connectionManager.connect(
                    tempConnectionUri,
                    cleanedConnection,
                    {
                        shouldHandleErrors: false, // Connect should not handle errors, as we want to handle them here
                        connectionSource: CONNECTION_DIALOG_VIEW_ID,
                    },
                );

                const connectionInfo =
                    this._mainController.connectionManager?.getConnectionInfo(tempConnectionUri);

                if (!result) {
                    return await this.handleConnectionErrorCodes(connectionInfo, state);
                }
            } catch (error) {
                this.state.formMessage = { message: getErrorMessage(error) };
                this.state.connectionStatus = ApiStatus.Error;

                if (
                    getErrorMessage(error).includes(AzureConstants.multiple_matching_tokens_error)
                ) {
                    this.state.formMessage.buttons = [
                        { id: CLEAR_TOKEN_CACHE, label: Loc.clearTokenCache },
                    ];
                }

                sendErrorEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.CreateConnection,
                    error,
                    false, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                    {
                        connectionInputType: this.state.selectedInputMode,
                        authMode: this.state.connectionProfile.authenticationType,
                        cloudType: getCloudId(),
                    },
                );

                return state;
            }

            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.CreateConnection, {
                result: "success",
                newOrEditedConnection: this._connectionBeingEdited ? "edited" : "new",
                connectionInputType: this.state.selectedInputMode,
                authMode: this.state.connectionProfile.authenticationType,
                serverTypes: getServerTypes(this.state.connectionProfile).join(","),
                cloudType: getCloudId(),
            });

            if (this._connectionBeingEdited) {
                this._mainController.connectionManager.getUriForConnection(
                    this._connectionBeingEdited,
                );
                await this._objectExplorerProvider.removeConnectionNodes([
                    this._connectionBeingEdited,
                ]);

                await this._mainController.connectionManager.connectionStore.removeProfile(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    this._connectionBeingEdited as any,
                );
            }

            // all properties are set when converting from a ConnectionDetails object,
            // so we want to clean the default undefined properties before saving.
            cleanedConnection = ConnectionCredentials.removeUndefinedProperties(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cleanedConnection as any,
            );

            async function saveConnectionAndCreateSession(
                self: ConnectionDialogWebviewController,
            ): Promise<TreeNodeInfo> {
                await self._mainController.connectionManager.connectionStore.saveProfile(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    cleanedConnection as any,
                );
                const node =
                    await self._mainController.createObjectExplorerSession(cleanedConnection);
                await self.updateLoadedConnections(state);
                self.updateState();

                return node;
            }

            let node = await saveConnectionAndCreateSession(this);

            this.state.connectionStatus = ApiStatus.Loaded;

            try {
                await this._mainController.objectExplorerTree.reveal(node, {
                    focus: true,
                    select: true,
                    expand: true,
                });
            } catch {
                // If revealing the node fails, we've hit an event-based race condition; re-saving and creating the profile should fix it.
                node = await saveConnectionAndCreateSession(this);
                await this._mainController.objectExplorerTree.reveal(node, {
                    focus: true,
                    select: true,
                    expand: true,
                });
            }

            await this.panel.dispose();
            this.dispose();
            UserSurvey.getInstance().promptUserForNPSFeedback(CONNECTION_DIALOG_VIEW_ID);
        } catch (error) {
            this.state.connectionStatus = ApiStatus.Error;
            this.state.formMessage = { message: getErrorMessage(error) };

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
                    cloudType: getCloudId(),
                },
            );

            return state;
        }
        return state;
    }

    private async handleConnectionErrorCodes(
        result: ConnectionInfo,
        state: ConnectionDialogWebviewState,
    ): Promise<ConnectionDialogWebviewState> {
        const errorType = await getSqlConnectionErrorType(
            {
                errorNumber: result.errorNumber,
                errorMessage: result.errorMessage,
                message: result.messages,
            },
            result.credentials,
        );
        if (errorType === SqlConnectionErrorType.TrustServerCertificateNotEnabled) {
            this.state.connectionStatus = ApiStatus.Error;
            this.state.dialog = {
                type: "trustServerCert",
                message: result.errorMessage,
            } as TrustServerCertDialogProps;

            // connection failing because the user didn't trust the server cert is not an error worth logging;
            // just prompt the user to trust the cert

            return state;
        } else if (errorType === SqlConnectionErrorType.FirewallRuleError) {
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
                    "parseIP", // errorType
                );

                // Proceed with 0.0.0.0 as the client IP, and let user fill it out manually.
                handleFirewallErrorResult.ipAddress = "0.0.0.0";
            }

            const addFirewallDialogState: AddFirewallRuleState = {
                message: result.errorMessage,
                clientIp: handleFirewallErrorResult.ipAddress,
                accounts: [],
                tenants: {},
                isSignedIn: true,
                serverName: this.state.connectionProfile.server,
                addFirewallRuleStatus: ApiStatus.NotStarted,
            };

            if (addFirewallDialogState.isSignedIn) {
                await populateAzureAccountInfo(
                    addFirewallDialogState,
                    false /* forceSignInPrompt */,
                );
            }

            addFirewallDialogState.isSignedIn = await VsCodeAzureHelper.isSignedIn();

            this.state.dialog = {
                type: "addFirewallRule",
                props: addFirewallDialogState,
            } as AddFirewallRuleDialogProps;

            return state;
        } else if (errorType === SqlConnectionErrorType.PasswordExpired) {
            this.state.connectionStatus = ApiStatus.Error;
            this.state.formMessage = { message: `${result.errorNumber}: ${result.errorMessage}` };
            this.state.dialog = {
                type: "changePassword",
                props: {
                    server: result.credentials.server,
                    userName: result.credentials.user,
                } as ChangePasswordWebviewState,
            } as ChangePasswordDialogProps;
            return state;
        } else {
            this.state.formMessage = { message: result.errorMessage };
            this.state.connectionStatus = ApiStatus.Error;

            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.CreateConnection, {
                result: "connectionError",
                errorNumber: String(result.errorNumber),
                newOrEditedConnection: this._connectionBeingEdited ? "edited" : "new",
                connectionInputType: this.state.selectedInputMode,
                authMode: this.state.connectionProfile.authenticationType,
            });

            return state;
        }
    }

    private async loadConnectionToEdit(connectionToEdit: IConnectionInfo) {
        if (connectionToEdit) {
            this._connectionBeingEdited = structuredClone(connectionToEdit);
            const connection = await this.initializeConnectionForDialog(
                this._connectionBeingEdited,
            );
            this.state.connectionProfile = connection;
            this.state.selectedInputMode = ConnectionInputMode.Parameters;

            if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA) {
                await this.handleAzureMFAEdits("accountId");
            }

            await this.checkReadyToConnect();

            this.updateState();
        }
    }

    private loadEmptyConnection() {
        this.state.connectionProfile = getDefaultConnection();
    }

    private async initializeConnectionForDialog(
        connection: IConnectionInfo,
    ): Promise<IConnectionDialogProfile> {
        // Load the password if it's saved
        if (Utils.isEmpty(connection.connectionString)) {
            if (!connection.password) {
                // look up password in credential store if one isn't already set
                const password =
                    await this._mainController.connectionManager.connectionStore.lookupPassword(
                        connection,
                        false /* isConnectionString */,
                    );
                connection.password = password;
            }
        } else {
            this.logger.logDebug(
                "Connection string connection found in Connection Dialog initialization; should have been converted.",
            );
        }

        return connection;
    }

    //#endregion

    //#region Azure helpers

    private async getConnectionGroups(mainController: MainController): Promise<FormItemOptions[]> {
        return mainController.connectionManager.connectionUI.getConnectionGroupOptions();
    }

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        const actionButtons: FormItemActionButton[] = [];
        actionButtons.push({
            label: Loc.signIn,
            id: "azureSignIn",
            callback: async () => {
                const account = await this._mainController.azureAccountService.addAccount();
                this.logger.verbose(
                    `Added Azure account '${account.displayInfo?.displayName}', ${account.key.id}`,
                );

                const accountsComponent = this.getFormComponent(this.state, "accountId");

                if (!accountsComponent) {
                    this.logger.error("Account component not found");
                    return;
                }

                accountsComponent.options = await getAccounts(
                    this._mainController.azureAccountService,
                    this.logger,
                );

                this.logger.verbose(
                    `Read ${accountsComponent.options.length} Azure accounts: ${accountsComponent.options.map((a) => a.value).join(", ")}`,
                );

                this.state.connectionProfile.accountId = account.key.id;

                this.logger.verbose(`Selecting '${account.key.id}'`);

                this.updateState();
                await this.handleAzureMFAEdits("accountId");
            },
        });

        if (
            this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA &&
            this.state.connectionProfile.accountId
        ) {
            const account = (await this._mainController.azureAccountService.getAccounts()).find(
                (account) => account.displayInfo.userId === this.state.connectionProfile.accountId,
            );
            if (account) {
                let isTokenExpired = false;
                try {
                    const session =
                        await this._mainController.azureAccountService.getAccountSecurityToken(
                            account,
                            undefined,
                        );
                    isTokenExpired = !AzureController.isTokenValid(
                        session.token,
                        session.expiresOn,
                    );
                } catch (err) {
                    this.logger.verbose(
                        `Error getting token or checking validity; prompting for refresh. Error: ${getErrorMessage(err)}`,
                    );

                    this.vscodeWrapper.showErrorMessage(
                        "Error validating Entra authentication token; you may need to refresh your token.",
                    );

                    isTokenExpired = true;
                }

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
                                try {
                                    const session =
                                        await this._mainController.azureAccountService.getAccountSecurityToken(
                                            account,
                                            undefined,
                                        );
                                    this.logger.log("Token refreshed", session.expiresOn);
                                } catch (err) {
                                    this.logger.error(
                                        `Error refreshing token: ${getErrorMessage(err)}`,
                                    );
                                }
                            }
                        },
                    });
                }
            }
        }
        return actionButtons;
    }

    private async handleAzureMFAEdits(propertyName: keyof IConnectionDialogProfile) {
        const mfaComponents: (keyof IConnectionDialogProfile)[] = [
            "accountId",
            "tenantId",
            "authenticationType",
        ];

        if (
            !mfaComponents.includes(propertyName) ||
            this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA
        ) {
            return;
        }

        const accountComponent = this.getFormComponent(this.state, "accountId");
        const tenantComponent = this.getFormComponent(this.state, "tenantId");
        let tenants: FormItemOptions[] = [];
        switch (propertyName) {
            case "accountId":
                tenants = await getTenants(
                    this._mainController.azureAccountService,
                    this.state.connectionProfile.accountId,
                    this.logger,
                );
                if (tenantComponent) {
                    tenantComponent.options = tenants;
                    if (
                        tenants.length > 0 &&
                        !tenants.find((t) => t.value === this.state.connectionProfile.tenantId)
                    ) {
                        // if expected tenantId is not in the list of tenants, set it to the first tenant
                        this.state.connectionProfile.tenantId = tenants[0].value;
                        await this.validateForm(this.state.formState, "tenantId");
                    }
                }
                accountComponent.actionButtons = await this.getAzureActionButtons();
                break;
            case "tenantId":
                break;
            case "authenticationType":
                const firstOption = accountComponent.options[0];
                if (firstOption) {
                    this.state.connectionProfile.accountId = firstOption.value;
                }
                if (this.state.connectionProfile.accountId) {
                    tenants = await getTenants(
                        this._mainController.azureAccountService,
                        this.state.connectionProfile.accountId,
                        this.logger,
                    );
                    if (tenantComponent) {
                        tenantComponent.options = tenants;
                        if (tenants && tenants.length > 0) {
                            this.state.connectionProfile.tenantId = tenants[0].value;
                        }
                    }
                }

                accountComponent.actionButtons = await this.getAzureActionButtons();
                break;
        }
    }

    private async loadAzureSubscriptions(
        state: ConnectionDialogWebviewState,
    ): Promise<Map<string, AzureSubscription[]> | undefined> {
        let telemActivity: ActivityObject;
        try {
            // Step 1: Check for existing accounts first and show loading while we do
            state.loadingAzureAccountsStatus = ApiStatus.Loading;
            state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
            state.azureTenants = [];
            this.updateState(state);

            state.formMessage = undefined;
            state.azureAccounts = (await VsCodeAzureHelper.getAccounts()).map((a) => {
                return {
                    id: a.id,
                    name: a.label,
                } as IAzureAccount;
            });
            state.loadingAzureAccountsStatus = ApiStatus.Loaded;
            this.updateState(state);

            // If there are no accounts, don't proceed to load subscriptions
            if (!state.azureAccounts || state.azureAccounts.length === 0) {
                return undefined;
            }

            // Step 2: We have accounts; initialize provider (should not force prompt)
            let auth: MssqlVSCodeAzureSubscriptionProvider;
            try {
                auth = await VsCodeAzureHelper.signIn();
            } catch (error) {
                state.formMessage = {
                    message: LocAzure.errorSigningIntoAzure(getErrorMessage(error)),
                };
                return undefined;
            }

            state.loadingAzureSubscriptionsStatus = ApiStatus.Loading;
            this.updateState();

            // getSubscriptions() below checks this config setting if filtering is specified.  If the user has this set, then we use it; if not, we get all subscriptions.
            // The specific vscode config setting it uses is hardcoded into the VS Code Azure SDK, so we need to use the same value here.
            const shouldUseFilter =
                vscode.workspace
                    .getConfiguration()
                    .get<string[] | undefined>(configSelectedAzureSubscriptions) !== undefined;

            telemActivity = startActivity(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureSubscriptions,
            );

            this._azureSubscriptions = new Map(
                (await auth.getSubscriptions(shouldUseFilter)).map((s) => [s.subscriptionId, s]),
            );
            const tenantSubMap = Map.groupBy<string, AzureSubscription>(
                Array.from(this._azureSubscriptions.values()),
                (s) => s.tenantId,
            );

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

            telemActivity.end(
                ActivityStatus.Succeeded,
                undefined, // additionalProperties
                {
                    subscriptionCount: subs.length,
                },
            );
            this.updateState();

            return tenantSubMap;
        } catch (error) {
            state.formMessage = { message: l10n.t("Error loading Azure subscriptions.") };
            state.loadingAzureSubscriptionsStatus = ApiStatus.Error;
            this.logger.error(state.formMessage + "\n" + getErrorMessage(error));
            telemActivity?.endFailed(error, false);
            return undefined;
        }
    }

    private async loadAllAzureServers(state: ConnectionDialogWebviewState): Promise<void> {
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
                state.formMessage = {
                    message: l10n.t(
                        "No subscriptions available.  Adjust your subscription filters to try again.",
                    ),
                };
            } else {
                state.loadingAzureServersStatus = ApiStatus.Loading;
                state.azureServers = [];
                this.updateState();
                const promiseArray: Promise<void>[] = [];
                for (const t of tenantSubMap.keys()) {
                    for (const s of tenantSubMap.get(t)) {
                        promiseArray.push(
                            this.loadAzureServersForSubscription(state, s.subscriptionId),
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
            state.formMessage = { message: l10n.t("Error loading Azure databases.") };
            state.loadingAzureServersStatus = ApiStatus.Error;
            this.logger.error(state.formMessage.message + os.EOL + getErrorMessage(error));

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
        const stateSub = state.azureSubscriptions.find((s) => s.id === subscriptionId);

        try {
            const servers = await VsCodeAzureHelper.fetchServersFromAzure(azSub);
            state.azureServers.push(...servers);
            stateSub.loaded = true;
            this.updateState();
            this.logger.log(
                `Loaded ${servers.length} servers for subscription ${azSub.name} (${azSub.subscriptionId})`,
            );
        } catch (error) {
            this.logger.error(
                Loc.errorLoadingAzureDatabases(azSub.name, azSub.subscriptionId) +
                    os.EOL +
                    getErrorMessage(error),
            );

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureServers,
                error,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    cloudType: getCloudId(),
                },
            );
        }
    }

    //#endregion

    //#region Fabric helpers

    private async loadFabricWorkspaces(
        state: ConnectionDialogWebviewState,
        account: IAzureAccount | string,
        tenantId: string,
    ): Promise<void> {
        const loadWorkspacesActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadFabricWorkspaces,
        );

        try {
            const accountId = typeof account === "string" ? account : account.id;
            const vscodeAccount = await VsCodeAzureHelper.getAccountById(accountId);

            const newWorkspaces: FabricWorkspaceInfo[] = [];

            // Fetch the full tenant info to confirm token permissions
            const tenant = await VsCodeAzureHelper.getTenant(vscodeAccount, tenantId);

            if (!tenant) {
                const message = `Failed to get tenant '${tenantId}' for account '${vscodeAccount.label}'.`;
                const locMessage = LocAzure.failedToGetTenantForAccount(
                    tenantId,
                    vscodeAccount.label,
                );

                this.logger.error(message);
                state.fabricWorkspacesLoadStatus = { status: ApiStatus.Error, message: locMessage };

                loadWorkspacesActivity.endFailed(
                    new Error(
                        "Failed to get tenant info from VS Code; may have been user-canceled.",
                    ),
                    true, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                );
            }

            try {
                const workspaces = await FabricHelper.getFabricWorkspaces(tenant.tenantId);

                for (const workspace of workspaces) {
                    const stateWorkspace: FabricWorkspaceInfo = {
                        id: workspace.id,
                        displayName: workspace.displayName,
                        databases: [],
                        tenantId: tenant.tenantId,
                        loadStatus: { status: ApiStatus.NotStarted },
                    };

                    newWorkspaces.push(stateWorkspace);
                }

                this.state.fabricWorkspaces = newWorkspaces.sort((a, b) =>
                    a.displayName.localeCompare(b.displayName),
                );
                state.fabricWorkspacesLoadStatus = {
                    status: ApiStatus.Loaded,
                    message:
                        this.state.fabricWorkspaces.length === 0
                            ? Loc.noWorkspacesFound
                            : undefined,
                };

                loadWorkspacesActivity.end(ActivityStatus.Succeeded, undefined, {
                    workspaceCount: this.state.fabricWorkspaces.length,
                });
            } catch (err) {
                const message = `Failed to get Fabric workspaces for tenant '${tenant.displayName} (${tenant.tenantId})': ${getErrorMessage(err)}`;
                const locMessage = LocFabric.failedToGetWorkspacesForTenant(
                    tenant.displayName,
                    tenant.tenantId,
                    getErrorMessage(err),
                );

                this.logger.error(message);
                state.fabricWorkspacesLoadStatus = { status: ApiStatus.Error, message: locMessage };

                loadWorkspacesActivity.endFailed(
                    new Error("Failed to fetch Fabric workspaces"),
                    true, // includeErrorMessage
                    undefined, // errorCode
                    undefined, // errorType
                );
            }
        } catch (err) {
            state.formMessage = { message: getErrorMessage(err) };

            loadWorkspacesActivity.endFailed(
                new Error("Failure while getting Fabric workspaces"),
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
            );
        }
    }

    private async loadFabricDatabasesForWorkspace(
        state: ConnectionDialogWebviewState,
        workspace: FabricWorkspaceInfo,
    ): Promise<void> {
        const loadDatabasesActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadDatabases,
        );

        // 1. Display loading status
        workspace.loadStatus = { status: ApiStatus.Loading };
        this.updateState(state);

        try {
            const databases: FabricSqlDbInfo[] = [];
            const errorMessages: string[] = [];

            // 2. Load SQL databases from Fabric
            try {
                databases.push(
                    ...(await FabricHelper.getFabricDatabases(workspace.id, workspace.tenantId)),
                );
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                this.logger.error(
                    `Error loading Fabric databases for workspace ${workspace.id}: ${errorMessage}`,
                );

                errorMessages.push(errorMessage);
            }

            const sqlDbCount = databases.length;
            const sqlDbErrored = errorMessages.length > 0;

            // 3. Load SQL Analytics endpoints from Fabric
            try {
                databases.push(
                    ...(await FabricHelper.getFabricSqlEndpoints(workspace.id, workspace.tenantId)),
                );
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                console.error(
                    `Error loading Fabric SQL endpoints for workspace ${workspace.id}: ${errorMessage}`,
                );
                errorMessages.push(errorMessage);
            }

            // 4. Construct state and check for errors
            workspace.databases = databases.map((db) => {
                return {
                    id: db.id,
                    database: db.database,
                    displayName: db.displayName,
                    server: db.server,
                    type: db.type,
                    workspaceId: workspace.id,
                    workspaceName: workspace.displayName,
                    tenantId: workspace.tenantId,
                };
            });

            if (errorMessages.length > 0) {
                workspace.loadStatus = {
                    status: ApiStatus.Error,
                    message: errorMessages.join("\n"),
                };
            } else {
                workspace.loadStatus = { status: ApiStatus.Loaded };
            }

            workspace.databases.sort((a, b) => a.displayName.localeCompare(b.displayName));

            loadDatabasesActivity.end(
                ActivityStatus.Succeeded,
                {
                    sqlDbErrored: String(sqlDbErrored),
                    sqlAnalyticsEndpointErrored: String(
                        errorMessages.length - (sqlDbErrored ? 1 : 0),
                    ),
                },
                {
                    sqlDbCount: sqlDbCount,
                    sqlAnalyticsEndpointCount: workspace.databases.length - sqlDbCount,
                },
            );

            this.updateState(state);
        } catch (err) {
            const message = `Failed to load Fabric databases for workspace ${workspace.id}: ${getErrorMessage(err)}`;

            this.logger.error(message);
            workspace.loadStatus = { status: ApiStatus.Error, message: getErrorMessage(err) };

            loadDatabasesActivity.endFailed(
                new Error("Failure while getting Fabric databases"),
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
            );
        }
    }

    //#endregion

    //#region Miscellanous helpers

    private clearFormError() {
        this.state.formMessage = undefined;
        for (const component of this.getActiveFormComponents(this.state).map(
            (x) => this.state.formComponents[x],
        )) {
            component.validation = undefined;
        }
    }

    private async hydrateConnectionDetailsFromProfile(
        connDetails: ConnectionDetails,
        fromProfile: IConnectionDialogProfile,
    ): Promise<IConnectionDialogProfile> {
        const toProfile: IConnectionDialogProfile =
            ConnectionCredentials.createConnectionInfo(connDetails);

        if (fromProfile.profileName) {
            toProfile.profileName = fromProfile.profileName;
        }

        toProfile.applicationName =
            connDetails.options.applicationName === "sqltools"
                ? fromProfile.applicationName || "vscode-mssql"
                : connDetails.options.applicationName;

        toProfile.savePassword = !!toProfile.password; // Save password if it's included in the connection string

        toProfile.profileName = fromProfile.profileName;
        toProfile.id = fromProfile.id;
        toProfile.groupId = fromProfile.groupId;

        if (
            toProfile.authenticationType === AuthenticationType.AzureMFA &&
            toProfile.user !== undefined
        ) {
            const accounts = await this._mainController.azureAccountService.getAccounts();

            const matchingAccount = accounts.find((a) => a.displayInfo.email === toProfile.user);

            if (matchingAccount) {
                toProfile.accountId = matchingAccount.displayInfo.userId;
                toProfile.email = matchingAccount.displayInfo.email;
            }
        }

        return toProfile;
    }

    //#endregion

    //#endregion
}
