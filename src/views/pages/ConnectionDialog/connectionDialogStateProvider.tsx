/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ConnectionDialogContextProps,
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    GetConnectionDisplayNameRequest,
    IConnectionDialogProfile,
} from "../../../shared/connectionDialog";

import { FirewallRuleSpec } from "../../../shared/firewallRule";

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../shared/connectionGroup";

const ConnectionDialogContext = createContext<ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogProviderProps {
    children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<ConnectionDialogWebviewState, ConnectionDialogReducers>();
    const connectionDialogState = webviewState?.state;
    return (
        <ConnectionDialogContext.Provider
            value={{
                state: connectionDialogState,
                themeKind: webviewState?.themeKind,
                ...getCoreRPCs(webviewState),
                loadConnection: function (connection: IConnectionDialogProfile): void {
                    webviewState?.extensionRpc.action("loadConnection", {
                        connection: connection,
                    });
                },
                formAction: function (event): void {
                    webviewState?.extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                setConnectionInputType: function (inputMode: ConnectionInputMode): void {
                    webviewState?.extensionRpc.action("setConnectionInputType", {
                        inputMode: inputMode,
                    });
                },
                connect: function (): void {
                    webviewState?.extensionRpc.action("connect");
                },
                loadAzureServers: function (subscriptionId: string): void {
                    webviewState?.extensionRpc.action("loadAzureServers", {
                        subscriptionId: subscriptionId,
                    });
                },
                addFirewallRule: function (firewallRuleSpec: FirewallRuleSpec): void {
                    webviewState?.extensionRpc.action("addFirewallRule", {
                        firewallRuleSpec,
                    });
                },
                createConnectionGroup: function (connectionGroupSpec: ConnectionGroupSpec): void {
                    webviewState.extensionRpc.action("createConnectionGroup", {
                        connectionGroupSpec,
                    });
                },
                openCreateConnectionGroupDialog: function (): void {
                    webviewState.extensionRpc.action("openCreateConnectionGroupDialog");
                },
                closeDialog: function (): void {
                    webviewState?.extensionRpc.action("closeDialog");
                },
                filterAzureSubscriptions: function (): void {
                    webviewState.extensionRpc.action("filterAzureSubscriptions");
                },
                refreshConnectionsList: function (): void {
                    webviewState.extensionRpc.action("refreshConnectionsList");
                },
                deleteSavedConnection: function (connection: IConnectionDialogProfile): void {
                    webviewState.extensionRpc.action("deleteSavedConnection", {
                        connection: connection,
                    });
                },
                removeRecentConnection: function (connection: IConnectionDialogProfile): void {
                    webviewState.extensionRpc.action("removeRecentConnection", {
                        connection: connection,
                    });
                },
                loadFromConnectionString: function (connectionString: string): void {
                    webviewState.extensionRpc.action("loadFromConnectionString", {
                        connectionString: connectionString,
                    });
                },
                openConnectionStringDialog: function (): void {
                    webviewState.extensionRpc.action("openConnectionStringDialog");
                },
                getConnectionDisplayName: async function (
                    connectionProfile: IConnectionDialogProfile,
                ): Promise<string> {
                    return await webviewState.extensionRpc.sendRequest(
                        GetConnectionDisplayNameRequest.type,
                        connectionProfile,
                    );
                },
                signIntoAzureForFirewallRule: function (): void {
                    webviewState.extensionRpc.action("signIntoAzureForFirewallRule");
                },
            }}>
            {children}
        </ConnectionDialogContext.Provider>
    );
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };
