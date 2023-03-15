/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const serviceName = 'Code';

export const httpConfigSectionName = 'http';

export const extensionConfigSectionName = 'mssql';

export const azureAccountDirectory = 'Azure Accounts';

export const homeCategory = 'Home';

export const account = 'account';

export const accountsSection = 'accounts';

export const authSection = 'auth';

export const azureSection = 'azure';

export const azureAccountProviderCredentials = 'azureAccountProviderCredentials';

export const cloudSection = 'cloud';

export const clearTokenCacheCommand = 'clearTokenCache';

export const configSection = 'config';

export const mssqlSection = 'mssql';

export const tenantSection = 'tenant';

export const sqlAuthProviderSection = 'enableSqlAuthenticationProvider';

export const mssqlAuthenticationProviderConfig = mssqlSection + '.' + sqlAuthProviderSection;

export const accountsClearTokenCacheCommand = accountsSection + '.' + clearTokenCacheCommand;

export const accountsAzureAuthSection = accountsSection + '.' + azureSection + '.' + authSection;

export const accountsAzureCloudSection = accountsSection + '.' + azureSection + '.' + cloudSection;

export const azureTenantConfigSection = azureSection + '.' + tenantSection + '.' + configSection;

/** MSAL Account version */
export const accountVersion = '2.0';

export const bearer = 'Bearer';

/**
 * Use SHA-256 algorithm
 */
export const s256CodeChallengeMethod = 'S256';

export const selectAccount = 'select_account';

/**
 * Account issuer as received from access token
 */
export enum AccountIssuer {
	Corp = 'corp',
	Msft = 'msft'
}
/**
 * http methods
 */
export enum HttpMethod {
	GET = 'get',
	POST = 'post'
}

export enum HttpStatus {
	SUCCESS_RANGE_START = 200,
	SUCCESS_RANGE_END = 299,
	REDIRECT = 302,
	CLIENT_ERROR_RANGE_START = 400,
	CLIENT_ERROR_RANGE_END = 499,
	SERVER_ERROR_RANGE_START = 500,
	SERVER_ERROR_RANGE_END = 599
}

export enum ProxyStatus {
	SUCCESS_RANGE_START = 200,
	SUCCESS_RANGE_END = 299,
	SERVER_ERROR = 500
}

/**
 * Constants
 */
export const constants = {
	MSAL_SKU: 'msal.js.node',
	JWT_BEARER_ASSERTION_TYPE: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
	AUTHORIZATION_PENDING: 'authorization_pending',
	HTTP_PROTOCOL: 'http://',
	LOCALHOST: 'localhost'
};
