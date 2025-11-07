/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    AddFirewallRuleContextProps,
    AddFirewallRuleReducers,
    AddFirewallRuleState,
} from "../../../../src/sharedInterfaces/addFirewallRule";
import { getCoreRPCs } from "../../common/utils";
import { FirewallRuleSpec } from "../../../sharedInterfaces/firewallRule";

const AddFirewallRuleContext = createContext<AddFirewallRuleContextProps | undefined>(undefined);

interface AddFirewallRuleProviderProps {
    children: React.ReactNode;
}

const AddFirewallRuleStateProvider: React.FC<AddFirewallRuleProviderProps> = ({ children }) => {
    const webviewContext = useVscodeWebview<AddFirewallRuleState, AddFirewallRuleReducers>();

    return (
        <AddFirewallRuleContext.Provider
            value={{
                state: webviewContext.state,
                themeKind: webviewContext.themeKind,
                keyBindings: webviewContext.keyBindings,
                ...getCoreRPCs(webviewContext),
                addFirewallRule: function (firewallRuleSpec: FirewallRuleSpec): void {
                    webviewContext?.extensionRpc.action("addFirewallRule", {
                        firewallRuleSpec,
                    });
                },
                closeDialog: function (): void {
                    webviewContext?.extensionRpc.action("closeDialog");
                },
                signIntoAzure: function (): void {
                    webviewContext?.extensionRpc.action("signIntoAzure");
                },
            }}>
            {children}
        </AddFirewallRuleContext.Provider>
    );
};

export { AddFirewallRuleContext, AddFirewallRuleStateProvider };
