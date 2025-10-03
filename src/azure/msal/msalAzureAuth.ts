/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Resource } from "@azure/arm-resources";
import {
    AccountInfo,
    AuthError,
    AuthenticationResult,
    InteractionRequiredAuthError,
    PublicClientApplication,
    SilentFlowRequest,
} from "@azure/msal-node";
import * as url from "url";
import * as vscode from "vscode";
import * as LocalizedConstants from "../../constants/locConstants";
import VscodeWrapper from "../../controllers/vscodeWrapper";
import {
    AccountType,
    AzureAuthType,
    IAADResource,
    IAccount,
    IProviderSettings,
    ITenant,
    LoginResult,
} from "../../models/contracts/azure";
import { IDeferred } from "../../models/interfaces";
import { Logger } from "../../models/logger";
import { AzureAuthError } from "../azureAuthError";
import * as Constants from "../constants";
import { ErrorResponseBody } from "@azure/arm-subscriptions";
import { HttpHelper } from "../../http/httpHelper";
import { getErrorMessage } from "../../utils/utils";

export type GetTenantsResponseData = {
    value: ITenantResponse[];
};
export type ErrorResponseBodyWithError = Required<ErrorResponseBody>;

export abstract class MsalAzureAuth {
    protected readonly loginEndpointUrl: string;
    protected readonly redirectUri: string;
    protected readonly scopes: string[];
    protected readonly scopesString: string;
    protected readonly clientId: string;
    protected readonly resources: Resource[];
    private readonly _httpHelper: HttpHelper;

    constructor(
        protected readonly providerSettings: IProviderSettings,
        protected readonly context: vscode.ExtensionContext,
        protected clientApplication: PublicClientApplication,
        protected readonly authType: AzureAuthType,
        protected readonly vscodeWrapper: VscodeWrapper,
        protected readonly logger: Logger,
    ) {
        this.loginEndpointUrl =
            this.providerSettings.loginEndpoint ?? "https://login.microsoftonline.com/";
        this.redirectUri = "http://localhost";
        this.clientId = this.providerSettings.clientId;
        this.scopes = [...this.providerSettings.scopes];
        this.scopesString = this.scopes.join(" ");

        this._httpHelper = new HttpHelper(logger);
    }

    public async startLogin(): Promise<LoginResult> {
        let loginComplete: IDeferred<void, Error> | undefined = undefined;
        try {
            this.logger.verbose("Starting login");
            if (!this.providerSettings.settings.windowsManagementResource) {
                throw new Error(
                    LocalizedConstants.azureNoMicrosoftResource(this.providerSettings.displayName),
                );
            }
            const result = await this.login(Constants.organizationTenant);
            loginComplete = result.authComplete;

            if (!result?.response || !result.response?.account) {
                this.logger.error(`Authentication failed: ${loginComplete}`);

                return {
                    success: false,
                    canceled: false,
                    error: loginComplete.toString(),
                };
            }

            const token: IToken = {
                token: result.response.accessToken,
                key: result.response.account.homeAccountId,
                tokenType: result.response.tokenType,
            };

            const tokenClaims = <ITokenClaims>result.response.idTokenClaims;
            const account = await this.hydrateAccount(token, tokenClaims);
            loginComplete?.resolve();

            return {
                success: true,
                account,
            };
        } catch (ex) {
            this.logger.error(`Login failed: ${ex}`);
            if (ex instanceof AzureAuthError) {
                if (loginComplete) {
                    loginComplete.reject(ex);
                    this.logger.error(ex);
                } else {
                    void vscode.window.showErrorMessage(ex.message);
                    this.logger.error(ex.originalMessageAndException);
                }
            } else {
                this.logger.error(ex);
            }
            return {
                success: false,
                canceled: false,
                error: getErrorMessage(ex),
            };
        }
    }

    public async hydrateAccount(
        token: IToken | IAccessToken,
        tokenClaims: ITokenClaims,
    ): Promise<IAccount> {
        const tenants = await this.getTenants(token.token);
        let account = this.createAccount(tokenClaims, token.key, tenants);
        return account;
    }

    protected abstract login(tenant: ITenant): Promise<{
        response: AuthenticationResult | null;
        authComplete: IDeferred<void, Error>;
    }>;

    /**
     * Gets the access token for the correct account and scope from the token cache, if the correct token doesn't exist in the token cache
     * (i.e. expired token, wrong scope, etc.), sends a request for a new token using the refresh token
     * @param account
     * @param azureResource
     * @returns The authentication result, including the access token
     */
    public async getToken(
        account: IAccount,
        tenantId: string,
        settings: IAADResource,
    ): Promise<AuthenticationResult | null> {
        let accountInfo: AccountInfo | null;
        try {
            accountInfo = await this.getAccountFromMsalCache(account.key.id);
        } catch (ex) {
            this.logger.error(
                `Error: Could not fetch account from MSAL cache, re-authentication needed: ${getErrorMessage(ex)}`,
            );
            // build refresh token request
            const tenant: ITenant = {
                id: tenantId,
                displayName: "",
            };
            return this.handleInteractionRequired(tenant, settings, false);
        }
        // Resource endpoint must end with '/' to form a valid scope for MSAL token request.
        const endpoint = settings.endpoint.endsWith("/")
            ? settings.endpoint
            : settings.endpoint + "/";

        if (!account) {
            this.logger.error("Error: Account not received.");
            return null;
        }

        if (!tenantId) {
            tenantId = account.properties.owningTenant.id;
        }

        let newScope: string[];
        if (settings.id === this.providerSettings.settings.windowsManagementResource.id) {
            newScope = [`${endpoint}user_impersonation`];
        } else {
            newScope = [`${endpoint}.default`];
        }

        let authority = this.loginEndpointUrl + tenantId;
        this.logger.info(`Authority URL set to: ${authority}`);

        let shouldForceRefresh = false;

        // construct request
        // forceRefresh needs to be set true here in order to fetch the correct token, due to this issue
        // https://github.com/AzureAD/microsoft-authentication-library-for-js/issues/3687
        const tokenRequest: SilentFlowRequest = {
            account: accountInfo!,
            authority: authority,
            scopes: newScope,
            forceRefresh: shouldForceRefresh,
        };
        try {
            return await this.clientApplication.acquireTokenSilent(tokenRequest);
        } catch (e) {
            this.logger.error("Failed to acquireTokenSilent", e);
            if (e instanceof AuthError && this.accountNeedsRefresh(e)) {
                // build refresh token request
                const tenant: ITenant = {
                    id: tenantId,
                    displayName: "",
                };
                return this.handleInteractionRequired(tenant, settings);
            } else if (e.name === "ClientAuthError") {
                this.logger.verbose("[ClientAuthError] Failed to silently acquire token");
            }

            this.logger.error(
                `Failed to silently acquire token, not InteractionRequiredAuthError: ${e.message}`,
            );
            throw e;
        }
    }

    /**
     * Determines whether the account needs to be refreshed based on received error instance
     * and STS error codes from errorMessage.
     * @param error AuthError instance
     */
    private accountNeedsRefresh(error: AuthError): boolean {
        return (
            error instanceof InteractionRequiredAuthError ||
            error.errorMessage.includes(Constants.AADSTS70043) ||
            error.errorMessage.includes(Constants.AADSTS50020) ||
            error.errorMessage.includes(Constants.AADSTS50173)
        );
    }

    public async refreshAccessToken(
        account: IAccount,
        tenantId: string,
        settings: IAADResource,
    ): Promise<IAccount | undefined> {
        if (account) {
            try {
                const tokenResult = await this.getToken(account, tenantId, settings);
                if (!tokenResult) {
                    account.isStale = true;
                    return account;
                }

                const tokenClaims = this.getTokenClaims(tokenResult.accessToken);
                if (!tokenClaims) {
                    account.isStale = true;
                    return account;
                }

                const token: IToken = {
                    key: tokenResult.account!.homeAccountId,
                    token: tokenResult.accessToken,
                    tokenType: tokenResult.tokenType,
                    expiresOn: tokenResult.account!.idTokenClaims!.exp,
                };

                return await this.hydrateAccount(token, tokenClaims);
            } catch (ex) {
                account.isStale = true;
                throw ex;
            }
        } else {
            this.logger.error(
                `refreshAccessToken: Account not received for refreshing access token.`,
            );
            throw Error(LocalizedConstants.msgAccountNotFound);
        }
    }

    public async loadTokenCache(): Promise<void> {
        let tokenCache = this.clientApplication.getTokenCache();
        void tokenCache.getAllAccounts();
    }

    public async getAccountFromMsalCache(accountId: string): Promise<AccountInfo | null> {
        const cache = this.clientApplication.getTokenCache();
        if (!cache) {
            this.logger.error("Error: Could not fetch token cache.");
            return null;
        }

        let account: AccountInfo | null;
        // if the accountId is a home ID, it will include a '.' character
        if (accountId.includes(".")) {
            account = await cache.getAccountByHomeId(accountId);
        } else {
            account = await cache.getAccountByLocalId(accountId);
        }
        if (!account) {
            this.logger.error("Error: Could not find account from MSAL Cache.");
            return null;
        }
        return account;
    }

    public async getTenants(token: string): Promise<ITenant[]> {
        const tenantUri = url.resolve(
            this.providerSettings.settings.armResource.endpoint,
            "tenants?api-version=2019-11-01",
        );
        try {
            this.logger.verbose("Fetching tenants with uri {0}", tenantUri);
            let tenantList: string[] = [];
            const tenantResponse = await this._httpHelper.makeGetRequest<GetTenantsResponseData>(
                tenantUri,
                token,
            );
            const data = tenantResponse.data;
            if (this.isErrorResponseBodyWithError(data)) {
                this.logger.error(
                    `Error fetching tenants :${data.error.code} - ${data.error.message}`,
                );
                throw new Error(`${data.error.code} - ${data.error.message}`);
            }
            const tenants: ITenant[] = data.value.map((tenantInfo: ITenantResponse) => {
                if (tenantInfo.displayName) {
                    tenantList.push(tenantInfo.displayName);
                } else {
                    tenantList.push(tenantInfo.tenantId);
                    this.logger.info("Tenant display name found empty: {0}", tenantInfo.tenantId);
                }
                return {
                    id: tenantInfo.tenantId,
                    displayName: tenantInfo.displayName
                        ? tenantInfo.displayName
                        : tenantInfo.tenantId,
                    userId: token,
                    tenantCategory: tenantInfo.tenantCategory,
                } as ITenant;
            });
            this.logger.verbose(`Tenants: ${tenantList}`);
            const homeTenantIndex = tenants.findIndex(
                (tenant) => tenant.tenantCategory === Constants.homeCategory,
            );
            // remove home tenant from list of tenants
            if (homeTenantIndex >= 0) {
                const homeTenant = tenants.splice(homeTenantIndex, 1);
                tenants.unshift(homeTenant[0]);
            }
            this.logger.verbose(`Filtered Tenants: ${tenantList}`);
            return tenants;
        } catch (ex) {
            this.logger.error(`Error fetching tenants :${ex}`);
            throw ex;
        }
    }

    private isErrorResponseBodyWithError(body: any): body is ErrorResponseBodyWithError {
        return "error" in body && body.error;
    }

    //#region interaction handling
    public async handleInteractionRequired(
        tenant: ITenant,
        settings: IAADResource,
        promptUser: boolean = true,
    ): Promise<AuthenticationResult | null> {
        let shouldOpen: boolean;
        if (promptUser) {
            shouldOpen = await this.askUserForInteraction(tenant, settings);
            if (shouldOpen) {
                const result = await this.login(tenant);
                result?.authComplete?.resolve();
                return result?.response;
            }
        } else {
            const result = await this.login(tenant);
            result?.authComplete?.resolve();
            return result?.response;
        }

        return null;
    }

    /**
     * Asks the user if they would like to do the interaction based authentication as required by OAuth2
     * @param tenant
     * @param resource
     */
    private async askUserForInteraction(tenant: ITenant, settings: IAADResource): Promise<boolean> {
        if (!tenant.displayName && !tenant.id) {
            throw new Error("Tenant did not have display name or id");
        }

        interface IConsentMessageItem extends vscode.MessageItem {
            booleanResult: boolean;
            action?: (tenantId: string) => Promise<void>;
        }

        const openItem: IConsentMessageItem = {
            title: LocalizedConstants.azureConsentDialogOpen,
            booleanResult: true,
        };

        const closeItem: IConsentMessageItem = {
            title: LocalizedConstants.Common.cancel,
            isCloseAffordance: true,
            booleanResult: false,
        };

        const messageBody = LocalizedConstants.azureConsentDialogBodyAccount(settings.id);
        const result = await vscode.window.showInformationMessage(
            messageBody,
            { modal: true },
            openItem,
            closeItem,
        );

        if (result?.action) {
            await result.action(tenant.id);
        }

        return result?.booleanResult || false;
    }
    //#endregion

    //#region data modeling

    public createAccount(tokenClaims: ITokenClaims, key: string, tenants: ITenant[]): IAccount {
        this.logger.verbose(`Token Claims acccount: ${tokenClaims.name}, TID: ${tokenClaims.tid}`);
        tenants.forEach((tenant) => {
            this.logger.verbose(`Tenant ID: ${tenant.id}, Tenant Name: ${tenant.displayName}`);
        });

        // Determine if this is a microsoft account
        let accountIssuer = "unknown";

        if (
            tokenClaims.iss === "https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/" ||
            tokenClaims.iss === `${this.loginEndpointUrl}72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0`
        ) {
            accountIssuer = Constants.AccountIssuer.Corp;
        }
        if (tokenClaims?.idp === "live.com") {
            accountIssuer = Constants.AccountIssuer.Msft;
        }

        const name =
            tokenClaims.name ??
            tokenClaims.preferred_username ??
            tokenClaims.email ??
            tokenClaims.unique_name;
        const email =
            tokenClaims.preferred_username ?? tokenClaims.email ?? tokenClaims.unique_name;

        let owningTenant: ITenant = Constants.commonTenant; // default to common tenant

        // Read more about tid > https://learn.microsoft.com/azure/active-directory/develop/id-tokens
        if (tokenClaims.tid) {
            owningTenant = tenants.find((t) => t.id === tokenClaims.tid) ?? {
                id: tokenClaims.tid,
                displayName: "Microsoft Account",
            };
        } else {
            this.logger.info(
                "Could not find tenant information from tokenClaims, falling back to common Tenant.",
            );
        }

        let displayName = name;
        if (email) {
            displayName = `${displayName} - ${email}`;
        }

        let contextualDisplayName: string;
        switch (accountIssuer) {
            case Constants.AccountIssuer.Corp:
                contextualDisplayName = LocalizedConstants.azureMicrosoftCorpAccount;
                break;
            case Constants.AccountIssuer.Msft:
                contextualDisplayName = LocalizedConstants.azureMicrosoftAccount;
                break;
            default:
                contextualDisplayName = displayName;
        }

        let accountType =
            accountIssuer === Constants.AccountIssuer.Msft
                ? AccountType.Microsoft
                : AccountType.WorkSchool;

        const account: IAccount = {
            key: {
                providerId: this.providerSettings.id,
                id: key,
                accountVersion: Constants.accountVersion,
            },
            name: displayName,
            displayInfo: {
                accountType: accountType,
                userId: key,
                contextualDisplayName: contextualDisplayName,
                displayName,
                email,
                name,
            },
            properties: {
                providerSettings: this.providerSettings,
                isMsAccount: accountIssuer === Constants.AccountIssuer.Msft,
                owningTenant: owningTenant,
                tenants,
                azureAuthType: this.authType,
            },
            isStale: false,
        } as IAccount;

        return account;
    }
    //#endregion

    //#region inconsequential
    protected getTokenClaims(accessToken: string): ITokenClaims {
        try {
            const split = accessToken.split(".");
            return JSON.parse(Buffer.from(split[1], "base64").toString("utf8"));
        } catch (ex) {
            throw new Error("Unable to read token claims: " + JSON.stringify(ex));
        }
    }

    protected toBase64UrlEncoding(base64string: string): string {
        return base64string.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); // Need to use base64url encoding
    }

    public async clearCredentials(account: IAccount): Promise<void> {
        try {
            const tokenCache = this.clientApplication.getTokenCache();
            let accountInfo: AccountInfo | null = await this.getAccountFromMsalCache(
                account.key.id,
            );
            await tokenCache.removeAccount(accountInfo!);
        } catch (ex) {
            // We need not prompt user for error if token could not be removed from cache.
            this.logger.error("Error when removing token from cache: ", ex);
        }
    }

    // tslint:disable:no-empty
    public async autoOAuthCancelled(): Promise<void> {}

    //#endregion
}

//#region models

export interface IAccountKey {
    /**
     * Account Key - uniquely identifies an account
     */
    key: string;
}

export interface IAccessToken extends IAccountKey {
    /**
     * Access Token
     */
    token: string;
}

export interface IRefreshToken extends IAccountKey {
    /**
     * Refresh Token
     */
    token: string;
}

export interface ITenantResponse {
    // https://docs.microsoft.com/en-us/rest/api/resources/tenants/list
    id: string;
    tenantId: string;
    displayName?: string;
    tenantCategory?: string;
}

export interface IMultiTenantTokenResponse {
    [tenantId: string]: IToken | undefined;
}

export interface IToken extends IAccountKey {
    /**
     * Access token
     */
    token: string;

    /**
     * Access token expiry timestamp
     */
    expiresOn?: number;

    /**
     * TokenType
     */
    tokenType: string;
}

export interface ITokenClaims {
    // https://docs.microsoft.com/en-us/azure/active-directory/develop/id-tokens
    /**
     * Identifies the intended recipient of the token. In id_tokens, the audience
     * is your app's Application ID, assigned to your app in the Azure portal.
     * This value should be validated. The token should be rejected if it fails
     * to match your app's Application ID.
     */
    aud: string;
    /**
     * Identifies the issuer, or 'authorization server' that constructs and
     * returns the token. It also identifies the Microsoft Entra tenant for which
     * the user was authenticated. If the token was issued by the v2.0 endpoint,
     * the URI will end in /v2.0. The GUID that indicates that the user is a consumer
     * user from a Microsoft account is 9188040d-6c67-4c5b-b112-36a304b66dad.
     * Your app should use the GUID portion of the claim to restrict the set of
     * tenants that can sign in to the app, if applicable.
     */
    iss: string;
    /**
     * 'Issued At' indicates when the authentication for this token occurred.
     */
    iat: number;
    /**
     * Records the identity provider that authenticated the subject of the token.
     * This value is identical to the value of the Issuer claim unless the user
     * account not in the same tenant as the issuer - guests, for instance.
     * If the claim isn't present, it means that the value of iss can be used instead.
     * For personal accounts being used in an organizational context (for instance,
     * a personal account invited to an Microsoft Entra tenant), the idp claim may be
     * 'live.com' or an STS URI containing the Microsoft account tenant
     * 9188040d-6c67-4c5b-b112-36a304b66dad.
     */
    idp: string;
    /**
     * The 'nbf' (not before) claim identifies the time before which the JWT MUST NOT be accepted for processing.
     */
    nbf: number;
    /**
     * The 'exp' (expiration time) claim identifies the expiration time on or
     * after which the JWT must not be accepted for processing. It's important
     * to note that in certain circumstances, a resource may reject the token
     * before this time. For example, if a change in authentication is required
     * or a token revocation has been detected.
     */
    exp: number;
    home_oid?: string;
    /**
     * The code hash is included in ID tokens only when the ID token is issued with an
     * OAuth 2.0 authorization code. It can be used to validate the authenticity of an
     * authorization code. To understand how to do this validation, see the OpenID
     * Connect specification.
     */
    c_hash: string;
    /**
     * The access token hash is included in ID tokens only when the ID token is issued
     * from the /authorize endpoint with an OAuth 2.0 access token. It can be used to
     * validate the authenticity of an access token. To understand how to do this validation,
     * see the OpenID Connect specification. This is not returned on ID tokens from the /token endpoint.
     */
    at_hash: string;
    /**
     * An internal claim used by Microsoft Entra to record data for token reuse. Should be ignored.
     */
    aio: string;
    /**
     * The primary username that represents the user. It could be an email address, phone number,
     * or a generic username without a specified format. Its value is mutable and might change
     * over time. Since it is mutable, this value must not be used to make authorization decisions.
     * It can be used for username hints, however, and in human-readable UI as a username. The profile
     * scope is required in order to receive this claim. Present only in v2.0 tokens.
     */
    preferred_username: string;
    /**
     * The email claim is present by default for guest accounts that have an email address.
     * Your app can request the email claim for managed users (those from the same tenant as the resource)
     * using the email optional claim. On the v2.0 endpoint, your app can also request the email OpenID
     * Connect scope - you don't need to request both the optional claim and the scope to get the claim.
     */
    email: string;
    /**
     * The name claim provides a human-readable value that identifies the subject of the token. The value
     * isn't guaranteed to be unique, it can be changed, and it's designed to be used only for display purposes.
     * The profile scope is required to receive this claim.
     */
    name: string;
    /**
     * The nonce matches the parameter included in the original /authorize request to the IDP. If it does not
     * match, your application should reject the token.
     */
    nonce: string;
    /**
     * The immutable identifier for an object in the Microsoft identity system, in this case, a user account.
     * This ID uniquely identifies the user across applications - two different applications signing in the
     * same user will receive the same value in the oid claim. The Microsoft Graph will return this ID as
     * the id property for a given user account. Because the oid allows multiple apps to correlate users,
     * the profile scope is required to receive this claim. Note that if a single user exists in multiple
     * tenants, the user will contain a different object ID in each tenant - they're considered different
     * accounts, even though the user logs into each account with the same credentials. The oid claim is a
     * GUID and cannot be reused.
     */
    oid: string;
    /**
     * The set of roles that were assigned to the user who is logging in.
     */
    roles: string[];
    /**
     * An internal claim used by Azure to revalidate tokens. Should be ignored.
     */
    rh: string;
    /**
     * The principal about which the token asserts information, such as the user
     * of an app. This value is immutable and cannot be reassigned or reused.
     * The subject is a pairwise identifier - it is unique to a particular application ID.
     * If a single user signs into two different apps using two different client IDs,
     * those apps will receive two different values for the subject claim.
     * This may or may not be wanted depending on your architecture and privacy requirements.
     */
    sub: string;
    /**
     * Represents the tenant that the user is signing in to. For work and school accounts,
     * the GUID is the immutable tenant ID of the organization that the user is signing in to.
     * For sign-ins to the personal Microsoft account tenant (services like Xbox, Teams for Life, or Outlook),
     * the value is 9188040d-6c67-4c5b-b112-36a304b66dad.
     */
    tid: string;
    /**
     * Only present in v1.0 tokens. Provides a human readable value that identifies the subject of the token.
     * This value is not guaranteed to be unique within a tenant and should be used only for display purposes.
     */
    unique_name: string;
    /**
     * Token identifier claim, equivalent to jti in the JWT specification. Unique, per-token identifier that is case-sensitive.
     */
    uti: string;
    /**
     * Indicates the version of the id_token.
     */
    ver: string;
}

export type OAuthTokenResponse = {
    accessToken: IAccessToken;
    refreshToken: IRefreshToken | undefined;
    tokenClaims: ITokenClaims;
    expiresOn: string;
};

export interface ITokenPostData {
    grant_type:
        | "refresh_token"
        | "authorization_code"
        | "urn:ietf:params:oauth:grant-type:device_code";
    client_id: string;
    resource: string;
}

export interface IRefreshTokenPostData extends ITokenPostData {
    grant_type: "refresh_token";
    refresh_token: string;
    client_id: string;
    tenant: string;
}

export interface IAuthorizationCodePostData extends ITokenPostData {
    grant_type: "authorization_code";
    code: string;
    code_verifier: string;
    redirect_uri: string;
}

export interface IDeviceCodeStartPostData extends Omit<ITokenPostData, "grant_type"> {}

export interface IDeviceCodeCheckPostData extends Omit<ITokenPostData, "resource"> {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code";
    tenant: string;
    code: string;
}
//#endregion
