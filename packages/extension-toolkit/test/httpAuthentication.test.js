/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { withBearerToken } = require("../dist/base/index.js");

suite("withBearerToken", () => {
    test("adds authorization without mutating existing options", () => {
        const headers = { Accept: "application/json" };
        const options = { headers, timeoutMs: 1_000 };

        const result = withBearerToken("token-value", options);

        assert.deepEqual(result, {
            headers: { Accept: "application/json", Authorization: "Bearer token-value" },
            timeoutMs: 1_000,
        });
        assert.notEqual(result, options);
        assert.notEqual(result.headers, headers);
    });

    for (const token of ["", " token", "token ", "Bearer token", "token\nvalue"]) {
        test(`rejects invalid token input ${JSON.stringify(token)}`, () => {
            assert.throws(
                () => withBearerToken(token),
                /Bearer token must be an unprefixed, non-empty value/,
            );
        });
    }

    test("rejects an existing authorization header case-insensitively", () => {
        assert.throws(
            () =>
                withBearerToken("token-value", {
                    headers: { authorization: "existing-value" },
                }),
            /already contain an Authorization header/,
        );
    });
});
