/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormItemActionButton } from "../sharedInterfaces/form";
import {
    DisasterRecoveryAzureFormState,
    DisasterRecoveryViewModel,
    ObjectManagementWebviewState,
} from "../sharedInterfaces/objectManagement";
import * as LocConstants from "../constants/locConstants";
import { getDefaultTenantId, VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { ApiStatus } from "../sharedInterfaces/webview";
import { BlobContainer, StorageAccount } from "@azure/arm-storage";

export async function getAzureActionButton(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
): Promise<FormItemActionButton[]> {
    const accountFormComponentId = "accountId";

    const actionButtons: FormItemActionButton[] = [];
    actionButtons.push({
        label:
            state.formState.accountId === ""
                ? LocConstants.ConnectionDialog.signIn
                : LocConstants.ConnectionDialog.addAccount,
        id: "azureSignIn",
        callback: async () => {
            // Force sign in prompt
            await VsCodeAzureHelper.signIn(true);

            const accountsComponent = state.formComponents[accountFormComponentId];

            const azureAccounts = await VsCodeAzureHelper.getAccounts();
            accountsComponent.options = azureAccounts.map((account) => ({
                displayName: account.label,
                value: account.id,
            }));

            // There should always be at least one account, because the user just went through the sign in workflow
            if (azureAccounts.length !== 0) {
                state.formState.accountId = azureAccounts[azureAccounts.length - 1].id;
            }

            const accountComponent = state.formComponents["accountId"];
            accountComponent.actionButtons = await getAzureActionButton(state);
        },
    });
    return actionButtons;
}

/**
 * Loads the Azure Account component options
 * @param state Current backup database state
 * @returns Updated backup database state with account component options loaded
 */
export async function loadAccountComponent(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
): Promise<ObjectManagementWebviewState<DisasterRecoveryAzureFormState>> {
    const accountComponent = state.formComponents["accountId"];
    const azureAccounts = await VsCodeAzureHelper.getAccounts();
    const azureAccountOptions = azureAccounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));
    state.formState.accountId = azureAccounts.length > 0 ? azureAccounts[0].id : "";

    accountComponent.options = azureAccountOptions;
    accountComponent.actionButtons = await getAzureActionButton(state);

    return state;
}

/**
 * Loads the Azure tenant options
 * @param state Current backup database state
 * @returns Updated backup database state with tenant component options loaded
 */
export async function loadTenantComponent(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
): Promise<ObjectManagementWebviewState<DisasterRecoveryAzureFormState>> {
    const viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    const tenantComponent = state.formComponents["tenantId"];

    // If no account selected, set error state and return
    if (!state.formState.accountId) {
        viewModel.azureComponentStatuses["tenantId"] = ApiStatus.Error;
        tenantComponent.placeholder = LocConstants.BackupDatabase.noTenantsFound;
        return state;
    }

    // Load tenants for selected account
    const tenants = await VsCodeAzureHelper.getTenantsForAccount(state.formState.accountId);
    const tenantOptions = tenants.map((tenant) => ({
        displayName: tenant.displayName,
        value: tenant.tenantId,
    }));

    // Set associated state values
    tenantComponent.options = tenantOptions;
    tenantComponent.placeholder = tenants.length
        ? LocConstants.ConnectionDialog.selectATenant
        : LocConstants.BackupDatabase.noTenantsFound;
    state.formState.tenantId = getDefaultTenantId(state.formState.accountId, tenants);
    viewModel.tenants = tenants;

    state.viewModel.model = viewModel as any;
    return state;
}

/**
 * Loads the Azure subscription options
 * @param state Current backup database state
 * @returns Updated backup database state with subscription component options loaded
 */
export async function loadSubscriptionComponent(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
): Promise<ObjectManagementWebviewState<DisasterRecoveryAzureFormState>> {
    const viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    const subscriptionComponent = state.formComponents["subscriptionId"];

    // if no tenant selected, set error state and return
    if (!state.formState.tenantId) {
        viewModel.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
        subscriptionComponent.placeholder = LocConstants.BackupDatabase.noSubscriptionsFound;
        return state;
    }

    // Load subscriptions for selected tenant
    const tenant = viewModel.tenants.find((t) => t.tenantId === state.formState.tenantId);
    const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
    const subscriptionOptions = subscriptions.map((subscription) => ({
        displayName: subscription.name,
        value: subscription.subscriptionId,
    }));

    // Set associated state values
    subscriptionComponent.options = subscriptionOptions;
    state.formState.subscriptionId =
        subscriptionOptions.length > 0 ? subscriptionOptions[0].value : "";
    subscriptionComponent.placeholder = subscriptions.length
        ? LocConstants.BackupDatabase.selectASubscription
        : LocConstants.BackupDatabase.noSubscriptionsFound;
    viewModel.subscriptions = subscriptions;

    state.viewModel.model = viewModel as any;
    return state;
}

/**
 * Loads the Azure storage account options
 * @param state Current backup database state
 * @returns Updated backup database state with storage account component options loaded
 */
export async function loadStorageAccountComponent(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
): Promise<ObjectManagementWebviewState<DisasterRecoveryAzureFormState>> {
    const viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    const storageAccountComponent = state.formComponents["storageAccountId"];

    // if no subscription selected, set error state and return
    if (!state.formState.subscriptionId) {
        viewModel.azureComponentStatuses["storageAccountId"] = ApiStatus.Error;
        storageAccountComponent.placeholder = LocConstants.BackupDatabase.noStorageAccountsFound;
        return state;
    }

    // Load storage accounts for selected subscription
    const subscription = viewModel.subscriptions.find(
        (s) => s.subscriptionId === state.formState.subscriptionId,
    );
    let storageAccounts: StorageAccount[] = [];
    try {
        storageAccounts = await VsCodeAzureHelper.fetchStorageAccountsForSubscription(subscription);
    } catch (error) {
        state.errorMessage = error.message;
    }
    const storageAccountOptions = storageAccounts.map((account) => ({
        displayName: account.name,
        value: account.id,
    }));

    // Set associated state values
    storageAccountComponent.options = storageAccountOptions;
    state.formState.storageAccountId =
        storageAccountOptions.length > 0 ? storageAccountOptions[0].value : "";
    storageAccountComponent.placeholder =
        storageAccounts.length > 0
            ? LocConstants.BackupDatabase.selectAStorageAccount
            : LocConstants.BackupDatabase.noStorageAccountsFound;
    viewModel.storageAccounts = storageAccounts;

    state.viewModel.model = viewModel as any;
    return state;
}

/**
 * Loads the Azure blob container options
 * @param state Current backup database state
 * @returns Updated backup database state with blob container component options loaded
 */
export async function loadBlobContainerComponent(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
): Promise<ObjectManagementWebviewState<DisasterRecoveryAzureFormState>> {
    const viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    const blobContainerComponent = state.formComponents["blobContainerId"];

    // if no storage account or subscription selected, set error state and return
    if (!state.formState.storageAccountId || !state.formState.subscriptionId) {
        viewModel.azureComponentStatuses["blobContainerId"] = ApiStatus.Error;
        blobContainerComponent.placeholder = LocConstants.BackupDatabase.noBlobContainersFound;
        return state;
    }

    // Load blob containers for selected storage account and subscription
    const subscription = viewModel.subscriptions.find(
        (s) => s.subscriptionId === state.formState.subscriptionId,
    );
    const storageAccount = viewModel.storageAccounts.find(
        (sa) => sa.id === state.formState.storageAccountId,
    );

    let blobContainers: BlobContainer[] = [];
    try {
        blobContainers = await VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
            subscription,
            storageAccount,
        );
    } catch (error) {
        state.errorMessage = error.message;
    }

    const blobContainerOptions = blobContainers.map((container) => ({
        displayName: container.name,
        value: container.id,
    }));

    // Set associated state values
    blobContainerComponent.options = blobContainerOptions;
    state.formState.blobContainerId =
        blobContainers.length > 0 ? blobContainerOptions[0].value : "";
    blobContainerComponent.placeholder =
        blobContainers.length > 0
            ? LocConstants.BackupDatabase.selectABlobContainer
            : LocConstants.BackupDatabase.noBlobContainersFound;
    viewModel.blobContainers = blobContainers;

    state.viewModel.model = viewModel as any;
    return state;
}

/**
 * Reloads Azure components starting from the specified component
 * @param state Current backup database state
 * @param formComponent Component ID to start reloading from
 * @returns Updated backup database state with components reloaded
 */
export function reloadAzureComponents(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
    formComponent: string,
): ObjectManagementWebviewState<DisasterRecoveryAzureFormState> {
    const viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    const azureComponents = Object.keys(viewModel.azureComponentStatuses);
    const reloadComponentsFromIndex = azureComponents.indexOf(formComponent) + 1;

    // for every component after the formComponent, set status to NotStarted to trigger reload
    for (let i = reloadComponentsFromIndex; i < azureComponents.length; i++) {
        viewModel.azureComponentStatuses[azureComponents[i]] = ApiStatus.NotStarted;
        state.formComponents[azureComponents[i]].options = [];
        state.formState[azureComponents[i]] = "";
    }

    state.viewModel.model = viewModel as any;
    return state;
}

export async function loadAzureComponentHelper(
    state: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
    payload: { componentName: string },
) {
    let viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    // Only start loading if not already started
    if (viewModel.azureComponentStatuses[payload.componentName] !== ApiStatus.NotStarted)
        return state;

    switch (payload.componentName) {
        case "accountId":
            state = await loadAccountComponent(state);
            break;
        case "tenantId":
            state = await loadTenantComponent(state);
            break;
        case "subscriptionId":
            state = await loadSubscriptionComponent(state);
            break;
        case "storageAccountId":
            state = await loadStorageAccountComponent(state);
            break;
        case "blobContainerId":
            state = await loadBlobContainerComponent(state);
            break;
        default:
            return state;
    }

    viewModel = state.viewModel.model as unknown as DisasterRecoveryViewModel;
    viewModel.azureComponentStatuses[payload.componentName] = ApiStatus.Loaded;
    state.viewModel.model = viewModel as any;

    return state;
}
