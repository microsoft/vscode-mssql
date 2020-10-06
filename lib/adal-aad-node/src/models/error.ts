import { ErrorCodes } from "../errors/errors";

export interface ErrorLookup {
    getSimpleError: (errorCode: ErrorCodes) => string;

    getTenantNotFoundError: (context: Error1Context) => string;
}

export interface Error1Context {
    tenantId: string;
}



