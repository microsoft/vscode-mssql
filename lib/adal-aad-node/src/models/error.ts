export interface ErrorLookup {
    getSimpleError: (errorCode: number) => string;

    getTenantNotFoundError: (context: Error1Context) => string;
}

export interface Error1Context {
    tenantId: string;
}



