/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FirewallRuleSpec } from "./firewallRule";
import { ApiStatus, WebviewContextProps } from "./webview";

/**
 * State for the Add Firewall Rule webview
 */
export interface AddFirewallRuleState {
    serverName?: string;
    message: string;
    clientIp: string;
    isSignedIn: boolean;
    tenants: { name: string; id: string }[];
    addFirewallRuleState: ApiStatus;
}

/**
 * Reducers for the Add Firewall Rule webview - to be implemented later
 */
export interface AddFirewallRuleReducers {
    addFirewallRule: {
        firewallRuleSpec: FirewallRuleSpec;
    };
    closeDialog: {};
    signIntoAzure: {};
}

/**
 * Context props for the Add Firewall Rule webview
 */
export interface AddFirewallRuleContextProps extends WebviewContextProps<AddFirewallRuleState> {
    closeDialog: () => void;
    addFirewallRule: (firewallRuleSpec: FirewallRuleSpec) => void;
    signIntoAzure: () => void;
}
