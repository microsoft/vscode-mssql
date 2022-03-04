/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureAccountExtensionApi, AzureSession } from '../../typings/azure-account.api';
import { AzureExtensionApiProvider } from '../../typings/azpi';
//import * as coreAuth from '@azure/core-auth';
import * as identity from '@azure/identity';
import { Token } from '@microsoft/ads-adal-library';
import { vsCodePlugin } from "@azure/identity-vscode";

export class AzureSqlClient {

	public static async init() {
		if (!AzureSqlClient.azureApis) {
			const extension = vscode.extensions.getExtension<AzureExtensionApiProvider>('ms-vscode.azure-account');
			if (extension && !extension.isActive) {
				await extension.activate();

			} else if (!extension) {
				void vscode.window.showErrorMessage('Please make sure Azure Account extension is installed!');
			}

			const azureApiProvider = extension?.exports;
			if (azureApiProvider) {
				AzureSqlClient.azureApis = azureApiProvider.getApi<AzureAccountExtensionApi>('1');
				if (!(await AzureSqlClient.azureApis.waitForLogin())) {
					await vscode.commands.executeCommand('azure-account.askForLogin');
				}
			}
		}
	}

	public static async getToken(tenantId: string): Promise<Token | undefined> {

		identity.useIdentityPlugin(vsCodePlugin);
		let vsCredential = new identity.VisualStudioCodeCredential({ tenantId: tenantId , authorityHost: "https://login.windows.net/microsoft.com"});
		if (!vsCredential) {
			vsCredential = new identity.VisualStudioCodeCredential();
		}
		console.log(`vsCredential !!!!!!! ${vsCredential}`);
		console.log(`tenant id ${tenantId}`);
		const token = await vsCredential!.getToken("https://database.windows.net/.default");

		console.log(`token ${token}`);
		/*
		const azureApis = await AzureSqlClient.getAzureApis();
		const session = azureApis.sessions[0];

		console.log(`user id ${session.userId}`);
		console.log(`tenant id ${session.tenantId}`);

		const token =  <coreAuth.AccessToken>await session.credentials2.getToken('https://database.windows.net/.default');
*/
		return {
			token: token.token,
			expiresOn: token.expiresOnTimestamp,
			key: '',//identity.VisualStudioCodeCredential.,
			tokenType: 'Bearer'
		}
	}

	public static async getAccount(): Promise<AzureSession | undefined> {

		const azureApis = await AzureSqlClient.getAzureApis();
		const session = azureApis.sessions[0];

		return await session;
	}

	private static azureApis: AzureAccountExtensionApi | undefined;

	private static async getAzureApis(): Promise<AzureAccountExtensionApi | undefined> {
		if (!AzureSqlClient.azureApis) {
			await AzureSqlClient.init();
		}

		return AzureSqlClient.azureApis;
	}
}
