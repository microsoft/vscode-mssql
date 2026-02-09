/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useMemo } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider2";
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
    const { extensionRpc } = useVscodeWebview<AddFirewallRuleState, AddFirewallRuleReducers>();

    const commands = useMemo<AddFirewallRuleContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            addFirewallRule: function (firewallRuleSpec: FirewallRuleSpec): void {
                extensionRpc.action("addFirewallRule", {
                    firewallRuleSpec,
                });
            },
            closeDialog: function (): void {
                extensionRpc.action("closeDialog");
            },
            signIntoAzure: function (): void {
                extensionRpc.action("signIntoAzure");
            },
        }),
        [extensionRpc],
    );

    return (
        <AddFirewallRuleContext.Provider value={commands}>
            {children}
        </AddFirewallRuleContext.Provider>
    );
};

export { AddFirewallRuleContext, AddFirewallRuleStateProvider };
