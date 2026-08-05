/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../constants/constants";
import { FirewallRuleSpec } from "../sharedInterfaces/firewallRule";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { getErrorMessage } from "../utils/utils";
import { Azure as LocAzure } from "../constants/locConstants";

export interface IHandleFirewallRuleResponse {
    result: boolean;
    ipAddress: string;
}

export class FirewallService {
    public async handleFirewallRule(
        errorCode: number,
        errorMessage: string,
    ): Promise<IHandleFirewallRuleResponse> {
        if (errorCode !== Constants.errorFirewallRule) {
            return { result: false, ipAddress: "" };
        }

        const ipMatch = errorMessage.match(
            /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/,
        );

        return {
            result: ipMatch !== null,
            ipAddress: ipMatch?.[0] ?? "",
        };
    }

    public async createFirewallRuleWithVscodeAccount(
        firewallRuleSpec: FirewallRuleSpec,
        serverName: string,
    ) {
        const [startIp, endIp] =
            typeof firewallRuleSpec.ip === "string"
                ? [firewallRuleSpec.ip, firewallRuleSpec.ip]
                : [firewallRuleSpec.ip.startIp, firewallRuleSpec.ip.endIp];

        try {
            const { accountId, tenantId } = firewallRuleSpec.azureAccountInfo;
            const azureSqlServerName = VsCodeAzureHelper.getAzureSqlServerName(serverName);
            if (!azureSqlServerName) {
                throw new Error(LocAzure.unableToLocateSqlServer(serverName));
            }

            const resource = await VsCodeAzureHelper.findSqlResource(accountId, azureSqlServerName);

            if (resource === "UnableToCheck") {
                throw new Error(LocAzure.unableToLocateSqlServer(serverName));
            }

            const subscriptions = await VsCodeAzureHelper.getSubscriptionsForAccount(accountId);
            const subscription = subscriptions.find(
                (sub) =>
                    sub.subscriptionId === resource.subscriptionId && sub.tenantId === tenantId,
            );

            if (!subscription) {
                throw new Error(LocAzure.errorLoadingAzureAccountInfoForTenantId(tenantId));
            }

            await VsCodeAzureHelper.createFirewallRule(
                subscription,
                resource.resourceGroup,
                azureSqlServerName,
                firewallRuleSpec.name,
                startIp,
                endIp,
            );
        } catch (err) {
            const error = new Error(
                LocAzure.errorCreatingFirewallRule(
                    `"${firewallRuleSpec.name}" (${startIp} - ${endIp})`,
                    getErrorMessage(err),
                ),
            );
            error.name = "createFirewallRule";

            throw error;
        }
    }
}
