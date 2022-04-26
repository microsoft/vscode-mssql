/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from '@azure/arm-resources';
import { SqlManagementClient } from '@azure/arm-sql';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { PagedAsyncIterableIterator } from '@azure/core-paging';
import { Token } from 'vscode-mssql';
import { TokenCredentialWrapper } from './credentialWrapper';

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

export type SubscriptionClientFactory = (token: Token) => SubscriptionClient;
export function defaultSubscriptionClientFactory(token: Token): SubscriptionClient {
	return new SubscriptionClient(new TokenCredentialWrapper(token));
}

export type ResourceManagementClientFactory = (token: Token, subscriptionId: string) => ResourceManagementClient;
export function defaultResourceManagementClientFactory(token: Token, subscriptionId: string): ResourceManagementClient {
	return new ResourceManagementClient(new TokenCredentialWrapper(token), subscriptionId);
}

export type SqlManagementClientFactory = (token: Token, subscriptionId: string) => SqlManagementClient;
export function defaultSqlManagementClientFactory(token: Token, subscriptionId: string): SqlManagementClient {
	return new SqlManagementClient(new TokenCredentialWrapper(token), subscriptionId);
}
