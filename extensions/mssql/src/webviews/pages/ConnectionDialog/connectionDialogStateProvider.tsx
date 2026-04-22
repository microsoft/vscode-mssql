/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";
import {
    ConnectionDialogContextProps,
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    GetConnectionDisplayNameRequest,
    GetSqlAnalyticsEndpointUriFromFabricRequest,
    IConnectionDialogProfile,
    OpenOptionInfoLinkNotification,
} from "../../../sharedInterfaces/connectionDialog";
import { FirewallRuleSpec } from "../../../sharedInterfaces/firewallRule";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";
import { SqlDbInfo } from "../../../sharedInterfaces/fabric";
import {
    ChangePasswordResult,
    ChangePasswordWebviewRequest,
} from "../../../sharedInterfaces/changePassword";
import { FormItemOptions } from "../../../sharedInterfaces/form";

const ConnectionDialogContext = createContext<ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogProviderProps {
    children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();

    const commands = useMemo<ConnectionDialogContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            loadConnectionForEdit: function (connection: IConnectionDialogProfile): void {
                extensionRpc.action("loadConnectionForEdit", {
                    connection: connection,
                });
            },
            loadConnectionAsNewDraft: function (connection: IConnectionDialogProfile): void {
                extensionRpc.action("loadConnectionAsNewDraft", {
                    connection: connection,
                });
            },
            formAction: function (event): void {
                extensionRpc.action("formAction", {
                    event: event,
                });
            },
            setConnectionInputType: function (inputMode: ConnectionInputMode): void {
                extensionRpc.action("setConnectionInputType", {
                    inputMode: inputMode,
                });
            },
            connect: function (): void {
                extensionRpc.action("connect");
            },
            testConnection: function (): void {
                extensionRpc.action("testConnection");
            },
            saveWithoutConnecting: function (): void {
                extensionRpc.action("saveWithoutConnecting");
            },
            retryLastSubmitAction: function (): void {
                extensionRpc.action("retryLastSubmitAction");
            },
            loadAzureServers: function (subscriptionId: string): void {
                extensionRpc.action("loadAzureServers", {
                    subscriptionId: subscriptionId,
                });
            },
            addFirewallRule: function (firewallRuleSpec: FirewallRuleSpec): void {
                extensionRpc.action("addFirewallRule", {
                    firewallRuleSpec,
                });
            },
            createConnectionGroup: function (connectionGroupSpec: ConnectionGroupSpec): void {
                extensionRpc.action("createConnectionGroup", {
                    connectionGroupSpec,
                });
            },
            openCreateConnectionGroupDialog: function (): void {
                extensionRpc.action("openCreateConnectionGroupDialog");
            },
            closeDialog: function (): void {
                extensionRpc.action("closeDialog");
            },
            closeMessage: function (): void {
                extensionRpc.action("closeMessage");
            },
            filterAzureSubscriptions: function (): void {
                extensionRpc.action("filterAzureSubscriptions");
            },
            refreshConnectionsList: function (): void {
                extensionRpc.action("refreshConnectionsList");
            },
            deleteSavedConnection: function (connection: IConnectionDialogProfile): void {
                extensionRpc.action("deleteSavedConnection", {
                    connection: connection,
                });
            },
            removeRecentConnection: function (connection: IConnectionDialogProfile): void {
                extensionRpc.action("removeRecentConnection", {
                    connection: connection,
                });
            },
            loadFromConnectionString: function (connectionString: string): void {
                extensionRpc.action("loadFromConnectionString", {
                    connectionString: connectionString,
                });
            },
            openConnectionStringDialog: function (): void {
                extensionRpc.action("openConnectionStringDialog");
            },
            signIntoAzureForFirewallRule: function (): void {
                extensionRpc.action("signIntoAzureForFirewallRule");
            },
            signIntoAzureForBrowse: function (
                browseTarget: ConnectionInputMode.AzureBrowse | ConnectionInputMode.FabricBrowse,
            ): void {
                extensionRpc.action("signIntoAzureForBrowse", {
                    browseTarget,
                });
            },
            signIntoAzureTenantForBrowse: function (): void {
                extensionRpc.action("signIntoAzureTenantForBrowse");
            },
            selectAzureAccount: (accountId: string) => {
                extensionRpc.action("selectAzureAccount", {
                    accountId,
                });
            },
            selectAzureTenant: (tenantId: string) => {
                extensionRpc.action("selectAzureTenant", {
                    tenantId,
                });
            },
            selectSqlCollection: (collectionId: string) => {
                extensionRpc.action("selectSqlCollection", {
                    collectionId,
                });
            },
            openInfoLink: (option: FormItemOptions) => {
                void extensionRpc.sendNotification(OpenOptionInfoLinkNotification.type, {
                    option,
                });
            },
            messageButtonClicked: (buttonId: string) => {
                extensionRpc.action("messageButtonClicked", {
                    buttonId,
                });
            },
            getConnectionDisplayName: async function (
                connectionProfile: IConnectionDialogProfile,
            ): Promise<string> {
                return await extensionRpc.sendRequest(
                    GetConnectionDisplayNameRequest.type,
                    connectionProfile,
                );
            },
            getSqlAnalyticsEndpointUriFromFabric: async function (
                sqlDb: SqlDbInfo,
            ): Promise<string> {
                return await extensionRpc.sendRequest(
                    GetSqlAnalyticsEndpointUriFromFabricRequest.type,
                    sqlDb,
                );
            },
            changePassword: async function (newPassword: string): Promise<ChangePasswordResult> {
                return await extensionRpc.sendRequest(
                    ChangePasswordWebviewRequest.type,
                    newPassword,
                );
            },
        }),
        [extensionRpc],
    );

    return (
        <ConnectionDialogContext.Provider value={commands}>
            {children}
        </ConnectionDialogContext.Provider>
    );
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };
