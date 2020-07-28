import { ErrorLookup, Error1Context } from "../models/error";

type ErrorMapping = {
    [errorCode: number]: string;
};

const simpleErrorMapping: ErrorMapping = {
    2: 'Something failed with the authentication, or your tokens have been deleted from the system. Please try adding your account to Azure Data Studio again.',
    3: 'Error when getting your account from the cache',
    4: 'Error when parsing your account from the cache',
};

export class DefaultErrorLookup implements ErrorLookup {
    getSimpleError(errorCode: number): string {
        return simpleErrorMapping[errorCode];
    }

    getError1(errorCode: number, context: Error1Context): string {
        return `Specified tenant with ID "${context.tenantId}" not found.`;
    }
}