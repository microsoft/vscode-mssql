/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { ErrorLookup, Error1Context } from '../models/error';

type ErrorMapping = {
    [errorCodes in ErrorCodes]: string;
};

export enum ErrorCodes {
    AuthError = 2,
    TokenRetrieval = 3,
    NoAccessTokenReturned = 4,
    UniqueIdentifier = 5,
    Tenant = 6,
    GetAccount = 7,
    ParseAccount = 8,
    AddAccount = 9,
    GetAccessTokenAuthCodeGrant = 10,
    GetAccessTokenDeviceCodeLogin = 11,
    TimedOutDeviceCode = 12
}
const simpleErrorMapping: ErrorMapping = {
    [ErrorCodes.AuthError]: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to vscode-mssql again',
    [ErrorCodes.TokenRetrieval]: 'Token retrieval failed with an error. Open developer tools to view the error',
    [ErrorCodes.NoAccessTokenReturned]: 'No access token returned from Microsoft OAuth',
    [ErrorCodes.UniqueIdentifier]: 'The user had no unique identifier within AAD',
    [ErrorCodes.Tenant]: 'Error retrieving tenant information',
    [ErrorCodes.GetAccount]: 'Error when getting your account from the cache',
    [ErrorCodes.ParseAccount]: 'Error when parsing your account from the cache',
    [ErrorCodes.AddAccount]: 'Error when adding your account to the cache',
    [ErrorCodes.GetAccessTokenAuthCodeGrant]: 'Error when getting access token from authorization token for AuthCodeGrant',
    [ErrorCodes.GetAccessTokenDeviceCodeLogin]: 'Error when getting access token for DeviceCodeLogin',
    [ErrorCodes.TimedOutDeviceCode]: 'Timed out when waiting for device code login results'
};

export class DefaultErrorLookup implements ErrorLookup {
    getSimpleError(errorCode: ErrorCodes): string {
        return simpleErrorMapping[errorCode];
    }

    getTenantNotFoundError(context: Error1Context): string {
        return `Specified tenant with ID "${context.tenantId}" not found.`;
    }
}
