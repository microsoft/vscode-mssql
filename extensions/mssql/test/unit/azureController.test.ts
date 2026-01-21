/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { AzureController } from "../../src/azure/azureController";
import * as sinon from "sinon";

suite("Azure Controller Tests", () => {
    const currentTime = 1600000000; // Fixed timestamp to avoid timing issues
    let dateStub: sinon.SinonStub;

    setup(() => {
        // Mock Date.now() to return consistent timestamp
        dateStub = sinon.stub(Date, "now").returns(currentTime * 1000);
    });

    teardown(() => {
        dateStub.restore();
    });

    test("isTokenValid should return false for undefined token", () => {
        const actual = AzureController.isTokenValid(undefined, currentTime);
        const expected = false;
        expect(actual).to.equal(expected);
    });

    test("isTokenValid should return false for empty token", () => {
        const actual = AzureController.isTokenValid("", currentTime);
        const expected = false;
        expect(actual).to.equal(expected);
    });

    test("isTokenValid should return false for undefined expiresOn", () => {
        const actual = AzureController.isTokenValid("token", undefined);
        const expected = false;
        expect(actual).to.equal(expected);
    });

    test("isTokenValid should return false for expired token", () => {
        const actual = AzureController.isTokenValid("token", currentTime - 4 * 60);
        const expected = false;
        expect(actual).to.equal(expected);
    });

    test("isTokenValid should return true for valid token", () => {
        const actual = AzureController.isTokenValid("token", currentTime + 3 * 60);
        const expected = true;
        expect(actual).to.equal(expected);
    });
});
