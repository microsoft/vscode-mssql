import { ErrorLookup, Error1Context } from "../models/error";

type ErrorMapping = {
    [errorCode: number]: string;
};

const simpleErrorMapping: ErrorMapping = {
    2: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again',
    3: 'Token retrival failed with an error. Open developer tools to view the error',
    4: 'No access token returned from Microsoft OAuth',
    5: 'The user had no unique identifier within AAD',
    6: 'Error retrieving tenant information',
    7: 'Error when getting your account from the cache',
    8: 'Error when parsing your account from the cache',
    9: 'Error when adding your account to the cache',
};

export class DefaultErrorLookup implements ErrorLookup {
    getSimpleError(errorCode: number): string {
        return simpleErrorMapping[errorCode];
    }

    getError1(errorCode: number, context: Error1Context): string {
        return `Specified tenant with ID "${context.tenantId}" not found.`;
    }
}