/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserInteraction } from '@microsoft/ads-adal-library';
import * as vscode from 'vscode';

export class AzureUserInteraction implements UserInteraction {

	port: string;
	nonce: string;
	state: string;
	constructor(
		state: string
	) {
		let arr = state.split(',');
		this.port = arr[0];
		this.nonce = arr[1];

	}

	public askForConsent(msg: string): Promise<boolean> {
		return;
	}

	public async openUrl(signInUrl): Promise<boolean> {
		return vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${this.port}/signin?nonce=${encodeURIComponent(this.nonce)}`));
	}
}
