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
} from "../../../sharedInterfaces/connectionDialog";
import { FirewallRuleSpec } from "../../../sharedInterfaces/firewallRule";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";
import { FabricSqlDbInfo } from "../../../sharedInterfaces/fabric";
import {
    ChangePasswordResult,
    ChangePasswordWebviewRequest,
} from "../../../sharedInterfaces/changePassword";

const ConnectionDialogContext = createContext<ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogProviderProps {
    children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();

    const commands = useMemo<ConnectionDialogContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            loadConnection: function (connection: IConnectionDialogProfile): void {
                extensionRpc.action("loadConnection", {
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
            selectFabricWorkspace: (workspaceId: string) => {
                extensionRpc.action("selectFabricWorkspace", {
                    workspaceId,
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
                sqlDb: FabricSqlDbInfo,
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
