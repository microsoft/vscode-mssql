export interface ErrorLookup {
    getSimpleError: (errorCode: number) => string;

    getError5?: (errorCode: number, context: Error5Context) => string;
}

export interface Error5Context {

}

