
import { ErrorLookup, ErrorCodes, Error1Context } from 'aad-library';



export class AzureErrorLookup implements ErrorLookup {
    getSimpleError(errorCode: ErrorCodes): string {
        return;
    }

    getTenantNotFoundError(context: Error1Context): string {
        return;
    }
}