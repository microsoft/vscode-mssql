import { StringLookup, InteractionRequiredContext } from 'ads-adal-library';

export class AzureStringLookup implements StringLookup {
    getSimpleString: (code: number) => string;
    getInteractionRequiredString: (context: InteractionRequiredContext) => string;
}
