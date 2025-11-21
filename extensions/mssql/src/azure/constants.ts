/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITenant } from "../models/contracts/azure";

export const serviceName = "Code";

export const httpConfigSectionName = "http";

export const extensionConfigSectionName = "mssql";

export const azureAccountDirectory = "Azure Accounts";

export const homeCategory = "Home";

export const account = "account";

export const accountsSection = "accounts";

export const authSection = "auth";

export const azureSection = "azure";

export const azureAccountProviderCredentials =
  "azureAccountProviderCredentials";

export const cloudSection = "cloud";

export const clearTokenCacheCommand = "clearTokenCache";

export const configSection = "config";

export const mssqlSection = "mssql";

export const tenantSection = "tenant";

export const sqlAuthProviderSection = "enableSqlAuthenticationProvider";

export const enableConnectionPoolingSection = "enableConnectionPooling";

export const mssqlAuthenticationProviderConfig =
  mssqlSection + "." + sqlAuthProviderSection;

export const accountsClearTokenCacheCommand =
  accountsSection + "." + clearTokenCacheCommand;

export const accountsAzureAuthSection =
  accountsSection + "." + azureSection + "." + authSection;

export const accountsAzureCloudSection =
  accountsSection + "." + azureSection + "." + cloudSection;

export const azureTenantConfigSection =
  azureSection + "." + tenantSection + "." + configSection;

export const oldMsalCacheFileName = "azureTokenCacheMsal-azure_publicCloud";

/////// MSAL ERROR CODES, ref: https://learn.microsoft.com/en-us/azure/active-directory/develop/reference-aadsts-error-codes
/**
 * The refresh token has expired or is invalid due to sign-in frequency checks by conditional access.
 * The token was issued on {issueDate} and the maximum allowed lifetime for this request is {time}.
 */
export const AADSTS70043 = "AADSTS70043";
/**
 * FreshTokenNeeded - The provided grant has expired due to it being revoked, and a fresh auth token is needed.
 * Either an admin or a user revoked the tokens for this user, causing subsequent token refreshes to fail and
 * require reauthentication. Have the user sign in again.
 */
export const AADSTS50173 = "AADSTS50173";
/**
 * User account 'user@domain.com' from identity provider {IdentityProviderURL} does not exist in tenant {ResourceTenantName}.
 * This error occurs when account is authenticated without a tenant id, which happens when tenant Id is not available in connection profile.
 * We have the user sign in again when this error occurs.
 */
export const AADSTS50020 = "AADSTS50020";
/**
 * Error thrown from STS - indicates user account not found in MSAL cache.
 * We request user to sign in again.
 */
export const mdsUserAccountNotFound = `User account '{0}' not found in MSAL cache, please add linked account or refresh account credentials.`;
/**
 * Error thrown from STS - indicates user account info not received from connection profile.
 * This is possible when account info is not available when populating user's preferred name in connection profile.
 * We request user to sign in again, to refresh their account credentials.
 */
export const mdsUserAccountNotReceived = "User account not received.";
/**
 * This error is thrown by MSAL when user account is not received in silent authentication request.
 * Thrown by TS layer, indicates user account hint not provided. We request user to reauthenticate when this error occurs.
 */
export const noAccountInSilentRequestError = "no_account_in_silent_request";
/**
 * multiple_matching_tokens error can occur in scenarios when users try to run vscode-mssql as different users, reference issue:
 * https://github.com/AzureAD/microsoft-authentication-library-for-js/issues/5134
 * Error message: multiple_matching_tokens The cache contains multiple tokens satisfying the requirements.
 * Call AcquireToken again providing more requirements such as authority or account.
 */
export const multiple_matching_tokens_error = "multiple_matching_tokens";

/** MSAL Account version */
export const accountVersion = "2.0";

export const bearer = "Bearer";

/**
 * Use SHA-256 algorithm
 */
export const s256CodeChallengeMethod = "S256";

export const selectAccount = "select_account";

export const commonTenant: ITenant = {
  id: "common",
  displayName: "common",
};

export const organizationTenant: ITenant = {
  id: "organizations",
  displayName: "organizations",
};
/**
 * Account issuer as received from access token
 */
export enum AccountIssuer {
  Corp = "corp",
  Msft = "msft",
}
/**
 * http methods
 */
export enum HttpMethod {
  GET = "get",
  POST = "post",
}

export enum HttpStatus {
  SUCCESS_RANGE_START = 200,
  SUCCESS_RANGE_END = 299,
  REDIRECT = 302,
  CLIENT_ERROR_RANGE_START = 400,
  CLIENT_ERROR_RANGE_END = 499,
  SERVER_ERROR_RANGE_START = 500,
  SERVER_ERROR_RANGE_END = 599,
}

export enum ProxyStatus {
  SUCCESS_RANGE_START = 200,
  SUCCESS_RANGE_END = 299,
  SERVER_ERROR = 500,
}

/**
 * Constants
 */
export const constants = {
  MSAL_SKU: "msal.js.node",
  JWT_BEARER_ASSERTION_TYPE:
    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
  AUTHORIZATION_PENDING: "authorization_pending",
  HTTP_PROTOCOL: "http://",
  LOCALHOST: "localhost",
};
