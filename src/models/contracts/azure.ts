/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

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
    settings: IProviderResources;
    fabric: {
        fabricApiUriBase: string;
        fabricScopeUriBase: string;
        sqlDbDnsSuffix: string;
        dataWarehouseDnsSuffix: string;
    };
}

/**
 * Represents a resource exposed by a Microsoft Entra identity
 */
export interface Resource {
    /**
     * Identifier of the resource
     */
    id: string;

    /**
     * Endpoint url used to access the resource
     */
    endpoint: string;

    /**
     * Endpoint suffix used to access the resource
     */
    endpointSuffix?: string;

    /**
     * Resource ID for azdata
     */
    azureResourceId?: AzureResource;
}

export enum AzureResource {
    /**
     * Azure Resource Management (ARM)
     */
    ResourceManagement = 0,
    /**
     * SQL Azure
     */
    Sql = 1,
    /**
     * OSS RDMS
     */
    OssRdbms = 2,
    /**
     * Azure Key Vault
     */
    AzureKeyVault = 3,
    // 4 (formerly Azure Graph) is no longer used.
    /**
     * Microsoft Resource Management
     */
    MicrosoftResourceManagement = 5,
    /**
     * Azure Dev Ops
     */
    AzureDevOps = 6,
    /**
     * Microsoft Graph
     */
    MsGraph = 7,
    /**
     * Azure Log Analytics
     */
    AzureLogAnalytics = 8,
    /**
     * Azure Storage
     */
    AzureStorage = 9,
    /**
     * Kusto
     */
    AzureKusto = 10,
    /**
     * Power BI
     */
    PowerBi = 11,
    /**
     * Represents custom resource URIs as received from server endpoint.
     */
    Custom = 12,
}

export interface IProviderResources {
    windowsManagementResource: IAADResource;
    armResource: IAADResource;
    graphResource?: IAADResource;
    sqlResource?: IAADResource & { analyticsDnsSuffix?: string };
    ossRdbmsResource?: IAADResource;
    azureKeyVaultResource?: IAADResource;
    azureDevopsResource?: IAADResource;
    fabric?: IAADResource & { sqlDbDnsSuffix?: string; dataWarehouseDnsSuffix: string };
}

export interface IAADResource {
    id: string;
    resource: string;
    endpoint: string;
    dnsSuffix?: string;
}

export type LoginResult = ISuccessfulLoginResult | IFailedLoginResult;

export interface ILoginResultBase {
    success: boolean;
}

export interface ISuccessfulLoginResult extends ILoginResultBase {
    success: true;
    account: IAccount;
}

export interface IFailedLoginResult extends ILoginResultBase {
    success: false;
    canceled: boolean;
    error?: string;
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

// ------------------------------- < Security Token Request > ------------------------------------------
export interface RequestSecurityTokenParams {
    provider: string;
    authority: string;
    resource: string;
    scopes: string[];
}

export interface RequestSecurityTokenResponse {
    accountKey: string;
    token: string;
}

export namespace SecurityTokenRequest {
    export const type = new RequestType<
        RequestSecurityTokenParams,
        RequestSecurityTokenResponse,
        void,
        void
    >("account/securityTokenRequest");
}

export interface UserGroup {
    id: string;
    displayName: string;
}
