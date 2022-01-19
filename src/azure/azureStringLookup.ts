import { StringLookup, InteractionRequiredContext } from '@microsoft/ads-adal-library';

export class AzureStringLookup implements StringLookup {
	getSimpleString: (code: number) => string;
	getInteractionRequiredString: (context: InteractionRequiredContext) => string;
}
