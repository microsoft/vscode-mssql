/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    AddFirewallRuleContextProps,
    AddFirewallRuleState,
    AddFirewallRuleReducers,
} from "../../../../src/sharedInterfaces/addFirewallRule";
import { getCoreRPCs } from "../../common/utils";
import { ApiStatus } from "../../../sharedInterfaces/webview";

// Create context with default undefined value
const AddFirewallRuleContext = createContext<AddFirewallRuleContextProps | undefined>(undefined);

interface AddFirewallRuleProviderProps {
    children: React.ReactNode;
}

// Simple scaffold of the state provider - will be enhanced later
const AddFirewallRuleStateProvider: React.FC<AddFirewallRuleProviderProps> = ({ children }) => {
    // This will be replaced with actual implementation later
    const mockState: AddFirewallRuleState = {
        loadingStatus: ApiStatus.NotStarted,
    };

    const vscodeWebviewProvider = useVscodeWebview<AddFirewallRuleState, AddFirewallRuleReducers>();

    // Using the actual state if available, otherwise using mock state for development
    const currentState = vscodeWebviewProvider.state || mockState;

    // Mock implementation of methods - to be replaced later
    const mockSubmit = async (_ipAddress: string, _ruleName: string, _tenantId?: string) => {
        console.log("Submit called - not implemented yet");
    };

    const mockCancel = async () => {
        console.log("Cancel called - not implemented yet");
    };

    const mockRefreshIpAddress = async () => {
        console.log("Refresh IP called - not implemented yet");
    };

    return (
        <AddFirewallRuleContext.Provider
            value={{
                state: currentState,
                ...getCoreRPCs(vscodeWebviewProvider),
                submit: mockSubmit,
                cancel: mockCancel,
                refreshIpAddress: mockRefreshIpAddress,
                themeKind: vscodeWebviewProvider.themeKind,
            }}>
            {children}
        </AddFirewallRuleContext.Provider>
    );
};

export { AddFirewallRuleContext, AddFirewallRuleStateProvider };
