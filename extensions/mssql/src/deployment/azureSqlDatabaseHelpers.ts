/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription, AzureTenant } from "@microsoft/vscode-azext-azureauth";
import {
    KnownAlwaysEncryptedEnclaveType,
    Server,
    KnownSampleName,
    KnownFreeLimitExhaustionBehavior,
} from "@azure/arm-sql";
import { getDefaultTenantId, VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import { AzureSqlDatabase, ConnectionDialog } from "../constants/locConstants";
import { ILogger2 } from "../models/logger2";
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
import { getCloudProviderSettings } from "../azure/providerSettings";
import { user } from "../constants/constants";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "../azure/vscodeEntraMfaUtils";

// Cached logger reference for use in helper functions that don't have
// direct access to the controller's protected logger.
let cachedLogger: ILogger2 | undefined;

const FIREWALL_ERROR_CODE = 40615;

function clearCacheDownstream(state: asd.AzureSqlDatabaseState, fromComponent: string): void {
    const order = asd.AZURE_SQL_DB_COMPONENT_ORDER as readonly string[];
    const idx = order.indexOf(fromComponent);
    if (idx === -1) return;

    for (let i = idx + 1; i < order.length; i++) {
        switch (order[i]) {
            case "tenantId":
                state.tenants = [];
                break;
            case "subscriptionId":
                state.subscriptions = [];
                state.maintenanceConfigs = [];
                break;
            case "resourceGroup":
                state.resourceGroups = [];
                break;
            case "serverName":
                state.servers = [];
                break;
        }
    }
    state.locations = [];
}

function getCachedSubscription(
    state: asd.AzureSqlDatabaseState,
    subscriptionId: string,
): AzureSubscription | undefined {
    return state.subscriptions.find((s) => s.subscriptionId === subscriptionId);
}

const COLLATION_OPTIONS = [
    "SQL_Latin1_General_CP1_CI_AS",
    "Latin1_General_CI_AS",
    "Latin1_General_CS_AS",
    "SQL_Latin1_General_CP1_CS_AS",
    "Latin1_General_BIN",
    "Japanese_CI_AS",
    "Chinese_PRC_CI_AS",
    "Korean_Wansung_CI_AS",
    "Arabic_CI_AS",
    "Turkish_CI_AS",
];

const DATA_SOURCE_OPTIONS: FormItemOptions[] = [
    { displayName: AzureSqlDatabase.noDataSource, value: "" },
    { displayName: KnownSampleName.AdventureWorksLT, value: KnownSampleName.AdventureWorksLT },
    {
        displayName: KnownSampleName.WideWorldImportersStd,
        value: KnownSampleName.WideWorldImportersStd,
    },
    {
        displayName: KnownSampleName.WideWorldImportersFull,
        value: KnownSampleName.WideWorldImportersFull,
    },
];

function getCachedTenant(
    state: asd.AzureSqlDatabaseState,
    tenantId: string,
): AzureTenant | undefined {
    return state.tenants.find((t) => t.tenantId === tenantId);
}

/**
 * Finds a cached server by name.
 */
function getCachedServer(state: asd.AzureSqlDatabaseState, serverName: string): Server | undefined {
    return state.servers.find((s) => s.name === serverName);
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

    const server = getCachedServer(azureSqlState, serverName);
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

    const serverComponent = azureSqlState.formComponents.serverName;
    const databaseComponent = azureSqlState.formComponents.databaseName;
    switch (authType) {
        case AuthenticationType.AzureMFA:
            serverComponent.tooltip = AzureSqlDatabase.serverTooltipMFA;
            databaseComponent.tooltip = AzureSqlDatabase.databaseTooltipMFA;
            break;
        case AuthenticationType.AzureMFAAndUser:
            serverComponent.tooltip = AzureSqlDatabase.serverTooltipMFAAndUser;
            databaseComponent.tooltip = AzureSqlDatabase.databaseTooltipMFAAndUser;
            break;
        case AuthenticationType.SqlLogin:
            serverComponent.tooltip = AzureSqlDatabase.serverTooltipSqlLogin;
            databaseComponent.tooltip = AzureSqlDatabase.databaseTooltipSqlLogin;
            break;
        default:
            serverComponent.tooltip = AzureSqlDatabase.serverAuthTypeUnknown;
    }
}

export async function initializeAzureSqlDatabaseState(
    deploymentController: DeploymentWebviewController,
    groupOptions: FormItemOptions[],
    logger: ILogger2,
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
        freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
        profileName: "",
        groupId: selectedGroupId || groupOptions[0]?.value || "",
        collation: COLLATION_OPTIONS[0],
        maintenanceConfig: "",
        dataSource: "",
        enableAlwaysEncrypted: false,
        maxVcores: "2",
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

        // Capture user-editable fields that load functions don't manage,
        // so concurrent formAction changes aren't lost during the await.
        const preservedMaintenanceConfig = azureSqlState.formState.maintenanceConfig;

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

        // Restore maintenance config if it wasn't explicitly reset by the load
        // (subscriptionId load resets it via reloadAzureComponentsDownstream)
        if (
            payload.componentName !== "subscriptionId" &&
            payload.componentName !== "accountId" &&
            payload.componentName !== "tenantId"
        ) {
            // Check if a concurrent formAction updated maintenanceConfig;
            // prefer the latest value from the controller's live state.
            const liveMaintenanceConfig = (
                deploymentController.state.deploymentTypeState as asd.AzureSqlDatabaseState
            ).formState.maintenanceConfig;
            azureSqlState.formState.maintenanceConfig =
                liveMaintenanceConfig || preservedMaintenanceConfig;
        }

        // If the load function set the component to Error (e.g. no results found),
        // propagate that error to all downstream components.
        if (azureSqlState.azureComponentStatuses[payload.componentName] === ApiStatus.Error) {
            const componentOrder = asd.AZURE_SQL_DB_COMPONENT_ORDER as readonly string[];
            const fromIndex = componentOrder.indexOf(payload.componentName);
            if (fromIndex !== -1) {
                for (let i = fromIndex + 1; i < componentOrder.length; i++) {
                    azureSqlState.azureComponentStatuses[componentOrder[i]] = ApiStatus.Error;
                }
            }
        } else {
            azureSqlState.azureComponentStatuses[payload.componentName] = ApiStatus.Loaded;
        }
        state.deploymentTypeState = azureSqlState;
        return state;
    });

    deploymentController.registerReducer(
        "startAzureSqlDatabaseDeployment",
        async (state, payload) => {
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
            azureSqlState.deploymentStartTime = new Date().toLocaleString();
            azureSqlState.provisionLoadState = ApiStatus.Loading;

            // Resolve display names for the provisioning page
            const deploySubscription = getCachedSubscription(
                azureSqlState,
                azureSqlState.formState.subscriptionId,
            );
            azureSqlState.subscriptionName = deploySubscription?.name ?? "";
            const deployServer = getCachedServer(azureSqlState, azureSqlState.formState.serverName);
            azureSqlState.serverRegion = deployServer?.location ?? "";

            updateAzureSqlDatabaseState(deploymentController, azureSqlState);

            try {
                const startTime = Date.now();
                const subscription = getCachedSubscription(
                    azureSqlState,
                    azureSqlState.formState.subscriptionId,
                );
                if (!subscription) {
                    throw new Error(AzureSqlDatabase.noSubscriptionsFound);
                }

                await VsCodeAzureHelper.createAzureSqlDatabase(
                    subscription,
                    azureSqlState.formState.resourceGroup,
                    azureSqlState.formState.serverName,
                    azureSqlState.formState.databaseName,
                    {
                        sampleName: azureSqlState.formState.dataSource || undefined,
                        collation: azureSqlState.formState.collation || undefined,
                        preferredEnclaveType: azureSqlState.formState.enableAlwaysEncrypted
                            ? KnownAlwaysEncryptedEnclaveType.Default
                            : undefined,
                        maintenanceConfigurationId:
                            azureSqlState.formState.maintenanceConfig || undefined,
                        tags:
                            payload.tags && Object.keys(payload.tags).length > 0
                                ? payload.tags
                                : undefined,
                        freeLimitExhaustionBehavior: azureSqlState.formState.freeLimitBehavior,
                        useFreeLimit: true,
                        maxVcores: azureSqlState.formState.maxVcores,
                    },
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
                // Close any other open drawer
                azureSqlState.createServerDrawerState = undefined;

                // Open drawer immediately with loading state for locations
                azureSqlState.createResourceGroupDrawerState = {
                    locationOptions: [],
                    locationsLoadState: ApiStatus.Loading,
                    createLoadState: ApiStatus.NotStarted,
                };
                state.deploymentTypeState = azureSqlState;
                updateAzureSqlDatabaseState(deploymentController, azureSqlState);

                // Fetch locations in the background
                const { subscriptionId } = azureSqlState.formState;
                const subscription = getCachedSubscription(azureSqlState, subscriptionId);
                if (subscription) {
                    azureSqlState.locations =
                        await VsCodeAzureHelper.getLocationsForSubscription(subscription);
                }

                // Only update if the drawer is still open
                if (!azureSqlState.createResourceGroupDrawerState) {
                    return state;
                }

                // Update drawer with loaded locations
                azureSqlState.createResourceGroupDrawerState = {
                    locationOptions: azureSqlState.locations,
                    locationsLoadState: ApiStatus.Loaded,
                    createLoadState: ApiStatus.NotStarted,
                };
            } else {
                azureSqlState.createResourceGroupDrawerState = undefined;
            }

            state.deploymentTypeState = azureSqlState;
            return state;
        },
    );

    deploymentController.registerReducer("submitCreateResourceGroup", async (state, payload) => {
        const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;
        const { resourceGroupName, location, tags } = payload.spec;

        // Show creating state in the drawer
        const drawerState = azureSqlState.createResourceGroupDrawerState;
        if (drawerState) {
            drawerState.createLoadState = ApiStatus.Loading;
            state.deploymentTypeState = azureSqlState;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);
        }

        try {
            const subscription = getCachedSubscription(
                azureSqlState,
                azureSqlState.formState.subscriptionId,
            );
            if (!subscription) {
                throw new Error(AzureSqlDatabase.noSubscriptionsFound);
            }

            await VsCodeAzureHelper.createResourceGroup(
                subscription,
                resourceGroupName,
                location,
                tags,
            );

            // Set the new resource group as selected and reload downstream
            azureSqlState.formState.resourceGroup = resourceGroupName;
            azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.NotStarted;
            azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.NotStarted;
            azureSqlState.formState.serverName = "";

            // Close drawer on success
            azureSqlState.createResourceGroupDrawerState = undefined;
        } catch (error) {
            cachedLogger?.error(
                `Failed to create resource group: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Keep drawer open and reset create state so user can retry
            if (drawerState) {
                drawerState.createLoadState = ApiStatus.Error;
                drawerState.message = error instanceof Error ? error.message : String(error);
            }
        }

        state.deploymentTypeState = azureSqlState;
        return state;
    });

    deploymentController.registerReducer("setCreateServerDrawerState", async (state, payload) => {
        const azureSqlState = state.deploymentTypeState as asd.AzureSqlDatabaseState;

        if (payload.shouldOpen) {
            // Close any other open drawer
            azureSqlState.createResourceGroupDrawerState = undefined;

            // Open drawer immediately with loading state
            azureSqlState.createServerDrawerState = {
                locationOptions: [],
                locationsLoadState: ApiStatus.Loading,
                createLoadState: ApiStatus.NotStarted,
            };
            state.deploymentTypeState = azureSqlState;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);

            // Fetch locations and resource group default location
            const { subscriptionId, resourceGroup } = azureSqlState.formState;
            const subscription = getCachedSubscription(azureSqlState, subscriptionId);
            let defaultLocation = "";
            if (subscription) {
                azureSqlState.locations =
                    await VsCodeAzureHelper.getLocationsForSubscription(subscription);
                if (resourceGroup) {
                    defaultLocation = await VsCodeAzureHelper.getDefaultLocationForResourceGroup(
                        resourceGroup,
                        subscription,
                    );
                }
            }

            // Only update if the drawer is still open
            if (!azureSqlState.createServerDrawerState) {
                return state;
            }

            azureSqlState.createServerDrawerState = {
                locationOptions: azureSqlState.locations,
                locationsLoadState: ApiStatus.Loaded,
                createLoadState: ApiStatus.NotStarted,
                defaultLocation,
            };
        } else {
            azureSqlState.createServerDrawerState = undefined;
        }

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

        // Show creating state in the drawer
        const drawerState = azureSqlState.createServerDrawerState;
        if (drawerState) {
            drawerState.createLoadState = ApiStatus.Loading;
            state.deploymentTypeState = azureSqlState;
            updateAzureSqlDatabaseState(deploymentController, azureSqlState);
        }

        try {
            const subscription = getCachedSubscription(
                azureSqlState,
                azureSqlState.formState.subscriptionId,
            );
            if (!subscription) {
                throw new Error(AzureSqlDatabase.noSubscriptionsFound);
            }

            // Resolve the signed-in user's identity for Entra admin configuration
            const account = azureSqlState.accounts.find(
                (a) => a.id === azureSqlState.formState.accountId,
            );

            // Get the user's Object ID from the subscription's auth session token,
            // which contains the correct OID for the user in the target tenant.
            const accountOid = await VsCodeAzureHelper.getAccountObjectId(subscription, account);

            await VsCodeAzureHelper.createSqlServer(
                subscription,
                azureSqlState.formState.resourceGroup,
                serverName,
                location,
                {
                    authenticationType,
                    adminLogin,
                    adminPassword,
                    entraAdmin:
                        account && accountOid
                            ? {
                                  login: account.label,
                                  sid: accountOid,
                                  tenantId: azureSqlState.formState.tenantId,
                                  principalType: user,
                              }
                            : undefined,
                },
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

            // Close drawer on success
            azureSqlState.createServerDrawerState = undefined;
        } catch (error) {
            cachedLogger?.error(
                `Failed to create server: ${error instanceof Error ? error.message : String(error)}`,
            );
            if (drawerState) {
                drawerState.createLoadState = ApiStatus.Error;
                drawerState.message = error instanceof Error ? error.message : String(error);
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

        // Reset maintenance configs when subscription or upstream resets
        if (componentName === "subscriptionId" || componentName === "resourceGroup") {
            azureSqlState.azureComponentStatuses["maintenanceConfig"] = ApiStatus.NotStarted;
            azureSqlState.formState.maintenanceConfig = "";
            const maintenanceComponent = azureSqlState.formComponents.maintenanceConfig;
            if (maintenanceComponent) {
                maintenanceComponent.options = [];
            }
            azureSqlState.maintenanceConfigs = [];
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
        const cachedServer = getCachedServer(state, state.formState.serverName);
        const serverFqdn =
            cachedServer?.fullyQualifiedDomainName ??
            `${state.formState.serverName}${getCloudProviderSettings().settings.sqlResource.dnsSuffix}`;
        const connectionDetails =
            await deploymentController.mainController.connectionManager.parseConnectionString(
                `Server=${serverFqdn};Database=${state.formState.databaseName}`,
            );

        const connectionProfile: IConnectionDialogProfile =
            await ConnectionCredentials.createConnectionInfo(connectionDetails);
        connectionProfile.profileName = state.formState.profileName || state.formState.databaseName;
        connectionProfile.groupId = state.formState.groupId;
        connectionProfile.authenticationType =
            state.formState.authenticationType === AuthenticationType.SqlLogin
                ? AuthenticationType.SqlLogin
                : AuthenticationType.AzureMFA;

        connectionProfile.accountId = state.formState.accountId;
        connectionProfile.tenantId = state.formState.tenantId;

        // Acquire an Entra SQL access token so the connection starts with a
        // valid token. The provisioning wizard authenticates through VS Code
        // accounts, so use that path directly.
        if (state.formState.authenticationType === AuthenticationType.AzureMFA) {
            const tokenInfo = await acquireTokenFromVscodeAccountForResource(
                getCloudResourceEndpoint("sqlResource"),
                state.formState.accountId,
                state.formState.tenantId,
            );
            connectionProfile.accountId = tokenInfo.account.id;
            connectionProfile.tenantId = tokenInfo.tenantId;
            connectionProfile.user = tokenInfo.account.label;
            connectionProfile.email = tokenInfo.session.account.label;
        }

        connectionProfile.user = state.formState.userName;
        connectionProfile.password = state.formState.password;
        connectionProfile.savePassword = state.formState.savePassword;

        // Probe connectivity with retries. On the first firewall error, extract
        // the client IP from the error message (same pattern as the connection
        // dialog's addFirewallRule flow) and create a firewall rule automatically.
        const maxRetries = 10;
        const retryDelayMs = 30_000;
        const connManager = deploymentController.mainController.connectionManager;
        const tempUri = `${state.formState.serverName}/${state.formState.databaseName}`;
        let firewallRuleCreated = false;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const success = await connManager.connect(
                tempUri,
                connectionProfile as IConnectionProfile,
                { shouldHandleErrors: false },
            );

            if (success) {
                // Probe succeeded — clean it up and proceed to full OE session
                await connManager.disconnect(tempUri);
                break;
            }

            // Check if the failure is firewall-related
            const connInfo = connManager.getConnectionInfo(tempUri);
            const isFirewallError = connInfo?.errorNumber === FIREWALL_ERROR_CODE;

            if (!isFirewallError || attempt === maxRetries) {
                // Non-firewall error or exhausted retries — report failure
                state.connectionLoadState = ApiStatus.Error;
                state.errorMessage = connInfo?.errorMessage || AzureSqlDatabase.connectionFailed;
                sendErrorEvent(
                    TelemetryViews.AzureSqlDatabase,
                    TelemetryActions.ConnectToAzureSqlDatabase,
                    new Error(AzureSqlDatabase.connectionFailed),
                    false,
                );
                updateAzureSqlDatabaseState(deploymentController, state);
                return;
            }

            // On the first firewall error, extract the client IP and create a rule
            if (!firewallRuleCreated) {
                const handleResult = await connManager.firewallService.handleFirewallRule(
                    connInfo?.errorNumber ?? Number(FIREWALL_ERROR_CODE),
                    connInfo?.errorMessage ?? "",
                );

                if (!handleResult.result || !handleResult.ipAddress) {
                    state.connectionLoadState = ApiStatus.Error;
                    state.errorMessage = AzureSqlDatabase.clientIpDetectionFailed;
                    cachedLogger?.error(
                        "Could not detect client IP from firewall error; manual firewall rule required.",
                    );
                    sendErrorEvent(
                        TelemetryViews.AzureSqlDatabase,
                        TelemetryActions.ConnectToAzureSqlDatabase,
                        new Error("Failed to detect client IP for firewall rule"),
                        false,
                    );
                    updateAzureSqlDatabaseState(deploymentController, state);
                    return;
                }

                const clientIp = handleResult.ipAddress;
                state.publicIp = clientIp;
                updateAzureSqlDatabaseState(deploymentController, state);

                const subscription = getCachedSubscription(state, state.formState.subscriptionId);
                if (!subscription) {
                    throw new Error(AzureSqlDatabase.noSubscriptionsFound);
                }

                try {
                    await VsCodeAzureHelper.createFirewallRule(
                        subscription,
                        state.formState.resourceGroup,
                        state.formState.serverName,
                        `mssql-${state.formState.serverName}-firewall-rule`,
                        clientIp,
                        clientIp,
                    );
                } catch (firewallError) {
                    const errorMsg =
                        firewallError instanceof Error
                            ? firewallError.message
                            : String(firewallError);
                    state.connectionLoadState = ApiStatus.Error;
                    state.errorMessage = AzureSqlDatabase.firewallRuleCreationFailed(errorMsg);
                    cachedLogger?.error(`Failed to create firewall rule: ${errorMsg}`);
                    sendErrorEvent(
                        TelemetryViews.AzureSqlDatabase,
                        TelemetryActions.ConnectToAzureSqlDatabase,
                        new Error(`Firewall rule creation failed: ${errorMsg}`),
                        false,
                    );
                    updateAzureSqlDatabaseState(deploymentController, state);
                    return;
                }
                firewallRuleCreated = true;
            }

            cachedLogger?.trace(
                `Connection attempt ${attempt}/${maxRetries} failed (firewall not yet propagated), retrying in ${retryDelayMs / 1000}s...`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }

        // Firewall is propagated — create the full OE session
        const profile = await connManager.connectionUI.saveProfile(
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
            err instanceof Error ? err : new Error(String(err)),
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

    azureSqlState.accounts = await VsCodeAzureHelper.getAccounts();
    clearCacheDownstream(azureSqlState, "accountId");

    accountComponent.options = azureSqlState.accounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));
    accountComponent.actionButtons = await getAzureActionButton(deploymentController);

    if (azureSqlState.accounts.length === 0) {
        accountComponent.placeholder = AzureSqlDatabase.noAzureAccountsFound;
    }

    azureSqlState.formState.accountId =
        azureSqlState.accounts.length > 0 ? azureSqlState.accounts[0].id : "";
}

async function loadTenantComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const tenantComponent = azureSqlState.formComponents.tenantId;
    if (!tenantComponent) return;

    if (!azureSqlState.formState.accountId) {
        azureSqlState.azureComponentStatuses["tenantId"] = ApiStatus.Error;
        tenantComponent.placeholder = AzureSqlDatabase.noTenantsFound;
        return;
    }

    azureSqlState.tenants = await VsCodeAzureHelper.getTenantsForAccount(
        azureSqlState.formState.accountId,
    );
    clearCacheDownstream(azureSqlState, "tenantId");

    tenantComponent.options = azureSqlState.tenants.map((t) => ({
        displayName: t.displayName,
        value: t.tenantId,
    }));
    tenantComponent.placeholder =
        azureSqlState.tenants.length > 0
            ? ConnectionDialog.selectATenant
            : AzureSqlDatabase.noTenantsFound;

    azureSqlState.formState.tenantId = getDefaultTenantId(
        azureSqlState.formState.accountId,
        azureSqlState.tenants,
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

    const tenant = getCachedTenant(azureSqlState, azureSqlState.formState.tenantId);
    if (!tenant) {
        azureSqlState.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
        subscriptionComponent.placeholder = AzureSqlDatabase.noSubscriptionsFound;
        return;
    }

    azureSqlState.subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
    clearCacheDownstream(azureSqlState, "subscriptionId");

    subscriptionComponent.options = azureSqlState.subscriptions.map((sub) => ({
        displayName: `${sub.name} (${sub.subscriptionId})`,
        value: sub.subscriptionId,
    }));
    subscriptionComponent.placeholder =
        azureSqlState.subscriptions.length > 0
            ? AzureSqlDatabase.selectASubscription
            : AzureSqlDatabase.noSubscriptionsFound;

    azureSqlState.formState.subscriptionId =
        azureSqlState.subscriptions.length > 0 ? azureSqlState.subscriptions[0].subscriptionId : "";

    // Load maintenance configurations for the selected subscription
    void loadMaintenanceConfigs(azureSqlState);
}

async function loadMaintenanceConfigs(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const maintenanceComponent = azureSqlState.formComponents.maintenanceConfig;
    if (!maintenanceComponent) return;

    azureSqlState.azureComponentStatuses["maintenanceConfig"] = ApiStatus.Loading;

    const subscription = getCachedSubscription(
        azureSqlState,
        azureSqlState.formState.subscriptionId,
    );
    if (!subscription) {
        maintenanceComponent.options = [];
        azureSqlState.azureComponentStatuses["maintenanceConfig"] = ApiStatus.Error;
        return;
    }

    const configs = await VsCodeAzureHelper.fetchPublicMaintenanceConfigurations(subscription);
    azureSqlState.maintenanceConfigs = configs
        .filter((c) => c.name && c.id)
        .map((c) => ({ name: c.name!, id: c.id! }));

    maintenanceComponent.options = azureSqlState.maintenanceConfigs.map((c) => ({
        displayName: c.name,
        value: c.id,
    }));
    maintenanceComponent.placeholder = AzureSqlDatabase.selectMaintenanceWindow;
    azureSqlState.azureComponentStatuses["maintenanceConfig"] = ApiStatus.Loaded;

    // Default to SQL_Default if available and user hasn't already selected a value
    const defaultConfig = azureSqlState.maintenanceConfigs.find((c) => c.name === "SQL_Default");
    if (defaultConfig && !azureSqlState.formState.maintenanceConfig) {
        azureSqlState.formState.maintenanceConfig = defaultConfig.id;
    }
}

async function loadResourceGroupComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const resourceGroupComponent = azureSqlState.formComponents.resourceGroup;
    if (!resourceGroupComponent) return;

    if (!azureSqlState.formState.subscriptionId || !azureSqlState.formState.tenantId) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    const subscription = getCachedSubscription(
        azureSqlState,
        azureSqlState.formState.subscriptionId,
    );
    if (!subscription) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    azureSqlState.resourceGroups =
        await VsCodeAzureHelper.getResourceGroupsForSubscription(subscription);
    clearCacheDownstream(azureSqlState, "resourceGroup");

    resourceGroupComponent.options = azureSqlState.resourceGroups.map((name) => ({
        displayName: name,
        value: name,
    }));
    resourceGroupComponent.placeholder =
        azureSqlState.resourceGroups.length > 0
            ? AzureSqlDatabase.selectAResourceGroup
            : AzureSqlDatabase.noResourceGroupsFound;

    // Preserve the current selection if it exists in the loaded list (e.g., after creating a new one)
    const currentRg = azureSqlState.formState.resourceGroup;
    if (currentRg && azureSqlState.resourceGroups.includes(currentRg)) {
        azureSqlState.formState.resourceGroup = currentRg;
    } else {
        azureSqlState.formState.resourceGroup =
            azureSqlState.resourceGroups.length > 0 ? azureSqlState.resourceGroups[0] : "";
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

    const subscription = getCachedSubscription(
        azureSqlState,
        azureSqlState.formState.subscriptionId,
    );
    if (!subscription) {
        azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.Error;
        serverComponent.placeholder = AzureSqlDatabase.noServersFound;
        return;
    }

    azureSqlState.servers = await VsCodeAzureHelper.getSqlServersForResourceGroup(
        subscription,
        azureSqlState.formState.resourceGroup,
    );

    serverComponent.options = azureSqlState.servers.map((s) => ({
        displayName: s.name ?? "",
        value: s.name ?? "",
    }));
    serverComponent.placeholder =
        azureSqlState.servers.length > 0
            ? AzureSqlDatabase.selectAServer
            : AzureSqlDatabase.noServersFound;

    // Preserve the current selection if it exists in the loaded list (e.g., after creating a new one)
    const currentServer = azureSqlState.formState.serverName;
    const matchedServer = currentServer
        ? azureSqlState.servers.find((s) => s.name === currentServer)
        : undefined;
    if (matchedServer) {
        azureSqlState.formState.serverName = currentServer;
    } else {
        azureSqlState.formState.serverName =
            azureSqlState.servers.length > 0 ? (azureSqlState.servers[0].name ?? "") : "";
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
            try {
                await VsCodeAzureHelper.signIn(true);
            } catch {
                cachedLogger?.error("Azure sign-in was canceled or failed.");
                return;
            }
            const currentState = deploymentController.state
                .deploymentTypeState as asd.AzureSqlDatabaseState;
            const accountsComponent = currentState.formComponents.accountId;
            if (!accountsComponent) {
                cachedLogger?.error("Account component not found");
                return;
            }
            const previousAccountIds = new Set(currentState.accounts.map((a) => a.id));
            currentState.accounts = await VsCodeAzureHelper.getAccounts();
            clearCacheDownstream(currentState, "accountId");
            accountsComponent.options = currentState.accounts.map((account) => ({
                displayName: account.label,
                value: account.id,
            }));

            // Auto-select the newly added account, or keep the first one
            const newAccount = currentState.accounts.find((a) => !previousAccountIds.has(a.id));
            currentState.formState.accountId =
                newAccount?.id ??
                (currentState.accounts.length > 0 ? currentState.accounts[0].id : "");

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
            componentWidth: "320px",
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
        dataSource: createFormItem({
            propertyName: "dataSource",
            label: AzureSqlDatabase.dataSource,
            type: FormItemType.Dropdown,
            isAdvancedOption: true,
            options: DATA_SOURCE_OPTIONS,
            placeholder: AzureSqlDatabase.selectDataSource,
        }),
        collation: createFormItem({
            propertyName: "collation",
            label: AzureSqlDatabase.collation,
            type: FormItemType.SearchableDropdown,
            isAdvancedOption: true,
            options: COLLATION_OPTIONS.map((c) => ({ displayName: c, value: c })),
            placeholder: AzureSqlDatabase.selectCollation,
        }),
        maintenanceConfig: createFormItem({
            propertyName: "maintenanceConfig",
            label: AzureSqlDatabase.maintenanceWindow,
            type: FormItemType.SearchableDropdown,
            isAdvancedOption: true,
            options: [],
            placeholder: AzureSqlDatabase.selectMaintenanceWindow,
        }),
        enableAlwaysEncrypted: createFormItem({
            propertyName: "enableAlwaysEncrypted",
            label: AzureSqlDatabase.enableAlwaysEncrypted,
            type: FormItemType.Checkbox,
            isAdvancedOption: true,
            componentWidth: "350px",
        }),
        maxVcores: createFormItem({
            propertyName: "maxVcores",
            label: AzureSqlDatabase.maxVcores,
            type: FormItemType.Dropdown,
            options: [
                { displayName: "1", value: "1" },
                { displayName: "2", value: "2" },
                { displayName: "4", value: "4" },
            ],
            isAdvancedOption: true,
            placeholder: AzureSqlDatabase.selectMaxVcores,
        }),
    };
}
