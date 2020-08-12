"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultErrorLookup = exports.ErrorCodes = void 0;
var ErrorCodes;
(function (ErrorCodes) {
    ErrorCodes[ErrorCodes["AuthError"] = 2] = "AuthError";
    ErrorCodes[ErrorCodes["TokenRetrieval"] = 3] = "TokenRetrieval";
    ErrorCodes[ErrorCodes["NoAccessTokenReturned"] = 4] = "NoAccessTokenReturned";
    ErrorCodes[ErrorCodes["UniqueIdentifier"] = 5] = "UniqueIdentifier";
    ErrorCodes[ErrorCodes["Tenant"] = 6] = "Tenant";
    ErrorCodes[ErrorCodes["GetAccount"] = 7] = "GetAccount";
    ErrorCodes[ErrorCodes["ParseAccount"] = 8] = "ParseAccount";
    ErrorCodes[ErrorCodes["AddAccount"] = 9] = "AddAccount";
    ErrorCodes[ErrorCodes["GetAccessTokenAuthCodeGrant"] = 10] = "GetAccessTokenAuthCodeGrant";
    ErrorCodes[ErrorCodes["GetAccessTokenDeviceCodeLogin"] = 11] = "GetAccessTokenDeviceCodeLogin";
    ErrorCodes[ErrorCodes["TimedOutDeviceCode"] = 12] = "TimedOutDeviceCode";
})(ErrorCodes = exports.ErrorCodes || (exports.ErrorCodes = {}));
const simpleErrorMapping = {
    [ErrorCodes.AuthError]: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again',
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
class DefaultErrorLookup {
    getSimpleError(errorCode) {
        return simpleErrorMapping[errorCode];
    }
    getTenantNotFoundError(context) {
        return `Specified tenant with ID "${context.tenantId}" not found.`;
    }
}
exports.DefaultErrorLookup = DefaultErrorLookup;
//# sourceMappingURL=errors.js.map