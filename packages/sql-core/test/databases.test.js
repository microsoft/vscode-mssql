/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { classifyPlatform, listDatabases, sessionPreamble } = require("../dist/index.js");
const { resultSet, scriptedReader } = require("../test-fixtures/fakeReader.js");

suite("databases", () => {
    test("lists the online databases after the read preamble", async () => {
        const info = classifyPlatform({ engineEdition: 5 });
        const reader = scriptedReader([
            [resultSet(["name"], [["master"], ["Orders"], [null], ["Sales"]])],
        ]);

        assert.deepEqual(await listDatabases(reader, info), ["master", "Orders", "Sales"]);
        assert.ok(reader.calls[0].startsWith(sessionPreamble(info, "read")));
        assert.match(reader.calls[0], /FROM sys\.databases\nWHERE state = 0\nORDER BY name;$/);
    });

    test("passes the read options", async () => {
        const info = classifyPlatform({ engineEdition: 3, productVersion: "16.0.4135.4" });
        const reader = scriptedReader([[resultSet(["name"])]]);

        assert.deepEqual(await listDatabases(reader, info, { timeoutMs: 1000 }), []);
        assert.deepEqual(reader.options[0], { timeoutMs: 1000 });
    });
});
