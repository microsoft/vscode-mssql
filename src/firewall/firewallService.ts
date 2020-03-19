/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { IAccount, CreateFirewallRuleRequest, HandleFirewallRuleRequest,
    IHandleFirewallRuleParams, IHandleFirewallRuleResponse,
    ICreateFirewallRuleResponse,
    IAccountKey,
    ICreateFirewallRuleParams} from '../models/contracts/firewall/firewallRequest';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import Constants = require('../constants/constants');
import { Deferred } from '../protocol';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { IAzureSession } from '../models/interfaces';

export class FirewallService {

    private _isSignedIn: boolean = false;
    private _session: IAzureSession = undefined;
    private _account: IAccount = undefined;
    private _token = undefined;
    private _isStale: boolean;


    constructor(
        private _client: SqlToolsServiceClient,
        private _vscodeWrapper: VscodeWrapper
    ) {}

    public get isSignedIn(): boolean {
        return this._isSignedIn;
    }

    public get account(): IAccount {
        return this._account;
    }

    /**
     * Public for testing purposes only
     */
    public set token(value: any) {
        this._token = value;
    }

    private convertToAzureAccount(azureSession: IAzureSession): IAccount {
        let tenant = {
            displayName: Constants.tenantDisplayName,
            id: azureSession.tenantId,
            userId: azureSession.userId
        };
        let key: IAccountKey = {
            providerId: Constants.resourceProviderId,
            accountId: azureSession.userId
        };
        let account: IAccount = {
            key: key,
            displayInfo: {
                userId: azureSession.userId,
                contextualDisplayName: undefined,
                displayName: undefined,
                accountType: undefined
            },
            properties: {
                tenants: [tenant]
            },
            isStale: this._isStale
        };
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

    private async asCreateFirewallRuleParams(serverName: string, startIpAddress: string, endIpAddress?: string): Promise<ICreateFirewallRuleParams> {
        let params: ICreateFirewallRuleParams = {
            account: this._account,
            serverName: serverName,
            startIpAddress: startIpAddress,
            endIpAddress: endIpAddress ? endIpAddress : startIpAddress,
            securityTokenMappings: await this.createSecurityTokenMapping()
        };
        return params;
    }

    public set isSignedIn(value: boolean) {
        this._isSignedIn = value;
        if (value) {
            this._session = this._vscodeWrapper.azureAccountExtension.exports.sessions[0];
            this._account = this.convertToAzureAccount(this._session);
        }
    }

    public async createFirewallRule(serverName: string, startIpAddress: string, endIpAddress?: string): Promise<ICreateFirewallRuleResponse> {
        let params = await this.asCreateFirewallRuleParams(serverName, startIpAddress, endIpAddress);
        let result = await this._client.sendResourceRequest(CreateFirewallRuleRequest.type, params);
        return result;
    }

    public async handleFirewallRule(errorCode: number, errorMessage: string): Promise<IHandleFirewallRuleResponse> {
        let params: IHandleFirewallRuleParams = { errorCode: errorCode, errorMessage: errorMessage, connectionTypeId: Constants.mssqlProviderName };
        let result = await this._client.sendResourceRequest(HandleFirewallRuleRequest.type, params);
        return result;
    }

}
