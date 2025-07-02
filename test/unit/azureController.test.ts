/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureController } from "../../src/extension/azure/azureController";
import * as assert from "assert";

suite("Azure Controller Tests", () => {
    const currentTime = Date.now() / 1000;

    test("isTokenValid should return false for undefined token", () => {
        const actual = AzureController.isTokenValid(undefined, currentTime);
        const expected = false;
        assert.strictEqual(actual, expected);
    });

    test("isTokenValid should return false for empty token", () => {
        const actual = AzureController.isTokenValid("", currentTime);
        const expected = false;
        assert.strictEqual(actual, expected);
    });

    test("isTokenValid should return false for undefined expiresOn", () => {
        const actual = AzureController.isTokenValid("token", undefined);
        const expected = false;
        assert.strictEqual(actual, expected);
    });

    test("isTokenValid should return false for expired token", () => {
        const actual = AzureController.isTokenValid("token", currentTime - 4 * 60);
        const expected = false;
        assert.strictEqual(actual, expected);
    });

    test("isTokenValid should return true for valid token", () => {
        const actual = AzureController.isTokenValid("token", currentTime + 3 * 60);
        const expected = true;
        assert.strictEqual(actual, expected);
    });
});
