/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringLookup, InteractionRequiredContext } from '@microsoft/ads-adal-library';

export class AzureStringLookup implements StringLookup {
	getSimpleString: (code: number) => string;
	getInteractionRequiredString: (context: InteractionRequiredContext) => string;
}
