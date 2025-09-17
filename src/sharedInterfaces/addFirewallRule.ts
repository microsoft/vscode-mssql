/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMssqlAzureAccount, IMssqlAzureTenant } from "./azureAccountManagement";
import { IDialogContextProps } from "./connectionDialog";
import { FirewallRuleSpec } from "./firewallRule";
import { ApiStatus, WebviewContextProps } from "./webview";

/**
 * State for the Add Firewall Rule webview
 */
export interface AddFirewallRuleState extends IDialogContextProps {
    serverName?: string;
    message: string;
    clientIp: string;
    isSignedIn: boolean;
    accounts: IMssqlAzureAccount[];
    /** Maps from account ID to list of tenants */
    tenants: Record<string, IMssqlAzureTenant[]>;
    addFirewallRuleStatus: ApiStatus;
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
