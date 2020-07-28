import { ErrorLookup, Error1Context } from "../models/error";

type ErrorMapping = {
    [errorCode: number]: string;
};

const simpleErrorMapping: ErrorMapping = {
    2: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again.',
    3: 'Token retrival failed with an error. Open developer tools to view the error',
    4: 'No access token returned from Microsoft OAuth',
    5: 'The user had no unique identifier within AAD',
};

export class DefaultErrorLookup implements ErrorLookup {
    getSimpleError(errorCode: number): string {
        return simpleErrorMapping[errorCode];
    }

    getError1(errorCode: number, context: Error1Context): string {
        return `Specified tenant with ID "${context.tenantId}" not found.`;
    }
}