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

            azureSqlState.formErrors = await deploymentController.validateDeploymentForm();
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
                const tenant = await VsCodeAzureHelper.getTenant(
                    azureSqlState.formState.accountId,
                    azureSqlState.formState.tenantId,
                );
                if (!tenant) {
                    throw new Error(AzureSqlDatabase.noTenantsFound);
                }
                const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
                const subscription = subscriptions.find(
                    (s) => s.subscriptionId === azureSqlState.formState.subscriptionId,
                );
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
        connectionProfile.authenticationType = AuthenticationType.AzureMFA;
        connectionProfile.accountId = state.formState.accountId;
        connectionProfile.tenantId = state.formState.tenantId;

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

    const azureAccounts = await VsCodeAzureHelper.getAccounts();
    accountComponent.options = azureAccounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));
    accountComponent.actionButtons = await getAzureActionButton(deploymentController);

    if (azureAccounts.length === 0) {
        accountComponent.placeholder = AzureSqlDatabase.noAzureAccountsFound;
    }

    azureSqlState.formState.accountId = azureAccounts.length > 0 ? azureAccounts[0].id : "";
}

async function loadTenantComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const tenantComponent = azureSqlState.formComponents.tenantId;
    if (!tenantComponent) return;

    if (!azureSqlState.formState.accountId) {
        azureSqlState.azureComponentStatuses["tenantId"] = ApiStatus.Error;
        tenantComponent.placeholder = AzureSqlDatabase.noTenantsFound;
        return;
    }

    const tenants = await VsCodeAzureHelper.getTenantsForAccount(azureSqlState.formState.accountId);

    tenantComponent.options = tenants.map((t) => ({
        displayName: t.displayName,
        value: t.tenantId,
    }));
    tenantComponent.placeholder =
        tenants.length > 0 ? ConnectionDialog.selectATenant : AzureSqlDatabase.noTenantsFound;

    azureSqlState.formState.tenantId = getDefaultTenantId(
        azureSqlState.formState.accountId,
        tenants,
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

    const tenant = await VsCodeAzureHelper.getTenant(
        azureSqlState.formState.accountId,
        azureSqlState.formState.tenantId,
    );

    if (!tenant) {
        azureSqlState.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
        subscriptionComponent.placeholder = AzureSqlDatabase.noSubscriptionsFound;
        return;
    }

    const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);

    subscriptionComponent.options = subscriptions.map((sub) => ({
        displayName: `${sub.name} (${sub.subscriptionId})`,
        value: sub.subscriptionId,
    }));
    subscriptionComponent.placeholder =
        subscriptions.length > 0
            ? AzureSqlDatabase.selectASubscription
            : AzureSqlDatabase.noSubscriptionsFound;

    azureSqlState.formState.subscriptionId =
        subscriptions.length > 0 ? subscriptions[0].subscriptionId : "";
}

async function loadResourceGroupComponent(azureSqlState: asd.AzureSqlDatabaseState): Promise<void> {
    const resourceGroupComponent = azureSqlState.formComponents.resourceGroup;
    if (!resourceGroupComponent) return;

    if (!azureSqlState.formState.subscriptionId || !azureSqlState.formState.tenantId) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    const tenant = await VsCodeAzureHelper.getTenant(
        azureSqlState.formState.accountId,
        azureSqlState.formState.tenantId,
    );
    if (!tenant) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
    const subscription = subscriptions.find(
        (s) => s.subscriptionId === azureSqlState.formState.subscriptionId,
    );
    if (!subscription) {
        azureSqlState.azureComponentStatuses["resourceGroup"] = ApiStatus.Error;
        resourceGroupComponent.placeholder = AzureSqlDatabase.noResourceGroupsFound;
        return;
    }

    const resourceGroups = await VsCodeAzureHelper.getResourceGroupsForSubscription(subscription);

    resourceGroupComponent.options = resourceGroups.map((name) => ({
        displayName: name,
        value: name,
    }));
    resourceGroupComponent.placeholder =
        resourceGroups.length > 0
            ? AzureSqlDatabase.selectAResourceGroup
            : AzureSqlDatabase.noResourceGroupsFound;

    azureSqlState.formState.resourceGroup = resourceGroups.length > 0 ? resourceGroups[0] : "";
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

    const tenant = await VsCodeAzureHelper.getTenant(
        azureSqlState.formState.accountId,
        azureSqlState.formState.tenantId,
    );
    if (!tenant) {
        azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.Error;
        serverComponent.placeholder = AzureSqlDatabase.noServersFound;
        return;
    }

    const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
    const subscription = subscriptions.find(
        (s) => s.subscriptionId === azureSqlState.formState.subscriptionId,
    );
    if (!subscription) {
        azureSqlState.azureComponentStatuses["serverName"] = ApiStatus.Error;
        serverComponent.placeholder = AzureSqlDatabase.noServersFound;
        return;
    }

    const servers = await VsCodeAzureHelper.getSqlServersForResourceGroup(
        subscription,
        azureSqlState.formState.resourceGroup,
    );

    serverComponent.options = servers.map((s) => ({
        displayName: s.name ?? "",
        value: s.name ?? "",
    }));
    serverComponent.placeholder =
        servers.length > 0 ? AzureSqlDatabase.selectAServer : AzureSqlDatabase.noServersFound;

    azureSqlState.formState.serverName = servers.length > 0 ? (servers[0].name ?? "") : "";
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
            const azureAccounts = await VsCodeAzureHelper.getAccounts();
            accountsComponent.options = azureAccounts.map((account) => ({
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
