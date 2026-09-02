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
    type ObjectMetadata,
} from "../../src/index.ts";

suite("catalog completion performance smoke", () => {
    // Verifies prefix lookup remains interactive for the reported 50k-plus object catalog shape.
    test("completes a 60k-object dbo catalog within an interactive budget", async () => {
        const objects: ObjectMetadata[] = Array.from({ length: 60_000 }, (_, index) => ({
            ref: { id: `large:${index}` },
            database: "CustomerDb",
            schema: "dbo",
            name: `Table${index.toString().padStart(5, "0")}`,
            kind: "table",
        }));
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "CustomerDb", defaultSchema: "dbo" },
            objects,
            schemas: [{ database: "CustomerDb", name: "dbo" }],
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const sql = "SELECT * FROM dbo.Table59999";
        await runtime.open("file:///large.sql", 1, sql);
        const started = performance.now();
        const result = features.completion("file:///large.sql", 1, sql.length);
        const elapsedMs = performance.now() - started;

        assert.ok(result.items.some((item) => item.label === "Table59999"));
        assert.ok(elapsedMs < 1_000, `catalog completion took ${elapsedMs.toFixed(1)} ms`);
    });
});
