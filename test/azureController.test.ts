/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { AzureController } from '../src/azure/azureController';
import * as assert from 'assert';

suite('Azure Controller Tests', () => {

	const currentTime = new Date().getTime() / 1000;

	test('isTokenInValid should return true for undefined token', () => {
		const actual = AzureController.isTokenInValid(undefined, currentTime);
		const expected = true;
		assert.strictEqual(actual, expected);
	});

	test('isTokenInValid should return true for empty token', () => {
		const actual = AzureController.isTokenInValid('', currentTime);
		const expected = true;
		assert.strictEqual(actual, expected);
	});

	test('isTokenInValid should return true for undefined expiresOn', () => {
		const actual = AzureController.isTokenInValid('token', undefined);
		const expected = true;
		assert.strictEqual(actual, expected);
	});

	test('isTokenInValid should return true for expired token', () => {
		const actual = AzureController.isTokenInValid('token', currentTime - (4 * 60));
		const expected = true;
		assert.strictEqual(actual, expected);
	});

	test('isTokenInValid should return false for valid token', () => {
		const actual = AzureController.isTokenInValid('token', currentTime + (3 * 60));
		const expected = false;
		assert.strictEqual(actual, expected);
	});
});
