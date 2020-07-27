import { ErrorLookup } from "../models/error";

type ErrorMapping = {
    [errorCode: number]: string;
};

const simpleErrorMapping: ErrorMapping = {
};

export class DefaultErrorLookup implements ErrorLookup {
    getSimpleError(errorCode: number): string {
        return simpleErrorMapping[errorCode];
    }
}