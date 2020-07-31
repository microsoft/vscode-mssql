import { AADResource, Tenant } from '.';

export interface StringLookup {
    getSimpleString: (code: number) => string;
    getInteractionRequiredString: (context: InteractionRequiredContext) => string;
}

export interface InteractionRequiredContext{
    tenant: Tenant;
    resource: AADResource;
}