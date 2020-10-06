/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { AzureAuth } from './azureAuth';
import { ProviderSettings, SecureStorageProvider, CachingProvider, Logger, MessageDisplayer, ErrorLookup, StringLookup, AzureAuthType, Tenant, AADResource, LoginResponse, DeviceCodeStartPostData, Deferred, DeviceCodeCheckPostData, AuthRequest, UserInteraction } from '../models';
import { AzureAuthError } from '../errors/azureAuthError';
import { ErrorCodes } from '../errors/errors';

export class AzureDeviceCode extends AzureAuth {
    constructor(
        protected readonly providerSettings: ProviderSettings,
        protected readonly secureStorage: SecureStorageProvider,
        protected readonly cachingProvider: CachingProvider,
        protected readonly logger: Logger,
        protected readonly messageDisplayer: MessageDisplayer,
        protected readonly errorLookup: ErrorLookup,
        protected readonly userInteraction: UserInteraction,
        protected readonly stringLookup: StringLookup,
        protected readonly authRequest: AuthRequest,
    ) {
        super(providerSettings, secureStorage, cachingProvider, logger, messageDisplayer, errorLookup, userInteraction, stringLookup, AzureAuthType.AuthCodeGrant);
    }

    protected async login(tenant: Tenant, resource: AADResource): Promise<LoginResponse> {
        let authCompleteDeferred: Deferred<void>;
        let authCompletePromise = new Promise<void>((resolve, reject) => authCompleteDeferred = { resolve, reject });
        const uri = `${this.loginEndpointUrl}/${this.commonTenant.id}/oauth2/devicecode`;

        const postData: DeviceCodeStartPostData = {
            client_id: this.clientId,
            resource: resource.endpoint
        };

        const postResult = await this.makePostRequest(uri, postData);

        const initialDeviceLogin: DeviceCodeLogin = postResult.data;

        await this.authRequest.displayDeviceCodeScreen(initialDeviceLogin.message, initialDeviceLogin.user_code, initialDeviceLogin.verification_url);

        const finalDeviceLogin = await this.setupPolling(initialDeviceLogin);

        const accessTokenString = finalDeviceLogin.access_token;
        const refreshTokenString = finalDeviceLogin.refresh_token;

        const currentTime = new Date().getTime() / 1000;
        const expiresOn = `${currentTime + finalDeviceLogin.expires_in}`;
        const result = await this.getTokenHelper(tenant, resource, accessTokenString, refreshTokenString, expiresOn);

        if (!result) {
            // Error when getting access token for DeviceCodeLogin
            throw new AzureAuthError(ErrorCodes.GetAccessTokenDeviceCodeLogin, this.errorLookup.getSimpleError(ErrorCodes.GetAccessTokenDeviceCodeLogin));
        }

        authCompletePromise.finally(async () => await this.authRequest.closeDeviceCodeScreen()).catch(this.logger.error);

        return {
            response: result,
            authComplete: authCompleteDeferred!,
        };
    }

    private setupPolling(info: DeviceCodeLogin): Promise<DeviceCodeLoginResult> {
        const fiveMinutes = 5 * 60 * 1000;

        return new Promise<DeviceCodeLoginResult>((resolve, reject) => {
            let timeout: NodeJS.Timer;

            const timer = setInterval(async () => {
                const x = await this.checkForResult(info);
                if (!x.access_token) {
                    return;
                }
                clearTimeout(timeout);
                clearInterval(timer);
                resolve(x);
            }, info.interval * 1000);

            timeout = setTimeout(() => {
                clearInterval(timer);
                // Error when getting access token for DeviceCodeLogin
                reject(new AzureAuthError(ErrorCodes.GetAccessTokenDeviceCodeLogin, this.errorLookup.getSimpleError(ErrorCodes.GetAccessTokenDeviceCodeLogin)));
            }, fiveMinutes);
        });
    }

    private async checkForResult(info: DeviceCodeLogin): Promise<DeviceCodeLoginResult> {
        const uri = `${this.loginEndpointUrl}/${this.commonTenant}/oauth2/token`;
        const postData: DeviceCodeCheckPostData = {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: this.clientId,
            tenant: this.commonTenant.id,
            code: info.device_code
        };

        const postResult = await this.makePostRequest(uri, postData);

        const result: DeviceCodeLoginResult = postResult.data;

        return result;
    }
}

interface DeviceCodeLogin { // https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-device-code
    device_code: string;
    expires_in: number;
    interval: number;
    message: string;
    user_code: string;
    verification_url: string;
}

interface DeviceCodeLoginResult {
    token_type: string;
    scope: string;
    expires_in: number;
    access_token: string;
    refresh_token: string;
}