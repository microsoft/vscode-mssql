/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { Account, FirewallRuleInfo, CreateFirewallRuleRequest, HandleFirewallRuleRequest,
    HandleFirewallRuleParams, HandleFirewallRuleResponse,
    CreateFirewallRuleResponse } from '../models/contracts/firewall/firewallRequest';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import Constants = require('../constants/constants');

export class FirewallService {

    public static azureAccountExtension = vscode.extensions.getExtension('ms-vscode.azure-account');
    private _isSignedIn: boolean = false;
    private _account: Account = undefined;

    constructor(private _client: SqlToolsServiceClient){}

    public get isSignedIn(): boolean {
        return this._isSignedIn;
    }

    public get account(): Account {
        return this._account;
    }

    public set isSignedIn(value: boolean) {
        this._isSignedIn = value;
        if (value) {
            this._account = FirewallService.azureAccountExtension.exports.sessions[0];
        }
    }

    public async createFirewallRule(account: Account, firewallRuleInfo: FirewallRuleInfo): Promise<CreateFirewallRuleResponse> {
        let result = await this._client.sendRequest(CreateFirewallRuleRequest.type, firewallRuleInfo);
        return result;
    }

    public async handleFirewallRule(errorCode: number, errorMessage: string): Promise<HandleFirewallRuleResponse> {
        let params: HandleFirewallRuleParams = { errorCode: errorCode, errorMessage: errorMessage, connectionTypeId: Constants.mssqlProviderName };
        let result = await this._client.sendRequest(HandleFirewallRuleRequest.type, params);
        return result;
    }

}
