/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { createNodeWorkerClient } = require("../../dist/worker/node/client.js");

suite("Node worker runtime", () => {
    test("keeps document state and stats inside a persistent Node worker", async () => {
        const client = createNodeWorkerClient();
        try {
            const opened = await client.open("file:///worker.sql", 1, "SELECT 1;");
            assert.equal(opened.version, 1);
            const changed = await client.change("file:///worker.sql", 2, [
                { start: 7, end: 8, text: "2" },
            ]);
            assert.equal(changed.version, 2);
            const stats = await client.stats("file:///worker.sql");
            assert.equal(stats.document.version, 2);
            assert.equal(stats.syntax.mode, "incremental");
            const rebound = await client.rebind("file:///worker.sql");
            assert.equal(rebound.version, 2);
        } finally {
            await client.dispose();
        }
    });
});
