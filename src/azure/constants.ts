/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const serviceName = 'Code';

export const httpConfigSectionName = 'http';

export const extensionConfigSectionName = 'mssql';

export const azureAccountDirectory = 'Azure Accounts';

export const homeCategory = 'Home';

export const account = 'account';

export const accountsSection = 'accounts';

export const authSection = 'auth';

export const authenticationLibrarySection = 'authenticationLibrary';

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

export const azureAuthenticationLibrarySection = azureSection + '.' + authenticationLibrarySection;

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
