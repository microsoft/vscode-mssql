/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { IAccount, IAccountKey, IAccountDisplayInfo } from '../models/contracts/azure/accountInterfaces';
import SqlToolsServiceClient from '../languageservice/serviceclient';
import { IAzureSession } from '../models/interfaces';
import { Deferred } from '../protocol';
import Constants = require('../constants/constants');
import VscodeWrapper from '../controllers/vscodeWrapper';

export class AccountService {

    private _session: IAzureSession = undefined;
    private _account: IAccount = undefined;
    private _token = undefined;
    private _isStale: boolean;

    constructor(
        private _client: SqlToolsServiceClient,
        private _vscodeWrapper: VscodeWrapper
    ) {}

    public get account(): IAccount {
        return this._account;
    }

    public get client(): SqlToolsServiceClient {
        return this._client;
    }

    /**
     * Public for testing purposes only
     */
    public set token(value: any) {
        this._token = value;
    }

    public convertToAzureAccount(azureSession: IAzureSession): IAccount {
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
            isStale: this._isStale,
            isSignedIn: false
        };
        return account;
    }

    public async createSecurityTokenMapping(): Promise<any> {
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

    public initializeSessionAccount(): void {
        this._session = this._vscodeWrapper.azureAccountExtension.exports.filters[0].session;
        this._account = this.convertToAzureAccount(this._session);
    }




}
