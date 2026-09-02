/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Guards the shape of the semantic layer's cost, not its speed. Doubling the document must not
// produce quadratic binding or edit growth, regardless of the machine's absolute speed.

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { suite, test } from "node:test";
import { InProcessLanguageServiceRuntime } from "../../src/index.ts";

/** Doubling the document must not more than triple the work. Quadratic would quadruple it. */
const growthCeiling = 3;

/** One SQL batch, repeated to reach a size. Deliberately full of columns that share names. */
function corpus(batches: number): string {
    const unit = [
        "CREATE TABLE #staging (id INT, name NVARCHAR(100), created DATETIME2);",
        "DECLARE @rows TABLE (id INT, name NVARCHAR(100));",
        "WITH recent AS (SELECT id, name, created FROM #staging WHERE created > '2024-01-01')",
        "INSERT INTO @rows (id, name) SELECT r.id, r.name FROM recent AS r;",
        "SELECT s.id, s.name, s.created FROM #staging AS s JOIN @rows AS w ON s.id = w.id;",
        "DROP TABLE #staging;",
        "GO",
        "",
    ].join("\n");
    return unit.repeat(batches);
}

/** Median of several runs, so one unlucky garbage collection cannot decide the result. */
async function median(runs: number, body: (run: number) => Promise<unknown>): Promise<number> {
    const samples: number[] = [];
    for (let run = 0; run < runs; run++) {
        const started = performance.now();
        await body(run);
        samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const medianSample = samples[samples.length >> 1];
    if (medianSample === undefined) throw new Error("Median requires at least one run.");
    return medianSample;
}

async function openCost(batches: number, run: number): Promise<void> {
    const text = corpus(batches);
    const runtime = new InProcessLanguageServiceRuntime();
    await runtime.open(`file:///scaling-${batches}-${run}.sql`, 1, text);
}

async function editCost(batches: number, run: number): Promise<unknown> {
    const text = corpus(batches);
    const runtime = new InProcessLanguageServiceRuntime();
    const uri = `file:///scaling-edit-${batches}-${run}.sql`;
    await runtime.open(uri, 1, text);
    const at = text.indexOf(";") + 1;
    return runtime.change(uri, 1, 2, [{ start: at, end: at, text: " " }]);
}

suite("semantic layer scaling", () => {
    test("binding a document grows no worse than linearly", async () => {
        const small = await median(3, (run) => openCost(200, run));
        const large = await median(3, (run) => openCost(400, run));
        const growth = large / small;
        assert.ok(
            growth < growthCeiling,
            `Doubling the document multiplied bind time by ${growth.toFixed(2)}x ` +
                `(${small.toFixed(0)} ms then ${large.toFixed(0)} ms). Above ${growthCeiling}x means ` +
                "a lookup has started scanning a collection instead of indexing it.",
        );
    });

    test("one keystroke grows no worse than linearly", async () => {
        const small = await median(3, (run) => editCost(200, run));
        const large = await median(3, (run) => editCost(400, run));
        const growth = large / small;
        assert.ok(
            growth < growthCeiling,
            `Doubling the document multiplied keystroke time by ${growth.toFixed(2)}x ` +
                `(${small.toFixed(0)} ms then ${large.toFixed(0)} ms). Above ${growthCeiling}x means ` +
                "a lookup has started scanning a collection instead of indexing it.",
        );
    });
});
