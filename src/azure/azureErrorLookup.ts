
import { ErrorLookup, ErrorCodes, Error1Context } from '@microsoft/ads-adal-library';

type ErrorMapping = {
	[errorCodes in ErrorCodes]: string;
};

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
	[ErrorCodes.TimedOutDeviceCode]: 'Timed out when waiting for device code login results',
	[ErrorCodes.ServerStartFailure]: 'Server could not start. This could be a permissions error or an incompatibility on your system. You can try enabling device code authentication from settings.',
	[ErrorCodes.UserKey]: '"User key was undefined - could not create a userKey from the tokenClaims"'
};
export class AzureErrorLookup implements ErrorLookup {
	getSimpleError(errorCode: ErrorCodes): string {
		return simpleErrorMapping[errorCode];
	}

	getTenantNotFoundError(context: Error1Context): string {
		return;
	}
}
