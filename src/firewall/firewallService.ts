/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CreateFirewallRuleRequest,
    HandleFirewallRuleRequest,
    IHandleFirewallRuleParams,
    IHandleFirewallRuleResponse,
    ICreateFirewallRuleResponse,
    ICreateFirewallRuleParams,
} from "../models/contracts/firewall/firewallRequest";
import * as Constants from "../constants/constants";
import { AccountService } from "../azure/accountService";
import { FirewallRuleSpec } from "../sharedInterfaces/firewallRule";
import { constructAzureAccountForTenant } from "../connectionconfig/azureHelpers";
import { getErrorMessage } from "../utils/utils";
import { Azure as LocAzure } from "../constants/locConstants";
import { IAccount } from "../models/contracts/azure";

export class FirewallService {
    constructor(private accountService: AccountService) {}

    public async createFirewallRule(
        params: ICreateFirewallRuleParams,
    ): Promise<ICreateFirewallRuleResponse> {
        let result = await this.accountService.client.sendResourceRequest(
            CreateFirewallRuleRequest.type,
            params,
        );
        return result;
    }

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

        let account: IAccount, tokenMappings: {};

        try {
            ({ account, tokenMappings } = await constructAzureAccountForTenant(
                firewallRuleSpec.tenantId,
            ));
        } catch (err) {
            const error = new Error(
                LocAzure.errorCreatingFirewallRule(
                    `"${firewallRuleSpec.name}" (${startIp} - ${endIp})`,
                    getErrorMessage(err),
                ),
            );
            error.name = "constructAzureAccountForTenant";
            throw error;
        }

        try {
            const result = await this.createFirewallRule({
                account: account,
                firewallRuleName: firewallRuleSpec.name,
                startIpAddress: startIp,
                endIpAddress: endIp,
                serverName: serverName,
                securityTokenMappings: tokenMappings,
            });

            if (!result.result) {
                throw result.errorMessage;
            }
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
