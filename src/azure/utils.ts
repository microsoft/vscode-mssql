/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from '@azure/arm-resources';
import { SqlManagementClient } from '@azure/arm-sql';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { PagedAsyncIterableIterator } from '@azure/core-paging';
import { HttpsProxyAgentOptions } from 'https-proxy-agent';
import { parse } from 'url';
import * as vscode from 'vscode';
import { getProxyAgentOptions } from '../languageservice/proxy';
import { AuthLibrary, AzureAuthType, IToken } from '../models/contracts/azure';
import * as Constants from './constants';
import { TokenCredentialWrapper } from './credentialWrapper';
import { HttpClient } from './msal/httpClient';

const configAzureAD = 'azureActiveDirectory';
const configAzureAuthLibrary = 'azureAuthenticationLibrary';

const configProxy = 'proxy';
const configProxyStrictSSL = 'proxyStrictSSL';
const configProxyAuthorization = 'proxyAuthorization';

/**
 * Helper method to convert azure results that comes as pages to an array
 * @param pages azure resources as pages
 * @param convertor a function to convert a value in page to the expected value to add to array
 * @returns array or Azure resources
 */
export async function getAllValues<T, TResult>(pages: PagedAsyncIterableIterator<T>, convertor: (input: T) => TResult | undefined): Promise<TResult[]> {
	let values: TResult[] = [];
	let newValue = await pages.next();
	while (!newValue.done) {
		values.push(convertor(newValue.value)!);
		newValue = await pages.next();
	}
	return values;
}

export type SubscriptionClientFactory = (token: IToken) => SubscriptionClient;
export function defaultSubscriptionClientFactory(token: IToken): SubscriptionClient {
	return new SubscriptionClient(new TokenCredentialWrapper(token));
}

export type ResourceManagementClientFactory = (token: IToken, subscriptionId: string) => ResourceManagementClient;
export function defaultResourceManagementClientFactory(token: IToken, subscriptionId: string): ResourceManagementClient {
	return new ResourceManagementClient(new TokenCredentialWrapper(token), subscriptionId);
}

export type SqlManagementClientFactory = (token: IToken, subscriptionId: string) => SqlManagementClient;
export function defaultSqlManagementClientFactory(token: IToken, subscriptionId: string): SqlManagementClient {
	return new SqlManagementClient(new TokenCredentialWrapper(token), subscriptionId);
}

function getConfiguration(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(Constants.extensionConfigSectionName);
}

function getHttpConfiguration(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(Constants.httpConfigSectionName);
}
export function getAzureActiveDirectoryConfig(): AzureAuthType {
	let config = getConfiguration();
	if (config) {
		const val: string | undefined = config.get(configAzureAD);
		if (val) {
			return AzureAuthType[val];
		}
	} else {
		return AzureAuthType.AuthCodeGrant;
	}
}

export function getAzureAuthLibraryConfig(): AuthLibrary {
	let config = getConfiguration();
	if (config) {
		const val: string | undefined = config.get(configAzureAuthLibrary);
		if (val) {
			return AuthLibrary[val];
		}
	}
	return AuthLibrary.MSAL; // default to MSAL
}

export function getEnableSqlAuthenticationProviderConfig(): boolean {
	const config = getConfiguration();
	if (config) {
		const val: boolean | undefined = config.get(Constants.sqlAuthProviderSection);
		if (val !== undefined) {
			return val;
		}
	}
	return true; // default setting
}

export function getProxyEnabledHttpClient(): HttpClient {
	const proxy = <string>getHttpConfiguration().get(configProxy);
	const strictSSL = getHttpConfiguration().get(configProxyStrictSSL, true);
	const authorization = getHttpConfiguration().get(configProxyAuthorization);

	const url = parse(proxy);
	let agentOptions = getProxyAgentOptions(url, proxy, strictSSL);

	if (authorization && url.protocol === 'https:') {
		let httpsAgentOptions = agentOptions as HttpsProxyAgentOptions;
		httpsAgentOptions!.headers = Object.assign(httpsAgentOptions!.headers || {}, {
			'Proxy-Authorization': authorization
		});
		agentOptions = httpsAgentOptions;
	}

	return new HttpClient(proxy, agentOptions);
}
