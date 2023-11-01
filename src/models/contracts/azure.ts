/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AccountInfo } from "@azure/msal-node";

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
	DeviceCode = 1
}

export enum AccountType {
	Microsoft = 'microsoft',
	WorkSchool = 'work_school'
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
	Custom = 12
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
	/**
	 * Specifies if an account should be deleted
	 */
	delete?: boolean;
}

export interface IAzureAccountProperties {
	/**
	 * Auth type of azure used to authenticate this account.
	 */
	azureAuthType: AzureAuthType;
	/**
	 * Provider settings for Azure account.
	 */
	providerSettings: IAccountProviderMetadata;
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
	configKey: string;
	metadata: IAccountProviderMetadata;
}

export interface IProviderMetadata {
	id: string;
	displayName: string;
	settings: {} | undefined;
}

export interface IAccountProviderMetadata extends IProviderMetadata {
	settings: ISettings;
}

export interface ISettings {
	/**
		 * Host of the authority
		 */
	host: string;

	/**
	 * Identifier of the client application
	 */
	clientId: string;

	/**
	 * Information that describes the Microsoft resource management resource
	 */
	microsoftResource: IAADResource

	/**
	 * Information that describes the MS graph resource
	 */
	msGraphResource?: IAADResource;

	/**
	 * Information that describes the Azure resource management resource
	 */
	armResource: IAADResource;

	/**
	 * Information that describes the SQL Azure resource
	 */
	sqlResource?: IAADResource;

	/**
	 * Information that describes the OSS RDBMS resource
	 */
	ossRdbmsResource?: IAADResource;

	/**
	 * Information that describes the Azure Key Vault resource
	 */
	azureKeyVaultResource?: IAADResource;

	/**
	 * Information that describes the Azure Dev Ops resource
	 */
	azureDevOpsResource?: IAADResource;

	/**
	 * Information that describes the Azure Kusto resource
	 */
	azureKustoResource?: IAADResource;

	/**
	 * Information that describes the Azure Log Analytics resource
	 */
	azureLogAnalyticsResource?: IAADResource;

	/**
	 * Information that describes the Azure Storage resource
	 */
	azureStorageResource?: IAADResource;

	/**
	 * Information that describes the Power BI resource
	 */
	powerBiResource?: IAADResource;

	/**
	 * A list of tenant IDs to authenticate against. If defined, then these IDs will be used
	 * instead of querying the tenants endpoint of the armResource
	 */
	adTenants?: string[];

	// AuthorizationCodeGrantFlowSettings //////////////////////////////////

	/**
	 * An optional site ID that brands the interactive aspect of sign in
	 */
	siteId?: string;

	/**
	 * Redirect URI that is used to signify the end of the interactive aspect of sign in
	 */
	redirectUri: string;

	scopes: string[]

	portalEndpoint?: string
}

export interface IAADResource {
	id: string;
	resource: AzureResource;
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

/**
	 * Represents a provider of accounts for use with the account management service
	 */
export interface IAccountProvider {
	/**
	 * Initializes the account provider with the accounts restored from the memento,
	 * @param storedAccounts Accounts restored from the memento
	 * @return Account objects after being rehydrated (if necessary)
	 */
	initialize(storedAccounts: IAccount[]): Thenable<IAccount[]>;

	/**
	 * Generates a security token for the provided account and tenant
	 * @param account The account to generate a security token for
	 * @param resource The resource to get the token for
	 * @return Promise to return a security token object
	 */
	getAccountSecurityToken(account: IAccount, tenant: string, resource: AzureResource): Thenable<IToken | undefined>;

	/**
	 * Prompts the user to enter account information.
	 * Returns an error if the user canceled the operation.
	 */
	prompt(): Thenable<IAccount | IPromptFailedResult>;

	/**
	 * Refreshes a stale account.
	 * Returns an error if the user canceled the operation.
	 * Otherwise, returns a new updated account instance.
	 * @param account - An account.
	 */
	refresh(account: IAccount): Thenable<IAccount | IPromptFailedResult>;

	/**
	 * Clears sensitive information for an account. To be called when account is removed
	 * @param accountKey - Key that uniquely identifies the account to clear
	 */
	clear(accountKey: IAccountKey): Thenable<void>;

	/**
	 * Called from the account management service when the user has cancelled an auto OAuth
	 * authorization process. Implementations should use this to cancel any polling process
	 * and call the end OAuth method.
	 */
	autoOAuthCancelled(): Thenable<void>;

	checkAccountInCache(account: IAccount): Thenable<AccountInfo>;
}
