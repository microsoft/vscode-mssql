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

// Create context with default undefined value
const AddFirewallRuleContext = createContext<AddFirewallRuleContextProps | undefined>(undefined);

interface AddFirewallRuleProviderProps {
    children: React.ReactNode;
}

// Simple scaffold of the state provider - will be enhanced later
const AddFirewallRuleStateProvider: React.FC<AddFirewallRuleProviderProps> = ({ children }) => {
    const vscodeWebviewProvider = useVscodeWebview<AddFirewallRuleState, AddFirewallRuleReducers>();

    return (
        <AddFirewallRuleContext.Provider
            value={{
                state: vscodeWebviewProvider.state,
                ...getCoreRPCs(vscodeWebviewProvider),
                themeKind: vscodeWebviewProvider.themeKind,
            }}>
            {children}
        </AddFirewallRuleContext.Provider>
    );
};

export { AddFirewallRuleContext, AddFirewallRuleStateProvider };
