/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createHttpHeaders } = require("../dist/base/index.js");

describe("HttpHeaders", () => {
    it("resolves names case-insensitively", () => {
        const headers = createHttpHeaders({ "Content-Type": "application/json" });

        assert.equal(headers.get("content-type"), "application/json");
        assert.equal(headers.get("CONTENT-TYPE"), "application/json");
        assert.equal(headers.has("Content-Type"), true);
    });

    it("preserves repeated values", () => {
        const headers = createHttpHeaders([
            ["Set-Cookie", "a=1"],
            ["set-cookie", "b=2"],
        ]);

        assert.equal(headers.get("set-cookie"), "a=1");
        assert.deepEqual(headers.getAll("Set-Cookie"), ["a=1", "b=2"]);
    });

    it("normalizes primitive values and omits unsupported values", () => {
        const headers = createHttpHeaders({
            "content-length": 42,
            secure: true,
            missing: undefined,
            structured: { nested: true },
        });

        assert.equal(headers.get("content-length"), "42");
        assert.equal(headers.get("secure"), "true");
        assert.equal(headers.has("missing"), false);
        assert.equal(headers.has("structured"), false);
    });
});
