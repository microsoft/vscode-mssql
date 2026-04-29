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
    OpenOptionInfoLinkNotification,
    IAzureAccount,
    GetSqlAnalyticsEndpointUriFromFabricRequest,
    ChangePasswordDialogProps,
    ConnectionSubmitAction,
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
    VsCodeAzureAuth,
} from "./azureHelpers";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";

import { ApiStatus } from "../sharedInterfaces/webview";
import { AzureController } from "../azure/azureController";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { ConnectionDetails, IConnectionInfo, IToken } from "vscode-mssql";
import MainController from "../controllers/mainController";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { UserSurvey } from "../nps/userSurvey";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    getConnectionDisplayName,
    getServerTypes,
    getDefaultConnection,
} from "../models/connectionInfo";
import { formatEpochSecondsForDisplay, getErrorMessage, uuid } from "../utils/utils";
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
import {
    configSelectedAzureSubscriptions,
    configSelectedFabricWorkspaces,
    defaultDatabase,
} from "../constants/constants";
import * as AzureConstants from "../azure/constants";
import { AddFirewallRuleState } from "../sharedInterfaces/addFirewallRule";
import * as Utils from "../models/utils";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";
import { populateAzureAccountInfo } from "../controllers/addFirewallRuleWebviewController";
import { MssqlVSCodeAzureSubscriptionProvider } from "../azure/MssqlVSCodeAzureSubscriptionProvider";
import { FabricHelper } from "../fabric/fabricHelper";
import { SqlDbInfo, SqlCollectionInfo } from "../sharedInterfaces/fabric";
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
import { ConnectionConfig } from "./connectionconfig";
import {
    areCompatibleEntraAccountIds,
    getVscodeEntraAccountOptions,
    getVscodeEntraTenantOptions,
    resolveVscodeEntraAccount,
} from "../azure/vscodeEntraMfaUtils";
import { PreviewFeature, previewService } from "../previews/previewService";

const FABRIC_WORKSPACE_AUTOLOAD_LIMIT = 10;
export const CLEAR_TOKEN_CACHE = "clearTokenCache";
export const SIGN_IN_TO_AZURE = "signInToAzure";
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
    private _lastSubmittedAction: ConnectionSubmitAction = ConnectionSubmitAction.Connect;

    /** Cached VS Code Entra account options, invalidated on sign-in */
    private _cachedEntraAccounts: FormItemOptions[] | undefined;
    /** Cached VS Code Entra tenant options per account ID, invalidated on sign-in */
    private _cachedEntraTenants: Map<string, FormItemOptions[]> = new Map();
    /** Deferred that resolves when background Entra account+tenant loading completes. Check `isCompleted` for synchronous readiness. */
    private _entraDataLoaded = new Deferred<void>();

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
        const useVscodeAccounts = previewService.isFeatureEnabled(
            PreviewFeature.UseVscodeAccountsForEntraMFA,
        );

        // Load connection form components
        this.state.formComponents = await generateConnectionComponents(
            this._mainController.connectionManager,
            useVscodeAccounts ? Promise.resolve([]) : this.getEntraMfaAccountOptions(),
            this.getAzureActionButtons(),
            this.getConnectionGroups(this._mainController),
        );

        if (useVscodeAccounts) {
            const accountComponent = this.getFormComponent(this.state, "accountId");
            if (accountComponent) {
                accountComponent.loading = true;
            }
        }

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

        // Load VS Code Entra accounts and tenants in the background after the initial render
        if (useVscodeAccounts) {
            void this.loadVscodeEntraDataAsync();
        } else {
            this._entraDataLoaded.resolve();
        }

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

        // Ensure connection group is set in precedence order:
        // 1. explicitly-specified initialConnectionGroup
        // 2. existing groupId on connection being edited
        // 3. default to root group
        if (initialConnectionGroup) {
            this.state.connectionProfile.groupId = initialConnectionGroup.id;
        } else {
            this.state.connectionProfile.groupId ??= ConnectionConfig.ROOT_GROUP_ID;
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
                state.sqlCollectionsLoadStatus = { status: ApiStatus.NotStarted };
                state.sqlCollections = [];

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

        this.registerReducer("loadConnectionForEdit", async (state, payload) => {
            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.LoadConnection);
            await this.setConnectionForEdit(payload.connection);

            return state;
        });

        this.registerReducer("loadConnectionAsNewDraft", async (state, payload) => {
            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.LoadConnection, {
                mode: "newDraft",
            });
            await this.setConnectionAsNewDraft(payload.connection);

            return state;
        });

        this.registerReducer("connect", async (state) => {
            return this.submitConnectionAction(state, ConnectionSubmitAction.Connect);
        });

        this.registerReducer("testConnection", async (state) => {
            return this.submitConnectionAction(state, ConnectionSubmitAction.TestConnection);
        });

        this.registerReducer("saveWithoutConnecting", async (state) => {
            return this.submitConnectionAction(state, ConnectionSubmitAction.SaveWithoutConnecting);
        });

        this.registerReducer("retryLastSubmitAction", async (state) => {
            return this.submitConnectionAction(state, this._lastSubmittedAction);
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

            return await this.submitConnectionAction(state, this._lastSubmittedAction);
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

            return await this.submitConnectionAction(state, this._lastSubmittedAction);
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
            // Helper function to set error message in the appropriate place
            function setConnectionStringError(errorMessage: string) {
                if (state.dialog?.type === "loadFromConnectionString") {
                    (state.dialog as ConnectionStringDialogProps).connectionStringError =
                        errorMessage;
                } else {
                    state.formMessage = { message: errorMessage };
                }
            }

            try {
                const connDetails =
                    await this._mainController.connectionManager.parseConnectionString(
                        payload.connectionString,
                    );

                const supportedAuthenticationTypes = [
                    AuthenticationType.SqlLogin,
                    AuthenticationType.Integrated,
                    AuthenticationType.AzureMFA,
                    AuthenticationType.ActiveDirectoryDefault,
                ];

                if (
                    !supportedAuthenticationTypes.includes(connDetails.options.authenticationType)
                ) {
                    setConnectionStringError(
                        Loc.unsupportedAuthType(connDetails.options.authenticationType),
                    );

                    sendActionEvent(
                        TelemetryViews.ConnectionDialog,
                        TelemetryActions.LoadFromConnectionString,
                        {
                            result: "unsupportedAuthType",
                            details: connDetails.options.authenticationType,
                        },
                    );

                    return state;
                }

                state.connectionProfile = await this.hydrateConnectionDetailsFromProfile(
                    connDetails,
                    state.connectionProfile,
                );

                state.dialog = undefined; // Close the dialog

                if (state.connectionProfile.authenticationType === AuthenticationType.AzureMFA) {
                    await this.handleAzureMFAEdits("accountId");
                }

                await this.updateItemVisibility();

                sendActionEvent(
                    TelemetryViews.ConnectionDialog,
                    TelemetryActions.LoadFromConnectionString,
                    {
                        result: "success",
                    },
                );

                return state;
            } catch (error) {
                // If there's an error parsing the connection string, show an error and keep dialog open
                this.logger.error("Error parsing connection string: " + getErrorMessage(error));

                const errorMessage = l10n.t(
                    "Invalid connection string: {0}",
                    getErrorMessage(error),
                );

                setConnectionStringError(errorMessage);

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

        this.registerReducer("signIntoAzureTenantForBrowse", async (state) => {
            let auth: MssqlVSCodeAzureSubscriptionProvider;
            try {
                auth = await VsCodeAzureHelper.signIn();
            } catch (error) {
                this.logger.error("Error signing into Azure: " + getErrorMessage(error));
                state.formMessage = {
                    message: LocAzure.errorSigningIntoAzure(getErrorMessage(error)),
                };

                return state;
            }

            try {
                await VsCodeAzureAuth.signInToTenant(auth);
            } catch (error) {
                this.logger.error("Error signing into Azure tenant: " + getErrorMessage(error));
                state.formMessage = {
                    message: LocAzure.errorSigningIntoAzure(getErrorMessage(error)),
                };

                return state;
            }

            await this.loadAllAzureServers(state);
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

        this.registerReducer("setSelectedTenantId", async (state, payload) => {
            state.selectedTenantId = payload.tenantId;
            return state;
        });

        this.registerReducer("toggleFavoriteCollection", async (state, payload) => {
            if (payload.inputMode === ConnectionInputMode.AzureBrowse) {
                const sub = state.azureSubscriptions.find((s) => s.id === payload.collectionId);
                if (!sub) {
                    return state;
                }
                const entry = `${sub.tenantId}/${sub.id}`;
                const current = vscode.workspace
                    .getConfiguration()
                    .get<string[]>(configSelectedAzureSubscriptions, []);
                const idx = current.indexOf(entry);
                if (idx >= 0) {
                    current.splice(idx, 1);
                } else {
                    current.push(entry);
                }
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        configSelectedAzureSubscriptions,
                        current,
                        vscode.ConfigurationTarget.Global,
                    );
                state.favoritedAzureSubscriptionIds = current.map((e) => e.split("/")[1]);
            } else if (payload.inputMode === ConnectionInputMode.FabricBrowse) {
                const current = vscode.workspace
                    .getConfiguration()
                    .get<string[]>(configSelectedFabricWorkspaces, []);
                const idx = current.indexOf(payload.collectionId);
                if (idx >= 0) {
                    current.splice(idx, 1);
                } else {
                    current.push(payload.collectionId);
                }
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        configSelectedFabricWorkspaces,
                        current,
                        vscode.ConfigurationTarget.Global,
                    );
                state.favoritedFabricWorkspaceIds = [...current];
            }
            return state;
        });

        this.registerReducer("selectAzureTenant", async (state, payload) => {
            state.selectedTenantId = payload.tenantId;
            state.sqlCollectionsLoadStatus = { status: ApiStatus.Loading };
            state.sqlCollections = [];
            this.updateState(state);

            await this.loadFabricWorkspaces(state, state.selectedAccountId, state.selectedTenantId);

            // Fabric REST API rate-limits to 50 requests/user/minute,
            // so only auto-load contents of workspaces if they're below a safe threshold
            if (state.sqlCollections.length <= FABRIC_WORKSPACE_AUTOLOAD_LIMIT) {
                this.updateState(state);

                const promiseArray: Promise<void>[] = [];

                for (const workspace of state.sqlCollections) {
                    promiseArray.push(this.loadFabricDatabasesForWorkspace(state, workspace));
                }

                await Promise.all(promiseArray);
            }

            return state;
        });

        this.registerReducer("selectSqlCollection", async (state, payload) => {
            const workspace = state.sqlCollections.find((w) => w.id === payload.collectionId);
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

        this.onNotification(OpenOptionInfoLinkNotification.type, async (payload) => {
            const infoLinkMap: Partial<Record<AuthenticationType, string>> = {
                [AuthenticationType.ActiveDirectoryDefault]:
                    "https://aka.ms/vscode-mssql-auth-entra-default",
                [AuthenticationType.AzureMFA]: "https://aka.ms/vscode-mssql-auth-entra-mfa",
            };

            const url = infoLinkMap[payload.option.value as AuthenticationType];
            if (url) {
                void this.vscodeWrapper.openExternal(url);
            }
        });

        this.registerReducer("messageButtonClicked", async (state, payload) => {
            if (payload.buttonId === CLEAR_TOKEN_CACHE) {
                this._mainController.connectionManager.azureController.clearTokenCache();
                this.vscodeWrapper.showInformationMessage(LocAll.Accounts.clearedEntraTokenCache);
                this.state.formMessage = undefined;
            } else if (payload.buttonId === SIGN_IN_TO_AZURE) {
                this.state.formMessage = undefined;
                const signInButton = this.getFormComponent(
                    this.state,
                    "accountId",
                )?.actionButtons?.find((b) => b.id === "azureSignIn");
                if (signInButton) {
                    await signInButton.callback();
                }
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
                    payload.collectionId,
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
                const state = await this.submitConnectionAction(
                    this.state,
                    this._lastSubmittedAction,
                );
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
        if (propertyName !== "profileName" && propertyName !== "groupId") {
            this.state.testConnectionSucceeded = false;
        }
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

        if (
            this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin &&
            this.state.connectionProfile.authenticationType !==
                AuthenticationType.ActiveDirectoryDefault
        ) {
            hiddenProperties.push("user");
        }
        if (this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin) {
            hiddenProperties.push("password", "savePassword");
        }

        const userComponent = this.state.formComponents["user"];
        if (userComponent) {
            // userId is required for SQL Login, optional for AD Default, and hidden (above) for everything else
            userComponent.required =
                this.state.connectionProfile.authenticationType === AuthenticationType.SqlLogin;
        }

        if (this.state.connectionProfile.authenticationType !== AuthenticationType.AzureMFA) {
            hiddenProperties.push("accountId", "tenantId");
        }
        if (this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA) {
            if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
                const accountId = this.state.connectionProfile.accountId;
                const cachedTenants = accountId
                    ? this._cachedEntraTenants.get(accountId)
                    : undefined;

                if (!cachedTenants || cachedTenants.length < 2) {
                    hiddenProperties.push("tenantId");
                }
            } else {
                let tenants = [];
                if (this.state.connectionProfile.accountId !== undefined) {
                    tenants = await this.getEntraMfaTenantOptions(
                        this.state.connectionProfile.accountId,
                    );
                }
                if (tenants.length < 2) {
                    hiddenProperties.push("tenantId");
                }
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
        const recentConnectionsLimit =
            this._mainController.connectionManager.connectionStore.getMaxRecentConnectionsCount();
        const unsortedConnections: IConnectionProfileWithSource[] =
            await this._mainController.connectionManager.connectionStore.readAllConnections(
                true /* includeRecentConnections */,
                recentConnectionsLimit,
            );

        const savedConnections = unsortedConnections.filter(
            (c) => c.profileSource === CredentialsQuickPickItemType.Profile,
        );

        const recentConnections = this.normalizeRecentConnectionsForDisplay(
            unsortedConnections.filter((c) => c.profileSource === CredentialsQuickPickItemType.Mru),
            savedConnections,
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

    private normalizeRecentConnectionsForDisplay(
        recentConnections: IConnectionProfileWithSource[],
        savedConnections: IConnectionProfileWithSource[],
    ): IConnectionProfileWithSource[] {
        return recentConnections.map((recentConnection) => {
            const matchingSavedConnection = savedConnections.find((savedConnection) =>
                this.isOriginalSavedProfile(savedConnection, recentConnection),
            );

            if (
                matchingSavedConnection &&
                !this.isSameDatabaseName(
                    matchingSavedConnection.database,
                    recentConnection.database,
                )
            ) {
                return {
                    ...recentConnection,
                    profileName: undefined,
                };
            }

            return recentConnection;
        });
    }

    private isOriginalSavedProfile(
        savedConnection: IConnectionProfileWithSource,
        recentConnection: IConnectionProfileWithSource,
    ): boolean {
        if (savedConnection.id && recentConnection.id) {
            return savedConnection.id === recentConnection.id;
        }

        if (
            !savedConnection.profileName ||
            !recentConnection.profileName ||
            savedConnection.profileName !== recentConnection.profileName
        ) {
            return false;
        }

        if (savedConnection.connectionString || recentConnection.connectionString) {
            return savedConnection.connectionString === recentConnection.connectionString;
        }

        if (savedConnection.server !== recentConnection.server) {
            return false;
        }

        const savedAuthType = savedConnection.authenticationType || AuthenticationType.SqlLogin;
        const recentAuthType = recentConnection.authenticationType || AuthenticationType.SqlLogin;

        if (savedAuthType !== recentAuthType) {
            return false;
        }

        if ((savedConnection.user ?? "") !== (recentConnection.user ?? "")) {
            return false;
        }

        if (savedConnection.accountId || recentConnection.accountId) {
            return areCompatibleEntraAccountIds(
                savedConnection.accountId,
                recentConnection.accountId,
            );
        }

        return true;
    }

    private isSameDatabaseName(currentDatabase?: string, expectedDatabase?: string): boolean {
        const normalizedCurrentDatabase = currentDatabase?.trim() || defaultDatabase;
        const normalizedExpectedDatabase = expectedDatabase?.trim() || defaultDatabase;

        return normalizedCurrentDatabase === normalizedExpectedDatabase;
    }

    private async validateProfile(connectionProfile?: IConnectionDialogProfile): Promise<string[]> {
        if (!connectionProfile) {
            connectionProfile = this.state.connectionProfile;
        }

        // clean the connection by clearing the options that aren't being used
        const cleanedConnection = this.cleanConnection(connectionProfile);

        return await this.validateForm(cleanedConnection);
    }

    private async submitConnectionAction(
        state: ConnectionDialogWebviewState,
        action: ConnectionSubmitAction,
    ): Promise<ConnectionDialogWebviewState> {
        this._lastSubmittedAction = action;
        this.state.connectionAction = action;

        const cleanedConnection = await this.prepareConnectionForSubmit(state);
        if (!cleanedConnection) {
            return state;
        }

        try {
            if (action === ConnectionSubmitAction.TestConnection) {
                const testSucceeded = await this.testConnectionStep(cleanedConnection, state);
                if (!testSucceeded) {
                    return state;
                }

                this.state.connectionStatus = ApiStatus.Loaded;
                this.state.testConnectionSucceeded = true;
                this.updateState();
                return state;
            }

            if (action === ConnectionSubmitAction.SaveWithoutConnecting) {
                const preparedConnection = await this.prepareConnectionForSave(cleanedConnection);
                await this.removeEditedConnectionIfNeeded();
                await this.saveProfileStep(preparedConnection, state);
                this.state.connectionStatus = ApiStatus.Loaded;
                this.updateState();
                await this.panel.dispose();
                this.dispose();
                return state;
            }

            const testSucceeded = await this.testConnectionStep(cleanedConnection, state);
            if (!testSucceeded) {
                return state;
            }

            const preparedConnection = await this.prepareConnectionForSave(cleanedConnection);
            await this.removeEditedConnectionIfNeeded();
            await this.saveProfileStep(preparedConnection, state);
            await this.connectAndRevealStep(preparedConnection, state);

            this.state.connectionStatus = ApiStatus.Loaded;
            this.updateState();

            sendActionEvent(TelemetryViews.ConnectionDialog, TelemetryActions.CreateConnection, {
                result: "success",
                submitAction: action,
                newOrEditedConnection: this._connectionBeingEdited ? "edited" : "new",
                connectionInputType: this.state.selectedInputMode,
                authMode: this.state.connectionProfile.authenticationType,
                serverTypes: getServerTypes(this.state.connectionProfile).join(","),
                cloudType: getCloudId(),
            });

            await this.panel.dispose();
            this.dispose();
            UserSurvey.getInstance().promptUserForNPSFeedback(CONNECTION_DIALOG_VIEW_ID);
        } catch (error) {
            this.state.connectionStatus = ApiStatus.Error;
            this.state.formMessage = { message: getErrorMessage(error) };
            this.updateState();

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.CreateConnection,
                error,
                undefined, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    submitAction: action,
                    connectionInputType: this.state.selectedInputMode,
                    authMode: this.state.connectionProfile.authenticationType,
                    cloudType: getCloudId(),
                },
            );

            return state;
        }
        return state;
    }

    private async prepareConnectionForSubmit(
        state: ConnectionDialogWebviewState,
    ): Promise<IConnectionDialogProfile | undefined> {
        this.clearFormError();
        this.state.connectionStatus = ApiStatus.Loading;
        this.updateState();

        const cleanedConnection = this.cleanConnection(this.state.connectionProfile);
        const erroredInputs = await this.validateProfile(cleanedConnection);

        if (erroredInputs.length > 0) {
            this.state.connectionStatus = ApiStatus.Error;
            this.updateState(state);
            this.logger.warn("One more more inputs have errors: " + erroredInputs.join(", "));
            return undefined;
        }

        return cleanedConnection;
    }

    private async testConnectionStep(
        connection: IConnectionDialogProfile,
        state: ConnectionDialogWebviewState,
    ): Promise<boolean> {
        const tempConnectionUri = uuid();

        try {
            const result = await this._mainController.connectionManager.connect(
                tempConnectionUri,
                connection,
                {
                    shouldHandleErrors: false, // Connect should not handle errors, as we want to handle them here
                    connectionSource: CONNECTION_DIALOG_VIEW_ID,
                },
            );

            const connectionInfo =
                this._mainController.connectionManager?.getConnectionInfo(tempConnectionUri);

            if (!result) {
                await this.handleConnectionErrorCodes(connectionInfo, state);
                this.updateState(state);
                return false;
            }

            return true;
        } catch (error) {
            this.state.formMessage = { message: getErrorMessage(error) };
            this.state.connectionStatus = ApiStatus.Error;

            if (getErrorMessage(error).includes(AzureConstants.multiple_matching_tokens_error)) {
                this.state.formMessage.buttons = [
                    { id: CLEAR_TOKEN_CACHE, label: Loc.clearTokenCache },
                ];
            }

            this.updateState(state);

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.CreateConnection,
                error,
                false, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    submitAction: this._lastSubmittedAction,
                    connectionInputType: this.state.selectedInputMode,
                    authMode: this.state.connectionProfile.authenticationType,
                    cloudType: getCloudId(),
                },
            );

            return false;
        } finally {
            try {
                await this._mainController.connectionManager.disconnect(tempConnectionUri);
            } catch (err) {
                this.logger.error(
                    `Error disconnecting after connection test: ${getErrorMessage(err)}`,
                );
            }
        }
    }

    private async prepareConnectionForSave(
        connection: IConnectionDialogProfile,
    ): Promise<IConnectionDialogProfile> {
        const preparedConnection = ConnectionCredentials.removeUndefinedProperties(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            connection as any,
        ) as IConnectionDialogProfile;

        if ((preparedConnection as IConnectionProfile).configSource === undefined) {
            const connectionGroup =
                this._mainController.connectionManager.connectionStore.connectionConfig.getGroupById(
                    preparedConnection.groupId,
                );
            (preparedConnection as IConnectionProfile).configSource = connectionGroup.configSource;
        }

        return preparedConnection;
    }

    private async removeEditedConnectionIfNeeded(): Promise<void> {
        if (!this._connectionBeingEdited) {
            return;
        }

        this._mainController.connectionManager.getUriForConnection(this._connectionBeingEdited);
        await this._objectExplorerProvider.removeConnectionNodes([this._connectionBeingEdited]);

        await this._mainController.connectionManager.connectionStore.removeProfile(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._connectionBeingEdited as any,
        );

        this._connectionBeingEdited = undefined;
    }

    private async saveProfileStep(
        connection: IConnectionDialogProfile,
        state: ConnectionDialogWebviewState,
    ): Promise<void> {
        await this._mainController.connectionManager.connectionStore.saveProfile(
            connection as IConnectionProfile,
        );
        await this.updateLoadedConnections(state);
        this.updateState(state);
    }

    private async connectAndRevealStep(
        connection: IConnectionDialogProfile,
        state: ConnectionDialogWebviewState,
    ): Promise<void> {
        let node = await this._mainController.createObjectExplorerSession(connection);

        try {
            await this._mainController.objectExplorerTree.reveal(node, {
                focus: true,
                select: true,
                expand: true,
            });
        } catch {
            // If revealing the node fails, we've hit an event-based race condition; re-saving and creating the profile should fix it.
            await this.saveProfileStep(connection, state);
            node = await this._mainController.createObjectExplorerSession(connection);
            await this._mainController.objectExplorerTree.reveal(node, {
                focus: true,
                select: true,
                expand: true,
            });
        }
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
                loadingAccounts: false,
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
            await this.setConnectionForEdit(connectionToEdit);
            this.updateState();
        }
    }

    private loadEmptyConnection() {
        this.state.connectionProfile = getDefaultConnection();
        this._connectionBeingEdited = undefined;
        this.state.isEditingConnection = false;
        this.state.editingConnectionDisplayName = undefined;
    }

    private async setConnectionForEdit(connectionToLoad: IConnectionInfo): Promise<void> {
        this.clearFormError();
        const initializedConnection = await this.initializeConnectionForDialog(
            structuredClone(connectionToLoad),
        );

        this._connectionBeingEdited = structuredClone(initializedConnection);
        this.state.connectionProfile = initializedConnection;
        this.state.selectedInputMode = ConnectionInputMode.Parameters;
        this.state.isEditingConnection = true;
        this.state.editingConnectionDisplayName = getConnectionDisplayName(initializedConnection);

        await this.updateItemVisibility();
        await this.handleAzureMFAEdits("authenticationType");
        await this.handleAzureMFAEdits("accountId");
        await this.checkReadyToConnect();
    }

    private async setConnectionAsNewDraft(connectionToCopy: IConnectionInfo): Promise<void> {
        this.clearFormError();
        const initializedConnection = await this.initializeConnectionForDialog(
            structuredClone(connectionToCopy),
        );

        const connectionDraft = structuredClone(initializedConnection) as IConnectionDialogProfile;
        connectionDraft.id = undefined;
        connectionDraft.profileName = undefined;
        delete (connectionDraft as IConnectionProfileWithSource).configSource;

        this._connectionBeingEdited = undefined;
        this.state.connectionProfile = connectionDraft;
        this.state.selectedInputMode = ConnectionInputMode.Parameters;
        this.state.isEditingConnection = false;
        this.state.editingConnectionDisplayName = undefined;

        await this.updateItemVisibility();
        await this.handleAzureMFAEdits("authenticationType");
        await this.handleAzureMFAEdits("accountId");
        await this.checkReadyToConnect();
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

    /**
     * Loads VS Code Entra accounts and tenants for all accounts in the background
     */
    private async loadVscodeEntraDataAsync(): Promise<void> {
        this._entraDataLoaded = new Deferred<void>();
        this._cachedEntraAccounts = undefined;
        this._cachedEntraTenants.clear();
        const accountComponent = this.getFormComponent(this.state, "accountId");

        try {
            const accountOptions = await this.getEntraMfaAccountOptions();

            if (accountComponent) {
                accountComponent.options = accountOptions;
            }

            await Promise.all(
                accountOptions.map(async (account) => {
                    try {
                        await this.getEntraMfaTenantOptions(account.value);
                    } catch (err) {
                        this.logger.error(
                            `Error loading tenants for account '${account.value}': ${getErrorMessage(err)}`,
                        );
                    }
                }),
            );

            this._entraDataLoaded.resolve();
        } catch (err) {
            this.logger.error(`Error loading VS Code Entra data: ${getErrorMessage(err)}`);
            this._entraDataLoaded.resolve();
        } finally {
            if (accountComponent) {
                accountComponent.loading = false;
            }

            await this.updateItemVisibility();
            this.updateState();
        }
    }

    private async getConnectionGroups(mainController: MainController): Promise<FormItemOptions[]> {
        return mainController.connectionManager.connectionUI.getConnectionGroupOptions();
    }

    private async getEntraMfaAccountOptions(): Promise<FormItemOptions[]> {
        if (this._cachedEntraAccounts) {
            return this._cachedEntraAccounts;
        }

        if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
            this._cachedEntraAccounts = await getVscodeEntraAccountOptions();
        } else {
            this._cachedEntraAccounts = await getAccounts(
                this._mainController.azureAccountService,
                this.logger,
            );
        }

        this.logger.verbose(
            `Read ${this._cachedEntraAccounts.length} Azure accounts: ${this._cachedEntraAccounts.map((a) => a.value).join(", ")}`,
        );

        return this._cachedEntraAccounts;
    }

    private async getEntraMfaTenantOptions(accountId?: string): Promise<FormItemOptions[]> {
        if (!accountId) {
            return [];
        }

        if (!this._cachedEntraTenants.has(accountId)) {
            if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
                this._cachedEntraTenants.set(
                    accountId,
                    await getVscodeEntraTenantOptions(accountId),
                );
            } else {
                this._cachedEntraTenants.set(
                    accountId,
                    await getTenants(
                        this._mainController.azureAccountService,
                        accountId,
                        this.logger,
                    ),
                );
            }
        }

        return this._cachedEntraTenants.get(accountId) ?? [];
    }

    /** Clears cached VS Code Entra accounts and tenants, forcing a re-fetch on next access */
    private clearEntraAccountCache(): void {
        this._cachedEntraAccounts = undefined;
        this._cachedEntraTenants.clear();
        this._entraDataLoaded = new Deferred<void>();
    }

    /**
     * Normalizes an account ID against the cached accounts list without making
     * async VS Code API calls. Returns the canonical account ID if found.
     */
    private normalizeAccountIdFromCache(accountId?: string): string | undefined {
        if (!accountId || !this._cachedEntraAccounts) {
            return undefined;
        }
        const exact = this._cachedEntraAccounts.find((a) => a.value === accountId);
        if (exact) {
            return exact.value;
        }
        const compatible = this._cachedEntraAccounts.find((a) =>
            areCompatibleEntraAccountIds(a.value, accountId),
        );
        return compatible?.value;
    }

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        const self = this;
        const actionButtons: FormItemActionButton[] = [];

        actionButtons.push({
            label: Loc.signIn,
            id: "azureSignIn",
            callback: async () => {
                if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
                    const existingAccountIds = new Set(
                        (this._cachedEntraAccounts ?? []).map((a) => a.value),
                    );

                    const auth = MssqlVSCodeAzureSubscriptionProvider.getInstance();
                    const signedIn = await auth.signIn();

                    if (!signedIn) {
                        this.logger.warn("VS Code Azure sign-in was canceled or failed.");
                        return;
                    }

                    const accountsComponent = this.getFormComponent(this.state, "accountId");
                    if (!accountsComponent) {
                        this.logger.error("Account component not found");
                        return;
                    }

                    // Invalidate cache and re-load all accounts + tenants
                    this.clearEntraAccountCache();
                    accountsComponent.loading = true;
                    this.updateState();

                    await this.loadVscodeEntraDataAsync();

                    const newlyAddedAccount = accountsComponent.options.find(
                        (accountOption) => !existingAccountIds.has(accountOption.value),
                    );

                    if (newlyAddedAccount) {
                        this.state.connectionProfile.accountId = newlyAddedAccount.value;
                    }

                    if (!this.state.connectionProfile.accountId && accountsComponent.options[0]) {
                        this.state.connectionProfile.accountId = accountsComponent.options[0].value;
                    }

                    this.updateState();
                    await this.handleAzureMFAEdits("accountId");
                } else {
                    const account = await this._mainController.azureAccountService.addAccount();
                    this.logger.verbose(
                        `Added Azure account '${account.displayInfo?.displayName}', ${account.key.id}`,
                    );

                    this.clearEntraAccountCache();

                    this.state.connectionProfile.accountId = account.key.id;

                    this.logger.verbose(`Selecting '${account.key.id}'`);

                    this.updateState();
                    await this.handleAzureMFAEdits("accountId");
                }
            },
        });

        if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
            return actionButtons;
        }

        if (
            this.state.connectionProfile.authenticationType === AuthenticationType.AzureMFA &&
            this.state.connectionProfile.accountId
        ) {
            const account = (await this._mainController.azureAccountService.getAccounts()).find(
                (account) => account.displayInfo.userId === this.state.connectionProfile.accountId,
            );

            if (account) {
                let isTokenExpired = false;

                async function refreshToken(): Promise<IToken | undefined> {
                    const account = (
                        await self._mainController.azureAccountService.getAccounts()
                    ).find(
                        (account) =>
                            account.displayInfo.userId === self.state.connectionProfile.accountId,
                    );

                    if (account) {
                        try {
                            const token =
                                await self._mainController.azureAccountService.getAccountSecurityToken(
                                    account,
                                    undefined,
                                );

                            if (AzureController.isTokenValid(token.token, token.expiresOn)) {
                                self.vscodeWrapper.showInformationMessage(
                                    Loc.tokenRefreshedSuccessfully,
                                );

                                self.logger.log(
                                    `Token refreshed.  Next expiration: ${formatEpochSecondsForDisplay(token.expiresOn)}`,
                                );

                                return token;
                            } else {
                                throw new Error(
                                    Loc.unableToAcquireValidToken(
                                        formatEpochSecondsForDisplay(token.expiresOn),
                                        formatEpochSecondsForDisplay(Date.now() / 1000),
                                    ),
                                );
                            }
                        } catch (err) {
                            self.logger.error(`Error refreshing token: ${getErrorMessage(err)}`);
                            self.vscodeWrapper.showErrorMessage(
                                Loc.errorRefreshingToken(getErrorMessage(err)),
                            );
                        }
                    } else {
                        self.logger.error(
                            `Account not found when attempting token refresh: ${self.state.connectionProfile.email} (${self.state.connectionProfile.accountId})`,
                        );
                    }

                    return undefined;
                }

                try {
                    // Check if token is expired or expiring soon...
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

                    void this.vscodeWrapper
                        .showErrorMessage(
                            Loc.errorValidatingEntraToken(getErrorMessage(err)),
                            refreshTokenLabel,
                        )
                        .then((result) => {
                            if (result === refreshTokenLabel) {
                                void refreshToken();
                            }
                        });

                    isTokenExpired = true;
                }

                if (isTokenExpired) {
                    actionButtons.push({
                        label: refreshTokenLabel,
                        id: "refreshToken",
                        callback: async () => {
                            await refreshToken();
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

        if (!accountComponent) {
            return;
        }

        const tenantComponent = this.getFormComponent(this.state, "tenantId");
        const useVscodeAccounts = previewService.isFeatureEnabled(
            PreviewFeature.UseVscodeAccountsForEntraMFA,
        );

        // If background loading hasn't finished, show spinner on account and
        // await the deferred. updateItemVisibility is called for authenticationType
        // changes so account/tenant fields become visible before pushing state.
        if (useVscodeAccounts && !this._entraDataLoaded.isCompleted) {
            accountComponent.loading = true;

            if (propertyName === "authenticationType") {
                await this.updateItemVisibility();
            }

            this.updateState();

            await this._entraDataLoaded.promise;
        }

        try {
            accountComponent.options = await this.getEntraMfaAccountOptions();

            if (this.state.connectionProfile.accountId) {
                const originalAccountId = this.state.connectionProfile.accountId;
                const cachedAccountId = this.normalizeAccountIdFromCache(originalAccountId);

                if (cachedAccountId) {
                    this.state.connectionProfile.accountId = cachedAccountId;
                } else {
                    const accountDisplayString =
                        this.state.connectionProfile.email ??
                        this.state.connectionProfile.accountId;

                    this.state.connectionProfile.accountId = undefined;
                    this.state.connectionProfile.tenantId = undefined;
                    this.state.connectionProfile.email = undefined;

                    this.state.formMessage = {
                        message: LocAzure.accountNotFound(accountDisplayString),
                        intent: "error",
                        buttons: [{ id: SIGN_IN_TO_AZURE, label: Loc.signIn }],
                    };
                }
            }

            let tenants: FormItemOptions[] = [];

            switch (propertyName) {
                case "accountId":
                    tenants = await this.getEntraMfaTenantOptions(
                        this.state.connectionProfile.accountId,
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
                    // Only default to first account if none is already selected
                    // (e.g. when editing an existing profile that has an accountId)
                    if (!this.state.connectionProfile.accountId) {
                        const firstOption = accountComponent.options[0];
                        if (firstOption) {
                            this.state.connectionProfile.accountId = firstOption.value;
                        }
                    }
                    if (this.state.connectionProfile.accountId) {
                        tenants = await this.getEntraMfaTenantOptions(
                            this.state.connectionProfile.accountId,
                        );
                        if (tenantComponent) {
                            tenantComponent.options = tenants;
                            if (
                                tenants &&
                                tenants.length > 0 &&
                                !tenants.find(
                                    (t) => t.value === this.state.connectionProfile.tenantId,
                                )
                            ) {
                                this.state.connectionProfile.tenantId = tenants[0].value;
                            }
                        }
                    }

                    accountComponent.actionButtons = await this.getAzureActionButtons();
                    break;
            }
        } finally {
            if (useVscodeAccounts) {
                accountComponent.loading = false;
                await this.updateItemVisibility();
            }
        }
    }

    /**
     * Refreshes the data used to generate the tenant sign-in count sumary and tooltip
     */
    private async refreshUnauthenticatedTenants(
        state: ConnectionDialogWebviewState,
        auth: MssqlVSCodeAzureSubscriptionProvider,
    ): Promise<void> {
        try {
            // Capture the tenants that aren't signed in
            const unauthenticatedTenants = await VsCodeAzureAuth.getUnauthenticatedTenants(auth);

            state.unauthenticatedAzureTenants = unauthenticatedTenants.map((tenant) => ({
                tenantId: tenant.tenantId,
                tenantName: tenant.displayName ?? tenant.tenantId,
                accountId: tenant.account.id,
                accountName: tenant.account.label,
            }));

            // Capture all the tenants
            const allTenants = await auth.getTenants();
            const totalTenants = allTenants.length;
            const unauthenticatedSet = new Set(
                state.unauthenticatedAzureTenants.map(
                    (tenant) => `${tenant.accountId}/${tenant.tenantId}`,
                ),
            );
            const tenantStatusMap = new Map<
                string,
                {
                    accountId: string;
                    accountName: string;
                    signedInTenants: string[];
                }
            >();

            // Use those to get the authenticated tenants per account
            for (const tenant of allTenants) {
                const key = tenant.account.id;
                if (!tenantStatusMap.has(key)) {
                    tenantStatusMap.set(key, {
                        accountId: key,
                        accountName: tenant.account.label,
                        signedInTenants: [],
                    });
                }

                if (!unauthenticatedSet.has(`${key}/${tenant.tenantId}`)) {
                    const entry = tenantStatusMap.get(key);
                    entry?.signedInTenants.push(tenant.displayName ?? tenant.tenantId);
                }
            }

            // Clean up info so it only includes accounts with at least one tenant signed in
            state.azureTenantStatus = Array.from(tenantStatusMap.values()).filter(
                (entry) => entry.signedInTenants.length > 0,
            );

            // Calculate the summary counts
            const signedInTenants = Math.max(
                0,
                totalTenants - state.unauthenticatedAzureTenants.length,
            );

            state.azureTenantSignInCounts = {
                totalTenants,
                signedInTenants,
            };
        } catch (error) {
            state.unauthenticatedAzureTenants = [];
            state.azureTenantStatus = [];
            state.azureTenantSignInCounts = undefined;
            this.logger.error(
                "Error determining Azure tenants without active sessions: " +
                    getErrorMessage(error),
            );
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
            state.unauthenticatedAzureTenants = [];
            state.azureTenantStatus = [];
            state.azureTenantSignInCounts = undefined;
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

            await this.refreshUnauthenticatedTenants(state, auth);
            this.updateState(state);

            telemActivity = startActivity(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureSubscriptions,
            );

            // Always load all subscriptions; the config key is now used to track favorites/ordering,
            // not to filter which subscriptions are shown.
            this._azureSubscriptions = new Map(
                (await auth.getSubscriptions(false)).map((s) => [s.subscriptionId, s]),
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
                        displayName: s.name,
                        tenantId: t,
                        databases: [],
                        loadStatus: { status: ApiStatus.NotStarted },
                    });
                }
            }

            state.azureSubscriptions = subs;
            state.loadingAzureSubscriptionsStatus = ApiStatus.Loaded;

            // Populate favorites from config (format: "tenantId/subscriptionId")
            const favoritedAzureConfig = vscode.workspace
                .getConfiguration()
                .get<string[]>(configSelectedAzureSubscriptions, []);
            state.favoritedAzureSubscriptionIds = favoritedAzureConfig.map(
                (entry) => entry.split("/")[1],
            );

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
            state.unauthenticatedAzureTenants = [];
            state.azureTenantStatus = [];
            state.azureTenantSignInCounts = undefined;
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
                    message: l10n.t("No subscriptions available."),
                };
            } else {
                state.loadingAzureServersStatus = ApiStatus.Loading;
                state.azureServers = [];
                this.updateState();

                // Flatten all subscriptions, then split: favorites load first so they
                // appear in the UI quickly, the rest follow concurrently in a second wave.
                const allSubs: AzureSubscription[] = [];
                for (const t of tenantSubMap.keys()) {
                    for (const s of tenantSubMap.get(t)) {
                        allSubs.push(s);
                    }
                }

                const favoritedIds = state.favoritedAzureSubscriptionIds;
                const favoriteSubs = allSubs.filter((s) => favoritedIds.includes(s.subscriptionId));
                const restSubs = allSubs.filter((s) => !favoritedIds.includes(s.subscriptionId));

                // Wave 1: favorites — await so they appear before the rest start
                await Promise.all(
                    favoriteSubs.map((s) =>
                        this.loadAzureServersForSubscription(state, s.subscriptionId),
                    ),
                );

                // Wave 2: everything else — all concurrent as before
                await Promise.all(
                    restSubs.map((s) =>
                        this.loadAzureServersForSubscription(state, s.subscriptionId),
                    ),
                );

                endActivity.end(
                    ActivityStatus.Succeeded,
                    undefined, // additionalProperties
                    {
                        subscriptionCount: allSubs.length,
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

        // Show loading spinner immediately
        stateSub.loadStatus = { status: ApiStatus.Loading };
        this.updateState(state);

        try {
            const servers = await VsCodeAzureHelper.fetchServersFromAzure(azSub);
            state.azureServers.push(...servers);
            stateSub.loadStatus = { status: ApiStatus.Loaded };
            this.updateState(state);
            this.logger.log(
                `Loaded ${servers.length} servers for subscription ${azSub.name} (${azSub.subscriptionId})`,
            );
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.logger.error(
                Loc.errorLoadingAzureDatabases(azSub.name, azSub.subscriptionId) +
                    os.EOL +
                    errorMessage,
            );

            stateSub.loadStatus = { status: ApiStatus.Error, message: errorMessage };
            this.updateState(state);

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

            const newWorkspaces: SqlCollectionInfo[] = [];

            // Fetch the full tenant info to confirm token permissions
            const tenant = await VsCodeAzureHelper.getTenant(vscodeAccount, tenantId);

            if (!tenant) {
                const message = `Failed to get tenant '${tenantId}' for account '${vscodeAccount.label}'.`;
                const locMessage = LocAzure.failedToGetTenantForAccount(
                    tenantId,
                    vscodeAccount.label,
                );

                this.logger.error(message);
                state.sqlCollectionsLoadStatus = { status: ApiStatus.Error, message: locMessage };

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
                    const stateWorkspace: SqlCollectionInfo = {
                        id: workspace.id,
                        displayName: workspace.displayName,
                        databases: [],
                        tenantId: tenant.tenantId,
                        loadStatus: { status: ApiStatus.NotStarted },
                    };

                    newWorkspaces.push(stateWorkspace);
                }

                this.state.sqlCollections = newWorkspaces;
                state.favoritedFabricWorkspaceIds = vscode.workspace
                    .getConfiguration()
                    .get<string[]>(configSelectedFabricWorkspaces, []);
                state.sqlCollectionsLoadStatus = {
                    status: ApiStatus.Loaded,
                    message:
                        this.state.sqlCollections.length === 0 ? Loc.noWorkspacesFound : undefined,
                };

                loadWorkspacesActivity.end(ActivityStatus.Succeeded, undefined, {
                    workspaceCount: this.state.sqlCollections.length,
                });
            } catch (err) {
                const message = `Failed to get Fabric workspaces for tenant '${tenant.displayName} (${tenant.tenantId})': ${getErrorMessage(err)}`;
                const locMessage = LocFabric.failedToGetWorkspacesForTenant(
                    tenant.displayName,
                    tenant.tenantId,
                    getErrorMessage(err),
                );

                this.logger.error(message);
                state.sqlCollectionsLoadStatus = { status: ApiStatus.Error, message: locMessage };

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
        workspace: SqlCollectionInfo,
    ): Promise<void> {
        const loadDatabasesActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadDatabases,
        );

        // 1. Display loading status
        workspace.loadStatus = { status: ApiStatus.Loading };
        this.updateState(state);

        try {
            const databases: SqlDbInfo[] = [];
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
                    collectionId: workspace.id,
                    collectionName: workspace.displayName,
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
            if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
                const matchingAccount = await resolveVscodeEntraAccount(undefined, toProfile.user);
                if (matchingAccount) {
                    toProfile.accountId = matchingAccount.id;
                    toProfile.email = matchingAccount.label;
                }
            } else {
                const accounts = await this._mainController.azureAccountService.getAccounts();

                const matchingAccount = accounts.find(
                    (account) => account.displayInfo.email === toProfile.user,
                );

                if (matchingAccount) {
                    toProfile.accountId = matchingAccount.displayInfo.userId;
                    toProfile.email = matchingAccount.displayInfo.email;
                }
            }
        }

        return toProfile;
    }

    //#endregion

    //#endregion
}
