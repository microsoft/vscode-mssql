/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { shallowEqualObjects } from "shallow-equal";
import * as LocalizedConstants from "../constants/locConstants";
import { getAccounts, getTenants, VsCodeAzureHelper, VsCodeAzureAuth } from "./azureHelpers";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";

import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    AuthenticationType,
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
import { ApiStatus } from "../sharedInterfaces/webview";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";
import MainController from "../controllers/mainController";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { UserSurvey } from "../nps/userSurvey";
import {
    getConnectionDisplayName,
    getServerTypes,
    getDefaultConnection,
} from "../models/connectionInfo";
import { getErrorMessage, uuid } from "../utils/utils";
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
import { defaultDatabase, systemDatabases } from "../constants/constants";
import * as AzureConstants from "../azure/constants";
import { AddFirewallRuleState } from "../sharedInterfaces/addFirewallRule";
import * as Utils from "../models/utils";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";
import { populateAzureAccountInfo } from "../controllers/addFirewallRuleWebviewController";
import { FabricHelper } from "../fabric/fabricHelper";
import {
    ConnectionInfo,
    getSqlConnectionErrorType,
    SqlConnectionErrorType,
} from "../controllers/connectionManager";
import {
    ChangePasswordWebviewRequest,
    ChangePasswordWebviewState,
} from "../sharedInterfaces/changePassword";
import { ConnectionConfig } from "./connectionconfig";
import {
    areCompatibleEntraAccountIds,
    getVscodeEntraAccountOptions,
    getVscodeEntraTenantOptions,
    resolveVscodeEntraAccount,
} from "../azure/vscodeEntraMfaUtils";
import { PreviewFeature, previewService } from "../previews/previewService";
import { getCloudId } from "../azure/providerSettings";
import {
    AzureBrowseProvider,
    BrowseProvider,
    BrowseProviderHost,
    FabricBrowseProvider,
} from "./browseProvider";

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
        "port",
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

    /** Properties that trigger a database list fetch when changed */
    private static readonly _dbFetchTriggerProps: readonly (keyof IConnectionDialogProfile)[] = [
        "server", // server, obviously
        "authenticationType", // auth info because changing auth may change ability to connect/list databases
        "user",
        "password",
        "accountId",
        "tenantId",
        "trustServerCertificate", // trustServerCertificate because enabling this may be required to connect/list databases
    ];

    private _connectionBeingEdited: IConnectionDialogProfile | undefined;
    private readonly _azureBrowseProvider: AzureBrowseProvider;
    private readonly _fabricBrowseProvider: FabricBrowseProvider;
    private _lastSubmittedAction: ConnectionSubmitAction = ConnectionSubmitAction.Connect;

    /** Cached VS Code Entra account options, invalidated on sign-in */
    private _cachedEntraAccounts: FormItemOptions[] | undefined;
    /** Cached VS Code Entra tenant options per account ID, invalidated on sign-in */
    private _cachedEntraTenants: Map<string, FormItemOptions[]> = new Map();
    /** Deferred that resolves when background Entra account+tenant loading completes. Check `isCompleted` for synchronous readiness. */
    private _entraDataLoaded = new Deferred<void>();

    /** Incremented on each database fetch to allow superseding in-flight requests. */
    private _dbFetchCounter = 0;
    /** Fetch key currently reflected in the UI (options + loadStatus), for tracking if a changed connection property should trigger an update. */
    private _activeDbFetchKey = "";
    /** Cache of database lists keyed by fetch key, reused within the same dialog session. */
    private _databaseListCache: Map<string, string[]> = new Map();

    // Original labels/tooltips for user/password fields from STS, cached so they
    // can be restored when switching away from Service Principal auth.
    private _originalUserLabel: string | undefined;
    private _originalUserTooltip: string | undefined;
    private _originalPasswordLabel: string | undefined;
    private _originalPasswordTooltip: string | undefined;
    private _originalSavePasswordLabel: string | undefined;

    //#endregion

    constructor(
        context: vscode.ExtensionContext,
        private _mainController: MainController,
        private _objectExplorerProvider: ObjectExplorerProvider,
        connectionToEdit?: IConnectionInfo,
        initialConnectionGroup?: IConnectionGroup,
    ) {
        super(
            context,
            CONNECTION_DIALOG_VIEW_ID,
            CONNECTION_DIALOG_VIEW_ID,
            new ConnectionDialogWebviewState(),
            {
                title: LocalizedConstants.ConnectionDialog.connectionDialog,
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

        const self = this;
        const host: BrowseProviderHost = {
            get state() {
                return self.state;
            },
            get logger() {
                return self.logger;
            },
            updateState: (state) => self.updateState(state),
            refreshUnauthenticatedTenants: (state, auth) =>
                self.refreshUnauthenticatedTenants(state, auth),
        };
        this._azureBrowseProvider = new AzureBrowseProvider(host);
        this._fabricBrowseProvider = new FabricBrowseProvider(host);

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
                accountComponent.loadStatus = { status: ApiStatus.Loading };
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

            // Don't port connection information when switching to a browse mode
            if (
                state.selectedInputMode === ConnectionInputMode.FabricBrowse ||
                state.selectedInputMode === ConnectionInputMode.AzureBrowse
            ) {
                state.connectionProfile.server = undefined;
                state.connectionProfile.database = undefined;
                state.connectionProfile.user = undefined;
                state.browseAuthChangedByUser = false;
            }

            this.updateState();

            const provider = this.getActiveProvider(state);

            if (provider) {
                await this.ensureAzureBrowseContext(state);

                if (state.selectedAccountId && state.selectedTenantId) {
                    const status = provider.getCollectionsLoadStatus(state);
                    const alreadyLoaded =
                        status.status === ApiStatus.Loaded &&
                        provider.getCollections(state).length > 0;
                    if (!alreadyLoaded) {
                        await provider.loadCollections(
                            state,
                            state.selectedAccountId,
                            state.selectedTenantId,
                        );
                        await provider.autoLoadContents(state);
                    }
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

        this.registerReducer("refreshConnectionsList", async (state) => {
            await this.updateLoadedConnections(state);

            return state;
        });

        this.registerReducer("deleteSavedConnection", async (state, payload) => {
            const confirm = await vscode.window.showQuickPick(
                [LocalizedConstants.Common.delete, LocalizedConstants.Common.cancel],
                {
                    title: LocalizedConstants.Common.areYouSureYouWantTo(
                        LocalizedConstants.ConnectionDialog.deleteTheSavedConnection(
                            getConnectionDisplayName(payload.connection),
                        ),
                    ),
                },
            );

            if (confirm !== LocalizedConstants.Common.delete) {
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
                    AuthenticationType.ActiveDirectoryServicePrincipal,
                ];

                if (
                    !supportedAuthenticationTypes.includes(connDetails.options.authenticationType)
                ) {
                    setConnectionStringError(
                        LocalizedConstants.ConnectionDialog.unsupportedAuthType(
                            connDetails.options.authenticationType,
                        ),
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

                const errorMessage = LocalizedConstants.invalidConnectionString0(
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

            const existingAccountIds = state.azureAccounts.map((a) => a.id);
            const previousAccountId = state.selectedAccountId;

            try {
                const signInResult = await VsCodeAzureHelper.signIn(true /* forceSignInPrompt */);

                state.azureAccounts = (await VsCodeAzureHelper.getAccounts()).map(
                    (a) =>
                        ({
                            id: a.id,
                            name: a.label,
                        }) as IAzureAccount,
                );

                state.selectedAccountId = signInResult.newAccountId ?? state.azureAccounts[0]?.id;
            } catch (error) {
                this.logger.error("Error signing into Azure: " + getErrorMessage(error));
                state.formMessage = {
                    message: LocalizedConstants.Azure.errorSigningIntoAzure(getErrorMessage(error)),
                };

                return state;
            }

            // If the selected account changed, clear tenant state so ensureAzureBrowseContext
            // reloads tenants for the new account instead of reusing the old account's tenants.
            if (state.selectedAccountId !== previousAccountId) {
                state.azureTenants = [];
                state.selectedTenantId = undefined;
                state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
            }

            state.loadingAzureAccountsStatus = ApiStatus.Loaded;
            this.updateState(state);

            // Refresh accounts after sign-in and switch selection to the newly added account
            // so the helper loads tenants for it.
            await this.ensureAzureBrowseContext(state, { forceRefreshAccounts: true });

            const newlyAddedAccountId = state.azureAccounts.find(
                (a) => !existingAccountIds.includes(a.id),
            )?.id;
            if (newlyAddedAccountId && newlyAddedAccountId !== state.selectedAccountId) {
                state.selectedAccountId = newlyAddedAccountId;
                state.azureTenants = [];
                state.selectedTenantId = undefined;
                state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
                await this.ensureAzureBrowseContext(state);
            }

            // New sign-in may have brought in new collections; invalidate caches for both providers.
            this._azureBrowseProvider.invalidateCache();
            this._fabricBrowseProvider.invalidateCache();

            const provider = this.getActiveProvider(state);
            if (provider && state.selectedAccountId && state.selectedTenantId) {
                await provider.loadCollections(
                    state,
                    state.selectedAccountId,
                    state.selectedTenantId,
                );
                await provider.autoLoadContents(state);
            }

            return state;
        });

        this.registerReducer("selectAzureAccount", async (state, payload) => {
            if (state.selectedAccountId === payload.accountId && state.azureTenants.length > 0) {
                // Same account already selected and tenants are loaded; nothing to do
                return state;
            }

            // Clear all stale data immediately so the UI never shows another account's data
            // before the new account's data is ready.
            state.selectedAccountId = payload.accountId;
            state.azureTenants = [];
            state.selectedTenantId = undefined;
            state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
            this._azureBrowseProvider.clearCollectionsState(state);
            this._fabricBrowseProvider.clearCollectionsState(state);
            state.notSignedInTenant = undefined;
            this._azureBrowseProvider.invalidateCache();
            this._fabricBrowseProvider.invalidateCache();
            this.updateState(state);

            await this.ensureAzureBrowseContext(state);

            const provider = this.getActiveProvider(state);
            if (provider && state.selectedAccountId && state.selectedTenantId) {
                await provider.loadCollections(
                    state,
                    state.selectedAccountId,
                    state.selectedTenantId,
                );
                await provider.autoLoadContents(state);
            }

            return state;
        });

        this.registerReducer("setSelectedTenantId", async (state, payload) => {
            if (state.selectedTenantId === payload.tenantId) {
                return state;
            }

            state.selectedTenantId = payload.tenantId;

            // If the tenant is not signed in, show error state and immediately prompt sign-in
            const tenant = state.azureTenants.find((t) => t.id === payload.tenantId);

            if (tenant && !tenant.isSignedIn) {
                state.notSignedInTenant = { id: tenant.id, name: tenant.name };
                this._azureBrowseProvider.clearCollectionsState(state);
                this._fabricBrowseProvider.clearCollectionsState(state);
                this.updateState(state);

                if (!(await this.signInToTenant(state, payload.tenantId))) {
                    return state;
                }

                state.notSignedInTenant = undefined;
                this.updateState(state);
            } else {
                state.notSignedInTenant = undefined;
                this._azureBrowseProvider.clearCollectionsState(state);
                this._fabricBrowseProvider.clearCollectionsState(state);
                this.updateState(state);
            }

            const provider = this.getActiveProvider(state);
            if (provider && state.selectedAccountId) {
                await provider.loadCollections(state, state.selectedAccountId, payload.tenantId);
                await provider.autoLoadContents(state);
            }

            return state;
        });

        this.registerReducer("toggleFavoriteCollection", async (state, payload) => {
            const provider =
                payload.inputMode === ConnectionInputMode.AzureBrowse
                    ? this._azureBrowseProvider
                    : payload.inputMode === ConnectionInputMode.FabricBrowse
                      ? this._fabricBrowseProvider
                      : undefined;
            if (provider) {
                await provider.toggleFavorite(state, payload.collectionId);
            }
            return state;
        });

        this.registerReducer("signIntoTenantForBrowse", async (state) => {
            if (!state.notSignedInTenant || !state.selectedAccountId) {
                return state;
            }

            const { id: tenantId } = state.notSignedInTenant;
            const signed = await this.signInToTenant(state, tenantId);

            if (!signed) {
                return state;
            }

            state.notSignedInTenant = undefined;

            const provider = this.getActiveProvider(state);
            if (provider) {
                await provider.loadCollections(state, state.selectedAccountId, tenantId);
                await provider.autoLoadContents(state);
            }

            return state;
        });

        this.registerReducer("selectSqlCollection", async (state, payload) => {
            this.state.connectionProfile.server = "";
            this.state.connectionProfile.database = "";

            const provider = this.getActiveProvider(state);
            if (!provider) {
                return state;
            }

            const collection = provider
                .getCollections(state)
                .find((c) => c.id === payload.collectionId);
            if (
                collection &&
                (collection.loadStatus.status === ApiStatus.NotStarted ||
                    collection.loadStatus.status === ApiStatus.Error)
            ) {
                await provider.loadCollectionContents(state, collection);
            }

            return state;
        });

        this.onNotification(OpenOptionInfoLinkNotification.type, async (payload) => {
            const infoLinkMap: Partial<Record<AuthenticationType, string>> = {
                [AuthenticationType.ActiveDirectoryDefault]:
                    "https://aka.ms/vscode-mssql-auth-entra-default",
                [AuthenticationType.AzureMFA]: "https://aka.ms/vscode-mssql-auth-entra-mfa",
                [AuthenticationType.ActiveDirectoryServicePrincipal]:
                    "https://learn.microsoft.com/en-us/sql/connect/ado-net/sql/azure-active-directory-authentication?view=sql-server-ver17#using-service-principal-authentication",
            };

            const url = infoLinkMap[payload.option.value as AuthenticationType];
            if (url) {
                void vscode.env.openExternal(vscode.Uri.parse(url));
            }
        });

        this.registerReducer("messageButtonClicked", async (state, payload) => {
            if (payload.buttonId === CLEAR_TOKEN_CACHE) {
                this._mainController.connectionManager.azureController.clearTokenCache();
                vscode.window.showInformationMessage(
                    LocalizedConstants.Accounts.clearedEntraTokenCache,
                );
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
        isBlur: boolean,
    ): Promise<void> {
        if (propertyName !== "profileName" && propertyName !== "groupId") {
            this.state.testConnectionSucceeded = false;
        }

        const browseAuthProperties: (keyof IConnectionDialogProfile)[] = [
            "authenticationType",
            "accountId",
            "tenantId",
        ];
        const inBrowseMode =
            this.state.selectedInputMode === ConnectionInputMode.AzureBrowse ||
            this.state.selectedInputMode === ConnectionInputMode.FabricBrowse;

        // Track when the user manually changes auth fields while in a browse mode,
        // so we don't overwrite their choices when they later select a different server.
        if (inBrowseMode && browseAuthProperties.includes(propertyName)) {
            this.state.browseAuthChangedByUser = true;
        }

        // When a server is selected in browse mode and the user hasn't manually changed auth,
        // pre-set auth to Entra MFA with the current browse account and tenant.
        if (
            propertyName === "server" &&
            this.state.connectionProfile.server &&
            inBrowseMode &&
            !this.state.browseAuthChangedByUser &&
            this.state.selectedAccountId &&
            this.state.selectedTenantId
        ) {
            this.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
            this.state.connectionProfile.accountId = this.state.selectedAccountId;
            this.state.connectionProfile.tenantId = this.state.selectedTenantId;
            await this.handleAzureMFAEdits("authenticationType");
        }

        await this.handleAzureMFAEdits(propertyName);

        if (
            isBlur &&
            ConnectionDialogWebviewController._dbFetchTriggerProps.includes(propertyName)
        ) {
            this.triggerDatabaseFetchIfReady();
        }
    }

    private triggerDatabaseFetchIfReady() {
        if (this.isConnectionReadyForDatabaseFetch(this.state.connectionProfile)) {
            const fetchKey = this.buildDatabaseFetchKey();

            if (fetchKey !== this._activeDbFetchKey) {
                void this.loadDatabaseList();
            }
        } else if (this._activeDbFetchKey !== "") {
            const dbComponent = this.getFormComponent(this.state, "database");

            if (dbComponent) {
                dbComponent.options = [];
                dbComponent.loadStatus = undefined;
            }

            this._activeDbFetchKey = "";
            this.updateState();
        }
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
                AuthenticationType.ActiveDirectoryDefault &&
            this.state.connectionProfile.authenticationType !==
                AuthenticationType.ActiveDirectoryServicePrincipal
        ) {
            hiddenProperties.push("user");
        }
        if (
            this.state.connectionProfile.authenticationType !== AuthenticationType.SqlLogin &&
            this.state.connectionProfile.authenticationType !==
                AuthenticationType.ActiveDirectoryServicePrincipal
        ) {
            hiddenProperties.push("password", "savePassword");
        }

        const userComponent = this.state.formComponents["user"];
        if (userComponent) {
            // userId is required for SQL Login and Service Principal, optional for AD Default, and hidden (above) for everything else
            userComponent.required =
                this.state.connectionProfile.authenticationType === AuthenticationType.SqlLogin ||
                this.state.connectionProfile.authenticationType ===
                    AuthenticationType.ActiveDirectoryServicePrincipal;
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

        // Relabel user/password fields for Service Principal to disambiguate from SQL Login
        const isServicePrincipal =
            this.state.connectionProfile.authenticationType ===
            AuthenticationType.ActiveDirectoryServicePrincipal;
        const userComp = this.state.formComponents["user"];
        if (userComp) {
            // Lazily cache the original capability-sourced label/tooltip the first time we see them
            if (userComp.label && !this._originalUserLabel) {
                this._originalUserLabel = userComp.label;
            }
            if (userComp.tooltip && !this._originalUserTooltip) {
                this._originalUserTooltip = userComp.tooltip;
            }
            userComp.label = isServicePrincipal
                ? LocalizedConstants.ConnectionDialog.applicationClientId
                : this._originalUserLabel;
            userComp.tooltip = isServicePrincipal
                ? LocalizedConstants.ConnectionDialog.applicationClientIdTooltip
                : this._originalUserTooltip;
        }
        const passwordComp = this.state.formComponents["password"];
        if (passwordComp) {
            if (passwordComp.label && !this._originalPasswordLabel) {
                this._originalPasswordLabel = passwordComp.label;
            }
            if (passwordComp.tooltip && !this._originalPasswordTooltip) {
                this._originalPasswordTooltip = passwordComp.tooltip;
            }
            passwordComp.label = isServicePrincipal
                ? LocalizedConstants.ConnectionDialog.clientSecret
                : this._originalPasswordLabel;
            passwordComp.tooltip = isServicePrincipal
                ? LocalizedConstants.ConnectionDialog.clientSecretTooltip
                : this._originalPasswordTooltip;
        }
        const savePasswordComp = this.state.formComponents["savePassword"];
        if (savePasswordComp) {
            if (savePasswordComp.label && !this._originalSavePasswordLabel) {
                this._originalSavePasswordLabel = savePasswordComp.label;
            }
            savePasswordComp.label = isServicePrincipal
                ? LocalizedConstants.ConnectionDialog.saveSecret
                : this._originalSavePasswordLabel;
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

        this.combineServerAndPort(cleanedConnection);

        return cleanedConnection;
    }

    private combineServerAndPort(connection: IConnectionDialogProfile): void {
        if (connection.port !== undefined) {
            if (connection.server && !connection.server.includes(",")) {
                connection.server = `${connection.server},${connection.port}`;
            }
            connection.port = undefined;
        }
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
                    {
                        id: CLEAR_TOKEN_CACHE,
                        label: LocalizedConstants.ConnectionDialog.clearTokenCache,
                    },
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

    private isConnectionReadyForDatabaseFetch(profile: IConnectionDialogProfile): boolean {
        if (!profile.server) {
            return false;
        }

        switch (profile.authenticationType) {
            case AuthenticationType.SqlLogin:
                return !!(profile.user && profile.password);
            case AuthenticationType.AzureMFA:
                return !!profile.accountId;
            case AuthenticationType.Integrated:
            case AuthenticationType.ActiveDirectoryDefault:
                return true;
            case AuthenticationType.ActiveDirectoryServicePrincipal:
                return !!(profile.user && profile.password);
            default:
                return false;
        }
    }

    private buildDatabaseOptions(dbs: string[]): FormItemOptions[] {
        const collator = new Intl.Collator(undefined, { sensitivity: "base" });
        const userDbs = dbs
            .filter((db) => !systemDatabases.includes(db.toLowerCase()))
            .sort((a, b) => collator.compare(a, b));
        const sysDbs = dbs
            .filter((db) => systemDatabases.includes(db.toLowerCase()))
            .sort((a, b) => collator.compare(a, b));
        return [
            ...userDbs.map((db) => ({
                displayName: db,
                value: db,
                groupName: LocalizedConstants.ConnectionDialog.userDatabasesGroup,
            })),
            ...sysDbs.map((db) => ({
                displayName: db,
                value: db,
                groupName: LocalizedConstants.ConnectionDialog.systemDatabasesGroup,
            })),
        ];
    }

    private buildDatabaseFetchKey(): string {
        const p = this.state.connectionProfile;
        return `${p.server ?? ""}|${p.authenticationType ?? ""}|${p.user ?? ""}|${p.accountId ?? ""}|${p.tenantId ?? ""}`;
    }

    private async loadDatabaseList(): Promise<void> {
        const counter = ++this._dbFetchCounter;
        const fetchKey = this.buildDatabaseFetchKey();
        const dbComponent = this.getFormComponent(this.state, "database");

        if (!dbComponent) {
            return;
        }

        // 1. Use cached list if available
        const cached = this._databaseListCache.get(fetchKey);

        if (cached) {
            this._activeDbFetchKey = fetchKey;
            dbComponent.options = this.buildDatabaseOptions(cached);
            dbComponent.loadStatus = undefined;
            this.updateState();
            return;
        }

        // 2. Display loading state
        this._activeDbFetchKey = fetchKey;
        dbComponent.options = [];
        dbComponent.loadStatus = { status: ApiStatus.Loading };
        this.updateState();

        // 3. Attempt to fetch database list
        const tempUri = uuid();
        try {
            const profile: IConnectionDialogProfile = {
                ...this.state.connectionProfile,
                database: "",
            };

            const connected = await this._mainController.connectionManager.connect(
                tempUri,
                profile,
                {
                    shouldHandleErrors: false,
                    connectionSource: CONNECTION_DIALOG_VIEW_ID,
                },
            );

            // Check if this fetch attempt is out-of-date
            if (counter !== this._dbFetchCounter) {
                return;
            }

            // 4a. If connection failed, show error message
            if (!connected) {
                const connInfo = this._mainController.connectionManager.getConnectionInfo(tempUri);
                const errorType = connInfo
                    ? await getSqlConnectionErrorType(connInfo, this.state.connectionProfile)
                    : SqlConnectionErrorType.Generic;
                const errorDetail =
                    errorType === SqlConnectionErrorType.TrustServerCertificateNotEnabled
                        ? LocalizedConstants.Connection.trustServerCertificateMustBeEnabledMessage
                        : (connInfo?.errorMessage ?? "");
                dbComponent.loadStatus = {
                    status: ApiStatus.Error,
                    message:
                        LocalizedConstants.ConnectionDialog.unableToLoadDatabaseList(errorDetail),
                };
                this._activeDbFetchKey = "";
                this.updateState();
                return;
            }

            const dbs = await this._mainController.connectionManager.listDatabases(tempUri);

            // Check if this fetch attempt is out-of-date
            if (counter !== this._dbFetchCounter) {
                return;
            }

            // 4b. If connection succeeded, cache and display database list
            this._databaseListCache.set(fetchKey, dbs);
            dbComponent.options = this.buildDatabaseOptions(dbs);
            dbComponent.loadStatus = undefined;

            this.updateState();
        } catch (err) {
            // Check if this fetch attempt is out-of-date
            if (counter !== this._dbFetchCounter) {
                return;
            }

            dbComponent.loadStatus = {
                status: ApiStatus.Error,
                message: LocalizedConstants.ConnectionDialog.unableToLoadDatabaseList(
                    getErrorMessage(err),
                ),
            };

            this._activeDbFetchKey = "";
            this.updateState();
        } finally {
            try {
                await this._mainController.connectionManager.disconnect(tempUri);
            } catch {
                // ignore disconnect errors
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

            if (this.isConnectionReadyForDatabaseFetch(this.state.connectionProfile)) {
                void this.loadDatabaseList();
            }
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
        // clear properties that will be unique for a cloned connection
        connectionDraft.id = undefined;
        connectionDraft.profileName = undefined;
        delete (connectionDraft as IConnectionProfile).order;

        // clear management properties that aren't serialized
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
            this.logger.debug(
                "Connection string connection found in Connection Dialog initialization; should have been converted.",
            );
        }

        // The server is serialized to config in "server,port" form; split the port into its own
        // field so it can be shown in the dedicated port input next to the server input.
        if (connection.server?.includes(",")) {
            const commaIndex = connection.server.indexOf(",");
            const portString = connection.server.substring(commaIndex + 1).trim();
            const parsedPort = Number(portString);

            if (portString !== "" && !isNaN(parsedPort)) {
                connection.server = connection.server.substring(0, commaIndex).trim();
                connection.port = parsedPort;
            }
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
                accountComponent.loadStatus = { status: ApiStatus.Loaded };
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

        this.logger.debug(
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
        const actionButtons: FormItemActionButton[] = [];

        actionButtons.push({
            label: LocalizedConstants.ConnectionDialog.signIn,
            id: "azureSignIn",
            callback: async () => {
                if (previewService.isFeatureEnabled(PreviewFeature.UseVscodeAccountsForEntraMFA)) {
                    const existingAccountIds = new Set(
                        (this._cachedEntraAccounts ?? []).map((a) => a.value),
                    );

                    const auth = VsCodeAzureHelper.getProvider();
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
                    accountsComponent.loadStatus = { status: ApiStatus.Loading };
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
                    this.logger.debug(
                        `Added Azure account '${account.displayInfo?.displayName}', ${account.key.id}`,
                    );

                    this.clearEntraAccountCache();

                    this.state.connectionProfile.accountId = account.key.id;

                    this.logger.debug(`Selecting '${account.key.id}'`);

                    this.updateState();
                    await this.handleAzureMFAEdits("accountId");
                }
            },
        });

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
            accountComponent.loadStatus = { status: ApiStatus.Loading };

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
                        message: LocalizedConstants.Azure.accountNotFound(accountDisplayString),
                        intent: "error",
                        buttons: [
                            {
                                id: SIGN_IN_TO_AZURE,
                                label: LocalizedConstants.ConnectionDialog.signIn,
                            },
                        ],
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
                accountComponent.loadStatus = { status: ApiStatus.Loaded };
                await this.updateItemVisibility();
            }
        }
    }

    /**
     * Refreshes the data used to generate the tenant sign-in count sumary and tooltip
     */
    private async refreshUnauthenticatedTenants(
        state: ConnectionDialogWebviewState,
        auth: VSCodeAzureSubscriptionProvider,
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
        } catch (error) {
            state.unauthenticatedAzureTenants = [];
            state.azureTenantStatus = [];

            this.logger.error(
                "Error determining Azure tenants without active sessions: " +
                    getErrorMessage(error),
            );
        }
    }

    /**
     * Ensures that Azure accounts and tenants are loaded for browsing and that an account/tenant are selected.
     */
    private async ensureAzureBrowseContext(
        state: ConnectionDialogWebviewState,
        options: {
            forceRefreshAccounts?: boolean;
            forceRefreshTenants?: boolean;
        } = {},
    ): Promise<void> {
        const { forceRefreshAccounts = false, forceRefreshTenants = false } = options;

        const accountsAlreadyLoaded =
            state.loadingAzureAccountsStatus === ApiStatus.Loaded && state.azureAccounts.length > 0;

        if (forceRefreshAccounts || !accountsAlreadyLoaded) {
            state.loadingAzureAccountsStatus = ApiStatus.Loading;
            this.updateState(state);

            state.azureAccounts = (await VsCodeAzureHelper.getAccounts()).map((a) => {
                return {
                    id: a.id,
                    name: a.label,
                } as IAzureAccount;
            });
            state.loadingAzureAccountsStatus = ApiStatus.Loaded;
            this.updateState(state);
        }

        if (state.azureAccounts.length === 0) {
            // Nothing to select; clear any stale tenant data
            state.selectedAccountId = undefined;
            state.azureTenants = [];
            state.selectedTenantId = undefined;
            state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
            return;
        }

        // Auto-select the first account if none is currently selected, or if the
        // current selection is no longer in the account list
        const selectionStillValid =
            !!state.selectedAccountId &&
            state.azureAccounts.some((a) => a.id === state.selectedAccountId);
        if (!selectionStillValid) {
            state.selectedAccountId = state.azureAccounts[0].id;
            // Account changed - tenants must be reloaded
            state.azureTenants = [];
            state.selectedTenantId = undefined;
            state.loadingAzureTenantsStatus = ApiStatus.NotStarted;
        }

        const tenantsAlreadyLoaded =
            state.loadingAzureTenantsStatus === ApiStatus.Loaded && state.azureTenants.length > 0;

        if (forceRefreshTenants || !tenantsAlreadyLoaded) {
            state.loadingAzureTenantsStatus = ApiStatus.Loading;
            state.azureTenants = [];
            state.selectedTenantId = undefined;
            this.updateState(state);

            const azureAccount = await VsCodeAzureHelper.getAccountById(state.selectedAccountId);
            const tenants = await VsCodeAzureHelper.getTenantsForAccount(azureAccount);

            // Check sign-in status for each tenant concurrently
            const auth = VsCodeAzureHelper.getProvider();
            const signedInStatuses = await Promise.all(
                tenants.map((t) => auth.isSignedIn(t.tenantId, azureAccount)),
            );

            state.azureTenants = tenants.map((t, i) => ({
                id: t.tenantId!,
                name: t.displayName!,
                isSignedIn: signedInStatuses[i],
            }));

            // Response from VS Code account system shows all tenants as "Home", so we need to extract the home tenant ID manually
            const homeTenantId = VsCodeAzureHelper.getHomeTenantIdForAccount(azureAccount);

            // Auto-select the home tenant if signed in; otherwise fall back to first signed-in tenant, then first overall.
            const homeTenant = state.azureTenants.find((t) => t.id === homeTenantId);
            const firstSignedIn = state.azureTenants.find((t) => t.isSignedIn);
            state.selectedTenantId =
                (homeTenant?.isSignedIn ? homeTenantId : undefined) ??
                firstSignedIn?.id ??
                (state.azureTenants.length > 0 ? state.azureTenants[0].id : undefined);

            state.loadingAzureTenantsStatus = ApiStatus.Loaded;
            this.updateState(state);
        }
    }

    /**
     * Signs in to a specific tenant using the currently selected account,
     * then refreshes the `isSignedIn` flag on all tenants in state.
     *
     * @returns `true` if sign-in succeeded, `false` if the user cancelled or it failed.
     */
    private async signInToTenant(
        state: ConnectionDialogWebviewState,
        tenantId: string,
    ): Promise<boolean> {
        const azureAccount = await VsCodeAzureHelper.getAccountById(state.selectedAccountId);
        const auth = VsCodeAzureHelper.getProvider();

        const signedIn = await auth.signIn(tenantId, azureAccount);

        // Refresh isSignedIn status for all tenants so the UI reflects the change
        if (signedIn) {
            const statuses = await Promise.all(
                state.azureTenants.map((t) => auth.isSignedIn(t.id, azureAccount)),
            );
            state.azureTenants = state.azureTenants.map((t, i) => ({
                ...t,
                isSignedIn: statuses[i],
            }));
            this.updateState(state);
        }

        return signedIn;
    }

    /** Returns the BrowseProvider matching the current input mode, or undefined when not in a browse mode. */
    private getActiveProvider(state: ConnectionDialogWebviewState): BrowseProvider | undefined {
        switch (state.selectedInputMode) {
            case ConnectionInputMode.AzureBrowse:
                return this._azureBrowseProvider;
            case ConnectionInputMode.FabricBrowse:
                return this._fabricBrowseProvider;
            default:
                return undefined;
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
