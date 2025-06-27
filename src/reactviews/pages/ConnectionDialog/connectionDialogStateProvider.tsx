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
} from "../../../sharedInterfaces/connectionDialog";

import { FirewallRuleSpec } from "../../../sharedInterfaces/firewallRule";

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";

const ConnectionDialogContext = createContext<ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogProviderProps {
    children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogProviderProps> = ({ children }) => {
    const webviewContext = useVscodeWebview<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();
    const state = webviewContext?.state;
    return (
        <ConnectionDialogContext.Provider
            value={{
                state: state,
                themeKind: webviewContext?.themeKind,
                ...getCoreRPCs(webviewContext),
                loadConnection: function (connection: IConnectionDialogProfile): void {
                    webviewContext?.extensionRpc.action("loadConnection", {
                        connection: connection,
                    });
                },
                formAction: function (event): void {
                    webviewContext?.extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                setConnectionInputType: function (inputMode: ConnectionInputMode): void {
                    webviewContext?.extensionRpc.action("setConnectionInputType", {
                        inputMode: inputMode,
                    });
                },
                connect: function (): void {
                    webviewContext?.extensionRpc.action("connect");
                },
                loadAzureServers: function (subscriptionId: string): void {
                    webviewContext?.extensionRpc.action("loadAzureServers", {
                        subscriptionId: subscriptionId,
                    });
                },
                addFirewallRule: function (firewallRuleSpec: FirewallRuleSpec): void {
                    webviewContext?.extensionRpc.action("addFirewallRule", {
                        firewallRuleSpec,
                    });
                },
                createConnectionGroup: function (connectionGroupSpec: ConnectionGroupSpec): void {
                    webviewContext.extensionRpc.action("createConnectionGroup", {
                        connectionGroupSpec,
                    });
                },
                openCreateConnectionGroupDialog: function (): void {
                    webviewContext.extensionRpc.action("openCreateConnectionGroupDialog");
                },
                closeDialog: function (): void {
                    webviewContext?.extensionRpc.action("closeDialog");
                },
                filterAzureSubscriptions: function (): void {
                    webviewContext.extensionRpc.action("filterAzureSubscriptions");
                },
                refreshConnectionsList: function (): void {
                    webviewContext.extensionRpc.action("refreshConnectionsList");
                },
                deleteSavedConnection: function (connection: IConnectionDialogProfile): void {
                    webviewContext.extensionRpc.action("deleteSavedConnection", {
                        connection: connection,
                    });
                },
                removeRecentConnection: function (connection: IConnectionDialogProfile): void {
                    webviewContext.extensionRpc.action("removeRecentConnection", {
                        connection: connection,
                    });
                },
                loadFromConnectionString: function (connectionString: string): void {
                    webviewContext.extensionRpc.action("loadFromConnectionString", {
                        connectionString: connectionString,
                    });
                },
                openConnectionStringDialog: function (): void {
                    webviewContext.extensionRpc.action("openConnectionStringDialog");
                },
                getConnectionDisplayName: async function (
                    connectionProfile: IConnectionDialogProfile,
                ): Promise<string> {
                    return await webviewContext.extensionRpc.sendRequest(
                        GetConnectionDisplayNameRequest.type,
                        connectionProfile,
                    );
                },
                signIntoAzureForFirewallRule: function (): void {
                    webviewContext.extensionRpc.action("signIntoAzureForFirewallRule");
                },
            }}>
            {children}
        </ConnectionDialogContext.Provider>
    );
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };
