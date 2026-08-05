/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    HandleFirewallRuleRequest,
    IHandleFirewallRuleParams,
    IHandleFirewallRuleResponse,
} from "../models/contracts/firewall/firewallRequest";
import * as Constants from "../constants/constants";
import { AccountService } from "../azure/accountService";
import { FirewallRuleSpec } from "../sharedInterfaces/firewallRule";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { getErrorMessage } from "../utils/utils";
import { Azure as LocAzure } from "../constants/locConstants";

export class FirewallService {
    constructor(private accountService: AccountService) {}

    public async handleFirewallRule(
        errorCode: number,
        errorMessage: string,
    ): Promise<IHandleFirewallRuleResponse> {
        let params: IHandleFirewallRuleParams = {
            errorCode: errorCode,
            errorMessage: errorMessage,
            connectionTypeId: Constants.mssqlProviderName,
        };
        let result = await this.accountService.client.sendResourceRequest(
            HandleFirewallRuleRequest.type,
            params,
        );
        return result;
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
            const resource = await VsCodeAzureHelper.findSqlResource(accountId, serverName);

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
                serverName,
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
