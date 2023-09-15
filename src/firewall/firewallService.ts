/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	CreateFirewallRuleRequest, HandleFirewallRuleRequest,
	IHandleFirewallRuleParams, IHandleFirewallRuleResponse,
	ICreateFirewallRuleResponse,
	ICreateFirewallRuleParams
} from '../models/contracts/firewall/firewallRequest';
import * as Constants from '../constants/constants';
import { AccountService } from '../azure/accountService';

export class FirewallService {

	constructor(
		private accountService: AccountService
	) { }

	public async createFirewallRule(params: ICreateFirewallRuleParams): Promise<ICreateFirewallRuleResponse> {
		let result = await this.accountService.client.sendResourceRequest(CreateFirewallRuleRequest.type, params);
		return result;
	}

	public async handleFirewallRule(errorCode: number, errorMessage: string): Promise<IHandleFirewallRuleResponse> {
		let params: IHandleFirewallRuleParams = { errorCode: errorCode, errorMessage: errorMessage, connectionTypeId: Constants.mssqlProviderName };
		let result = await this.accountService.client.sendResourceRequest(HandleFirewallRuleRequest.type, params);
		return result;
	}

}
