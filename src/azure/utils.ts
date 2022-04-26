/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PagedAsyncIterableIterator } from '@azure/core-paging';

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
