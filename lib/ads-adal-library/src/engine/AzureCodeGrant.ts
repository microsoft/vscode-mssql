/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { AzureAuth } from './AzureAuth';
import { AzureAuthType, ProviderSettings, SecureStorageProvider, CachingProvider, Logger, MessageDisplayer, ErrorLookup, StringLookup, AADResource, LoginResponse, Tenant, Deferred, AuthorizationCodePostData, OAuthTokenResponse, AuthRequest, UserInteraction } from '../models';
import * as crypto from 'crypto';
import * as qs from 'qs';
import { AzureAuthError } from '../errors/AzureAuthError';
import { ErrorCodes } from '../errors/errors';

export class AzureCodeGrant extends AzureAuth {
    constructor(
        protected readonly providerSettings: ProviderSettings,
        protected readonly secureStorage: SecureStorageProvider,
        protected readonly cachingProvider: CachingProvider,
        protected readonly logger: Logger,
        protected readonly messageDisplayer: MessageDisplayer,
        protected readonly errorLookup: ErrorLookup,
        protected readonly userInteraction: UserInteraction,
        protected readonly stringLookup: StringLookup,
        protected readonly authRequest: AuthRequest
    ) {
        super(providerSettings, secureStorage, cachingProvider, logger, messageDisplayer, errorLookup, userInteraction, stringLookup, AzureAuthType.AuthCodeGrant);
    }

    protected async login(tenant: Tenant, resource: AADResource): Promise<LoginResponse> {
        let authCompleteDeferred: Deferred<void>;
        let authCompletePromise = new Promise<void>((resolve, reject) => authCompleteDeferred = { resolve, reject });

        const { codeVerifier, codeChallenge } = this.createCryptoValues();
        const state = await this.authRequest.getState();
        const loginQuery = {
            response_type: 'code',
            response_mode: 'query',
            client_id: this.clientId,
            redirect_uri: this.providerSettings.redirectUri,
            state,
            prompt: 'select_account',
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            resource: resource.endpoint
        };

        const signInUrl = `${this.loginEndpointUrl}${tenant.id}/oauth2/authorize?${qs.stringify(loginQuery)}`;
        await this.userInteraction.openUrl(signInUrl);
        const authCode = await this.authRequest.getAuthorizationCode(signInUrl, authCompletePromise);


        const response = await this.getTokenWithAuthorizationCode(tenant, resource, {
            authCode,
            redirectUri: this.providerSettings.redirectUri,
            codeVerifier
        });
        if (!response) {
            throw new AzureAuthError(ErrorCodes.GetAccessTokenAuthCodeGrant, this.errorLookup.getSimpleError(ErrorCodes.GetAccessTokenAuthCodeGrant));
        }


        return {
            authComplete: authCompleteDeferred!,
            response
        };

    }

    /**
 * Requests an OAuthTokenResponse from Microsoft OAuth
 *
 * @param tenant
 * @param resource
 * @param authCode
 * @param redirectUri
 * @param codeVerifier
 */
    private async getTokenWithAuthorizationCode(tenant: Tenant, resource: AADResource, { authCode, redirectUri, codeVerifier }: AuthCodeResponse): Promise<OAuthTokenResponse | undefined> {
        const postData: AuthorizationCodePostData = {
            grant_type: 'authorization_code',
            code: authCode,
            client_id: this.clientId,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            resource: resource.endpoint
        };

        return this.getToken(tenant, resource, postData);
    }

    private createCryptoValues(): CryptoValues {
        const codeVerifier = this.toBase64UrlEncoding(crypto.randomBytes(32).toString('base64'));
        const codeChallenge = this.toBase64UrlEncoding(crypto.createHash('sha256').update(codeVerifier).digest('base64'));

        return {
            codeVerifier, codeChallenge
        };
    }
}

interface CryptoValues {
    codeVerifier: string;
    codeChallenge: string;
}

interface AuthCodeResponse {
    authCode: string;
    codeVerifier: string;
    redirectUri: string;
}
