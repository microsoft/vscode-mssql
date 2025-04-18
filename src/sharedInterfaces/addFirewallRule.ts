/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AddFirewallRuleDialogProps } from "./connectionDialog";
import { WebviewContextProps } from "./webview";

/**
 * Interface representing an Azure tenant
 */
export interface AzureTenant {
    id: string;
    name: string;
}

/**
 * State for the Add Firewall Rule webview
 */
export interface AddFirewallRuleState {
    addFirewallRuleProps: AddFirewallRuleDialogProps;
}

/**
 * Reducers for the Add Firewall Rule webview - to be implemented later
 */
export interface AddFirewallRuleReducers {
    // Placeholder for future implementation
}

/**
 * Context props for the Add Firewall Rule webview
 */
export interface AddFirewallRuleContextProps extends WebviewContextProps<AddFirewallRuleState> {
    submit: (ipAddress: string, ruleName: string, tenantId?: string) => Promise<void>;
    cancel: () => Promise<void>;
    refreshIpAddress: () => Promise<void>;
}
