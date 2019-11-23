/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { Account, CreateFirewallRuleRequest, HandleFirewallRuleRequest,
    HandleFirewallRuleParams, HandleFirewallRuleResponse,
    CreateFirewallRuleResponse,
    AccountKey,
    CreateFirewallRuleParams} from '../models/contracts/firewall/firewallRequest';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import Constants = require('../constants/constants');
import { Deferred } from '../protocol';

export class FirewallService {

    public static azureAccountExtension = vscode.extensions.getExtension('ms-vscode.azure-account');
    private _isSignedIn: boolean = false;
    private _session: any = undefined;
    private _account: Account = undefined;
    private _token = undefined;
    private _isStale: boolean;

    constructor(private _client: SqlToolsServiceClient){}

    public get isSignedIn(): boolean {
        return this._isSignedIn;
    }

    public get account(): Account {
        return this._account;
    }

    private convertToAzureAccount(azureSession: any): Account {
        let tenant = {
            displayName: Constants.tenantDisplayName,
            id: this._session.tenantId,
            userId: this._session.userId
        }
        let key : AccountKey = {
            providerId: Constants.resourceProviderId,
            accountId: azureSession.userId
        };
        let account : Account = {
            key: key,
            displayInfo: {
                userId: this._session.userId,
                contextualDisplayName: undefined,
                displayName: undefined,
                accountType: undefined
            },
            properties: {
                tenants: [tenant]
            },
            isStale: this._isStale
        }
        return account;
    }

    private async createSecurityTokenMapping(): Promise<any> {
        if (!this._token) {
            let promise = new Deferred();
            this._token = this._session.credentials.getToken((error, result ) => {
                if (result) {
                    this._isStale = false;
                    this._token = result;
                }
                if (error) {
                    this._isStale = true;
                }
                promise.resolve();
            });
            await promise;
        }
        let mapping = {};
        mapping[this._session.tenantId] = {
            expiresOn: this._token.expiresOn.toISOString(),
            resource: this._token.resource,
            tokenType: this._token.tokenType,
            token: this._token.accessToken
        };
        return mapping;
    }

    private async asCreateFirewallRuleParams(account: Account, serverName: string, ipAddress: string): Promise<CreateFirewallRuleParams> {
        let params: CreateFirewallRuleParams = {
            account: this._account,
            serverName: serverName,
            startIpAddress: ipAddress,
            endIpAddress: ipAddress,
            securityTokenMappings: await this.createSecurityTokenMapping()
        }
        return params;
    }

    public set isSignedIn(value: boolean) {
        this._isSignedIn = value;
        if (value) {
            this._session = FirewallService.azureAccountExtension.exports.sessions[0];
            this._account = this.convertToAzureAccount(this._session);
        }
    }

    public async createFirewallRule(account: Account, serverName: string, ipAddress: string): Promise<CreateFirewallRuleResponse> {
        let params = await this.asCreateFirewallRuleParams(account, serverName, ipAddress);
        let result = await this._client.sendResourceRequest(CreateFirewallRuleRequest.type, params);
        return result;
    }

    public async handleFirewallRule(errorCode: number, errorMessage: string): Promise<HandleFirewallRuleResponse> {
        let params: HandleFirewallRuleParams = { errorCode: errorCode, errorMessage: errorMessage, connectionTypeId: Constants.mssqlProviderName };
        let result = await this._client.sendResourceRequest(HandleFirewallRuleRequest.type, params);
        return result;
    }

}
