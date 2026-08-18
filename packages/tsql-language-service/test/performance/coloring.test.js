/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { InProcessLanguageServiceRuntime, TsqlColorizationService } = require("../../dist/index.js");

const statement =
    "SELECT c.Id, c.Name, o.Total FROM dbo.Customers AS c" +
    " JOIN dbo.Orders AS o ON o.CustomerId = c.Id WHERE c.Id > 1;\n";

function best(samples) {
    return Math.min(...samples);
}

suite("coloring performance regressions", () => {
    test("a viewport range costs a fraction of the whole document", async () => {
        let text = "";
        while (text.length < 512 * 1024) text += statement;
        const runtime = new InProcessLanguageServiceRuntime();
        const snapshot = await runtime.open("file:///coloring-performance.sql", 1, text);
        const service = new TsqlColorizationService();
        const range = {
            start: Math.floor(text.length / 2),
            end: Math.floor(text.length / 2) + 2048,
        };

        service.provideDocumentColors(snapshot);
        service.provideRangeColors({ ...snapshot, range });

        const fullSamples = [];
        const rangeSamples = [];
        for (let attempt = 0; attempt < 3; attempt++) {
            let started = performance.now();
            const full = service.provideDocumentColors(snapshot);
            fullSamples.push(performance.now() - started);
            assert.ok(full.tokens.length > 10_000);

            started = performance.now();
            const ranged = service.provideRangeColors({ ...snapshot, range });
            rangeSamples.push(performance.now() - started);
            assert.ok(ranged.tokens.length > 0);
        }

        // The margin is wide on purpose: this guards against a range request degrading into whole
        // document work, not against a specific machine speed.
        assert.ok(
            best(rangeSamples) * 8 < best(fullSamples),
            `range ${best(rangeSamples).toFixed(1)}ms is not bounded against full ${best(
                fullSamples,
            ).toFixed(1)}ms`,
        );
    });
});
