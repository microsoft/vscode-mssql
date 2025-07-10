/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Information for creating a Firewall rule */
export interface FirewallRuleSpec {
    /** Name of the firewall rule in Azure */
    name: string;
    /** Azure account info to create the firewall rule with */
    azureAccountInfo: { accountId: string; tenantId: string };
    /** IP address or IP range to allow through the firewall */
    ip: string | { startIp: string; endIp: string };
}
