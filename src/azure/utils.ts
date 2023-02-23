/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from '@azure/arm-resources';
import { SqlManagementClient } from '@azure/arm-sql';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { PagedAsyncIterableIterator } from '@azure/core-paging';
import * as vscode from 'vscode';
import * as Constants from './constants';
import { parse } from 'url';
import { TokenCredentialWrapper } from './credentialWrapper';
import { AuthLibrary, AzureAuthType, IToken } from '../models/contracts/azure';
import { getProxyAgent, isBoolean } from '../languageservice/proxy';
import * as HttpsProxyAgent from 'https-proxy-agent';

const configAzureAD = 'azureActiveDirectory';
const configAzureAuthLibrary = 'azureAuthenticationLibrary';

const https = 'https:';
const configProxy = 'proxy';
const configProxyStrictSSL = 'proxyStrictSSL';
const configProxyAuthorization = 'proxyAuthorization';

/**
 * Helper method to convert azure results that comes as pages to an array
 * @param pages azure resources as pages
 * @param convertor a function to convert a value in page to the expected value to add to array
 * @returns array or Azure resources
 */
export async function getAllValues<T, TResult>(pages: PagedAsyncIterableIterator<T>, convertor: (input: T) => TResult): Promise<TResult[]> {
	let values: TResult[] = [];
	let newValue = await pages.next();
	while (!newValue.done) {
		values.push(convertor(newValue.value));
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
		const val: string = config.get(configAzureAD);
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
		const val: string = config.get(configAzureAuthLibrary);
		if (val) {
			return AuthLibrary[val];
		}
	}
	return AuthLibrary.MSAL; // default to MSAL
}

export function getHttpProxyOptions(): HttpsProxyAgent.HttpsProxyAgentOptions {

	const proxy = <string>getHttpConfiguration().get(configProxy);
	const strictSSL = getHttpConfiguration().get(configProxyStrictSSL, true);
	const authorization = getHttpConfiguration().get(configProxyAuthorization);

	const url = parse(proxy);
	const agent = getProxyAgent(url, proxy, strictSSL);

	let options: HttpsProxyAgent.HttpsProxyAgentOptions = {
		host: url.hostname,
		path: url.path,
		port: url.port,
		agent: agent,
		secureProxy: strictSSL
	};

	if (url.protocol === https) {
		let httpsOptions: HttpsProxyAgent.HttpsProxyAgentOptions = {
			host: url.hostname,
			path: url.path,
			port: url.port,
			agent: agent,
			rejectUnauthorized: isBoolean(strictSSL) ? strictSSL : true
		};
		options = httpsOptions;
	}
	if (authorization) {
		options.headers = Object.assign(options.headers || {}, {
			'Proxy-Authorization': authorization
		});
	}

	return options;
}
