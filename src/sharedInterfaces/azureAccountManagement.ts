/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Define types for state and reducers
export interface AzureAccountManagementState {
    message: string;
    accounts: string[]; // List of active Azure accounts
    isLoading?: boolean; // Loading state for operations
    selectedAccount?: string; // Currently selected account
}

export interface AzureAccountManagementReducers {
    closeDialog: {};
    signIntoAzureAccount: {};
    selectAccount: { account: string };
}
