/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { suite, test } from "node:test";
import { InProcessLanguageServiceRuntime, TsqlColorizationService } from "../../src/index.ts";

const statement =
    "SELECT c.Id, c.Name, o.Total FROM dbo.Customers AS c" +
    " JOIN dbo.Orders AS o ON o.CustomerId = c.Id WHERE c.Id > 1;\n";

function best(samples: readonly number[]): number {
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

        const fullSamples: number[] = [];
        const rangeSamples: number[] = [];
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

        assert.ok(
            best(rangeSamples) * 8 < best(fullSamples),
            `range ${best(rangeSamples).toFixed(1)}ms is not bounded against full ${best(
                fullSamples,
            ).toFixed(1)}ms`,
        );
    });
});
