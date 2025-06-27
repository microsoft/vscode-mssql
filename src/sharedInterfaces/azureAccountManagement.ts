/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Define types for state and reducers
export interface AzureAccountManagementState {
    message: string;
    accounts: IMssqlAzureAccount[]; // List of active Azure accounts with ID and label
    selectedAccount?: IMssqlAzureAccount; // Currently selected account ID
    isLoading?: boolean; // Loading state for operations
    tenants: IMssqlAzureTenant[]; // List of tenants for selected account
    selectedTenant?: IMssqlAzureTenant; // Currently selected tenant
    isLoadingTenants?: boolean; // Loading state for tenant operations
    subscriptions: IMssqlAzureSubscription[]; // List of subscriptions for selected tenant
    selectedSubscription?: IMssqlAzureSubscription; // Currently selected subscription
}

export interface IMssqlAzureAccount {
    accountId: string;
    displayName: string;
}

export interface IMssqlAzureTenant {
    tenantId: string;
    displayName: string;
}

export interface IMssqlAzureSubscription {
    subscriptionId: string;
    displayName: string;
}

export interface AzureAccountManagementReducers {
    closeDialog: {};
    signIntoAzureAccount: {};
    selectAccount: { accountId: string }; // account ID
    loadTenants: { accountId: string };
    selectTenant: { tenantId: string };
    selectSubscription: { subscriptionId: string };
}
