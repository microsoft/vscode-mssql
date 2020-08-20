import { StringLookup, InteractionRequiredContext } from 'aad-library';

export class AzureStringLookup implements StringLookup {
    getSimpleString: (code: number) => string;
    getInteractionRequiredString: (context: InteractionRequiredContext) => string;
}