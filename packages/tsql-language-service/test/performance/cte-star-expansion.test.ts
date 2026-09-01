/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { suite, test } from "node:test";
import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} from "../../src/index.ts";

suite("CTE star expansion performance", () => {
    test("resolves and caches a 100-CTE projection chain within the completion budget", async (context) => {
        const metadata = new InMemoryMetadataProvider();
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const sql = chainedCtes(100);
        const uri = "file:///cte-star-performance.sql";
        const analysisStarted = performance.now();
        await runtime.open(uri, 1, sql);
        const analysisElapsed = performance.now() - analysisStarted;
        const star = sql.lastIndexOf("*");

        const coldStarted = performance.now();
        const cold = features.completion(uri, 1, star + 1);
        const coldElapsed = performance.now() - coldStarted;
        const warmStarted = performance.now();
        const warm = features.completion(uri, 1, star + 1);
        const warmElapsed = performance.now() - warmStarted;

        const coldExpansion = cold.items.find((item) => item.label === "Expand SELECT *");
        const warmExpansion = warm.items.find((item) => item.label === "Expand SELECT *");
        assert.ok(coldExpansion?.edit);
        assert.ok(warmExpansion?.edit);
        assert.ok(coldExpansion.edit.newText.includes("[Column8]"));
        assert.deepEqual(warmExpansion.edit, coldExpansion.edit);
        context.diagnostic(
            `100-CTE analysis ${analysisElapsed.toFixed(2)} ms; expansion: cold ${coldElapsed.toFixed(2)} ms, cached ${warmElapsed.toFixed(2)} ms`,
        );
        assert.ok(
            analysisElapsed < 1_000,
            `100-CTE parse and bind took ${analysisElapsed.toFixed(1)} ms`,
        );
        assert.ok(coldElapsed < 100, `cold 100-CTE expansion took ${coldElapsed.toFixed(1)} ms`);
        assert.ok(warmElapsed < 20, `cached expansion took ${warmElapsed.toFixed(1)} ms`);
    });

    test("enriches a 100-CTE completion chain without repeated walks", async (context) => {
        const metadata = new InMemoryMetadataProvider();
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const sql = chainedCtes(100).replace("SELECT * FROM Cte99;", "SELECT Cte99. FROM Cte99;");
        const uri = "file:///cte-column-performance.sql";
        await runtime.open(uri, 1, sql);
        const offset = sql.lastIndexOf("Cte99.") + "Cte99.".length;

        const coldStarted = performance.now();
        const cold = features.completion(uri, 1, offset);
        const coldElapsed = performance.now() - coldStarted;
        const warmStarted = performance.now();
        const warm = features.completion(uri, 1, offset);
        const warmElapsed = performance.now() - warmStarted;

        assert.equal(cold.items.find((item) => item.label === "Column1")?.detail, "int — Cte99");
        assert.equal(warm.items.find((item) => item.label === "Column8")?.detail, "int — Cte99");
        context.diagnostic(
            `100-CTE metadata completion: cold ${coldElapsed.toFixed(2)} ms, cached ${warmElapsed.toFixed(2)} ms`,
        );
        assert.ok(coldElapsed < 100, `cold metadata completion took ${coldElapsed.toFixed(1)} ms`);
        assert.ok(warmElapsed < 20, `cached metadata completion took ${warmElapsed.toFixed(1)} ms`);
    });
});

function chainedCtes(count: number): string {
    const declarations = [
        "Cte0 AS (SELECT 1 AS Column1, 2 AS Column2, 3 AS Column3, 4 AS Column4, " +
            "5 AS Column5, 6 AS Column6, 7 AS Column7, 8 AS Column8)",
    ];
    for (let index = 1; index < count; index++) {
        declarations.push(`Cte${index} AS (SELECT * FROM Cte${index - 1})`);
    }
    return `WITH ${declarations.join(",\n")}\nSELECT * FROM Cte${count - 1};`;
}
