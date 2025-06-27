/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";
import {
    AzureAccountManagementState,
    AzureAccountManagementReducers,
} from "../../../sharedInterfaces/azureAccountManagement";

// Define context props that will be passed to components
export interface AzureAccountManagementContextProps
    extends WebviewContextProps<AzureAccountManagementState> {
    closeDialog: () => void;
    signIntoAzureAccount: () => void;
    selectAccount: (account: string) => void;
    loadTenants: (accountId: string) => void;
    selectTenant: (tenantId: string) => void;
    selectSubscription: (subscriptionId: string) => void;
}

// Create context
const AzureAccountManagementContext = createContext<AzureAccountManagementContextProps | undefined>(
    undefined,
);

// Props for provider component
interface AzureAccountManagementProviderProps {
    children: React.ReactNode;
}

// State provider component
const AzureAccountManagementStateProvider: React.FC<AzureAccountManagementProviderProps> = ({
    children,
}) => {
    const context = useVscodeWebview<AzureAccountManagementState, AzureAccountManagementReducers>();
    const state = context?.state;

    if (!context) {
        return undefined;
    }

    return (
        <AzureAccountManagementContext.Provider
            value={{
                state: state,
                themeKind: context?.themeKind,
                ...getCoreRPCs(context),
                closeDialog: () => {
                    context.extensionRpc.action("closeDialog");
                },
                signIntoAzureAccount: () => {
                    context.extensionRpc.action("signIntoAzureAccount");
                },
                selectAccount: (accountId: string) => {
                    context.extensionRpc.action("selectAccount", { accountId });
                },
                loadTenants: (accountId: string) => {
                    context.extensionRpc.action("loadTenants", { accountId });
                },
                selectTenant: (tenantId: string) => {
                    context.extensionRpc.action("selectTenant", { tenantId });
                },
                selectSubscription: (subscriptionId: string) => {
                    context.extensionRpc.action("selectSubscription", { subscriptionId });
                },
            }}>
            {children}
        </AzureAccountManagementContext.Provider>
    );
};

export { AzureAccountManagementContext, AzureAccountManagementStateProvider };
