/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSourceNodeWorkerClient } from "../support/nodeWorkerClient.ts";

suite("Node worker runtime", () => {
    test("keeps document state and stats inside a persistent Node worker", async () => {
        const client = createSourceNodeWorkerClient();
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

    // Worker feature and color routes use the same source-map wrappers as the in-process route,
    // so a caret or viewport inside removed directive text cannot address unrelated projected SQL.
    test("preserves SQLCMD source coordinates in worker feature routes", async () => {
        const client = createSourceNodeWorkerClient();
        const uri = "file:///worker-sqlcmd.sql";
        const sql = ":setvar unused 1\nSELECT 1;";
        const start = sql.indexOf("unused");
        try {
            await client.open(uri, 1, sql);
            assert.deepEqual(await client.completion(uri, start), {
                items: [],
                incomplete: false,
            });
            assert.equal(await client.hover(uri, start), undefined);
            assert.deepEqual(await client.definition(uri, start), { locations: [] });
            assert.deepEqual(await client.selectionRanges(uri, [start]), []);
            assert.deepEqual(
                (await client.coloring(uri, { start, end: start + "unused".length })).tokens,
                [],
            );
        } finally {
            await client.dispose();
        }
    });
});
