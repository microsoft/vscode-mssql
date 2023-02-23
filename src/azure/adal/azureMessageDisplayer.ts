/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageDisplayer } from '@microsoft/ads-adal-library';

export class AzureMessageDisplayer implements MessageDisplayer {
	async displayInfoMessage(msg: string): Promise<void> {
		return;
	}
	async displayErrorMessage(msg: string): Promise<void> {
		return;
	}
}
