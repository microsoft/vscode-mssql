/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDefaultTenantId, VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import { AzureSqlDatabase, ConnectionDialog } from "../constants/locConstants";
import { Logger } from "../models/logger";
import * as asd from "../sharedInterfaces/azureSqlDatabase";
import { AuthenticationType, IConnectionDialogProfile } from "../sharedInterfaces/connectionDialog";
import { FormItemActionButton, FormItemOptions, FormItemType } from "../sharedInterfaces/form";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { IConnectionProfile } from "../models/interfaces";
import { DEPLOYMENT_VIEW_ID, DeploymentWebviewController } from "./deploymentWebviewController";
import { UserSurvey } from "../nps/userSurvey";

// Cached logger reference for use in helper functions that don't have
// direct access to the controller's protected logger.
let cachedLogger: Logger | undefined;

// ─── Cached Azure data ───────────────────────────────────────────────────────
// These caches reduce redundant Azure API calls. They are populated during
// component loading and invalidated when upstream selections change.
import type { AzureSubscription, AzureTenant } from "@microsoft/vscode-azext-azureauth";
import type { Server } from "@azure/arm-sql";
import type * as vscode from "vscode";

let cachedAccounts: vscode.AuthenticationSessionAccountInformation[] = [];
let cachedTenants: AzureTenant[] = [];
let cachedSubscriptions: AzureSubscription[] = [];
let cachedResourceGroups: string[] = [];
let cachedServers: Server[] = [];
let cachedLocations: { name: string; displayName: string }[] = [];

function clearCacheDownstream(fromComponent: string): void {
    const order = asd.AZURE_SQL_DB_COMPONENT_ORDER as readonly string[];
    const idx = order.indexOf(fromComponent);
    if (idx === -1) return;

    for (let i = idx + 1; i < order.length; i++) {
        switch (order[i]) {
            case "tenantId":
                cachedTenants = [];
                break;
            case "subscriptionId":
                cachedSubscriptions = [];
                break;
            case "resourceGroup":
                cachedResourceGroups = [];
                break;
            case "serverName":
                cachedServers = [];
                break;
        }
    }
    cachedLocations = [];
}

function getCachedSubscription(subscriptionId: string): AzureSubscription | undefined {
    return cachedSubscriptions.find((s) => s.subscriptionId === subscriptionId);
}

function getCachedTenant(tenantId: string): AzureTenant | undefined {
    return cachedTenants.find((t) => t.tenantId === tenantId);
}

/**
 * Finds a cached server by name.
 */
function getCachedServer(serverName: string): Server | undefined {
    return cachedServers.find((s) => s.name === serverName);
}

/**
 * Detects the authentication type from a server's properties:
 * - administrators exists + azureADOnlyAuthentication=true → AzureMFA
 * - administrators exists + azureADOnlyAuthentication=false → AzureMFAAndUser
 * - no administrators → SqlLogin
 *
 * Also returns the admin login for pre-filling the username field.
 */
function detectAuthType(server: Server): {
    authType: AuthenticationType;
    adminLogin: string;
} {
    if (server.administrators) {
        if (server.administrators.azureADOnlyAuthentication) {
            return { authType: AuthenticationType.AzureMFA, adminLogin: "" };
        }
        return {
            authType: AuthenticationType.AzureMFAAndUser,
            adminLogin: server.administratorLogin ?? "",
        };
    }
    return {
        authType: AuthenticationType.SqlLogin,
        adminLogin: server.administratorLogin ?? "",
    };
}

/**
 * Applies auth settings to the form state based on the selected server's properties.
 * Clears stale credentials when the server changes.
 */
export function applyServerAuthSettings(
    azureSqlState: asd.AzureSqlDatabaseState,
    serverName: string,
): void {
    // If auth was just provided via the Create New Server drawer, preserve those values
    if (azureSqlState.serverCreatedWithAuth) {
        return;
    }

    const server = getCachedServer(serverName);
    if (!server) {
        azureSqlState.formState.authenticationType = AuthenticationType.AzureMFA;
        azureSqlState.formState.userName = "";
        azureSqlState.formState.password = "";
        azureSqlState.formState.savePassword = false;
        return;
    }

    const { authType, adminLogin } = detectAuthType(server);
    azureSqlState.formState.authenticationType = authType;
    azureSqlState.formState.userName = adminLogin;
    azureSqlState.formState.password = "";
    azureSqlState.formState.savePassword = false;
}

export async function initializeAzureSqlDatabaseState(
    deploymentController: DeploymentWebviewController,
    groupOptions: FormItemOptions[],
    logger: Logger,
    selectedGroupId: string | undefined,
): Promise<asd.AzureSqlDatabaseState> {
    cachedLogger = logger;
    const startTime = Date.now();
    const state = new asd.AzureSqlDatabaseState();

    state.formState = {
        accountId: "",
        tenantId: "",
        subscriptionId: "",
        resourceGroup: "",
        serverName: "",
        databaseName: "",
        authenticationType: AuthenticationType.AzureMFA,
        userName: "",
        password: "",
        savePassword: false,
        autoPauseDelay: 60,
        profileName: "",
        groupId: selectedGroupId || groupOptions[0]?.value || "",
    };

    deploymentController.state.deploymentTypeState = state;
    state.formComponents = setAzureSqlDatabaseFormComponents([], [], groupOptions, [], []);
    state.loadState = ApiStatus.Loaded;
    sendActionEvent(
        TelemetryViews.AzureSqlDatabase,
        TelemetryActions.StartAzureSqlDatabaseDeployment,
        {},
        { azureSqlDatabaseInitTimeInMs: Date.now() - startTime },
    );

    return state;
}

export function registerAzureSqlDatabaseReducers(
    deploymentController: DeploymentWebviewController,
) {
    deploymentController.registerReducer("loadAzureComponent", async (state, payload) => {
        const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;

        if (azureSqlState.azureComponentStatuses[payload.componentName] !== ApiStatus.NotStarted) {
            return state;
        }

        switch (payload.componentName) {
            case "accountId":
                await loadAccountComponent(deploymentController, azureSqlState);
                break;
            case "tenantId":
                await loadTenantComponent(azureSqlState);
                break;
            case "subscriptionId":
                await loadSubscriptionComponent(azureSqlState);
                break;
            case "resourceGroup":
                await loadResourceGroupComponent(azureSqlState);
                break;
            case "serverName":
                await loadServerComponent(azureSqlState);
                break;
            default:
                return state;
        }

        azureSqlState.azureComponentStatuses[payload.componentName] = ApiStatus.Loaded;
        state.deploymentTypeState = azureSqlState;
        return state;
    });

    deploymentController.registerReducer(
        "startAzureSqlDatabaseDeployment",
        async (state, _payload) => {
            const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;

            azureSqlState.formValidationLoadState = ApiStatus.Loading;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);

            try {
                azureSqlState.formErrors = await deploymentController.validateDeploymentForm();
            } catch (error) {
                cachedLogger?.error(`Form validation failed: ${error}`);
                azureSqlState.formErrors = [];
            }
            if (azureSqlState.formErrors.length > 0) {
                azureSqlState.formValidationLoadState = ApiStatus.NotStarted;
                state.deploymentTypeState = azureSqlState;
                return state;
            }

            // Validation passed — navigate to the provisioning page
            azureSqlState.formValidationLoadState = ApiStatus.Loaded;
            azureSqlState.deploymentStartTime = new Date().toUTCString();
            azureSqlState.provisionLoadState = ApiStatus.Loading;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);

            try {
                const startTime = Date.now();
                const subscription = getCachedSubscription(azureSqlState.formState.subscriptionId);
                if (!subscription) {
                    throw new Error(AzureSqlDatabase.noSubscriptionsFound);
                }

                await VsCodeAzureHelper.createAzureSqlDatabase(
                    subscription,
                    azureSqlState.formState.resourceGroup,
                    azureSqlState.formState.serverName,
                    azureSqlState.formState.databaseName,
                );

                azureSqlState.provisionLoadState = ApiStatus.Loaded;
                updateAzureSqlDatabaseState(deploymentController, azureSqlState);

                sendActionEvent(
                    TelemetryViews.AzureSqlDatabase,
                    TelemetryActions.ProvisionAzureSqlDatabase,
                    {},
                    {
                        provisionDatabaseLoadTimeInMs: Date.now() - startTime,
                    },
                );

                void connectToAzureSqlDatabase(deploymentController);
            } catch (error) {
                azureSqlState.provisionLoadState = ApiStatus.Error;
                azureSqlState.errorMessage = error instanceof Error ? error.message : String(error);
                cachedLogger?.error(
                    `Azure SQL Database provisioning failed: ${azureSqlState.errorMessage}`,
                );
            }

            state.deploymentTypeState = azureSqlState;
            return state;
        },
    );

    deploymentController.registerReducer(
        "setCreateResourceGroupDrawerState",
        async (state, payload) => {
            const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;

            if (payload.shouldOpen) {
                // Open dialog immediately with loading state for locations
                state.dialog = {
                    type: "createResourceGroup",
                    props: {
                        locationOptions: [],
                        locationsLoadState: ApiStatus.Loading,
                        createLoadState: ApiStatus.NotStarted,
                    },
                } as asd.CreateResourceGroupDrawerProps;
                azureSqlState.dialog = state.dialog;
                state.deploymentTypeState = azureSqlState;
                updateAzureSqlDatabaseState(deploymentController, azureSqlState);

                // Fetch locations in the background
                const { subscriptionId } = azureSqlState.formState;
                const subscription = getCachedSubscription(subscriptionId);
                if (subscription) {
                    cachedLocations =
                        await VsCodeAzureHelper.getLocationsForSubscription(subscription);
                }

                // Update dialog with loaded locations
                state.dialog = {
                    type: "createResourceGroup",
                    props: {
                        locationOptions: cachedLocations,
                        locationsLoadState: ApiStatus.Loaded,
                        createLoadState: ApiStatus.NotStarted,
                    },
                } as asd.CreateResourceGroupDrawerProps;
            } else {
                state.dialog = undefined;
            }

            azureSqlState.dialog = state.dialog;
            state.deploymentTypeState = azureSqlState;
            return state;
        },
    );

    deploymentController.registerReducer("submitCreateResourceGroup", async (state, payload) => {
        const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;
        const { resourceGroupName, location } = payload.spec;

        // Show creating state in the dialog
        const dialogProps = (state.dialog as asd.CreateResourceGroupDrawerProps)?.props;
        if (dialogProps) {
            dialogProps.createLoadState = ApiStatus.Loading;
            azureSqlState.dialog = state.dialog;
            state.deploymentTypeState = azureSqlState;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);
        }

        try {
            const subscription = getCachedSubscription(azureSqlState.formState.subscriptionId);
            if (!subscription) {
                throw new Error(AzureSqlDatabase.noSubscriptionsFound);
            }

            await VsCodeAzureHelper.createResourceGroup(subscription, resourceGroupName, location);

            // Set the new resource group as selected and reload downstream
            azureSqlState.formState.resourceGroup = resourceGroupName;
            azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.NotStarted;
            azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.NotStarted;
            azureSqlState.formState.serverName = "";

            // Close dialog on success
            state.dialog = undefined;
            azureSqlState.dialog = undefined;
        } catch (error) {
            cachedLogger?.error(
                `Failed to create resource group: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Keep dialog open and reset create state so user can retry
            if (dialogProps) {
                dialogProps.createLoadState = ApiStatus.Error;
                dialogProps.message = error instanceof Error ? error.message : String(error);
                azureSqlState.dialog = state.dialog;
            }
        }

        state.deploymentTypeState = azureSqlState;
        return state;
    });

    deploymentController.registerReducer("setCreateServerDrawerState", async (state, payload) => {
        const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;

        if (payload.shouldOpen) {
            // Open dialog immediately with loading state
            state.dialog = {
                type: "createServer",
                props: {
                    locationOptions: [],
                    locationsLoadState: ApiStatus.Loading,
                    createLoadState: ApiStatus.NotStarted,
                },
            } as asd.CreateServerDrawerProps;
            azureSqlState.dialog = state.dialog;
            state.deploymentTypeState = azureSqlState;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);

            // Fetch locations and resource group default location
            const { subscriptionId, resourceGroup } = azureSqlState.formState;
            const subscription = getCachedSubscription(subscriptionId);
            let defaultLocation = "";
            if (subscription) {
                cachedLocations = await VsCodeAzureHelper.getLocationsForSubscription(subscription);
                if (resourceGroup) {
                    defaultLocation = await VsCodeAzureHelper.getDefaultLocationForResourceGroup(
                        resourceGroup,
                        subscription,
                    );
                }
            }

            state.dialog = {
                type: "createServer",
                props: {
                    locationOptions: cachedLocations,
                    locationsLoadState: ApiStatus.Loaded,
                    createLoadState: ApiStatus.NotStarted,
                    defaultLocation,
                },
            } as asd.CreateServerDrawerProps;
        } else {
            state.dialog = undefined;
        }

        azureSqlState.dialog = state.dialog;
        state.deploymentTypeState = azureSqlState;
        return state;
    });

    deploymentController.registerReducer("submitCreateServer", async (state, payload) => {
        const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;
        const {
            serverName,
            location,
            authenticationType,
            adminLogin,
            adminPassword,
            savePassword,
        } = payload.spec;

        // Show creating state in the dialog
        const dialogProps = (state.dialog as asd.CreateServerDrawerProps)?.props;
        if (dialogProps) {
            dialogProps.createLoadState = ApiStatus.Loading;
            azureSqlState.dialog = state.dialog;
            state.deploymentTypeState = azureSqlState;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);
        }

        try {
            const subscription = getCachedSubscription(azureSqlState.formState.subscriptionId);
            if (!subscription) {
                throw new Error(AzureSqlDatabase.noSubscriptionsFound);
            }

            await VsCodeAzureHelper.createSqlServer(
                subscription,
                azureSqlState.formState.resourceGroup,
                serverName,
                location,
                { authenticationType, adminLogin, adminPassword },
            );

            // Set the new server as selected and reload
            azureSqlState.formState.serverName = serverName;
            azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.NotStarted;

            // Apply auth settings from the drawer to the main form
            azureSqlState.formState.authenticationType = authenticationType as AuthenticationType;
            if (
                authenticationType === AuthenticationType.SqlLogin ||
                authenticationType === AuthenticationType.AzureMFAAndUser
            ) {
                azureSqlState.formState.userName = adminLogin ?? "";
                azureSqlState.formState.password = adminPassword ?? "";
                azureSqlState.formState.savePassword = savePassword ?? false;
                azureSqlState.serverCreatedWithAuth = true;
            } else {
                azureSqlState.formState.userName = "";
                azureSqlState.formState.password = "";
                azureSqlState.formState.savePassword = false;
                azureSqlState.serverCreatedWithAuth = false;
            }

            // Close dialog on success
            state.dialog = undefined;
            azureSqlState.dialog = undefined;
        } catch (error) {
            cachedLogger?.error(
                `Failed to create server: ${error instanceof Error ? error.message : String(error)}`,
            );
            if (dialogProps) {
                dialogProps.createLoadState = ApiStatus.Error;
                dialogProps.message = error instanceof Error ? error.message : String(error);
                azureSqlState.dialog = state.dialog;
            }
        }

        state.deploymentTypeState = azureSqlState;
        return state;
    });
}

/**
 * Resets all Azure components downstream of the given component to NotStarted,
 * clearing their form values and options. This triggers the UI to re-load them.
 */
export function reloadAzureComponentsDownstream(
    azureSqlState: asd.AzureSqlDatabaseState,
    fromComponent: string,
): void {
    const componentOrder = asd.AZURE_SQL_DB_COMPONENT_ORDER as readonly string[];
    const fromIndex = componentOrder.indexOf(fromComponent);
    if (fromIndex === -1) return;

    for (let i = fromIndex + 1; i < componentOrder.length; i++) {
        const componentName = componentOrder[i];
        azureSqlState.azureComponentStatuses[componentName] = ApiStatus.NotStarted;
        const formComponent =
            azureSqlState.formComponents[componentName as keyof asd.AzureSqlDatabaseFormState];
        if (formComponent) {
            formComponent.options = [];
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic property reset for cascading azure components
        (azureSqlState.formState as any)[componentName] = "";

        // Clear auth-related fields when server resets
        if (componentName === "serverName") {
            azureSqlState.formState.authenticationType = AuthenticationType.SqlLogin;
            azureSqlState.formState.userName = "";
            azureSqlState.formState.password = "";
            azureSqlState.formState.savePassword = false;
            azureSqlState.serverCreatedWithAuth = false;
        }
    }
}

export function sendAzureSqlDatabaseCloseEventTelemetry(state: asd.AzureSqlDatabaseState): void {
    sendActionEvent(
        TelemetryViews.AzureSqlDatabase,
        TelemetryActions.FinishAzureSqlDatabaseDeployment,
        {
            errorMessage: state.errorMessage || "",
            provisionState: state.provisionLoadState,
        },
    );
}

export async function connectToAzureSqlDatabase(
    deploymentController: DeploymentWebviewController,
): Promise<void> {
    const state = deploymentController.state.deploymentTypeState as asd.AzureSqlDatabaseState;
    const startTime = Date.now();
    state.connectionLoadState = ApiStatus.Loading;
    updateAzureSqlDatabaseState(deploymentController, state);

    try {
        const serverFqdn = `${state.formState.serverName}.database.windows.net`;
        const connectionDetails =
            await deploymentController.mainController.connectionManager.parseConnectionString(
                `Server=${serverFqdn};Database=${state.formState.databaseName}`,
            );

        const connectionProfile: IConnectionDialogProfile =
            await ConnectionCredentials.createConnectionInfo(connectionDetails);
        connectionProfile.profileName = state.formState.profileName || state.formState.databaseName;
        connectionProfile.groupId = state.formState.groupId;
        connectionProfile.authenticationType = state.formState
            .authenticationType as AuthenticationType;

        if (
            state.formState.authenticationType === AuthenticationType.AzureMFA ||
            state.formState.authenticationType === AuthenticationType.AzureMFAAndUser
        ) {
            connectionProfile.accountId = state.formState.accountId;
            connectionProfile.tenantId = state.formState.tenantId;
        }

        if (
            state.formState.authenticationType === AuthenticationType.SqlLogin ||
            state.formState.authenticationType === AuthenticationType.AzureMFAAndUser
        ) {
            connectionProfile.user = state.formState.userName;
            connectionProfile.password = state.formState.password;
            connectionProfile.savePassword = state.formState.savePassword;
        }

        const profile =
            await deploymentController.mainController.connectionManager.connectionUI.saveProfile(
                connectionProfile as IConnectionProfile,
            );
        await deploymentController.mainController.createObjectExplorerSession(profile);
        state.connectionLoadState = ApiStatus.Loaded;

        sendActionEvent(
            TelemetryViews.AzureSqlDatabase,
            TelemetryActions.ConnectToAzureSqlDatabase,
            {},
            {
                connectToDatabaseLoadTimeInMs: Date.now() - startTime,
            },
        );

        UserSurvey.getInstance().promptUserForNPSFeedback(`${DEPLOYMENT_VIEW_ID}_azureSqlDatabase`);
    } catch (err) {
        state.connectionLoadState = ApiStatus.Error;
        state.errorMessage = err instanceof Error ? err.message : String(err);
        sendErrorEvent(
            TelemetryViews.AzureSqlDatabase,
            TelemetryActions.ConnectToAzureSqlDatabase,
            err,
            false,
        );
    }

    updateAzureSqlDatabaseState(deploymentController, state);
}

// ─── Individual component loaders ────────────────────────────────────────────

async function loadAccountComponent(
    deploymentController: DeploymentWebviewController,
    azureSqlState: asd.AzureSqlDatabaseState,
): Promise<void> {
    const accountComponent = azureSqlState.formComponents.accountId;
    if (!accountComponent) return;

    cachedAccounts = await VsCodeAzureHelper.getAccounts();
    clearCacheDownstream("accountId");

    accountComponent.options = cachedAccounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));
    accountComponent.actionButtons = await getAzureActionButton(deploymentController);

    if (cachedAccounts.length === 0) {
        accountComponent.placeholder = AzureSqlDatabase.noAzureAccountsFound;
    }

    azureSqlState.formState.accountId = cachedAccounts.length > 0 ? cachedAccounts[0].id : "";
}

async function loadTenantComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const tenantComponent = azureSqlState.formComponents.tenantId;
    if (!tenantComponent) return;

    if (!azureSqlState.formState.accountId) {
        azureSqlState.azureComponentStatuses["tenantId"] = ApiStatus.Error;
        tenantComponent.placeholder = AzureSqlDatabase.noTenantsFound;
        return;
    }

    cachedTenants = await VsCodeAzureHelper.getTenantsForAccount(azureSqlState.formState.accountId);
    clearCacheDownstream("tenantId");

    tenantComponent.options = cachedTenants.map((t) => ({
        displayName: t.displayName,
        value: t.tenantId,
    }));
    tenantComponent.placeholder =
        cachedTenants.length > 0 ? ConnectionDialog.selectATenant : AzureSqlDatabase.noTenantsFound;

    azureSqlState.formState.tenantId = getDefaultTenantId(
        azureSqlState.formState.accountId,
        cachedTenants,
    );
}

async function loadSubscriptionComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const subscriptionComponent = azureSqlState.formComponents.subscriptionId;
    if (!subscriptionComponent) return;

    if (!azureSqlState.formState.tenantId) {
        azureSqlState.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
        subscriptionComponent.placeholder = AzureSqlDatabase.noSubscriptionsFound;
        return;
    }

    const tenant = getCachedTenant(azureSqlState.formState.tenantId);
    if (!tenant) {
        azureSqlState.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
        subscriptionComponent.placeholder = AzureSqlDatabase.noSubscriptionsFound;
        return;
    }

    cachedSubscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
    clearCacheDownstream("subscriptionId");

    subscriptionComponent.options = cachedSubscriptions.map((sub) => ({
        displayName: `${sub.name} (${sub.subscriptionId})`,
        value: sub.subscriptionId,
    }));
    subscriptionComponent.placeholder =
        cachedSubscriptions.length > 0
            ? AzureSqlDatabase.selectASubscription
            : AzureSqlDatabase.noSubscriptionsFound;

    azureSqlState.formState.subscriptionId =
        cachedSubscriptions.length > 0 ? cachedSubscriptions[0].subscriptionId : "";
}

async function loadResourceGroupComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const resourceGroupComponent = azureSqlState.formComponents.resourceGroup;
    if (!resourceGroupComponent) return;

    if (!azureSqlState.formState.subscriptionId || !azureSqlState.formState.tenantId) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    const subscription = getCachedSubscription(azureSqlState.formState.subscriptionId);
    if (!subscription) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    cachedResourceGroups = await VsCodeAzureHelper.getResourceGroupsForSubscription(subscription);
    clearCacheDownstream("resourceGroup");

    resourceGroupComponent.options = cachedResourceGroups.map((name) => ({
        displayName: name,
        value: name,
    }));
    resourceGroupComponent.placeholder =
        cachedResourceGroups.length > 0
            ? AzureSqlDatabase.selectAResourceGroup
            : AzureSqlDatabase.noResourceGroupsFound;

    // Preserve the current selection if it exists in the loaded list (e.g., after creating a new one)
    const currentRg = azureSqlState.formState.resourceGroup;
    if (currentRg && cachedResourceGroups.includes(currentRg)) {
        azureSqlState.formState.resourceGroup = currentRg;
    } else {
        azureSqlState.formState.resourceGroup =
            cachedResourceGroups.length > 0 ? cachedResourceGroups[0] : "";
    }
}

async function loadServerComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const serverComponent = azureSqlState.formComponents.serverName;
    if (!serverComponent) return;

    if (
        !azureSqlState.formState.resourceGroup ||
        !azureSqlState.formState.subscriptionId ||
        !azureSqlState.formState.tenantId
    ) {
        azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.Error;
        serverComponent.placeholder = AzureSqlDatabase.noServersFound;
        return;
    }

    const subscription = getCachedSubscription(azureSqlState.formState.subscriptionId);
    if (!subscription) {
        azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.Error;
        serverComponent.placeholder = AzureSqlDatabase.noServersFound;
        return;
    }

    cachedServers = await VsCodeAzureHelper.getSqlServersForResourceGroup(
        subscription,
        azureSqlState.formState.resourceGroup,
    );

    serverComponent.options = cachedServers.map((s) => ({
        displayName: s.name ?? "",
        value: s.name ?? "",
    }));
    serverComponent.placeholder =
        cachedServers.length > 0 ? AzureSqlDatabase.selectAServer : AzureSqlDatabase.noServersFound;

    // Preserve the current selection if it exists in the loaded list (e.g., after creating a new one)
    const currentServer = azureSqlState.formState.serverName;
    const matchedServer = currentServer
        ? cachedServers.find((s) => s.name === currentServer)
        : undefined;
    if (matchedServer) {
        azureSqlState.formState.serverName = currentServer;
    } else {
        azureSqlState.formState.serverName =
            cachedServers.length > 0 ? (cachedServers[0].name ?? "") : "";
    }

    // Auto-detect auth type based on the selected server's properties
    applyServerAuthSettings(azureSqlState, azureSqlState.formState.serverName);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function updateAzureSqlDatabaseState(
    deploymentController: DeploymentWebviewController,
    newState: asd.AzureSqlDatabaseState,
) {
    deploymentController.state.deploymentTypeState = newState;
    deploymentController.updateState(deploymentController.state);
}

async function getAzureActionButton(
    deploymentController: DeploymentWebviewController,
): Promise<FormItemActionButton[]> {
    const actionButtons: FormItemActionButton[] = [];
    actionButtons.push({
        label: ConnectionDialog.addAccount,
        id: "azureSignIn",
        callback: async () => {
            await VsCodeAzureHelper.signIn(true);
            const currentState = deploymentController.state
                .deploymentTypeState as asd.AzureSqlDatabaseState;
            const accountsComponent = currentState.formComponents.accountId;
            if (!accountsComponent) {
                cachedLogger?.error("Account component not found");
                return;
            }
            cachedAccounts = await VsCodeAzureHelper.getAccounts();
            clearCacheDownstream("accountId");
            accountsComponent.options = cachedAccounts.map((account) => ({
                displayName: account.label,
                value: account.id,
            }));
            // Reset downstream components so they reload with the new account
            reloadAzureComponentsDownstream(currentState, "accountId");
            updateAzureSqlDatabaseState(deploymentController, currentState);
        },
    });
    return actionButtons;
}

function setAzureSqlDatabaseFormComponents(
    azureAccountOptions: FormItemOptions[],
    azureActionButtons: FormItemActionButton[],
    groupOptions: FormItemOptions[],
    tenantOptions: FormItemOptions[],
    subscriptionOptions: FormItemOptions[],
): Record<string, asd.AzureSqlDatabaseFormItemSpec> {
    const createFormItem = (
        spec: Partial<asd.AzureSqlDatabaseFormItemSpec>,
    ): asd.AzureSqlDatabaseFormItemSpec =>
        ({
            required: false,
            isAdvancedOption: false,
            ...spec,
        }) as asd.AzureSqlDatabaseFormItemSpec;

    return {
        accountId: createFormItem({
            propertyName: "accountId",
            label: AzureSqlDatabase.azureAccount,
            required: true,
            type: FormItemType.Dropdown,
            options: azureAccountOptions,
            placeholder: ConnectionDialog.selectAnAccount,
            actionButtons: azureActionButtons,
            validate: (_state: asd.AzureSqlDatabaseState, value: string) => ({
                isValid: !!value,
                validationMessage: value ? "" : AzureSqlDatabase.azureAccountIsRequired,
            }),
        }),
        tenantId: createFormItem({
            propertyName: "tenantId",
            label: ConnectionDialog.tenantId,
            required: true,
            type: FormItemType.Dropdown,
            options: tenantOptions,
            placeholder: ConnectionDialog.selectATenant,
            validate: (_state: asd.AzureSqlDatabaseState, value: string) => ({
                isValid: !!value,
                validationMessage: value ? "" : ConnectionDialog.tenantIdIsRequired,
            }),
        }),
        subscriptionId: createFormItem({
            propertyName: "subscriptionId",
            label: AzureSqlDatabase.subscription,
            required: true,
            type: FormItemType.SearchableDropdown,
            options: subscriptionOptions,
            placeholder: AzureSqlDatabase.selectASubscription,
            validate: (_state: asd.AzureSqlDatabaseState, value: string) => ({
                isValid: !!value,
                validationMessage: value ? "" : AzureSqlDatabase.subscriptionIsRequired,
            }),
        }),
        resourceGroup: createFormItem({
            propertyName: "resourceGroup",
            label: AzureSqlDatabase.resourceGroup,
            required: true,
            type: FormItemType.SearchableDropdown,
            options: [],
            placeholder: AzureSqlDatabase.selectAResourceGroup,
            validate: (_state: asd.AzureSqlDatabaseState, value: string) => ({
                isValid: !!value,
                validationMessage: value ? "" : AzureSqlDatabase.resourceGroupIsRequired,
            }),
        }),
        serverName: createFormItem({
            propertyName: "serverName",
            label: AzureSqlDatabase.server,
            required: true,
            type: FormItemType.SearchableDropdown,
            options: [],
            placeholder: AzureSqlDatabase.selectAServer,
            validate: (_state: asd.AzureSqlDatabaseState, value: string) => ({
                isValid: !!value,
                validationMessage: value ? "" : AzureSqlDatabase.serverIsRequired,
            }),
        }),
        databaseName: createFormItem({
            propertyName: "databaseName",
            type: FormItemType.Input,
            required: true,
            label: AzureSqlDatabase.databaseName,
            placeholder: AzureSqlDatabase.enterDatabaseName,
            validate: (_state: asd.AzureSqlDatabaseState, value: string) => ({
                isValid: !!value,
                validationMessage: value ? "" : AzureSqlDatabase.databaseNameIsRequired,
            }),
        }),
        userName: createFormItem({
            propertyName: "userName",
            type: FormItemType.Input,
            required: true,
            label: AzureSqlDatabase.userName,
            placeholder: AzureSqlDatabase.enterUserName,
            validate: (state: asd.AzureSqlDatabaseState, value: string) => {
                if (state.formState.authenticationType === AuthenticationType.AzureMFA) {
                    return { isValid: true, validationMessage: "" };
                }
                return {
                    isValid: !!value,
                    validationMessage: value ? "" : AzureSqlDatabase.userNameIsRequired,
                };
            },
        }),
        password: createFormItem({
            propertyName: "password",
            type: FormItemType.Password,
            required: true,
            label: AzureSqlDatabase.password,
            placeholder: AzureSqlDatabase.enterPassword,
            validate: (state: asd.AzureSqlDatabaseState, value: string) => {
                if (state.formState.authenticationType === AuthenticationType.AzureMFA) {
                    return { isValid: true, validationMessage: "" };
                }
                return {
                    isValid: !!value,
                    validationMessage: value ? "" : AzureSqlDatabase.passwordIsRequired,
                };
            },
        }),
        savePassword: createFormItem({
            propertyName: "savePassword",
            type: FormItemType.Checkbox,
            required: false,
            label: AzureSqlDatabase.savePassword,
        }),
        profileName: createFormItem({
            propertyName: "profileName",
            type: FormItemType.Input,
            required: false,
            label: ConnectionDialog.profileName,
            placeholder: ConnectionDialog.profileNamePlaceholder,
            tooltip: ConnectionDialog.profileNameTooltip,
        }),
        groupId: createFormItem({
            ...getGroupIdFormItem(groupOptions),
        } as Partial<asd.AzureSqlDatabaseFormItemSpec>),
    };
}
