export interface ErrorLookup {
    getSimpleError: (errorCode: number) => string;

    getError1: (errorCode: number, context: Error1Context) => string;
}

export interface Error1Context {
    tenantId: string;
}



