/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a tenant information for an account.
 */
export interface ITenant {
    id: string;
    displayName: string;
    userId?: string;
    tenantCategory?: string;
}

/**
 * Represents a key that identifies an account.
 */
export interface IAccountKey {
    /**
     * Identifier for the account, unique to the provider
     */
    id: string;
    /**
     * Identifier of the provider
     */
    providerId: string;
    /**
     * Version of the account
     */
    accountVersion?: any;
}

export enum AzureAuthType {
    AuthCodeGrant = 0,
    DeviceCode = 1,
}

export enum AccountType {
    Microsoft = "microsoft",
    WorkSchool = "work_school",
}

/**
 * Represents display information for an account.
 */
export interface IAccountDisplayInfo {
    /**
     * account provider (eg, Work/School vs Microsoft Account)
     */
    accountType: AccountType;
    /**
     * User id that identifies the account, such as "user@contoso.com".
     */
    userId: string;
    /**
     * A display name that identifies the account, such as "User Name".
     */
    displayName: string;
    /**
     * email for AAD
     */
    email?: string;
    /**
     * name of account
     */
    name: string;
}

export interface IAccount {
    /**
     * The key that identifies the account
     */
    key: IAccountKey;
    /**
     * Display information for the account
     */
    displayInfo: IAccountDisplayInfo;
    /**
     * Custom properties stored with the account
     */
    properties: IAzureAccountProperties;
    /**
     * Indicates if the account needs refreshing
     */
    isStale: boolean;
    /**
     * Indicates if the account is signed in
     */
    isSignedIn?: boolean;
}

export interface IAzureAccountProperties {
    /**
     * Auth type of azure used to authenticate this account.
     */
    azureAuthType: AzureAuthType;
    /**
     * Provider settings for Azure account.
     */
    providerSettings: IProviderSettings;
    /**
     * Whether or not the account is a Microsoft account
     */
    isMsAccount: boolean;
    /**
     * Represents the tenant that the user would be signing in to. For work and school accounts,
     * the GUID is the immutable tenant ID of the organization that the user is signing in to.
     * For sign-ins to the personal Microsoft account tenant (services like Xbox, Teams for Life, or Outlook),
     * the value is 9188040d-6c67-4c5b-b112-36a304b66dad.
     */
    owningTenant: ITenant;
    /**
     * A list of tenants (aka directories) that the account belongs to
     */
    tenants: ITenant[];
}

/**
 * Represents settings for an AAD account provider
 */
export interface IProviderSettings {
    scopes: string[];
    displayName: string;
    id: string;
    clientId: string;
    loginEndpoint: string;
    portalEndpoint: string;
    redirectUri: string;
    resources: IProviderResources;
}

export interface IProviderResources {
    windowsManagementResource: IAADResource;
    azureManagementResource: IAADResource;
    graphResource?: IAADResource;
    databaseResource?: IAADResource;
    ossRdbmsResource?: IAADResource;
    azureKeyVaultResource?: IAADResource;
    azureDevopsResource?: IAADResource;
}

export interface IAADResource {
    id: string;
    resource: string;
    endpoint: string;
}
/**
 * Error to be used when the user has cancelled the prompt or refresh methods. When
 * AccountProvider.refresh or AccountProvider.prompt are rejected with this error, the error
 * will not be reported to the user.
 */
export interface IPromptFailedResult {
    /**
     * Type guard for differentiating user cancelled sign in errors from other errors
     */
    canceled: boolean;
}

export interface ITokenKey {
    /**
     * Account Key - uniquely identifies an account
     */
    key: string;
}
export interface IAccessToken extends ITokenKey {
    /**
     * Access Token
     */
    token: string;
    /**
     * Access token expiry timestamp
     */
    expiresOn?: number;
}

export interface IToken extends IAccessToken {
    /**
     * TokenType
     */
    tokenType: string;
}

export interface IRefreshToken extends ITokenKey {
    /**
     * Refresh Token
     */
    token: string;
}

export interface ITokenClaims {
    aud: string;
    iss: string;
    iat: number;
    idp: string;
    nbf: number;
    exp: number;
    home_oid?: string;
    c_hash: string;
    at_hash: string;
    aio: string;
    preferred_username: string;
    email: string;
    name: string;
    nonce: string;
    oid?: string;
    roles: string[];
    rh: string;
    sub: string;
    tid: string;
    unique_name: string;
    uti: string;
    ver: string;
}
