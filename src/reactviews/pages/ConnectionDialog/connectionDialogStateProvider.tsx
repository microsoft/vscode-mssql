/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ConnectionDialogContextProps,
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";

import { FirewallRuleSpec } from "../../../sharedInterfaces/firewallRule";

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";

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
                    const result = await webviewState.extensionRpc.call(
                        "getConnectionDisplayName",
                        connectionProfile,
                    );
                    return result as string;
                },
            }}>
            {children}
        </ConnectionDialogContext.Provider>
    );
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };
